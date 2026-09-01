import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function expect(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function loadEnv(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals > 0) values[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return values;
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

async function rpc(admin, name, args) {
  const result = await admin.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

async function createUser(admin, suffix) {
  const created = await admin.auth.admin.createUser({
    email: `p0-risk-${suffix}-${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: "Password!1234",
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const profile = await admin.from("profiles").upsert({
    id,
    anonymous_mode_enabled: true,
    anonymous_display_name: `Risk-${suffix}`,
    onboarding_completed: true,
    account_status: "active",
  });
  if (profile.error) throw profile.error;
  return id;
}

async function removeUser(admin, id) {
  if (!id) return;
  await admin.from("blocks").delete().or(`blocker_id.eq.${id},blocked_user_id.eq.${id}`);
  await admin.from("anonymous_risk_events").delete().eq("user_id", id);
  await admin.from("anonymous_risk_identities").delete().eq("current_user_id", id);
  await admin.from("profiles").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id, false);
}

const migration = read("supabase/migrations/20260901113000_web_v01_anonymous_matchmaking_identity_reconcile.sql");
const page = read("apps/web/app/page.tsx");
const fixture = read("work/herlink-production-active-session-fixture.mjs");
expect(migration.includes("reconcile_anonymous_matchmaking_identity"), "matcher must reconcile a missing risk identity on the server");
expect(migration.includes("PERFORM public.reconcile_anonymous_matchmaking_identity(p_actor_id)"), "join matcher must use reconciliation");
expect(!migration.includes("anonymous_avatar"), "name-only matcher must not require an avatar");
expect(!fixture.includes("anonymous_avatar"), "operator fixture must not require an avatar");
expect(!page.includes("clearAnonymousInstallationId"), "cooldown must not rotate installation identity");

const envPath = fs.existsSync(path.resolve(".supabase.test.env")) ? path.resolve(".supabase.test.env") : path.resolve(".env");
const env = loadEnv(envPath);
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Missing Supabase test credentials.");

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const created = [];
try {
  const missingIdentityUser = await createUser(admin, "missing");
  created.push(missingIdentityUser);
  expect((await rpc(admin, "is_anonymous_matchmaking_allowed", { p_user_id: missingIdentityUser })) === false, "missing identity starts rejected before reconciliation");
  await rpc(admin, "reconcile_anonymous_matchmaking_identity", { p_user_id: missingIdentityUser });
  expect((await rpc(admin, "is_anonymous_matchmaking_allowed", { p_user_id: missingIdentityUser })) === true, "missing identity should reconcile to allow");

  const cooldownUser = await createUser(admin, "cooldown");
  created.push(cooldownUser);
  const cooldownKey = crypto.createHash("md5").update(`risk-cooldown-${crypto.randomUUID()}`).digest("hex");
  const inserted = await admin.from("anonymous_risk_identities").insert({
    installation_key: cooldownKey,
    first_user_id: cooldownUser,
    current_user_id: cooldownUser,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    last_decision: "cooldown",
    cooldown_until: new Date(Date.now() + 60_000).toISOString(),
  });
  if (inserted.error) throw inserted.error;
  expect((await rpc(admin, "is_anonymous_matchmaking_allowed", { p_user_id: cooldownUser })) === false, "active cooldown must reject");
  const expired = await admin.from("anonymous_risk_identities").update({ cooldown_until: new Date(Date.now() - 1_000).toISOString() }).eq("installation_key", cooldownKey);
  if (expired.error) throw expired.error;
  await rpc(admin, "reconcile_anonymous_matchmaking_identity", { p_user_id: cooldownUser });
  expect((await rpc(admin, "is_anonymous_matchmaking_allowed", { p_user_id: cooldownUser })) === true, "expired cooldown must recover");

  const restrictedUser = await createUser(admin, "restricted");
  created.push(restrictedUser);
  await rpc(admin, "reconcile_anonymous_matchmaking_identity", { p_user_id: restrictedUser });
  const suspended = await admin.from("profiles").update({ account_status: "suspended" }).eq("id", restrictedUser);
  if (suspended.error) throw suspended.error;
  expect((await rpc(admin, "is_anonymous_matchmaking_allowed", { p_user_id: restrictedUser })) === false, "suspended account must reject");

  const blockA = await createUser(admin, "block-a");
  const blockB = await createUser(admin, "block-b");
  created.push(blockA, blockB);
  const block = await admin.from("blocks").insert({ blocker_id: blockA, blocked_user_id: blockB });
  if (block.error) throw block.error;
  expect((await rpc(admin, "has_block_between", { user_a: blockA, user_b: blockB })) === true, "block relationship must remain enforced");

  console.log(JSON.stringify({ ok: true }));
} finally {
  for (const id of created.reverse()) await removeUser(admin, id).catch(() => {});
}

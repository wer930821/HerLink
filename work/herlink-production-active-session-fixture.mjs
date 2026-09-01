import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const MANIFEST_DIR = path.resolve("work", ".herlink-active-session-fixtures");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^fixture-[a-z0-9-]{12,80}$/;

function fail(message) {
  throw new Error(message);
}

function shortId(value) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function requireUuid(value, label) {
  if (!UUID_PATTERN.test(value ?? "")) {
    fail(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

function parseArgs(args) {
  if (args[0] === "--cleanup" && args.length === 2) {
    return { mode: "cleanup", runId: args[1] };
  }

  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index], args[index + 1]);
  }

  if (args.length !== 4 || !values.has("--user-a") || !values.has("--user-b")) {
    fail("Usage: node work/herlink-production-active-session-fixture.mjs --user-a <uuid> --user-b <uuid> | --cleanup <runId>");
  }

  return {
    mode: "create",
    userA: requireUuid(values.get("--user-a"), "--user-a"),
    userB: requireUuid(values.get("--user-b"), "--user-b"),
  };
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the local environment.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function manifestPath(runId) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) {
    fail("Invalid fixture run id.");
  }
  return path.join(MANIFEST_DIR, `${runId}.json`);
}

function writeManifest(manifest) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  const target = manifestPath(manifest.runId);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readManifest(runId) {
  const target = manifestPath(runId);
  if (!fs.existsSync(target)) {
    fail("Fixture manifest not found; cleanup refused.");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    fail("Fixture manifest is invalid; cleanup refused.");
  }

  if (
    manifest?.version !== 1 ||
    manifest?.runId !== runId ||
    !UUID_PATTERN.test(manifest?.sessionId ?? "") ||
    !UUID_PATTERN.test(manifest?.userA ?? "") ||
    !UUID_PATTERN.test(manifest?.userB ?? "")
  ) {
    fail("Fixture manifest does not describe a valid fixture; cleanup refused.");
  }

  return manifest;
}

async function requireResult(result, label) {
  if (result.error) {
    fail(`${label} failed.`);
  }
  return result.data;
}

async function verifyUser(admin, userId, label) {
  const data = await requireResult(await admin.auth.admin.getUserById(userId), `${label} lookup`);
  if (!data?.user) {
    fail(`${label} does not exist.`);
  }
  if (data.user.is_anonymous !== true) {
    fail(`${label} must be an anonymous auth user.`);
  }
}

async function assertSafeFixturePair(admin, userA, userB) {
  if (userA === userB) {
    fail("Fixture users must be different.");
  }

  await Promise.all([
    verifyUser(admin, userA, "User A"),
    verifyUser(admin, userB, "User B"),
    requireResult(await admin.rpc("reconcile_profile_enforcement_status", { p_target_user_id: userA }), "User A moderation reconciliation"),
    requireResult(await admin.rpc("reconcile_profile_enforcement_status", { p_target_user_id: userB }), "User B moderation reconciliation"),
  ]);

  const [profiles, userAAllowed, userBAllowed, blocked, activeSessions, queueRows] = await Promise.all([
    requireResult(
      await admin
        .from("profiles")
        .select("id,account_status,onboarding_completed,anonymous_mode_enabled,anonymous_display_name")
        .in("id", [userA, userB]),
      "Profile lookup"
    ),
    requireResult(await admin.rpc("is_anonymous_matchmaking_allowed", { p_user_id: userA }), "User A eligibility check"),
    requireResult(await admin.rpc("is_anonymous_matchmaking_allowed", { p_user_id: userB }), "User B eligibility check"),
    requireResult(await admin.rpc("has_block_between", { user_a: userA, user_b: userB }), "Block check"),
    requireResult(
      await admin
        .from("random_chat_sessions")
        .select("id")
        .eq("status", "active")
        .or(`user_a.eq.${userA},user_b.eq.${userA},user_a.eq.${userB},user_b.eq.${userB}`),
      "Active session check"
    ),
    requireResult(
      await admin
        .from("random_match_queue")
        .select("user_id,status")
        .in("user_id", [userA, userB])
        .in("status", ["waiting", "matched"]),
      "Queue check"
    ),
  ]);

  if (!Array.isArray(profiles) || profiles.length !== 2) {
    fail("Both users must have profiles.");
  }
  for (const profile of profiles) {
    if (
      profile.account_status !== "active" ||
      !profile.onboarding_completed ||
      !profile.anonymous_mode_enabled ||
      !String(profile.anonymous_display_name ?? "").trim()
    ) {
      fail("Both users must have eligible active anonymous profiles.");
    }
  }
  if (userAAllowed !== true || userBAllowed !== true) {
    fail("Both users must pass the current anonymous eligibility checks.");
  }
  if (blocked === true) {
    fail("Fixture users have a block relationship.");
  }
  if (Array.isArray(activeSessions) && activeSessions.length > 0) {
    fail("A fixture user already has an active random session.");
  }
  if (Array.isArray(queueRows) && queueRows.length > 0) {
    fail("A fixture user is already waiting or matched in the random queue.");
  }
}

async function createFixture(admin, userA, userB) {
  await assertSafeFixturePair(admin, userA, userB);

  const runId = `fixture-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = crypto.randomUUID();
  const [user_a, user_b] = [userA, userB].sort();
  const createdAt = new Date().toISOString();
  await requireResult(
    await admin.from("random_chat_sessions").insert({
      id: sessionId,
      user_a,
      user_b,
      status: "active",
      created_at: createdAt,
      ended_at: null,
      ended_by: null,
      ended_reason: null,
    }),
    "Fixture session insert"
  );

  try {
    writeManifest({ version: 1, runId, sessionId, userA, userB, createdAt });
  } catch {
    await admin.from("random_chat_sessions").delete().eq("id", sessionId);
    fail("Fixture manifest could not be written; fixture session was removed.");
  }

  console.log(`RUN ID: ${runId}`);
  console.log(`SESSION ID: ${shortId(sessionId)}`);
  console.log(`USER A: ${shortId(userA)}`);
  console.log(`USER B: ${shortId(userB)}`);
  console.log("STATUS: active");
}

async function cleanupFixture(admin, runId) {
  const manifest = readManifest(runId);
  const row = await requireResult(
    await admin
      .from("random_chat_sessions")
      .select("id,user_a,user_b")
      .eq("id", manifest.sessionId)
      .maybeSingle(),
    "Fixture session lookup"
  );

  if (!row) {
    fs.unlinkSync(manifestPath(runId));
    console.log(`CLEANUP: ${runId} already removed.`);
    return;
  }

  const expectedPair = [manifest.userA, manifest.userB].sort().join(":");
  const actualPair = [row.user_a, row.user_b].sort().join(":");
  if (actualPair !== expectedPair) {
    fail("Fixture session pair does not match its manifest; cleanup refused.");
  }

  for (const table of ["random_chat_messages", "realtime_diagnostics", "fraud_risk_events"]) {
    await requireResult(await admin.from(table).delete().eq("session_id", manifest.sessionId), `${table} cleanup`);
  }
  await requireResult(await admin.from("random_chat_sessions").delete().eq("id", manifest.sessionId), "Fixture session cleanup");
  fs.unlinkSync(manifestPath(runId));
  console.log(`CLEANUP: ${runId} removed.`);
}

async function run() {
  const command = parseArgs(process.argv.slice(2));
  const admin = getAdminClient();
  if (command.mode === "cleanup") {
    await cleanupFixture(admin, command.runId);
    return;
  }
  await createFixture(admin, command.userA, command.userB);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Fixture command failed.");
  process.exitCode = 1;
});

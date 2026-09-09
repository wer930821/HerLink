// Non-destructive live Supabase regression for Web matchmaking.
// It creates only uniquely named test accounts and removes them in finally.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--live")) {
  throw new Error("Refusing to run without --live.");
}

function loadEnv(file) {
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()])
  );
}

const env = loadEnv(path.resolve(".supabase.test.env"));
const url = env.EXPO_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceRoleKey) throw new Error("The isolated test environment is incomplete.");

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const userIds = [];
const expect = (condition, message) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
};

function userClient() {
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

async function rpc(client, name, args = {}) {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
}

async function createParticipant(label) {
  const email = `herlink-web-match-${label}-${runId}@example.invalid`;
  const created = await admin.auth.admin.createUser({ email, password: "Test-password-123!", email_confirm: true });
  if (created.error) throw created.error;
  const userId = created.data.user.id;
  userIds.push(userId);

  const profile = await admin.from("profiles").upsert({
    id: userId,
    anonymous_mode_enabled: true,
    anonymous_display_name: `配對測試${label}`,
    anonymous_avatar: "avatar_01",
    onboarding_completed: true,
    account_status: "active",
  });
  if (profile.error) throw profile.error;

  const client = userClient();
  const login = await client.auth.signInWithPassword({ email, password: "Test-password-123!" });
  if (login.error) throw login.error;
  await rpc(client, "register_anonymous_abuse_identity", { p_installation_id: `web-match-${label}-${runId}` });
  await rpc(client, "touch_online_activity", { p_instance_id: crypto.randomUUID() });
  return { client, userId };
}

async function queueRow(userId) {
  const result = await admin.from("random_match_queue").select("user_id,status,matched_session_id,joined_at,updated_at").eq("user_id", userId).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function leaveSession(client, sessionId) {
  const result = await client.rpc("leave_random_session", { p_session_id: sessionId });
  if (result.error) throw result.error;
}

async function cleanup() {
  for (const userId of userIds) {
    await admin.auth.admin.deleteUser(userId, false).catch(() => {});
  }
}

try {
  const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map(createParticipant));

  // A waits longer than the old queue.updated_at cutoff but remains active.
  const first = await rpc(a.client, "find_or_join_random_match");
  expect(first?.status === "waiting", "A enters waiting queue");
  const beforeMatch = await queueRow(a.userId);
  expect(beforeMatch?.status === "waiting" && !beforeMatch.matched_session_id, "A queue row is waiting without a session");
  const ageQueue = await admin.from("random_match_queue").update({ updated_at: new Date(Date.now() - 121_000).toISOString() }).eq("user_id", a.userId);
  if (ageQueue.error) throw ageQueue.error;

  const second = await rpc(b.client, "find_or_join_random_match");
  expect(second?.status === "matched" && Boolean(second.session_id), "B matches an active A despite A queue timestamp being old");
  const [aQueue, bQueue, aView, bView] = await Promise.all([
    queueRow(a.userId),
    queueRow(b.userId),
    rpc(a.client, "get_my_random_session_view"),
    rpc(b.client, "get_my_random_session_view"),
  ]);
  expect(aQueue?.status === "matched" && aQueue.matched_session_id === second.session_id, "A receives matched_session_id");
  expect(bQueue?.status === "matched" && bQueue.matched_session_id === second.session_id, "B receives matched_session_id");
  expect(aView?.id === second.session_id && bView?.id === second.session_id, "both Web identities resolve the same redirect session");
  await leaveSession(a.client, second.session_id);

  // A stale activity row must never be selected only because its queue exists.
  const staleJoin = await rpc(c.client, "find_or_join_random_match");
  expect(staleJoin?.status === "waiting", "C enters waiting queue");
  const expireC = await admin.from("online_activity").update({ seen_at: new Date(Date.now() - 121_000).toISOString() }).eq("user_id", c.userId);
  if (expireC.error) throw expireC.error;
  const dJoin = await rpc(d.client, "find_or_join_random_match");
  expect(dJoin?.status === "waiting", "D does not match stale C");
  const cleaned = await admin.rpc("cleanup_stale_random_queue");
  if (cleaned.error) throw cleaned.error;
  expect((await queueRow(c.userId))?.status === "left", "cleanup removes stale C queue row");
  await rpc(d.client, "leave_random_queue");

  // An account cannot create two queue rows or two active sessions from concurrent requests.
  await rpc(c.client, "touch_online_activity", { p_instance_id: crypto.randomUUID() });
  const concurrent = await Promise.all([
    rpc(c.client, "find_or_join_random_match"),
    rpc(c.client, "find_or_join_random_match"),
  ]);
  expect(concurrent.every((result) => result?.status === "waiting"), "same account concurrent joins remain waiting");
  expect((await queueRow(c.userId))?.status === "waiting", "same account has one waiting row");
  await rpc(c.client, "leave_random_queue");

  console.log(JSON.stringify({
    ok: true,
    runId,
    checks: [
      "waiting row created",
      "old queue timestamp with active heartbeat matches",
      "both queue rows receive the same session",
      "both Web identities resolve the same session",
      "stale waiter is excluded and cleaned",
      "concurrent same-account joins stay singular",
    ],
  }, null, 2));
} finally {
  await cleanup();
}

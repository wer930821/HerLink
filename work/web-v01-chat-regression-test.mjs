import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

function resolveEnvPath() {
  const dedicatedEnv = path.resolve(".supabase.test.env");
  return fs.existsSync(dedicatedEnv) ? dedicatedEnv : path.resolve(".env");
}

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeError(error) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function hashInstallationId(value) {
  return crypto.createHash("md5").update(String(value).trim().toLowerCase()).digest("hex");
}

function makeClient(url, key, authHeader) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: authHeader
      ? {
          headers: {
            Authorization: `Bearer ${authHeader}`,
          },
        }
      : undefined,
  });
}

async function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

async function createUser(admin, email, password) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}

async function deleteUser(admin, userId) {
  if (!userId) return;
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error) throw error;
}

async function signIn(url, anonKey, email, password) {
  const client = makeClient(url, anonKey);
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return { client, session: result.data.session };
}

async function rpcOrThrow(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function rpcRows(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function cleanupRandomChatState(admin) {
  const cleanupQueries = [
    admin.from("random_chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    admin.from("random_chat_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    admin.from("random_match_queue").delete().neq("user_id", "00000000-0000-0000-0000-000000000000"),
    admin.from("random_pair_history").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    admin.from("random_action_rate_limit_events").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    admin.from("fraud_risk_events").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    admin.from("reports").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    admin.from("blocks").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
  ];
  const results = await Promise.all(cleanupQueries);
  for (const result of results) {
    if (result.error) throw result.error;
  }
}

async function registerAbuseIdentity(client, installationId) {
  const { data, error } = await client.rpc("register_anonymous_abuse_identity", {
    p_installation_id: installationId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function upsertAnonymousProfile(admin, userId, name, avatar) {
  const { error } = await admin.from("profiles").upsert({
    id: userId,
    anonymous_mode_enabled: true,
    anonymous_display_name: name,
    anonymous_avatar: avatar,
    onboarding_completed: true,
  });
  if (error) throw error;
}

async function joinPairIsolated(admin, clientA, clientB, rpcName = "find_or_join_random_match") {
  await cleanupRandomChatState(admin);
  const first = await rpcOrThrow(clientA, rpcName);
  await expect(first?.status === "waiting", "first join should wait");
  const second = await rpcOrThrow(clientB, rpcName);
  await expect(second?.status === "matched", "second join should match");
  await expect(Boolean(second?.session_id), "match should return session id");
  return second.session_id;
}

async function getSession(admin, sessionId) {
  const { data, error } = await admin
    .from("random_chat_sessions")
    .select("id,status,ended_at,ended_reason,ended_by,user_a,user_b")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function sendAndVerifyStep({
  admin,
  senderClient,
  senderLabel,
  partnerClient,
  sessionId,
  expectedCount,
  content,
}) {
  const result = await rpcOrThrow(senderClient, "send_random_message", {
    p_session_id: sessionId,
    p_content: content,
  });

  await expect(result?.content === content, `${senderLabel} should get inserted content back`);

  const [senderMessages, partnerMessages] = await Promise.all([
    rpcRows(senderClient, "list_random_messages", { p_session_id: sessionId, p_limit: 200 }),
    rpcRows(partnerClient, "list_random_messages", { p_session_id: sessionId, p_limit: 200 }),
  ]);
  await expect(senderMessages.length === expectedCount, `${senderLabel} should see ${expectedCount} messages`);
  await expect(partnerMessages.length === expectedCount, `partner should see ${expectedCount} messages`);
  await expect(
    senderMessages[senderMessages.length - 1]?.content === content,
    `${senderLabel} latest message should match`
  );
  await expect(
    partnerMessages[partnerMessages.length - 1]?.content === content,
    `partner latest message should match`
  );

  const session = await getSession(admin, sessionId);
  await expect(session?.status === "active", "session should remain active");
  await expect(session?.ended_at == null, "session should keep ended_at null");

  return result;
}

async function run() {
  const env = loadEnv(resolveEnvPath());
  const url = env.EXPO_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assertEnv("EXPO_PUBLIC_SUPABASE_URL", url);
  assertEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  assertEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);

  const admin = makeClient(url, serviceRoleKey);
  const stamp = Date.now();
  await cleanupRandomChatState(admin);
  const users = {
    a: { email: `chat-reg-a-${stamp}@example.com`, password: "Password!1234", name: "夜行列車", avatar: "avatar_01" },
    b: { email: `chat-reg-b-${stamp}@example.com`, password: "Password!1234", name: "雨後街角", avatar: "avatar_02" },
    c: { email: `chat-reg-c-${stamp}@example.com`, password: "Password!1234", name: "晨霧海岸", avatar: "avatar_03" },
    d: { email: `chat-reg-d-${stamp}@example.com`, password: "Password!1234", name: "晚風日記", avatar: "avatar_04" },
    e: { email: `chat-reg-e-${stamp}@example.com`, password: "Password!1234", name: "白色耳機", avatar: "avatar_05" },
    f: { email: `chat-reg-f-${stamp}@example.com`, password: "Password!1234", name: "月台盡頭", avatar: "avatar_06" },
    g: { email: `chat-reg-g-${stamp}@example.com`, password: "Password!1234", name: "藍色車站", avatar: "avatar_07" },
    h: { email: `chat-reg-h-${stamp}@example.com`, password: "Password!1234", name: "晨霧書頁", avatar: "avatar_08" },
  };

  const createdUserIds = {};
  const installationKeys = {};
  const clients = {};
  const summary = { tests: {} };

  try {
    for (const [key, user] of Object.entries(users)) {
      createdUserIds[key] = await createUser(admin, user.email, user.password);
      await upsertAnonymousProfile(admin, createdUserIds[key], user.name, user.avatar);
      const { client } = await signIn(url, anonKey, user.email, user.password);
      installationKeys[key] = `web-v01-chat-install-${key}-${stamp}`;
      await registerAbuseIdentity(client, installationKeys[key]);
      clients[key] = client;
    }

    summary.tests.chat_20_messages = await (async () => {
      const sessionId = await joinPairIsolated(admin, clients.a, clients.b);
      await expect(Boolean(sessionId), "chat session should exist");

      let expectedCount = 0;
      for (let i = 1; i <= 20; i += 1) {
        const senderKey = i % 2 === 1 ? "a" : "b";
        const senderClient = clients[senderKey];
        const partnerClient = clients[senderKey === "a" ? "b" : "a"];
        expectedCount += 1;
        await sendAndVerifyStep({
          admin,
          senderClient,
          senderLabel: senderKey.toUpperCase(),
          partnerClient,
          sessionId,
          expectedCount,
          content: `chat-regression ${i} from ${senderKey.toUpperCase()}`,
        });
        await sleep(1100);
      }

      const finalSession = await getSession(admin, sessionId);
      await expect(finalSession?.status === "active", "session should stay active through 20 messages");
      await expect(finalSession?.ended_at == null, "session ended_at should stay null through 20 messages");

      const [aMessages, bMessages] = await Promise.all([
        rpcRows(clients.a, "list_random_messages", { p_session_id: sessionId, p_limit: 200 }),
        rpcRows(clients.b, "list_random_messages", { p_session_id: sessionId, p_limit: 200 }),
      ]);
      await expect(aMessages.length === 20, "A should see 20 messages");
      await expect(bMessages.length === 20, "B should see 20 messages");

      return { ok: true, sessionId, messageCount: aMessages.length };
    })();

    summary.tests.realtime_recovery = await (async () => {
      const sessionId = await joinPairIsolated(admin, clients.c, clients.d);
      await rpcOrThrow(clients.c, "send_random_message", {
        p_session_id: sessionId,
        p_content: "realtime recovery seed 1",
      });
      await rpcOrThrow(clients.d, "send_random_message", {
        p_session_id: sessionId,
        p_content: "realtime recovery seed 2",
      });

      await sleep(800);
      const recoveredMessages = await rpcRows(clients.c, "list_random_messages", {
        p_session_id: sessionId,
        p_limit: 200,
      });
      await expect(recoveredMessages.length === 2, "reconciliation should recover both messages");

      return { ok: true, sessionId, messageCount: recoveredMessages.length };
    })();

    summary.tests.leave_flow = await (async () => {
      const sessionId = await joinPairIsolated(admin, clients.e, clients.f);
      const leaveResult = await rpcOrThrow(clients.e, "leave_random_session", { p_session_id: sessionId });
      await expect(leaveResult?.ended === true, "leave should end the session");
      const endedSession = await getSession(admin, sessionId);
      await expect(endedSession?.status === "ended", "leave session should end");
      await expect(endedSession?.ended_reason === "left", "leave should set ended_reason left");
      return { ok: true, sessionId };
    })();

    summary.tests.next_flow = await (async () => {
      const sessionId = await joinPairIsolated(admin, clients.g, clients.h);
      const nextByG = await rpcOrThrow(clients.g, "next_random_match", { p_session_id: sessionId });
      await expect(nextByG?.status === "waiting", "G should go back to waiting");
      const endedSession = await getSession(admin, sessionId);
      await expect(endedSession?.status === "ended", "next should end the original session");
      await expect(endedSession?.ended_reason === "next", "next should set ended_reason next");
      const gQueue = await admin.from("random_match_queue").select("status,matched_session_id").eq("user_id", createdUserIds.g).maybeSingle();
      await expect(!gQueue.error && gQueue.data?.status === "waiting", "G queue should be waiting after next");
      return { ok: true, sessionId };
    })();

    summary.tests.block_and_report = await (async () => {
      const sessionId = await joinPairIsolated(admin, clients.a, clients.b);

      const reportOnly = await rpcOrThrow(clients.a, "report_random_user", {
        p_session_id: sessionId,
        p_category: "harassment",
        p_description: "測試檢舉保留對話",
        p_block: false,
      });
      await expect(reportOnly?.blocked === false, "report-only should not block");

      const reportRow = await admin
        .from("reports")
        .select("id,reporter_id,reported_user_id,random_session_id,category,status,description")
        .eq("id", reportOnly.report_id)
        .maybeSingle();
      await expect(!reportRow.error && Boolean(reportRow.data), "report row should exist");
      await expect(reportRow.data?.reporter_id === createdUserIds.a, "reporter id should be A");
      await expect(reportRow.data?.reported_user_id === createdUserIds.b, "reported id should be B");
      await expect(reportRow.data?.random_session_id === sessionId, "report should keep session id");

      const sessionAfterReport = await getSession(admin, sessionId);
      await expect(sessionAfterReport?.status === "active", "report-only should keep session active");

      const blockSessionId = await joinPairIsolated(admin, clients.c, clients.d);
      const blockResult = await rpcOrThrow(clients.c, "report_random_user", {
        p_session_id: blockSessionId,
        p_category: "harassment",
        p_description: "測試檢舉並封鎖",
        p_block: true,
      });
      await expect(blockResult?.blocked === true, "report with block should block");

      const blockedSession = await getSession(admin, blockSessionId);
      await expect(blockedSession?.status === "ended", "block report should end session");
      await expect(blockedSession?.ended_reason === "blocked", "block report should set ended_reason blocked");

      const blockedRow = await admin
        .from("blocks")
        .select("id,blocker_id,blocked_user_id")
        .eq("blocker_id", createdUserIds.c)
        .eq("blocked_user_id", createdUserIds.d)
        .maybeSingle();
      await expect(!blockedRow.error && Boolean(blockedRow.data), "block row should exist");

      return {
        ok: true,
        reportOnly: { sessionId, reportId: reportOnly.report_id },
        reportAndBlock: { sessionId: blockSessionId, reportId: blockResult.report_id },
      };
    })();

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: summarizeError(error), summary }, null, 2));
    process.exitCode = 1;
  } finally {
    for (const userId of Object.values(createdUserIds)) {
      try {
        await deleteUser(admin, userId);
      } catch {
        // best effort cleanup
      }
    }
    for (const installationKey of Object.values(installationKeys)) {
      try {
        await admin.from("anonymous_risk_identities").delete().eq("installation_key", hashInstallationId(installationKey));
      } catch {
        // best effort cleanup
      }
    }
    try {
      await cleanupRandomChatState(admin);
    } catch {
      // best effort cleanup
    }
  }
}

void run();

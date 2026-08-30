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

function summarizeError(error) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
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

async function createUser(admin, email, password) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}

async function signIn(url, anonKey, email, password) {
  const client = makeClient(url, anonKey);
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return { client, session: result.data.session };
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

async function deleteUser(admin, userId) {
  if (!userId) return;
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error) throw error;
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

async function getQueueRow(admin, userId) {
  const { data, error } = await admin
    .from("random_match_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getActiveSession(admin, userA, userB) {
  const low = userA < userB ? userA : userB;
  const high = userA < userB ? userB : userA;
  const { data, error } = await admin
    .from("random_chat_sessions")
    .select("*")
    .eq("user_a", low)
    .eq("user_b", high)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
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
  const users = {
    h: {
      email: `web-v01-h-${stamp}@example.com`,
      password: "Password!1234",
      name: "晨霧書頁",
      avatar: "avatar_01",
    },
    a: {
      email: `web-v01-a-${stamp}@example.com`,
      password: "Password!1234",
      name: "夜行列車",
      avatar: "avatar_02",
    },
    b: {
      email: `web-v01-b-${stamp}@example.com`,
      password: "Password!1234",
      name: "雨後街角",
      avatar: "avatar_03",
    },
    c: {
      email: `web-v01-c-${stamp}@example.com`,
      password: "Password!1234",
      name: "晨霧海岸",
      avatar: "avatar_06",
    },
    d: {
      email: `web-v01-d-${stamp}@example.com`,
      password: "Password!1234",
      name: "晚風日記",
      avatar: "avatar_07",
    },
    e: {
      email: `web-v01-e-${stamp}@example.com`,
      password: "Password!1234",
      name: "白色耳機",
      avatar: "avatar_08",
    },
    f: {
      email: `web-v01-f-${stamp}@example.com`,
      password: "Password!1234",
      name: "月台盡頭",
      avatar: "avatar_04",
    },
    g: {
      email: `web-v01-g-${stamp}@example.com`,
      password: "Password!1234",
      name: "藍色車站",
      avatar: "avatar_05",
    },
  };

  const createdUserIds = {};
  const installationKeys = {};
  const clients = {};
  const summary = {
    tests: {},
  };

  try {
    for (const [key, user] of Object.entries(users)) {
      createdUserIds[key] = await createUser(admin, user.email, user.password);
      await upsertAnonymousProfile(admin, createdUserIds[key], user.name, user.avatar);
      const { client } = await signIn(url, anonKey, user.email, user.password);
      installationKeys[key] = `web-v01-install-${key}-${stamp}`;
      await registerAbuseIdentity(client, installationKeys[key]);
      clients[key] = client;
    }

    summary.tests.concurrent_self_queue = await (async () => {
      const [first, second] = await Promise.all([
        rpcOrThrow(clients.h, "find_or_join_random_match"),
        rpcOrThrow(clients.h, "find_or_join_random_match"),
      ]);
      const activeSessions = await admin
        .from("random_chat_sessions")
        .select("id")
        .or(`user_a.eq.${createdUserIds.h},user_b.eq.${createdUserIds.h}`)
        .eq("status", "active");
      await rpcOrThrow(clients.h, "leave_random_queue");
      const queueRow = await getQueueRow(admin, createdUserIds.h);
      await expect(first?.status === "waiting" || second?.status === "waiting", "self join should wait");
      await expect(!activeSessions.error && (activeSessions.data ?? []).length === 0, "self join should not create active session");
      await expect(queueRow?.status === "left", "self queue should be cleaned up");
      return { ok: true, first: first?.status, second: second?.status };
    })();

    summary.tests.first_match = await (async () => {
      const firstJoin = await rpcOrThrow(clients.a, "find_or_join_random_match");
      await expect(firstJoin?.status === "waiting", "A should wait first");
      const queueA = await getQueueRow(admin, createdUserIds.a);
      await expect(queueA?.status === "waiting", "A queue should be waiting");

      const secondJoin = await rpcOrThrow(clients.b, "find_or_join_random_match");
      await expect(secondJoin?.status === "matched", "B should match A");
      const sessionId = secondJoin?.session_id;
      await expect(Boolean(sessionId), "match should return session id");

      const session = await getActiveSession(admin, createdUserIds.a, createdUserIds.b);
      await expect(Boolean(session), "active session should exist");
      await expect(session.status === "active", "session should be active");
      await expect(session.user_a < session.user_b, "session pair should be canonical");

      const aQueue = await getQueueRow(admin, createdUserIds.a);
      const bQueue = await getQueueRow(admin, createdUserIds.b);
      await expect(aQueue?.status === "matched", "A queue should be matched");
      await expect(bQueue?.status === "matched", "B queue should be matched");
      await expect(aQueue?.matched_session_id === sessionId, "A queue should store session id");
      await expect(bQueue?.matched_session_id === sessionId, "B queue should store session id");

      const strangerRead = await clients.h.from("random_chat_sessions").select("*").eq("id", sessionId).maybeSingle();
      await expect(!strangerRead.error && strangerRead.data == null, "stranger cannot read session");

      const strangerEnd = await clients.h.rpc("leave_random_session", { p_session_id: sessionId });
      await expect(
        Boolean(strangerEnd.error) || Array.isArray(strangerEnd.data) && strangerEnd.data[0]?.ended === false,
        "stranger should not be able to end session"
      );

      const endedByA = await rpcOrThrow(clients.a, "leave_random_session", { p_session_id: sessionId });
      await expect(endedByA?.ended === true, "A can end session");

      const endedSession = await getActiveSession(admin, createdUserIds.a, createdUserIds.b);
      await expect(endedSession?.status === "ended", "session should be ended");

      return { ok: true, sessionId };
    })();

    summary.tests.repeat_protection = await (async () => {
      const aRetry = await rpcOrThrow(clients.a, "find_or_join_random_match");
      const bRetry = await rpcOrThrow(clients.b, "find_or_join_random_match");
      await expect(aRetry?.status === "waiting", "A should wait on repeat protection");
      await expect(bRetry?.status === "waiting", "B should wait on repeat protection");
      const activeSession = await getActiveSession(admin, createdUserIds.a, createdUserIds.b);
      await expect(activeSession?.status !== "active", "A/B should not rematch within 24h");
      await rpcOrThrow(clients.a, "leave_random_queue");
      await rpcOrThrow(clients.b, "leave_random_queue");
      return { ok: true };
    })();

    summary.tests.block_exclusion = await (async () => {
      await rpcOrThrow(clients.f, "block_user", { target_user_id: createdUserIds.g });
      const fJoin = await rpcOrThrow(clients.f, "find_or_join_random_match");
      const gJoin = await rpcOrThrow(clients.g, "find_or_join_random_match");
      await expect(fJoin?.status === "waiting", "F should wait when G is blocked");
      await expect(gJoin?.status === "waiting", "G should wait when F is blocked");
      const blockedSession = await getActiveSession(admin, createdUserIds.f, createdUserIds.g);
      await expect(blockedSession == null, "blocked pair should not match");
      await rpcOrThrow(clients.f, "leave_random_queue");
      await rpcOrThrow(clients.g, "leave_random_queue");
      return { ok: true };
    })();

    summary.tests.chat_flow = await (async () => {
      const cJoin = await rpcOrThrow(clients.c, "find_or_join_random_match");
      await expect(cJoin?.status === "waiting", "C should wait first");

      const dJoin = await rpcOrThrow(clients.d, "find_or_join_random_match");
      await expect(dJoin?.status === "matched", "D should match C");
      const sessionId = dJoin?.session_id;
      await expect(Boolean(sessionId), "chat session should have id");

      const ownSession = await clients.c.from("random_chat_sessions").select("*").eq("id", sessionId).maybeSingle();
      await expect(!ownSession.error && ownSession.data?.id === sessionId, "participant should recover own session");

      const strangerSession = await clients.h.from("random_chat_sessions").select("*").eq("id", sessionId).maybeSingle();
      await expect(!strangerSession.error && strangerSession.data == null, "third party cannot read random session");

      const sendByC = await rpcOrThrow(clients.c, "send_random_message", {
        p_session_id: sessionId,
        p_content: "你好，這是匿名聊天第一句。",
      });
      await expect(sendByC?.content === "你好，這是匿名聊天第一句。", "sender should get inserted message");

      const messagesByC = await rpcRows(clients.c, "list_random_messages", { p_session_id: sessionId });
      const messagesByD = await rpcRows(clients.d, "list_random_messages", { p_session_id: sessionId });
      await expect(messagesByC.length === 1, "C should read one message");
      await expect(messagesByD.length === 1, "D should read one message");
      await expect(messagesByC[0]?.content === messagesByD[0]?.content, "both members should read same message");

      const safePartner = await rpcRows(clients.c, "get_safe_anonymous_profiles", { p_user_ids: [createdUserIds.d] });
      await expect(!("email" in (safePartner[0] ?? {})), "safe projection should not leak email");

      const emptySend = await clients.c.rpc("send_random_message", {
        p_session_id: sessionId,
        p_content: "   ",
      });
      await expect(Boolean(emptySend.error), "empty message should be rejected");

      const longSend = await clients.c.rpc("send_random_message", {
        p_session_id: sessionId,
        p_content: "x".repeat(2001),
      });
      await expect(Boolean(longSend.error), "overlong message should be rejected");

      const forgedInsert = await clients.d.from("random_chat_messages").insert({
        session_id: sessionId,
        sender_id: createdUserIds.c,
        content: "偽造 sender",
      });
      await expect(Boolean(forgedInsert.error), "forged sender insert should fail");

      const strangerReadMessages = await clients.h.rpc("list_random_messages", { p_session_id: sessionId });
      await expect(Boolean(strangerReadMessages.error), "third party cannot read random messages");

      const strangerSend = await clients.h.rpc("send_random_message", {
        p_session_id: sessionId,
        p_content: "我是第三方。",
      });
      await expect(Boolean(strangerSend.error), "third party cannot send random messages");

      const strangerLeave = await clients.h.rpc("leave_random_session", { p_session_id: sessionId });
      await expect(
        Boolean(strangerLeave.error) || Array.isArray(strangerLeave.data) && strangerLeave.data[0]?.ended === false,
        "non participant should not end session"
      );

      const leaveByC = await rpcOrThrow(clients.c, "leave_random_session", { p_session_id: sessionId });
      await expect(leaveByC?.ended === true, "participant can leave random session");

      const sendAfterLeave = await clients.d.rpc("send_random_message", {
        p_session_id: sessionId,
        p_content: "離開後不應可送出。",
      });
      await expect(Boolean(sendAfterLeave.error), "ended session should reject send");

      const endedSession = await admin
        .from("random_chat_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();
      await expect(endedSession.data?.status === "ended", "session should be ended after leave");

      return { ok: true, sessionId };
    })();

    summary.tests.concurrent_next = await (async () => {
      const eJoin = await rpcOrThrow(clients.e, "find_or_join_random_match");
      await expect(eJoin?.status === "waiting", "E should wait first");

      const hJoin = await rpcOrThrow(clients.h, "find_or_join_random_match");
      await expect(hJoin?.status === "matched", "H should match E");
      const sessionId = hJoin?.session_id;
      await expect(Boolean(sessionId), "next test should have session id");

      const [nextByE, nextByH] = await Promise.all([
        rpcOrThrow(clients.e, "next_random_match", { p_session_id: sessionId }),
        rpcOrThrow(clients.h, "next_random_match", { p_session_id: sessionId }),
      ]);
      await expect(nextByE?.status === "waiting", "E should rejoin queue");
      await expect(nextByH?.status === "waiting", "H should rejoin queue");

      const activePair = await admin
        .from("random_chat_sessions")
        .select("id")
        .eq("status", "active")
        .or(`user_a.eq.${createdUserIds.e},user_b.eq.${createdUserIds.e},user_a.eq.${createdUserIds.h},user_b.eq.${createdUserIds.h}`);
      await expect(!activePair.error && (activePair.data ?? []).length === 0, "next should not leave two active sessions");

      const queueE = await getQueueRow(admin, createdUserIds.e);
      const queueH = await getQueueRow(admin, createdUserIds.h);
      await expect(queueE?.status === "waiting", "E queue should be waiting after next");
      await expect(queueH?.status === "waiting", "H queue should be waiting after next");

      await rpcOrThrow(clients.e, "leave_random_queue");
      await rpcOrThrow(clients.h, "leave_random_queue");
      return { ok: true, sessionId };
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
  }
}

void run();

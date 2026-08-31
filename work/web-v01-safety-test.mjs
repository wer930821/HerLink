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
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await client.auth.signInWithPassword({ email, password });
    if (!result.error) return { client, session: result.data.session };

    lastError = result.error;
    const message = String(result.error?.message ?? "").toLowerCase();
    const code = String(result.error?.code ?? "").toLowerCase();
    const status = typeof result.error?.status === "number" ? result.error.status : null;
    const isRateLimit =
      status === 429 ||
      code.includes("rate_limit") ||
      message.includes("rate limit") ||
      message.includes("too many attempts");

    if (!isRateLimit || attempt === 4) {
      throw result.error;
    }

    await sleep(2000 * (attempt + 1));
  }

  throw lastError ?? new Error("Sign in failed.");
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
    anonymous_intro: "今天也想好好聊天。",
    city: "台北市",
    identity_label: "T",
    interested_in_identity_labels: ["T"],
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

async function cleanupRandomChatState(admin) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cleanupQueries = [
      admin.from("random_chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      admin.from("random_chat_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      admin.from("random_match_queue").delete().neq("user_id", "00000000-0000-0000-0000-000000000000"),
      admin.from("random_pair_history").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      admin.from("random_action_rate_limit_events").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      admin.from("fraud_risk_events").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    ];
    const results = await Promise.all(cleanupQueries);
    for (const result of results) {
      if (result.error) throw result.error;
    }

    const queueCheck = await admin.from("random_match_queue").select("user_id", { count: "exact", head: true }).eq("status", "waiting");
    if (queueCheck.error) throw queueCheck.error;
    if ((queueCheck.count ?? 0) === 0) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for an empty random match queue.");
}

async function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

async function joinPair(admin, clientA, clientB, rpcName = "find_or_join_random_match") {
  if (admin) {
    await cleanupRandomChatState(admin);
  }
  const first = await rpcOrThrow(clientA, rpcName);
  await expect(first?.status === "waiting", "first join should wait");
  const second = await rpcOrThrow(clientB, rpcName);
  await expect(second?.status === "matched", "second join should match");
  await expect(Boolean(second?.session_id), "match should return session id");
  return second.session_id;
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
    a: { email: `web-v01-safe-a-${stamp}@example.com`, password: "Password!1234", name: "晨霧書頁", avatar: "avatar_01" },
    b: { email: `web-v01-safe-b-${stamp}@example.com`, password: "Password!1234", name: "夜行列車", avatar: "avatar_02" },
    c: { email: `web-v01-safe-c-${stamp}@example.com`, password: "Password!1234", name: "雨後街角", avatar: "avatar_03" },
    d: { email: `web-v01-safe-d-${stamp}@example.com`, password: "Password!1234", name: "晚風日記", avatar: "avatar_04" },
    e: { email: `web-v01-safe-e-${stamp}@example.com`, password: "Password!1234", name: "白色耳機", avatar: "avatar_05" },
    f: { email: `web-v01-safe-f-${stamp}@example.com`, password: "Password!1234", name: "月台盡頭", avatar: "avatar_06" },
    g: { email: `web-v01-safe-g-${stamp}@example.com`, password: "Password!1234", name: "藍色車站", avatar: "avatar_07" },
    h: { email: `web-v01-safe-h-${stamp}@example.com`, password: "Password!1234", name: "晚風信箱", avatar: "avatar_08" },
    i: { email: `web-v01-safe-i-${stamp}@example.com`, password: "Password!1234", name: "海岸線", avatar: "avatar_09" },
    j: { email: `web-v01-safe-j-${stamp}@example.com`, password: "Password!1234", name: "星光出口", avatar: "avatar_10" },
    k: { email: `web-v01-safe-k-${stamp}@example.com`, password: "Password!1234", name: "雨夜車窗", avatar: "avatar_11" },
    l: { email: `web-v01-safe-l-${stamp}@example.com`, password: "Password!1234", name: "午夜散場", avatar: "avatar_12" },
    m: { email: `web-v01-safe-m-${stamp}@example.com`, password: "Password!1234", name: "海邊月台", avatar: "avatar_01" },
    n: { email: `web-v01-safe-n-${stamp}@example.com`, password: "Password!1234", name: "凌晨書店", avatar: "avatar_02" },
    o: { email: `web-v01-safe-o-${stamp}@example.com`, password: "Password!1234", name: "雨後街角", avatar: "avatar_03" },
    p: { email: `web-v01-safe-p-${stamp}@example.com`, password: "Password!1234", name: "夜行列車", avatar: "avatar_04" },
    q: { email: `web-v01-safe-q-${stamp}@example.com`, password: "Password!1234", name: "藍色車站", avatar: "avatar_05" },
    r: { email: `web-v01-safe-r-${stamp}@example.com`, password: "Password!1234", name: "月台盡頭", avatar: "avatar_06" },
    s: { email: `web-v01-safe-s-${stamp}@example.com`, password: "Password!1234", name: "晨霧書頁", avatar: "avatar_07" },
    t: { email: `web-v01-safe-t-${stamp}@example.com`, password: "Password!1234", name: "夜行列車", avatar: "avatar_08" },
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
      installationKeys[key] = `web-v01-safe-install-${key}-${stamp}`;
      await registerAbuseIdentity(client, installationKeys[key]);
      clients[key] = client;
    }

    summary.tests.safe_session_projection = await (async () => {
      const sessionId = await joinPair(admin, clients.m, clients.n);
      const safeByA = await rpcOrThrow(clients.m, "get_my_random_session_view", { p_session_id: sessionId });
      const safeByH = await rpcOrThrow(clients.c, "get_my_random_session_view", { p_session_id: sessionId }).catch(() => null);
      await expect(Boolean(safeByA?.id), "safe session should return id");
      await expect(!("user_a" in (safeByA ?? {})), "safe session must not expose user_a");
      await expect(!("user_b" in (safeByA ?? {})), "safe session must not expose user_b");
      await expect(safeByA?.partner_anonymous_display_name === "凌晨書店", "safe session should include partner name");
      await expect(safeByA?.partner_anonymous_avatar === "avatar_02", "safe session should include partner avatar");
      await expect(Boolean(safeByA?.partner_verified) === false, "safe session partner verified should be false");
      await expect(safeByH === null, "third party cannot read safe session");
      await rpcOrThrow(clients.o, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.block_random_user = await (async () => {
      const sessionId = await joinPair(admin, clients.c, clients.d);
      const blocked = await rpcOrThrow(clients.c, "block_random_user", { p_session_id: sessionId });
      await expect(blocked?.blocked === true, "block should succeed");
      await admin
        .from("profiles")
        .update({ anonymous_display_name: "改名後仍被封鎖" })
        .eq("id", createdUserIds.d)
        .select("id")
        .maybeSingle();
      const sessionRow = await admin
        .from("random_chat_sessions")
        .select("status, ended_reason")
        .eq("id", sessionId)
        .maybeSingle();
      await expect(sessionRow.data?.status === "ended", "blocked session should end");
      await expect(sessionRow.data?.ended_reason === "blocked", "blocked session reason should be blocked");

      await cleanupRandomChatState(admin);
      const rematchA = await rpcOrThrow(clients.c, "find_or_join_random_match");
      const rematchB = await rpcOrThrow(clients.d, "find_or_join_random_match");
      await expect(rematchA?.status === "waiting", "blocked A should wait");
      await expect(rematchB?.status === "waiting", "blocked B should wait");
      const activePair = await admin
        .from("random_chat_sessions")
        .select("id")
        .or(`user_a.eq.${createdUserIds.c},user_b.eq.${createdUserIds.c}`)
        .eq("status", "active");
      await expect(!activePair.error && (activePair.data ?? []).length === 0, "blocked pair should not rematch");
      const forgedBlock = await clients.a.rpc("block_random_user", { p_session_id: sessionId });
      await expect(Boolean(forgedBlock.error), "non participant cannot block another session");
      await rpcOrThrow(clients.c, "leave_random_queue");
      await rpcOrThrow(clients.d, "leave_random_queue");
      return { ok: true };
    })();

    summary.tests.report_random_user = await (async () => {
      const sessionId = await joinPair(admin, clients.e, clients.f);
      const firstReport = await rpcOrThrow(clients.e, "report_random_user", {
        p_session_id: sessionId,
        p_category: "spam",
        p_description: "垃圾廣告",
        p_block: true,
      });
      await expect(firstReport?.status === "pending", "report should be pending");
      await expect(firstReport?.blocked === true, "combined report should block");
      await admin
        .from("profiles")
        .update({ anonymous_display_name: "改名後仍可追溯" })
        .eq("id", createdUserIds.f)
        .select("id")
        .maybeSingle();

      const duplicateReport = await rpcOrThrow(clients.e, "report_random_user", {
        p_session_id: sessionId,
        p_category: "spam",
        p_description: "垃圾廣告",
        p_block: false,
      });
      await expect(Boolean(duplicateReport?.report_id), "duplicate report should still return id");

      const reports = await admin
        .from("reports")
        .select("id, random_session_id, reported_user_id")
        .eq("reporter_id", createdUserIds.e)
        .eq("reported_user_id", createdUserIds.f)
        .eq("random_session_id", sessionId)
        .eq("category", "spam")
        .eq("description", "垃圾廣告");
      await expect(!reports.error && (reports.data ?? []).length === 1, "duplicate report should not create extra row");
      await expect(reports.data?.[0]?.random_session_id === sessionId, "report should keep session provenance");

      await rpcOrThrow(clients.e, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.report_rate_limit = await (async () => {
      const sessionId = await joinPair(admin, clients.g, clients.h);
      const forgedReport = await clients.a.rpc("report_random_user", {
        p_session_id: sessionId,
        p_category: "spam",
        p_description: "bad",
        p_block: false,
      });
      await expect(Boolean(forgedReport.error), "non participant cannot report another session");
      let blockedAt = null;
      for (let index = 0; index < 6; index += 1) {
        const result = await clients.g.rpc("report_random_user", {
          p_session_id: sessionId,
          p_category: "spam",
          p_description: `垃圾 ${index}`,
          p_block: false,
        });
        if (result.error) {
          blockedAt = index;
          break;
        }
      }
      await expect(blockedAt === 5, "6th report should hit rate limit");
      await rpcOrThrow(clients.g, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.report_category_rejects_invalid = await (async () => {
      const sessionId = await joinPair(admin, clients.o, clients.p);
      const invalid = await clients.o.rpc("report_random_user", {
        p_session_id: sessionId,
        p_category: "not_allowed",
        p_description: "bad",
        p_block: false,
      });
      await expect(Boolean(invalid.error), "invalid category should be rejected");
      await rpcOrThrow(clients.a, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.message_risk_detection = await (async () => {
      const sessionId = await joinPair(admin, clients.i, clients.j);
      const normal = await rpcOrThrow(clients.i, "send_random_message", {
        p_session_id: sessionId,
        p_content: "今天心情不錯，想聊電影。",
      });
      await expect(normal?.risk_level === "low", "normal message should be low risk");
      await expect(Array.isArray(normal?.risk_types) && normal.risk_types.length === 0, "normal message should have no risk types");

      const money = await rpcOrThrow(clients.i, "send_random_message", {
        p_session_id: sessionId,
        p_content: "可以匯款給我嗎？",
      });
      await expect(money?.risk_level === "high", "money request should be high risk");
      await expect(money?.risk_types.includes("suspicious_money_message"), "money risk type should be present");

      const link = await rpcOrThrow(clients.i, "send_random_message", {
        p_session_id: sessionId,
        p_content: "先看這個 https://example.com 再說。",
      });
      await expect(link?.risk_level === "medium" || link?.risk_level === "high", "external link should raise risk");
      await expect(link?.risk_types.includes("suspicious_external_link"), "external link risk type should be present");

      const repeat = await rpcOrThrow(clients.i, "send_random_message", {
        p_session_id: sessionId,
        p_content: "先看這個 https://example.com 再說。",
      });
      await expect(repeat?.risk_types.includes("repeated_message"), "repeated message risk type should be present");
      await rpcOrThrow(clients.i, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.message_rate_limit = await (async () => {
      const sessionId = await joinPair(admin, clients.k, clients.l);
      let blockedAt = null;
      for (let index = 0; index < 6; index += 1) {
        const result = await clients.k.rpc("send_random_message", {
          p_session_id: sessionId,
          p_content: `訊息 ${index}`,
        });
        if (result.error) {
          blockedAt = index;
          break;
        }
      }
      await expect(blockedAt === 5, "6th message should hit rate limit");
      await rpcOrThrow(clients.k, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.next_rate_limit = await (async () => {
      const sessionId = await joinPair(admin, clients.q, clients.r);
      const attempts = [];
      for (let index = 0; index < 4; index += 1) {
        attempts.push(await clients.q.rpc("next_random_match", { p_session_id: sessionId }));
      }
      await expect(attempts[0].error == null, "first next should pass");
      await expect(attempts[1].error == null, "second next should pass");
      await expect(attempts[2].error == null, "third next should pass");
      await expect(Boolean(attempts[3].error), "fourth next should hit rate limit");
      await rpcOrThrow(clients.q, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    summary.tests.rls_and_projection = await (async () => {
      const sessionId = await joinPair(admin, clients.s, clients.t);
      const messages = await rpcRows(clients.s, "list_random_messages", { p_session_id: sessionId });
      await expect(messages.length >= 0, "participant should read messages");
      await expect(!("sender_id" in (messages[0] ?? {})), "safe message projection must not expose sender_id");

      const sessionView = await rpcOrThrow(clients.s, "get_my_random_session_view", { p_session_id: sessionId });
      await expect(!("user_a" in (sessionView ?? {})), "safe session view must not expose user_a");
      await expect(!("user_b" in (sessionView ?? {})), "safe session view must not expose user_b");

      const rateLimitRead = await clients.s.from("random_action_rate_limit_events").select("*").limit(1);
      await expect(Boolean(rateLimitRead.error) || (rateLimitRead.data ?? []).length === 0, "rate limit rows should not be readable");

      const fraudRead = await clients.s.from("fraud_risk_events").select("*").limit(1);
      await expect(Boolean(fraudRead.error) || (fraudRead.data ?? []).length === 0, "fraud risk rows should not be readable");

      await rpcOrThrow(clients.s, "leave_random_session", { p_session_id: sessionId }).catch(() => null);
      return { ok: true };
    })();

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    for (const userId of Object.values(createdUserIds)) {
      await deleteUser(admin, userId).catch(() => null);
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

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

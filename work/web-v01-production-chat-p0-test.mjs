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

function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

function hashInstallationId(value) {
  return crypto.createHash("md5").update(String(value).trim().toLowerCase()).digest("hex");
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

async function listAllAuthUsers(admin) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage });
    if (result.error) throw result.error;

    const pageUsers = Array.isArray(result.data?.users)
      ? result.data.users
      : Array.isArray(result.data?.data?.users)
        ? result.data.data.users
        : [];

    users.push(...pageUsers);
    if (pageUsers.length < perPage) {
      break;
    }
  }

  return users;
}

function collectLegacyTestDisplayNames() {
  const names = new Set([
    "pp",
    "qq",
    "ㄍㄌ",
    "先從你好開始",
    "只是路過",
    "Gou / PPL",
    "067",
    "本人拒絕內耗",
    "慢熟但有上線",
    "該睡了",
    "快要睡了",
    "Uuuuu",
    "大腦正在連線",
    "en",
    "LH",
    "我是機器人",
    "晚安",
    "沒有要幹嘛",
    "很高興認識妳",
    "聊天隨緣就好",
    "有時候都突然不能傳訊息",
    "怎麼一直不能回覆",
    "睡覺不戴眼罩",
    "rr",
    "明天一定早睡",
    "目前沒有當機",
    "本人版本穩定",
    "訊號目前良好",
    "不要再聊到一半跳掉了😭",
    "快跟我聊天～～～",
    "快跟我聊天～～",
    "看看誰還沒睡",
    "正在練習聊天",
    "下輩子不當人",
    "火鍋不能有芋頭",
    "今天先求穩",
    "今天先這樣",
    "今天不想動腦",
    "等等要吃飯",
    "剛加班完",
    "蘿蔔糕好辣",
    "咖啡需要加倍",
    "555",
    "ㄍㄌ",
    "名字還在想",
    "先讓我想一下",
  ]);
  const workDir = path.resolve("work");
  let files = [];

  try {
    files = fs.readdirSync(workDir).filter((file) => file.startsWith("web-v01-") && file.endsWith(".mjs"));
  } catch {
    return [...names];
  }

  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(workDir, file), "utf8");
    } catch {
      continue;
    }

    const patterns = [
      /anonymous_display_name:\s*"([^"]+)"/g,
      /name:\s*"([^"]+)"/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const value = String(match[1] ?? "").trim();
        if (value) {
          names.add(value);
        }
      }
    }
  }

  return [...names];
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

async function waitFor(predicate, label, timeoutMs = 15000, intervalMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForChannelSubscribe(channel, label, timeoutMs = 15000) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label} to subscribe`));
    }, timeoutMs);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        reject(new Error(`${label} subscribe failed with status ${status}`));
      }
    });
  });
}

function openRealtimeCollector(client, { channelName, table, event, filter, map }) {
  const events = [];
  const channel = client.channel(channelName);

  channel.on(
    "postgres_changes",
    {
      event,
      schema: "public",
      table,
      filter,
    },
    (payload) => {
      events.push(map(payload));
    }
  );

  const ready = waitForChannelSubscribe(channel, channelName);

  return {
    channel,
    events,
    ready,
    async waitFor(label, predicate, timeoutMs = 15000) {
      return await waitFor(() => events.find(predicate), label, timeoutMs);
    },
    async close() {
      await client.removeChannel(channel);
    },
  };
}

async function cleanupRandomChatState(admin, { userIds = [], sessionIds = [], installationKeys = [] } = {}) {
  const deletions = [];

  if (sessionIds.length > 0) {
    deletions.push(
      admin.from("random_chat_messages").delete().in("session_id", sessionIds),
      admin.from("random_chat_sessions").delete().in("id", sessionIds),
      admin.from("fraud_risk_events").delete().in("session_id", sessionIds),
      admin.from("reports").delete().in("random_session_id", sessionIds)
    );
  }

  if (userIds.length > 0) {
    deletions.push(
      admin.from("random_match_queue").delete().in("user_id", userIds),
      admin.from("random_pair_history").delete().or(`user_a.in.(${userIds.join(",")}),user_b.in.(${userIds.join(",")})`),
      admin.from("random_action_rate_limit_events").delete().in("user_id", userIds),
      admin.from("anonymous_risk_events").delete().in("user_id", userIds),
      admin.from("fraud_risk_events").delete().in("user_id", userIds),
      admin.from("reports").delete().or(`reporter_id.in.(${userIds.join(",")}),reported_user_id.in.(${userIds.join(",")})`),
      admin.from("blocks").delete().or(`blocker_id.in.(${userIds.join(",")}),blocked_user_id.in.(${userIds.join(",")})`),
      admin.from("moderation_enforcements").delete().in("subject_user_id", userIds),
      admin.from("profiles").delete().in("id", userIds)
    );
  }

  if (installationKeys.length > 0) {
    deletions.push(admin.from("anonymous_risk_events").delete().in("installation_key", installationKeys));
    deletions.push(admin.from("anonymous_risk_identities").delete().in("installation_key", installationKeys));
  }

  const results = await Promise.all(deletions);
  for (const result of results) {
    if (result.error) throw result.error;
  }
}

async function cleanupKnownTestState(admin) {
  const staleCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const users = await listAllAuthUsers(admin);
  const testUsers = users.filter((user) => {
    const email = String(user.email ?? "").toLowerCase();
    return (
      email.endsWith("@example.com") &&
      (
        email.startsWith("p0-") ||
        email.startsWith("web-v01-") ||
        email.startsWith("chat-reg-") ||
        email.startsWith("admin-smoke-")
      )
    );
  });

  const profileIds = new Set(testUsers.map((user) => user.id));

  const staleSessions = await admin
    .from("random_chat_sessions")
    .select("user_a,user_b")
    .eq("status", "active")
    .lt("created_at", staleCutoff);
  if (staleSessions.error) throw staleSessions.error;
  for (const row of staleSessions.data ?? []) {
    if (row?.user_a) profileIds.add(row.user_a);
    if (row?.user_b) profileIds.add(row.user_b);
  }

  const staleQueue = await admin
    .from("random_match_queue")
    .select("user_id")
    .lte("updated_at", staleCutoff);
  if (staleQueue.error) throw staleQueue.error;
  for (const row of staleQueue.data ?? []) {
    if (row?.user_id) profileIds.add(row.user_id);
  }

  const legacyDisplayNames = collectLegacyTestDisplayNames();

  for (const name of legacyDisplayNames) {
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("anonymous_display_name", name);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row?.id) {
        profileIds.add(row.id);
      }
    }
  }

  const legacyDisplayPatterns = [
    "%快跟我聊天%",
    "%不要再聊到一半跳掉%",
    "%有時候都突然不能傳訊息%",
    "%怎麼一直不能回覆%",
  ];
  for (const pattern of legacyDisplayPatterns) {
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .ilike("anonymous_display_name", pattern);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row?.id) {
        profileIds.add(row.id);
      }
    }
  }

  const userIds = [...profileIds];
  if (userIds.length === 0) {
    return;
  }

  const sessionIds = [];
  for (let offset = 0; offset < userIds.length; offset += 200) {
    const chunk = userIds.slice(offset, offset + 200);
    const { data, error } = await admin
      .from("random_chat_sessions")
      .select("id")
      .or(`user_a.in.(${chunk.join(",")}),user_b.in.(${chunk.join(",")})`);
    if (error) throw error;
    sessionIds.push(...(data ?? []).map((row) => row.id));
  }

  const installationKeys = [];
  for (let offset = 0; offset < userIds.length; offset += 200) {
    const chunk = userIds.slice(offset, offset + 200);
    const { data, error } = await admin
      .from("anonymous_risk_identities")
      .select("installation_key")
      .in("current_user_id", chunk);
    if (error) throw error;
    installationKeys.push(...(data ?? []).map((row) => row.installation_key));
  }

  await cleanupRandomChatState(admin, {
    userIds,
    sessionIds,
    installationKeys,
  });

  for (const userId of userIds) {
    await deleteUser(admin, userId).catch(() => {});
  }
}

async function createAnonymousParticipant(admin, url, anonKey, stamp, label, avatar) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `p0-${label}-${stamp}-${suffix}@example.com`;
  const password = "Password!1234";
  const name = `P0-${label}-${suffix}`;
  const installationId = `p0-${label}-${stamp}-${suffix}`;

  const userId = await createUser(admin, email, password);
  const client = await (async () => {
    const auth = await signIn(url, anonKey, email, password);
    return auth.client;
  })();

  const profileResult = await admin.from("profiles").upsert({
    id: userId,
    anonymous_mode_enabled: true,
    anonymous_display_name: name,
    anonymous_avatar: avatar,
    onboarding_completed: true,
  });
  if (profileResult.error) throw profileResult.error;

  const identityResult = await client.rpc("register_anonymous_abuse_identity", {
    p_installation_id: installationId,
  });
  if (identityResult.error) throw identityResult.error;

  return {
    userId,
    email,
    password,
    name,
    avatar,
    installationId,
    installationKey: hashInstallationId(installationId),
    client,
  };
}

async function createRandomChatFixture(admin, url, anonKey, runId, cleanup) {
  const participantA = await createAnonymousParticipant(admin, url, anonKey, runId, "fixture-a", "avatar_01");
  const participantB = await createAnonymousParticipant(admin, url, anonKey, runId, "fixture-b", "avatar_02");
  cleanup.users.push(participantA.userId, participantB.userId);
  cleanup.installationKeys.push(participantA.installationKey, participantB.installationKey);

  const sessionId = crypto.randomUUID();
  const [user_a, user_b] = [participantA.userId, participantB.userId].sort();
  const sessionResult = await admin.from("random_chat_sessions").insert({
    id: sessionId,
    user_a,
    user_b,
    status: "active",
    created_at: new Date().toISOString(),
    ended_at: null,
    ended_by: null,
    ended_reason: null,
  });
  if (sessionResult.error) throw sessionResult.error;

  cleanup.sessionIds.push(sessionId);

  return {
    participantA,
    participantB,
    sessionId,
  };
}

async function ensureWaiting(participant, cleanup, label) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await rpcOrThrow(participant.client, "find_or_join_random_match");
    if (result?.status === "waiting") {
      return result;
    }

    expect(result?.status === "matched", `${label}: unexpected join status`);
    expect(Boolean(result.session_id), `${label}: matched join should return session id`);
    cleanup.sessionIds.push(result.session_id);

    const endResult = await rpcOrThrow(participant.client, "block_random_user", {
      p_session_id: result.session_id,
    });
    expect(Boolean(endResult?.blocked), `${label}: stray match should be blockable`);
    expect(Boolean(endResult?.session_ended), `${label}: stray match should end cleanly`);
  }

  throw new Error(`${label}: failed to reach waiting state after retries`);
}

async function assertMessageVisible(admin, client, sessionId, messageId, content, expectedCount) {
  const dbRows = await rpcRows(client, "list_random_messages", {
    p_session_id: sessionId,
    p_limit: 200,
  });
  expect(dbRows.length === expectedCount, `session should contain ${expectedCount} messages`);
  expect(dbRows.some((item) => item.id === messageId), "database should contain the sent message");
  expect(dbRows[dbRows.length - 1]?.content === content, "latest database message should match content");

  const directRow = await admin
    .from("random_chat_messages")
    .select("id,session_id,sender_id,content,created_at,risk_level,risk_types")
    .eq("id", messageId)
    .maybeSingle();
  if (directRow.error) throw directRow.error;
  expect(Boolean(directRow.data), "direct database row should exist");
  expect(directRow.data.content === content, "direct database row should match content");
}

async function sendAndVerifyStep({
  admin,
  sender,
  receiverCollector,
  sessionId,
  content,
  expectedCount,
  label,
}) {
  const result = await rpcOrThrow(sender.client, "send_random_message", {
    p_session_id: sessionId,
    p_content: content,
  });

  expect(Boolean(result?.id), `${label}: rpc should return inserted message`);
  expect(result.content === content, `${label}: rpc result content should match`);
  expect(result.session_id === sessionId, `${label}: rpc result session should match`);
  expect(result.is_mine === true, `${label}: rpc result should be marked as mine`);

  await assertMessageVisible(admin, sender.client, sessionId, result.id, content, expectedCount);
  const directSender = await admin
    .from("random_chat_messages")
    .select("sender_id")
    .eq("id", result.id)
    .maybeSingle();
  if (directSender.error) throw directSender.error;
  expect(directSender.data?.sender_id === sender.userId, `${label}: direct db sender should match`);
  await waitFor(
    () => receiverCollector.events.find((item) => item.id === result.id),
    `${label}: realtime insert`
  );

  const session = await admin
    .from("random_chat_sessions")
    .select("id,status,ended_at,ended_reason,ended_by,user_a,user_b")
    .eq("id", sessionId)
    .maybeSingle();
  if (session.error) throw session.error;
  expect(session.data?.status === "active", `${label}: session should stay active`);

  return result;
}

async function sendShouldFail(client, sessionId, content, label, expectedMessagePart) {
  const { error } = await client.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: content,
  });
  expect(Boolean(error), `${label}: rpc should fail`);
  const message = String(error?.message ?? "").toLowerCase();
  expect(message.includes(expectedMessagePart.toLowerCase()), `${label}: error should mention ${expectedMessagePart}`);
}

async function runSendAndRealtimeScenario(admin, fixture, runId) {
  const { participantA, participantB, sessionId } = fixture;

  const aMessages = openRealtimeCollector(participantA.client, {
    channelName: `p0-${runId}-send-a-${sessionId}-${crypto.randomUUID()}`,
    table: "random_chat_messages",
    event: "INSERT",
    filter: `session_id=eq.${sessionId}`,
    map: (payload) => payload.new,
  });
  const bMessages = openRealtimeCollector(participantB.client, {
    channelName: `p0-${runId}-send-b-${sessionId}-${crypto.randomUUID()}`,
    table: "random_chat_messages",
    event: "INSERT",
    filter: `session_id=eq.${sessionId}`,
    map: (payload) => payload.new,
  });
  const aSessions = openRealtimeCollector(participantA.client, {
    channelName: `p0-${runId}-session-a-${sessionId}-${crypto.randomUUID()}`,
    table: "random_chat_sessions",
    event: "UPDATE",
    filter: `id=eq.${sessionId}`,
    map: (payload) => payload.new,
  });
  const bSessions = openRealtimeCollector(participantB.client, {
    channelName: `p0-${runId}-session-b-${sessionId}-${crypto.randomUUID()}`,
    table: "random_chat_sessions",
    event: "UPDATE",
    filter: `id=eq.${sessionId}`,
    map: (payload) => payload.new,
  });

  await Promise.all([aMessages.ready, bMessages.ready, aSessions.ready, bSessions.ready]);

  const totalMessages = 20;
  for (let index = 0; index < totalMessages; index += 1) {
    const fromA = await sendAndVerifyStep({
      admin,
      sender: participantA,
      receiverCollector: bMessages,
      sessionId,
      content: `p0-a-${index + 1}-${runId}`,
      expectedCount: index * 2 + 1,
      label: `A->B #${index + 1}`,
    });
    expect(aMessages.events.some((item) => item.id === fromA.id), `A->B #${index + 1}: sender should also receive realtime insert`);

    const fromB = await sendAndVerifyStep({
      admin,
      sender: participantB,
      receiverCollector: aMessages,
      sessionId,
      content: `p0-b-${index + 1}-${runId}`,
      expectedCount: index * 2 + 2,
      label: `B->A #${index + 1}`,
    });
    expect(bMessages.events.some((item) => item.id === fromB.id), `B->A #${index + 1}: sender should also receive realtime insert`);

    if (index === 0) {
      await Promise.all([aSessions.close(), bSessions.close()]);
    }

    if (index < totalMessages - 1) {
      await sleep(2300);
    }
  }

  const beforeOffline = bMessages.events.length;
  await bMessages.close();

  const offlineContent = `p0-offline-reconnect-${runId}`;
  const offlineResult = await rpcOrThrow(participantA.client, "send_random_message", {
    p_session_id: sessionId,
    p_content: offlineContent,
  });
  expect(Boolean(offlineResult?.id), "offline send should still insert");
  await assertMessageVisible(admin, participantA.client, sessionId, offlineResult.id, offlineContent, totalMessages * 2 + 1);
  await sleep(1200);
  expect(bMessages.events.length === beforeOffline, "offline collector should not receive while unsubscribed");

  const bMessagesReconnect = openRealtimeCollector(participantB.client, {
    channelName: `p0-send-b-reconnect-${sessionId}-${crypto.randomUUID()}`,
    table: "random_chat_messages",
    event: "INSERT",
    filter: `session_id=eq.${sessionId}`,
    map: (payload) => payload.new,
  });
  await bMessagesReconnect.ready;
  const reconciled = await rpcRows(participantB.client, "list_random_messages", {
    p_session_id: sessionId,
    p_limit: 200,
  });
  expect(
    reconciled.some((item) => item.id === offlineResult.id),
    "reconnect should reconcile missing messages from DB"
  );
  await bMessagesReconnect.close();

  const endResult = await rpcOrThrow(participantB.client, "leave_random_session", {
    p_session_id: sessionId,
  });
  expect(Boolean(endResult?.ended), "server end should succeed");
  expect(endResult.session_id === sessionId, "server end should return the session id");

  const endedSessionA = await rpcOrThrow(participantA.client, "get_my_random_session_view", {
    p_session_id: sessionId,
  });
  expect(endedSessionA?.status === "ended", "missed realtime ended should reconcile to ended");
  expect(endedSessionA?.ended_reason === "left", "ended session should keep authoritative reason");

  const endedSessionB = await rpcOrThrow(participantB.client, "get_my_random_session_view", {
    p_session_id: sessionId,
  });
  expect(endedSessionB?.status === "ended", "partner refresh should also see ended");
  expect(endedSessionB?.ended_reason === "left", "partner refresh should keep authoritative reason");

  await Promise.all([aMessages.close(), bMessages.close()]);

  await sendShouldFail(participantA.client, sessionId, "post-end send", "post-end guard", "This session is not available");

  return {
    participantA,
    participantB,
    sessionId,
    totalMessageCount: totalMessages * 2 + 1,
  };
}

async function runLeaveAndNextScenario(admin, url, anonKey, stamp, cleanup) {
  const participantA = await createAnonymousParticipant(admin, url, anonKey, stamp, "leave-a", "avatar_03");
  const participantB = await createAnonymousParticipant(admin, url, anonKey, stamp, "leave-b", "avatar_04");
  cleanup.users.push(participantA.userId, participantB.userId);
  cleanup.installationKeys.push(participantA.installationKey, participantB.installationKey);

  const { sessionId } = await joinPair(admin, participantA, participantB, cleanup);
  cleanup.sessionIds.push(sessionId);

  const sessionWatcher = openRealtimeCollector(participantB.client, {
    channelName: `p0-leave-session-${sessionId}-${crypto.randomUUID()}`,
    table: "random_chat_sessions",
    event: "UPDATE",
    filter: `id=eq.${sessionId}`,
    map: (payload) => payload.new,
  });
  await sessionWatcher.ready;

  const leaveResult = await rpcOrThrow(participantA.client, "leave_random_session", {
    p_session_id: sessionId,
  });
  expect(Boolean(leaveResult?.ended), "leave should end the session");
  expect(leaveResult.session_id === sessionId, "leave should return the session id");

  const sessionRow = await admin
    .from("random_chat_sessions")
    .select("id,status,ended_at,ended_reason,ended_by,user_a,user_b")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionRow.error) throw sessionRow.error;
  expect(sessionRow.data?.status === "ended", "left session should be ended");
  expect(sessionRow.data?.ended_reason === "left", "left session should carry left reason");
  expect(Boolean(sessionWatcher.events.find((item) => item.id === sessionId && item.status === "ended")), "session realtime should show ended");

  await sendShouldFail(participantA.client, sessionId, "should not send after leave", "leave guard", "This session is not available");
  await sendShouldFail(participantB.client, sessionId, "should not send after leave", "leave guard partner", "This session is not available");
  await sessionWatcher.close();

  const nextA = await createAnonymousParticipant(admin, url, anonKey, stamp, "next-a", "avatar_05");
  const nextB = await createAnonymousParticipant(admin, url, anonKey, stamp, "next-b", "avatar_06");
  cleanup.users.push(nextA.userId, nextB.userId);
  cleanup.installationKeys.push(nextA.installationKey, nextB.installationKey);

  const nextJoin = await joinPair(admin, nextA, nextB, cleanup);
  cleanup.sessionIds.push(nextJoin.sessionId);

  const nextResult = await rpcOrThrow(nextA.client, "next_random_match", {
    p_session_id: nextJoin.sessionId,
  });
  expect(nextResult?.status === "waiting" || nextResult?.status === "matched", "next should return a match state");

  const nextSessionRow = await admin
    .from("random_chat_sessions")
    .select("id,status,ended_at,ended_reason,ended_by,user_a,user_b")
    .eq("id", nextJoin.sessionId)
    .maybeSingle();
  if (nextSessionRow.error) throw nextSessionRow.error;
  expect(nextSessionRow.data?.status === "ended", "next should end the prior session");
  expect(nextSessionRow.data?.ended_reason === "next", "next should use next ended reason");

  await sendShouldFail(nextA.client, nextJoin.sessionId, "should not send after next", "next guard", "This session is not available");
}

async function runBlockAndRematchScenario(admin, url, anonKey, stamp, cleanup) {
  const participantA = await createAnonymousParticipant(admin, url, anonKey, stamp, "block-a", "avatar_07");
  const participantB = await createAnonymousParticipant(admin, url, anonKey, stamp, "block-b", "avatar_08");
  cleanup.users.push(participantA.userId, participantB.userId);
  cleanup.installationKeys.push(participantA.installationKey, participantB.installationKey);

  const { sessionId } = await joinPair(admin, participantA, participantB, cleanup);
  cleanup.sessionIds.push(sessionId);

  const blockResult = await rpcOrThrow(participantA.client, "block_random_user", {
    p_session_id: sessionId,
  });
  expect(Boolean(blockResult?.blocked), "block should return blocked=true");
  expect(Boolean(blockResult?.session_ended), "block should end the session");

  const sessionRow = await admin
    .from("random_chat_sessions")
    .select("id,status,ended_at,ended_reason,ended_by,user_a,user_b")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionRow.error) throw sessionRow.error;
  expect(sessionRow.data?.status === "ended", "blocked session should be ended");
  expect(sessionRow.data?.ended_reason === "blocked", "blocked session should carry blocked reason");

  const rematchA = await rpcOrThrow(participantA.client, "find_or_join_random_match");
  expect(rematchA?.status === "waiting", "blocked user should not rematch immediately");
  const rematchB = await rpcOrThrow(participantB.client, "find_or_join_random_match");
  expect(rematchB?.status === "waiting", "blocked partner should not rematch immediately");

  const queueRows = await Promise.all([
    admin.from("random_match_queue").select("user_id,status,matched_session_id").eq("user_id", participantA.userId).maybeSingle(),
    admin.from("random_match_queue").select("user_id,status,matched_session_id").eq("user_id", participantB.userId).maybeSingle(),
  ]);
  for (const row of queueRows) {
    if (row.error) throw row.error;
    expect(row.data?.status === "waiting" || row.data?.status === "left", "blocked users should not create a new active session");
  }
}

async function runSuspendedMatchmakingScenario(admin, url, anonKey, stamp, cleanup) {
  const participant = await createAnonymousParticipant(admin, url, anonKey, stamp, "suspend", "avatar_09");
  cleanup.users.push(participant.userId);
  cleanup.installationKeys.push(participant.installationKey);

  const suspendedProfile = await admin.from("profiles").update({
    account_status: "suspended",
  }).eq("id", participant.userId);
  if (suspendedProfile.error) throw suspendedProfile.error;

  const attempt = await participant.client.rpc("find_or_join_random_match");
  expect(Boolean(attempt.error), "suspended profile should not matchmake");
  expect(String(attempt.error?.message ?? "").toLowerCase().includes("eligible"), "suspended profile error should mention eligibility");
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
  const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const cleanup = {
    users: [],
    sessionIds: [],
    installationKeys: [],
  };

  const summary = {
    send_and_realtime: null,
  };

  try {
    const fixture = await createRandomChatFixture(admin, url, anonKey, runId, cleanup);
    summary.send_and_realtime = await runSendAndRealtimeScenario(admin, fixture, runId);

    console.log(
      JSON.stringify(
        {
          ok: true,
          sessions_tested: summary.send_and_realtime?.totalMessageCount ?? 0,
          cleanup: {
            users: cleanup.users.length,
            sessions: cleanup.sessionIds.length,
            installation_keys: cleanup.installationKeys.length,
          },
        },
        null,
        2
      )
    );
  } finally {
    await cleanupRandomChatState(admin, cleanup);
    for (const userId of cleanup.users) {
      await deleteUser(admin, userId).catch(() => {});
    }
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(summarizeError(error));
    process.exit(1);
  });

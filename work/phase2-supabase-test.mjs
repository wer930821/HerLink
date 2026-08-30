import fs from "fs";
import path from "path";
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

function mask(value) {
  if (!value) return "(missing)";
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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

async function signIn(url, anonKey, email, password) {
  const client = makeClient(url, anonKey);
  const result = await client.auth.signInWithPassword({ email, password });
  return { client, result };
}

async function maybeDeleteUser(admin, userId) {
  if (!userId) return;
  await admin.auth.admin.deleteUser(userId, false);
}

async function createTestUser(admin, email, password) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error) {
    throw created.error;
  }

  return created.data.user.id;
}

async function completeOnboarding(client, userId, profile) {
  const result = await client.from("profiles").upsert({
    id: userId,
    display_name: profile.display_name,
    birthday: profile.birthday,
    city: profile.city,
    bio: profile.bio,
    orientation: profile.orientation,
    identity_label: profile.identity_label,
    relationship_goals: profile.relationship_goals,
    interests: profile.interests,
    onboarding_completed: profile.onboarding_completed,
    created_at: new Date().toISOString(),
  });

  if (result.error) {
    throw result.error;
  }
}

function summarizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object") {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    return JSON.stringify(error);
  }
  return String(error);
}

async function runStep(summary, label, fn) {
  try {
    const detail = await fn();
    summary.tests[label] = { ok: true, ...(detail ?? {}) };
    return summary.tests[label];
  } catch (error) {
    summary.tests[label] = {
      ok: false,
      error: summarizeError(error),
    };
    return summary.tests[label];
  }
}

async function fetchSingleMatchForPair(admin, userAId, userBId) {
  const user1 = userAId < userBId ? userAId : userBId;
  const user2 = userAId < userBId ? userBId : userAId;
  const { data, error } = await admin
    .from("matches")
    .select("*")
    .eq("user_1_id", user1)
    .eq("user_2_id", user2)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchLikesCount(admin, fromUserId, toUserId) {
  const { count, error } = await admin
    .from("likes")
    .select("*", { count: "exact", head: true })
    .eq("from_user_id", fromUserId)
    .eq("to_user_id", toUserId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function fetchMatchCountForPair(admin, userAId, userBId) {
  const user1 = userAId < userBId ? userAId : userBId;
  const user2 = userAId < userBId ? userBId : userAId;
  const { count, error } = await admin
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("user_1_id", user1)
    .eq("user_2_id", user2);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function sendMessage(client, matchId, content) {
  const { data, error } = await client.rpc("send_message", {
    p_match_id: matchId,
    p_content: content,
  });

  if (error) {
    throw error;
  }

  const row = data?.[0] ?? null;
  if (!row?.id) {
    throw new Error("send_message did not return a message row.");
  }

  return row;
}

async function trySendMessage(client, matchId, content) {
  const { data, error } = await client.rpc("send_message", {
    p_match_id: matchId,
    p_content: content,
  });

  return {
    data: data?.[0] ?? null,
    error,
  };
}

async function fetchMessagesForMatch(client, matchId) {
  return client.from("messages").select("*").eq("match_id", matchId).order("created_at", { ascending: true });
}

async function fetchConversationList(client) {
  return client.rpc("list_active_conversations");
}

function isDeniedOrHidden(result) {
  const message = summarizeError(result?.error) ?? "";
  return Boolean(
    result?.error ||
      result?.data === null ||
      (Array.isArray(result?.data) && result.data.length === 0) ||
      /permission denied|row-level security|not available|forbidden|not found|invalid input/i.test(message)
  );
}

async function main() {
  const env = loadEnv(resolveEnvPath());
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  assertEnv("EXPO_PUBLIC_SUPABASE_URL", url);
  assertEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  assertEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);

  const admin = makeClient(url, serviceRoleKey, serviceRoleKey);
  const summary = {
    env: {
      url: mask(url),
      anonKey: mask(anonKey),
      serviceRoleKey: mask(serviceRoleKey),
    },
    tests: {},
    cleanup: {},
  };

  const createdUserIds = [];

  try {
    const seed = Date.now();
    const password = `HerLink!${seed}Aa`;
    const emails = {
      a: `herlink.phase2.${seed}.a@example.com`,
      b: `herlink.phase2.${seed}.b@example.com`,
      c: `herlink.phase2.${seed}.c@example.com`,
      d: `herlink.phase2.${seed}.d@example.com`,
      e: `herlink.phase2.${seed}.e@example.com`,
      s: `herlink.phase2.${seed}.s@example.com`,
      p: `herlink.phase2.${seed}.p@example.com`,
    };

    const userIds = {};
    for (const [key, email] of Object.entries(emails)) {
      const userId = await createTestUser(admin, email, password);
      userIds[key] = userId;
      createdUserIds.push(userId);
    }

    const clients = {};
    for (const [key, email] of Object.entries(emails)) {
      const { client, result } = await signIn(url, anonKey, email, password);
      if (result.error) {
        throw result.error;
      }
      clients[key] = client;
    }

    await completeOnboarding(clients.a, userIds.a, {
      display_name: "Tester A",
      birthday: "1995-01-01",
      city: "Taipei",
      bio: "Phase 2 A",
      orientation: "Lesbian",
      identity_label: "P",
      relationship_goals: ["長期關係"],
      interests: ["閱讀"],
      onboarding_completed: true,
    });
    await completeOnboarding(clients.b, userIds.b, {
      display_name: "Tester B",
      birthday: "1994-02-02",
      city: "Kaohsiung",
      bio: "Phase 2 B",
      orientation: "Bisexual",
      identity_label: "P",
      relationship_goals: ["交朋友"],
      interests: ["電影"],
      onboarding_completed: true,
    });
    await completeOnboarding(clients.c, userIds.c, {
      display_name: "Tester C",
      birthday: "1993-03-03",
      city: "Taichung",
      bio: "Phase 2 C",
      orientation: "Lesbian",
      identity_label: "P",
      relationship_goals: ["不確定"],
      interests: ["旅行"],
      onboarding_completed: true,
    });
    await completeOnboarding(clients.d, userIds.d, {
      display_name: "Tester D",
      birthday: "1992-04-04",
      city: "Tainan",
      bio: "Phase 2 D",
      orientation: "Lesbian",
      identity_label: "P",
      relationship_goals: ["長期關係"],
      interests: ["咖啡"],
      onboarding_completed: true,
    });
    await completeOnboarding(clients.e, userIds.e, {
      display_name: "Tester E",
      birthday: "1991-05-05",
      city: "Hsinchu",
      bio: "Phase 2 E",
      orientation: "Bisexual",
      identity_label: "P",
      relationship_goals: ["交朋友"],
      interests: ["音樂"],
      onboarding_completed: true,
    });
    await completeOnboarding(clients.s, userIds.s, {
      display_name: "Tester Suspended",
      birthday: "1990-06-06",
      city: "Keelung",
      bio: "Phase 2 S",
      orientation: "Lesbian",
      identity_label: "P",
      relationship_goals: ["交朋友"],
      interests: ["散步"],
      onboarding_completed: true,
    });
    await completeOnboarding(clients.p, userIds.p, {
      display_name: "Tester Pending",
      birthday: "1989-07-07",
      city: "Chiayi",
      bio: "Phase 2 P",
      orientation: "Lesbian",
      identity_label: "P",
      relationship_goals: ["交朋友"],
      interests: ["烘焙"],
      onboarding_completed: false,
    });

    const suspendedUpdate = await admin
      .from("profiles")
      .update({ account_status: "suspended" })
      .eq("id", userIds.s);
    if (suspendedUpdate.error) {
      throw suspendedUpdate.error;
    }

    await runStep(summary, "A_like_B_success", async () => {
      const { data, error } = await clients.a.rpc("like_user", { target_user_id: userIds.b });
      if (error) throw error;
      const row = data?.[0];
      const likeCount = await fetchLikesCount(admin, userIds.a, userIds.b);
      return {
        result: row ?? null,
        likeCount,
        passed: !!row?.liked && row?.matched === false && likeCount === 1,
      };
    });

    await runStep(summary, "B_duplicate_like_no_second_row", async () => {
      const { data, error } = await clients.a.rpc("like_user", { target_user_id: userIds.b });
      if (error) throw error;
      const likeCount = await fetchLikesCount(admin, userIds.a, userIds.b);
      return {
        result: data?.[0] ?? null,
        likeCount,
        passed: likeCount === 1,
      };
    });

    await runStep(summary, "C_like_self_denied", async () => {
      const { error } = await clients.a.rpc("like_user", { target_user_id: userIds.a });
      if (!error) {
        throw new Error("Self-like was unexpectedly allowed.");
      }
      return {
        error: error.message,
        passed: /cannot like yourself/i.test(error.message),
      };
    });

    await runStep(summary, "D_forge_like_denied", async () => {
      const { error } = await clients.a.from("likes").insert({
        from_user_id: userIds.b,
        to_user_id: userIds.c,
      });
      if (!error) {
        throw new Error("Direct forged like insert was unexpectedly allowed.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "E_no_match_before_reverse_like", async () => {
      const match = await fetchSingleMatchForPair(admin, userIds.a, userIds.b);
      return {
        match: match ?? null,
        passed: match === null,
      };
    });

    let abMatchId = null;

    await runStep(summary, "F_reverse_like_creates_exactly_one_match", async () => {
      const { data, error } = await clients.b.rpc("like_user", { target_user_id: userIds.a });
      if (error) throw error;
      const row = data?.[0];
      const match = await fetchSingleMatchForPair(admin, userIds.a, userIds.b);
      abMatchId = match?.id ?? null;
      const count = await fetchMatchCountForPair(admin, userIds.a, userIds.b);
      return {
        result: row ?? null,
        matchId: match?.id ?? null,
        matchStatus: match?.status ?? null,
        count,
        passed: !!row?.matched && !!match?.id && count === 1,
      };
    });

    await runStep(summary, "G_concurrent_mutual_like_creates_one_match", async () => {
      const [likeD, likeE] = await Promise.all([
        clients.d.rpc("like_user", { target_user_id: userIds.e }),
        clients.e.rpc("like_user", { target_user_id: userIds.d }),
      ]);
      if (likeD.error) throw likeD.error;
      if (likeE.error) throw likeE.error;

      const match = await fetchSingleMatchForPair(admin, userIds.d, userIds.e);
      const count = await fetchMatchCountForPair(admin, userIds.d, userIds.e);

      return {
        likeD: likeD.data?.[0] ?? null,
        likeE: likeE.data?.[0] ?? null,
        matchId: match?.id ?? null,
        count,
        passed: !!match?.id && count === 1,
      };
    });

    await runStep(summary, "G2_duplicate_reverse_like_keeps_single_match", async () => {
      const repeatLike = await clients.a.rpc("like_user", { target_user_id: userIds.b });
      if (repeatLike.error) throw repeatLike.error;
      const match = await fetchSingleMatchForPair(admin, userIds.a, userIds.b);
      const count = await fetchMatchCountForPair(admin, userIds.a, userIds.b);

      return {
        result: repeatLike.data?.[0] ?? null,
        matchId: match?.id ?? null,
        count,
        passed: !!match?.id && count === 1,
      };
    });

    await runStep(summary, "H_owner_can_read_match", async () => {
      const { data, error } = await clients.a.from("matches").select("*").eq("id", abMatchId).maybeSingle();
      if (error) throw error;
      return {
        found: !!data,
        status: data?.status ?? null,
        passed: !!data,
      };
    });

    await runStep(summary, "I_third_party_cannot_read_match", async () => {
      const { data, error } = await clients.c.from("matches").select("*").eq("id", abMatchId).maybeSingle();
      if (error) throw error;
      return {
        found: !!data,
        passed: data === null,
      };
    });

    await runStep(summary, "J_client_cannot_insert_match", async () => {
      const user1 = userIds.b < userIds.c ? userIds.b : userIds.c;
      const user2 = userIds.b < userIds.c ? userIds.c : userIds.b;
      const { error } = await clients.b.from("matches").insert({
        user_1_id: user1,
        user_2_id: user2,
        status: "active",
      });
      if (!error) {
        throw new Error("Direct match insert was unexpectedly allowed.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "K_suspended_user_cannot_create_new_match", async () => {
      const { error } = await clients.s.rpc("like_user", { target_user_id: userIds.c });
      if (!error) {
        throw new Error("Suspended user was unexpectedly allowed to like.");
      }
      const match = await fetchSingleMatchForPair(admin, userIds.s, userIds.c);
      return {
        error: error.message,
        match: match ?? null,
        passed: match === null,
      };
    });

    let messageId = null;

    await runStep(summary, "L_member_can_send_message", async () => {
      const message = await sendMessage(clients.a, abMatchId, "你好，這是 Phase 2 測試訊息。");
      messageId = message.id;
      return {
        messageId,
        senderId: message.sender_id,
        matchId: message.match_id,
        content: message.content,
        passed: message.sender_id === userIds.a && message.match_id === abMatchId,
      };
    });

    await runStep(summary, "M_match_member_can_read_message", async () => {
      const [readerA, readerB] = await Promise.all([
        fetchMessagesForMatch(clients.a, abMatchId),
        fetchMessagesForMatch(clients.b, abMatchId),
      ]);
      if (readerA.error) throw readerA.error;
      if (readerB.error) throw readerB.error;
      const messageA = (readerA.data ?? []).find((item) => item.id === messageId) ?? null;
      const messageB = (readerB.data ?? []).find((item) => item.id === messageId) ?? null;
      return {
        foundByA: !!messageA,
        foundByB: !!messageB,
        contentByA: messageA?.content ?? null,
        contentByB: messageB?.content ?? null,
        passed:
          !!messageA &&
          !!messageB &&
          messageA.content === "你好，這是 Phase 2 測試訊息。" &&
          messageB.content === "你好，這是 Phase 2 測試訊息。" &&
          messageA.match_id === abMatchId &&
          messageB.match_id === abMatchId,
      };
    });

    await runStep(summary, "N_third_party_cannot_read_messages", async () => {
      const [messageResult, conversationResult] = await Promise.all([
        fetchMessagesForMatch(clients.c, abMatchId),
        fetchConversationList(clients.c),
      ]);
      const visibleConversation = (conversationResult.data ?? []).find((row) => row.match_id === abMatchId) ?? null;
      return {
        messagesDenied: isDeniedOrHidden(messageResult),
        conversationVisible: !!visibleConversation,
        messageError: summarizeError(messageResult.error),
        conversationError: summarizeError(conversationResult.error),
        passed: isDeniedOrHidden(messageResult) && !visibleConversation,
      };
    });

    await runStep(summary, "O_third_party_cannot_write_messages", async () => {
      const attempt = await trySendMessage(clients.c, abMatchId, "我不該能寫進別人的聊天室。");
      if (!attempt.error) {
        throw new Error("Third-party message insert was unexpectedly allowed.");
      }
      return {
        error: attempt.error.message,
        passed: true,
      };
    });

    await runStep(summary, "P_sender_id_forgery_denied", async () => {
      const { error } = await clients.a.from("messages").insert({
        match_id: abMatchId,
        sender_id: userIds.b,
        type: "text",
        content: "偽造 sender_id",
      });
      if (!error) {
        throw new Error("Forged sender_id was unexpectedly allowed.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "P2_second_member_can_send_message", async () => {
      const message = await sendMessage(clients.b, abMatchId, "B 也可以透過正式 RPC 回覆。");
      return {
        messageId: message.id,
        senderId: message.sender_id,
        matchId: message.match_id,
        passed: message.sender_id === userIds.b && message.match_id === abMatchId,
      };
    });

    await runStep(summary, "P3_mark_read_member_only", async () => {
      const readA = await clients.a.rpc("mark_match_messages_read", { p_match_id: abMatchId });
      const readB = await clients.b.rpc("mark_match_messages_read", { p_match_id: abMatchId });
      const readC = await clients.c.rpc("mark_match_messages_read", { p_match_id: abMatchId });

      if (readA.error) throw readA.error;
      if (readB.error) throw readB.error;

      return {
        readACount: readA.data ?? null,
        readBCount: readB.data ?? null,
        readCError: summarizeError(readC.error),
        passed: !readC.data && !!readC.error,
      };
    });

    await runStep(summary, "P4_invalid_match_blocked", async () => {
      const bogusMatchId = "00000000-0000-0000-0000-000000000000";
      const bogusAttempt = await trySendMessage(clients.a, bogusMatchId, "不存在的 match");
      const unrelatedAttempt = await trySendMessage(clients.a, "11111111-1111-1111-1111-111111111111", "假的 match");

      return {
        bogusError: summarizeError(bogusAttempt.error),
        unrelatedError: summarizeError(unrelatedAttempt.error),
        passed: !!bogusAttempt.error && !!unrelatedAttempt.error,
      };
    });

    await runStep(summary, "Q_unmatched_users_cannot_send_new_messages", async () => {
      const unmatchResult = await clients.a.rpc("unmatch_user", { p_match_id: abMatchId });
      if (unmatchResult.error) throw unmatchResult.error;
      if (!unmatchResult.data) {
        throw new Error("unmatch_user did not return true.");
      }

      const sendA = await trySendMessage(clients.a, abMatchId, "取消配對後 A 送訊息");
      const sendB = await trySendMessage(clients.b, abMatchId, "取消配對後 B 送訊息");
      const match = await fetchSingleMatchForPair(admin, userIds.a, userIds.b);

      if (!sendA.error || !sendB.error) {
        throw new Error("An unmatched member was unexpectedly allowed to send a message.");
      }

      return {
        unmatchReturned: unmatchResult.data,
        matchStatus: match?.status ?? null,
        sendAError: sendA.error.message,
        sendBError: sendB.error.message,
        passed: match?.status === "unmatched",
      };
    });

    await runStep(summary, "profiles_rls_owner_only", async () => {
      const own = await clients.a.from("profiles").select("id").eq("id", userIds.a);
      const other = await clients.a.from("profiles").select("id").eq("id", userIds.b);
      if (own.error) throw own.error;
      if (other.error) throw other.error;
      return {
        ownCount: own.data?.length ?? 0,
        otherCount: other.data?.length ?? 0,
        passed: (own.data?.length ?? 0) === 1 && (other.data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "public_profiles_filters_suspended_and_pending", async () => {
      const { data, error } = await clients.a
        .from("public_profiles")
        .select("id,display_name")
        .in("id", [userIds.b, userIds.c, userIds.s, userIds.p]);
      if (error) throw error;

      const visibleIds = (data ?? []).map((row) => row.id).sort();
      return {
        visibleIds,
        passed:
          visibleIds.includes(userIds.b) &&
          visibleIds.includes(userIds.c) &&
          !visibleIds.includes(userIds.s) &&
          !visibleIds.includes(userIds.p),
      };
    });

    await runStep(summary, "public_profiles_ineligible_targets_cannot_be_liked", async () => {
      const pendingAttempt = await clients.a.rpc("like_user", { target_user_id: userIds.p });
      const suspendedAttempt = await clients.a.rpc("like_user", { target_user_id: userIds.s });

      if (!pendingAttempt.error || !suspendedAttempt.error) {
        throw new Error("Ineligible target was unexpectedly likeable.");
      }

      return {
        pendingError: pendingAttempt.error.message,
        suspendedError: suspendedAttempt.error.message,
        passed: true,
      };
    });
  } finally {
    for (const userId of createdUserIds) {
      try {
        await maybeDeleteUser(admin, userId);
      } catch (error) {
        summary.cleanup[userId] = summarizeError(error);
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    fatal: true,
    message: summarizeError(error),
  }, null, 2));
  process.exitCode = 1;
});

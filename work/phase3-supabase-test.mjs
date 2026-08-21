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

function summarizeError(error) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
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
    onboarding_completed: true,
    created_at: new Date().toISOString(),
  });

  if (result.error) {
    throw result.error;
  }
}

async function runStep(summary, label, fn) {
  try {
    const detail = await fn();
    summary.tests[label] = { ok: true, ...(detail ?? {}) };
  } catch (error) {
    summary.tests[label] = {
      ok: false,
      error: summarizeError(error),
    };
  }
}

async function fetchMatch(admin, userAId, userBId) {
  const user1 = userAId < userBId ? userAId : userBId;
  const user2 = userAId < userBId ? userBId : userAId;
  const { data, error } = await admin
    .from("matches")
    .select("*")
    .eq("user_1_id", user1)
    .eq("user_2_id", user2)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchBlockCount(admin, blockerId, blockedId) {
  const { count, error } = await admin
    .from("blocks")
    .select("*", { count: "exact", head: true })
    .eq("blocker_id", blockerId)
    .eq("blocked_user_id", blockedId);
  if (error) throw error;
  return count ?? 0;
}

async function fetchRiskEvents(admin, userId) {
  const { data, error } = await admin
    .from("risk_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,trust_score,account_status")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  const env = loadEnv(path.resolve(".env"));
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
      a: `herlink.phase3.${seed}.a@example.com`,
      b: `herlink.phase3.${seed}.b@example.com`,
      c: `herlink.phase3.${seed}.c@example.com`,
      d: `herlink.phase3.${seed}.d@example.com`,
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
      bio: "Phase 3 A",
      orientation: "Lesbian",
      identity_label: "Woman",
      relationship_goals: ["長期關係"],
      interests: ["閱讀"],
    });
    await completeOnboarding(clients.b, userIds.b, {
      display_name: "Tester B",
      birthday: "1994-02-02",
      city: "Kaohsiung",
      bio: "Phase 3 B",
      orientation: "Bisexual",
      identity_label: "Woman",
      relationship_goals: ["交朋友"],
      interests: ["電影"],
    });
    await completeOnboarding(clients.c, userIds.c, {
      display_name: "Tester C",
      birthday: "1993-03-03",
      city: "Taichung",
      bio: "Phase 3 C",
      orientation: "Lesbian",
      identity_label: "Woman",
      relationship_goals: ["不確定"],
      interests: ["旅行"],
    });
    await completeOnboarding(clients.d, userIds.d, {
      display_name: "Tester D",
      birthday: "1992-04-04",
      city: "Tainan",
      bio: "Phase 3 D",
      orientation: "Lesbian",
      identity_label: "Woman",
      relationship_goals: ["長期關係"],
      interests: ["咖啡"],
    });

    await clients.a.rpc("like_user", { target_user_id: userIds.b });
    await clients.b.rpc("like_user", { target_user_id: userIds.a });
    await clients.a.rpc("like_user", { target_user_id: userIds.c });
    await clients.c.rpc("like_user", { target_user_id: userIds.a });

    const matchAB = await fetchMatch(admin, userIds.a, userIds.b);
    const matchAC = await fetchMatch(admin, userIds.a, userIds.c);

    await runStep(summary, "A_block_success", async () => {
      const { data, error } = await clients.a.rpc("block_user", { target_user_id: userIds.b });
      if (error) throw error;
      return {
        result: data?.[0] ?? null,
        blockCount: await fetchBlockCount(admin, userIds.a, userIds.b),
        passed: (data?.[0]?.blocked ?? false) === true,
      };
    });

    await runStep(summary, "B_duplicate_block_no_duplicate", async () => {
      const { data, error } = await clients.a.rpc("block_user", { target_user_id: userIds.b });
      if (error) throw error;
      const blockCount = await fetchBlockCount(admin, userIds.a, userIds.b);
      return {
        result: data?.[0] ?? null,
        blockCount,
        passed: blockCount === 1,
      };
    });

    await runStep(summary, "C_block_self_denied", async () => {
      const { error } = await clients.a.rpc("block_user", { target_user_id: userIds.a });
      if (!error) {
        throw new Error("Self block was unexpectedly allowed.");
      }
      return {
        error: error.message,
        passed: /cannot block yourself/i.test(error.message),
      };
    });

    await runStep(summary, "D_blocked_user_hidden_from_A_discover", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles");
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        visibleIds: ids,
        passed: !ids.includes(userIds.b),
      };
    });

    await runStep(summary, "E_A_hidden_from_B_discover", async () => {
      const { data, error } = await clients.b.rpc("list_discover_profiles");
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        visibleIds: ids,
        passed: !ids.includes(userIds.a),
      };
    });

    await runStep(summary, "F_blocked_users_cannot_like_each_other", async () => {
      const likeBA = await clients.b.rpc("like_user", { target_user_id: userIds.a });
      const likeAB = await clients.a.rpc("like_user", { target_user_id: userIds.b });
      if (!likeBA.error || !likeAB.error) {
        throw new Error("Blocked users were unexpectedly allowed to like.");
      }
      return {
        errorBA: likeBA.error.message,
        errorAB: likeAB.error.message,
        passed: true,
      };
    });

    await runStep(summary, "G_existing_active_match_becomes_blocked", async () => {
      const blockedMatch = await fetchMatch(admin, userIds.a, userIds.b);
      return {
        matchStatus: blockedMatch?.status ?? null,
        passed: blockedMatch?.status === "blocked",
      };
    });

    await runStep(summary, "H_blocked_match_cannot_send_messages", async () => {
      const { error } = await clients.b.rpc("send_message", {
        p_match_id: matchAB.id,
        p_content: "封鎖後測試訊息",
      });
      if (!error) {
        throw new Error("Blocked match unexpectedly allowed message send.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "I_user_C_not_affected_by_A_B_block", async () => {
      const { data, error } = await clients.c.rpc("list_discover_profiles");
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        visibleIds: ids,
        passed: ids.includes(userIds.a) && ids.includes(userIds.b) && ids.includes(userIds.d),
      };
    });

    let reportId = null;

    await runStep(summary, "J_report_success", async () => {
      const { data, error } = await clients.a.rpc("report_user", {
        target_user_id: userIds.b,
        p_category: "scam",
        p_description: "Phase 3 report test",
      });
      if (error) throw error;
      reportId = data?.[0]?.report_id ?? null;
      return {
        result: data?.[0] ?? null,
        passed: !!reportId,
      };
    });

    await runStep(summary, "K_report_self_denied", async () => {
      const { error } = await clients.a.rpc("report_user", {
        target_user_id: userIds.a,
        p_category: "other",
        p_description: "self report",
      });
      if (!error) {
        throw new Error("Self report was unexpectedly allowed.");
      }
      return {
        error: error.message,
        passed: /cannot report yourself/i.test(error.message),
      };
    });

    await runStep(summary, "L_reported_user_cannot_see_reporter", async () => {
      const { data, error } = await clients.b
        .from("reports")
        .select("*")
        .eq("reported_user_id", userIds.b);
      if (error) throw error;
      return {
        count: data?.length ?? 0,
        passed: (data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "M_client_cannot_update_report_status", async () => {
      const { error } = await clients.a
        .from("reports")
        .update({ status: "resolved" })
        .eq("id", reportId);
      const { data: reportRow, error: reportReadError } = await admin
        .from("reports")
        .select("status")
        .eq("id", reportId)
        .single();
      if (reportReadError) throw reportReadError;
      return {
        error: error?.message ?? null,
        statusAfterAttempt: reportRow.status,
        passed: !!error || reportRow.status === "pending",
      };
    });

    await runStep(summary, "N_reporter_only_sees_own_reports", async () => {
      const own = await clients.a.from("reports").select("*");
      const other = await clients.c.from("reports").select("*");
      if (own.error) throw own.error;
      if (other.error) throw other.error;
      return {
        ownCount: own.data?.length ?? 0,
        otherCount: other.data?.length ?? 0,
        passed: (own.data?.length ?? 0) === 1 && (other.data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "O_client_cannot_insert_risk_event", async () => {
      const { error } = await clients.a.from("risk_events").insert({
        user_id: userIds.a,
        event_type: "suspicious_money_message",
        risk_score_delta: -25,
        metadata: { source: "client" },
      });
      if (!error) {
        throw new Error("Client unexpectedly inserted risk_event.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "P_trusted_function_creates_risk_event", async () => {
      const before = await fetchRiskEvents(admin, userIds.d);
      const { data, error } = await admin.rpc("apply_risk_event", {
        p_user_id: userIds.d,
        p_event_type: "valid_report_received",
        p_metadata: { source: "phase3-test" },
      });
      if (error) throw error;
      const after = await fetchRiskEvents(admin, userIds.d);
      return {
        result: data?.[0] ?? null,
        beforeCount: before.length,
        afterCount: after.length,
        passed: after.length === before.length + 1,
      };
    });

    await runStep(summary, "Q_trust_score_decreases_correctly", async () => {
      const profile = await fetchProfile(admin, userIds.d);
      return {
        trustScore: profile.trust_score,
        passed: profile.trust_score === 30,
      };
    });

    await runStep(summary, "R_trust_score_never_below_zero", async () => {
      await admin.rpc("apply_risk_event", {
        p_user_id: userIds.d,
        p_event_type: "suspicious_investment_message",
        p_metadata: { source: "phase3-test" },
      });
      await admin.rpc("apply_risk_event", {
        p_user_id: userIds.d,
        p_event_type: "suspicious_investment_message",
        p_metadata: { source: "phase3-test" },
      });
      await admin.rpc("apply_risk_event", {
        p_user_id: userIds.d,
        p_event_type: "suspicious_investment_message",
        p_metadata: { source: "phase3-test" },
      });
      const profile = await fetchProfile(admin, userIds.d);
      return {
        trustScore: profile.trust_score,
        accountStatus: profile.account_status,
        passed: profile.trust_score === 0,
      };
    });

    await runStep(summary, "S_client_cannot_modify_trust_score", async () => {
      const { error } = await clients.a
        .from("profiles")
        .update({ trust_score: 99 })
        .eq("id", userIds.a);
      if (!error) {
        throw new Error("Client unexpectedly updated trust_score.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "T_normal_chat_has_no_warning", async () => {
      const { data, error } = await clients.a.rpc("send_message", {
        p_match_id: matchAC.id,
        p_content: "今晚想吃什麼？",
      });
      if (error) throw error;
      const result = data?.[0];
      return {
        result: result ?? null,
        passed: result?.risk_level === "low" && result?.safety_warning === null,
      };
    });

    await runStep(summary, "U_banking_sentence_not_high_risk", async () => {
      const { data, error } = await clients.a.rpc("send_message", {
        p_match_id: matchAC.id,
        p_content: "今天去銀行辦事情",
      });
      if (error) throw error;
      const result = data?.[0];
      return {
        result: result ?? null,
        passed: result?.risk_level === "low",
      };
    });

    await runStep(summary, "V_investment_pitch_creates_warning_and_risk_event", async () => {
      const beforeEvents = await fetchRiskEvents(admin, userIds.a);
      const beforeProfile = await fetchProfile(admin, userIds.a);
      const { data, error } = await clients.a.rpc("send_message", {
        p_match_id: matchAC.id,
        p_content: "我帶妳投資 USDT 保證獲利",
      });
      if (error) throw error;
      const afterEvents = await fetchRiskEvents(admin, userIds.a);
      const afterProfile = await fetchProfile(admin, userIds.a);
      return {
        result: data?.[0] ?? null,
        beforeEventCount: beforeEvents.length,
        afterEventCount: afterEvents.length,
        trustScoreBefore: beforeProfile.trust_score,
        trustScoreAfter: afterProfile.trust_score,
        passed:
          data?.[0]?.risk_level === "high" &&
          !!data?.[0]?.safety_warning &&
          afterEvents.length === beforeEvents.length + 1 &&
          afterProfile.trust_score === beforeProfile.trust_score - 30,
      };
    });

    await runStep(summary, "W_otp_request_creates_high_risk_event", async () => {
      const beforeEvents = await fetchRiskEvents(admin, userIds.a);
      const beforeProfile = await fetchProfile(admin, userIds.a);
      const { data, error } = await clients.a.rpc("send_message", {
        p_match_id: matchAC.id,
        p_content: "把 OTP 驗證碼傳給我",
      });
      if (error) throw error;
      const afterEvents = await fetchRiskEvents(admin, userIds.a);
      const afterProfile = await fetchProfile(admin, userIds.a);
      return {
        result: data?.[0] ?? null,
        beforeEventCount: beforeEvents.length,
        afterEventCount: afterEvents.length,
        trustScoreBefore: beforeProfile.trust_score,
        trustScoreAfter: afterProfile.trust_score,
        passed:
          data?.[0]?.risk_level === "high" &&
          !!data?.[0]?.safety_warning &&
          afterEvents.length === beforeEvents.length + 1 &&
          afterProfile.trust_score === Math.max(0, beforeProfile.trust_score - 30),
      };
    });

    await runStep(summary, "X_blocked_user_send_message_denied", async () => {
      const { error } = await clients.a.rpc("send_message", {
        p_match_id: matchAB.id,
        p_content: "封鎖後再試一次",
      });
      if (!error) {
        throw new Error("Blocked user unexpectedly sent a message.");
      }
      return {
        error: error.message,
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

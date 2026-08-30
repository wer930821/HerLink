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

async function insertReport(admin, reporterId, reportedId, category = "scam") {
  const { error } = await admin.from("reports").insert({
    reporter_id: reporterId,
    reported_user_id: reportedId,
    category,
    description: "abuse prevention smoke test",
    status: "pending",
  });
  if (error) throw error;
}

async function insertBlock(admin, blockerId, blockedId) {
  const { error } = await admin.from("blocks").insert({
    blocker_id: blockerId,
    blocked_user_id: blockedId,
  });
  if (error) throw error;
}

async function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

function summarizeError(error) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (error && typeof error === "object") {
    return error;
  }
  return { message: String(error) };
}

function hashInstallationId(value) {
  return crypto.createHash("md5").update(String(value).trim().toLowerCase()).digest("hex");
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
  const sharedInstallationId = `web-v01-shared-install-${stamp}`;
  const freshInstallationId = `web-v01-fresh-install-${stamp}`;
  const sharedInstallationKey = hashInstallationId(sharedInstallationId);
  const freshInstallationKey = hashInstallationId(freshInstallationId);

  const users = {
    a1: { email: `web-v01-abuse-a1-${stamp}@example.com`, password: "Password!1234", name: "晨霧書頁", avatar: "avatar_01" },
    a2: { email: `web-v01-abuse-a2-${stamp}@example.com`, password: "Password!1234", name: "夜行列車", avatar: "avatar_02" },
    r1: { email: `web-v01-abuse-r1-${stamp}@example.com`, password: "Password!1234", name: "雨後街角", avatar: "avatar_03" },
    r2: { email: `web-v01-abuse-r2-${stamp}@example.com`, password: "Password!1234", name: "晚風日記", avatar: "avatar_04" },
    r3: { email: `web-v01-abuse-r3-${stamp}@example.com`, password: "Password!1234", name: "白色耳機", avatar: "avatar_05" },
    fresh: { email: `web-v01-abuse-fresh-${stamp}@example.com`, password: "Password!1234", name: "月台盡頭", avatar: "avatar_06" },
  };

  const createdUserIds = {};
  const clients = {};
  const installationKeys = {
    shared: sharedInstallationId,
    fresh: freshInstallationId,
  };

  try {
    for (const [key, user] of Object.entries(users)) {
      createdUserIds[key] = await createUser(admin, user.email, user.password);
      const { error: profileError } = await admin.from("profiles").upsert({
        id: createdUserIds[key],
        anonymous_mode_enabled: true,
        anonymous_display_name: user.name,
        anonymous_avatar: user.avatar,
        anonymous_intro: "今天也想好好聊天。",
        city: "台北市",
        identity_label: "T",
        interested_in_identity_labels: ["T"],
        onboarding_completed: true,
      });
      if (profileError) throw profileError;

      const { client } = await signIn(url, anonKey, user.email, user.password);
      clients[key] = client;
    }

    const allowBeforeSignals = await registerAbuseIdentity(clients.a1, installationKeys.shared);
    await expect(allowBeforeSignals?.decision === "allow", "fresh shared install should start allowed");
    await expect(allowBeforeSignals?.current_user_id === createdUserIds.a1, "initial identity should attach to A1");

    await insertReport(admin, createdUserIds.r1, createdUserIds.a1, "scam");
    const afterOneReport = await admin
      .from("anonymous_risk_identities")
      .select("*")
      .eq("installation_key", sharedInstallationKey)
      .maybeSingle();
    await expect(!afterOneReport.error, "should read shared identity row");
    await expect(Boolean(afterOneReport.data), "single report should keep a shared identity row");

    await insertReport(admin, createdUserIds.r2, createdUserIds.a1, "harassment");
    await insertReport(admin, createdUserIds.r3, createdUserIds.a1, "other");

    await insertBlock(admin, createdUserIds.r1, createdUserIds.a1);

    const riskAfterSignals = await admin
      .from("anonymous_risk_identities")
      .select("*")
      .eq("installation_key", sharedInstallationKey)
      .maybeSingle();
    await expect(!riskAfterSignals.error, "should read updated shared identity row");
    await expect(
      riskAfterSignals.data?.last_decision === "cooldown" || riskAfterSignals.data?.last_decision === "temporary_suspension",
      "multiple abuse signals should restrict the shared install"
    );
    await expect((riskAfterSignals.data?.last_risk_score ?? 0) >= 5, "risk score should increase");

    const allowFresh = await registerAbuseIdentity(clients.fresh, installationKeys.fresh);
    await expect(allowFresh?.decision === "allow", "fresh install should still be allowed");

    await expect(allowFresh?.installation_key === freshInstallationKey, "fresh install should use normalized key");

    const rotationResult = await registerAbuseIdentity(clients.a2, installationKeys.shared);
    await expect(rotationResult?.current_user_id === createdUserIds.a2, "same install should rotate to new anonymous uid");
    await expect(
      rotationResult?.decision === "cooldown" || rotationResult?.decision === "temporary_suspension" || rotationResult?.decision === "blocked",
      "rotated user should inherit existing abuse restriction"
    );
    await expect(rotationResult?.decision !== "allow", "rotated user should not appear clean");

    const identityRow = await admin
      .from("anonymous_risk_identities")
      .select("installation_key, first_user_id, current_user_id, last_decision, last_reason_code")
      .eq("installation_key", sharedInstallationKey)
      .maybeSingle();
    await expect(!identityRow.error, "shared identity row should remain readable to admin");
    await expect(identityRow.data?.first_user_id === createdUserIds.a1, "shared identity should preserve original user");
    await expect(identityRow.data?.current_user_id === createdUserIds.a2, "shared identity should point to latest user");

    const events = await admin
      .from("anonymous_risk_events")
      .select("event_type")
      .eq("installation_key", sharedInstallationKey)
      .order("created_at", { ascending: true });
    await expect(!events.error, "should read risk events for cleanup");
    await expect((events.data ?? []).some((row) => row.event_type === "anonymous_signup"), "signup event should exist");
    await expect((events.data ?? []).some((row) => row.event_type === "anonymous_account_rotation"), "rotation event should exist");
    await expect((events.data ?? []).some((row) => row.event_type === "report_received"), "report event should exist");
    await expect((events.data ?? []).some((row) => row.event_type === "block_received"), "block event should exist");

    console.log(JSON.stringify({
      ok: true,
      summary: {
        shared_installation_id: sharedInstallationId,
        fresh_installation_id: freshInstallationId,
        shared_installation_key: sharedInstallationKey,
        fresh_installation_key: freshInstallationKey,
        shared_identity: identityRow.data,
        events: events.data ?? [],
      },
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: summarizeError(error),
    }, null, 2));
    process.exitCode = 1;
  } finally {
    for (const userId of Object.values(createdUserIds)) {
      try {
        await admin.auth.admin.deleteUser(userId, false);
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

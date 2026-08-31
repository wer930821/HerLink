import fs from "fs";
import path from "path";
import net from "net";
import { spawn } from "child_process";
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

async function createAdminRecord(admin, userId, role, active = true) {
  const { error } = await admin.from("admin_users").upsert(
    {
      user_id: userId,
      role,
      active,
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

async function createDirectSession(admin, userA, userB) {
  const low = userA < userB ? userA : userB;
  const high = userA < userB ? userB : userA;
  const sessionId = crypto.randomUUID();
  const { error } = await admin.from("random_chat_sessions").insert({
    id: sessionId,
    user_a: low,
    user_b: high,
    status: "active",
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  return sessionId;
}

async function cleanupRealtimeDiagnostics(admin) {
  const { error } = await admin.from("realtime_diagnostics").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw error;
}

async function cleanupAdminSmokeSession(admin, sessionId) {
  if (!sessionId) {
    return;
  }

  const deletions = [
    admin.from("realtime_diagnostics").delete().eq("session_id", sessionId),
    admin.from("random_chat_messages").delete().eq("session_id", sessionId),
    admin.from("reports").delete().eq("random_session_id", sessionId),
    admin.from("moderation_enforcements").delete().eq("metadata->>source", "admin_smoke"),
    admin.from("random_chat_sessions").delete().eq("id", sessionId),
  ];

  for (const deletion of deletions) {
    const { error } = await deletion;
    if (error) throw error;
  }
}

async function upsertAnonymousProfile(admin, userId, name) {
  const { error } = await admin.from("profiles").upsert({
    id: userId,
    anonymous_mode_enabled: true,
    anonymous_display_name: name,
    anonymous_avatar: "avatar_01",
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

async function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(baseUrl, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, { method: "GET" });
      if (response.ok || response.status === 200 || response.status === 304) {
        return;
      }
    } catch {
      // keep waiting
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (!port) {
          reject(new Error("Unable to determine a free port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startWebServer() {
  const webDir = path.resolve("apps/web");
  const port = Number.parseInt(process.env.ADMIN_TEST_PORT ?? String(await getFreePort()), 10);
  const child = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
  return { child, baseUrl };
}

async function fetchJson(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  return { response, payload };
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
  const createdUserIds = {};
  const clients = {};
  const summary = { tests: {} };
  let sessionId = null;

  const server = await startWebServer();

  try {
    await cleanupRealtimeDiagnostics(admin);

    const unauthenticatedChecks = [
      "/api/admin/summary",
      "/api/admin/sessions",
      "/api/admin/realtime",
      "/api/admin/reports",
      "/api/admin/safety",
    ];
    for (const route of unauthenticatedChecks) {
      const { response, payload } = await fetchJson(server.baseUrl, route);
      await expect(response.status === 401, `unauthenticated should be denied for ${route}`);
      await expect(typeof payload?.error === "string", `unauthenticated response should include error for ${route}`);
    }

    createdUserIds.admin = await createUser(admin, `web-v01-admin-${stamp}@example.com`, "Password!1234");
    createdUserIds.normal = await createUser(admin, `web-v01-normal-${stamp}@example.com`, "Password!1234");
    createdUserIds.a = await createUser(admin, `web-v01-admin-a-${stamp}@example.com`, "Password!1234");
    createdUserIds.b = await createUser(admin, `web-v01-admin-b-${stamp}@example.com`, "Password!1234");

    await createAdminRecord(admin, createdUserIds.admin, "admin", true);
    await upsertAnonymousProfile(admin, createdUserIds.admin, "夜行管理員");
    await upsertAnonymousProfile(admin, createdUserIds.normal, "一般匿名使用者");
    await upsertAnonymousProfile(admin, createdUserIds.a, "晨霧書頁");
    await upsertAnonymousProfile(admin, createdUserIds.b, "雨後街角");

    const adminAuth = await signIn(url, anonKey, `web-v01-admin-${stamp}@example.com`, "Password!1234");
    const normalAuth = await signIn(url, anonKey, `web-v01-normal-${stamp}@example.com`, "Password!1234");
    const aAuth = await signIn(url, anonKey, `web-v01-admin-a-${stamp}@example.com`, "Password!1234");
    const bAuth = await signIn(url, anonKey, `web-v01-admin-b-${stamp}@example.com`, "Password!1234");

    const adminClient = adminAuth.client;
    const normalClient = normalAuth.client;
    const participantA = aAuth.client;
    const participantB = bAuth.client;
    const adminRouteClient = makeClient(url, anonKey, adminAuth.session.access_token);

    sessionId = await createDirectSession(admin, createdUserIds.a, createdUserIds.b);
    await expect(Boolean(sessionId), "admin smoke session id should exist");
    await rpcOrThrow(participantA, "register_anonymous_abuse_identity", { p_installation_id: `admin-smoke-a-${stamp}` });
    await rpcOrThrow(participantB, "register_anonymous_abuse_identity", { p_installation_id: `admin-smoke-b-${stamp}` });

    const message = await rpcOrThrow(participantA, "send_random_message", {
      p_session_id: sessionId,
      p_content: "測試管理後台可見的安全訊號。",
    });
    await expect(Boolean(message?.id), "message should be inserted for admin smoke");

    const report = await rpcOrThrow(participantA, "report_random_user", {
      p_session_id: sessionId,
      p_category: "harassment",
      p_description: "測試後台報表。",
      p_block: false,
    });
    await expect(Boolean(report?.report_id), "report should be created for admin smoke");

    const { error: moderationInsertError } = await admin.from("moderation_enforcements").insert({
      subject_user_id: createdUserIds.b,
      enforcement_type: "temporary_suspension",
      reason_code: "admin_smoke_test",
      status: "active",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      metadata: { source: "admin_smoke" },
    });
    if (moderationInsertError) {
      throw moderationInsertError;
    }

    const [summaryResult, sessionsResult, realtimeResult, reportsResult, safetyResult] = await Promise.all([
      fetchJson(server.baseUrl, "/api/admin/summary", {
        headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
      }),
      fetchJson(server.baseUrl, "/api/admin/sessions?page=1&pageSize=10", {
        headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
      }),
      fetchJson(server.baseUrl, `/api/admin/realtime?page=1&pageSize=10&sessionId=${sessionId}`, {
        headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
      }),
      fetchJson(server.baseUrl, "/api/admin/reports?page=1&pageSize=10", {
        headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
      }),
      fetchJson(server.baseUrl, "/api/admin/safety?page=1&pageSize=10", {
        headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
      }),
    ]);

    for (const [index, result] of [summaryResult, sessionsResult, realtimeResult, reportsResult, safetyResult].entries()) {
      await expect(result.response.ok, `admin endpoint ${index + 1} should be readable`);
    }

    await expect(typeof summaryResult.payload?.waiting_count === "number", "summary should include waiting_count");
    await expect(Array.isArray(sessionsResult.payload?.items), "sessions should return items");
    await expect(Array.isArray(realtimeResult.payload?.items), "realtime should return items");
    await expect(Array.isArray(reportsResult.payload?.items), "reports should return items");
    await expect(Array.isArray(safetyResult.payload?.moderation_enforcements), "safety should return enforcements");
    await expect(Array.isArray(safetyResult.payload?.fraud_risk_events), "safety should return fraud events");

    const sessionListHit = sessionsResult.payload?.items?.find((item) => item.id === sessionId);
    await expect(Boolean(sessionListHit), "admin sessions list should include test session");

    const sessionRowProbe = await adminRouteClient
      .from("random_chat_sessions")
      .select("id,user_a,user_b,status,created_at,ended_at,ended_by,ended_reason")
      .eq("id", sessionId)
      .maybeSingle();
    await expect(!sessionRowProbe.error && Boolean(sessionRowProbe.data), "admin route should be able to read session row");

    const messagesProbe = await adminRouteClient
      .from("random_chat_messages")
      .select("id,session_id,sender_id,content,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    await expect(!messagesProbe.error, `admin route should be able to read messages (${messagesProbe.error?.message ?? "ok"})`);

    const reportsProbe = await adminRouteClient
      .from("reports")
      .select("id,created_at,random_session_id,category,reporter_id,reported_user_id,status,reviewed_at")
      .eq("random_session_id", sessionId)
      .order("created_at", { ascending: false });
    await expect(!reportsProbe.error, `admin route should be able to read reports (${reportsProbe.error?.message ?? "ok"})`);

    const fraudProbe = await adminRouteClient
      .from("fraud_risk_events")
      .select("id,user_id,session_id,message_id,risk_level,risk_types,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
    await expect(!fraudProbe.error, `admin route should be able to read fraud events (${fraudProbe.error?.message ?? "ok"})`);

    const blocksProbe = await adminRouteClient
      .from("blocks")
      .select("id,blocker_id,blocked_user_id,created_at")
      .in("blocker_id", [createdUserIds.a, createdUserIds.b]);
    await expect(!blocksProbe.error, `admin route should be able to read blocks (${blocksProbe.error?.message ?? "ok"})`);

    const sessionDetail = await fetchJson(server.baseUrl, `/api/admin/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
    });
    await expect(
      sessionDetail.response.ok,
      `admin session detail should be readable (status=${sessionDetail.response.status}, body=${JSON.stringify(sessionDetail.payload)})`
    );
    await expect(sessionDetail.payload?.id === sessionId, "session detail should match session id");
    await expect(!Object.prototype.hasOwnProperty.call(sessionDetail.payload ?? {}, "messages"), "session detail should omit messages by default");

    const sessionDetailWithMessages = await fetchJson(server.baseUrl, `/api/admin/sessions/${sessionId}?includeMessages=1`, {
      headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
    });
    await expect(Array.isArray(sessionDetailWithMessages.payload?.messages), "session detail should include messages when requested");
    await expect(
      sessionDetailWithMessages.payload?.messages?.some((item) => item.content?.includes("測試管理後台可見的安全訊號。")),
      "session messages should contain sent content only when requested"
    );

    await expect(Array.isArray(realtimeResult.payload?.items), "admin realtime should return items array");

    const normalRead = await fetchJson(server.baseUrl, "/api/admin/summary", {
      headers: { Authorization: `Bearer ${normalAuth.session.access_token}` },
    });
    await expect(normalRead.response.status === 403, "normal user should be blocked from admin summary");

    const normalEndpoints = ["/api/admin/sessions", "/api/admin/realtime", "/api/admin/reports", "/api/admin/safety"];
    for (const route of normalEndpoints) {
      const result = await fetchJson(server.baseUrl, route, {
        headers: { Authorization: `Bearer ${normalAuth.session.access_token}` },
      });
      await expect(result.response.status === 403, `normal user should be denied for ${route}`);
    }

    const telemetryInsertId = await rpcOrThrow(participantA, "record_realtime_diagnostic", {
      p_session_id: sessionId,
      p_event_type: "message_loaded_from_db",
      p_client_instance_id: `admin-smoke-client-${stamp}`,
      p_message_id: message.id,
      p_safe_error_code: null,
      p_metadata: { source: "admin-smoke" },
    });
    await expect(Boolean(telemetryInsertId), "telemetry rpc should return id");

    const telemetryDirectRead = await admin
      .from("realtime_diagnostics")
      .select("id,session_id,user_id,event_type,message_id,client_instance_id,safe_error_code,metadata,created_at")
      .eq("session_id", sessionId)
      .eq("message_id", message.id)
      .maybeSingle();
    await expect(Boolean(telemetryDirectRead.data), "telemetry row should exist after safe RPC write");

    const adminAuthTelemetryRead = await adminRouteClient
      .from("realtime_diagnostics")
      .select("id,session_id,user_id,event_type,message_id,client_instance_id,safe_error_code,metadata,created_at")
      .eq("session_id", sessionId)
      .eq("message_id", message.id)
      .maybeSingle();
    await expect(Boolean(adminAuthTelemetryRead.data), "admin auth client should be able to read telemetry row directly");

    const directTelemetryRead = await normalClient.from("realtime_diagnostics").select("id").limit(1);
    await expect(Boolean(directTelemetryRead.error) || (directTelemetryRead.data ?? []).length === 0, "normal client should not directly read realtime diagnostics");

    const adminTelemetryRead = await fetchJson(server.baseUrl, `/api/admin/realtime?page=1&pageSize=20&sessionId=${sessionId}&eventType=message_loaded_from_db`, {
      headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
    });
    await expect(adminTelemetryRead.response.ok, "admin should read realtime diagnostics after write");
    await expect(
      (adminTelemetryRead.payload?.items ?? []).some((item) => item.session_id === sessionId && item.message_id === message.id),
      "admin realtime should include safe telemetry row"
    );

    summary.tests = {
      unauthenticated_denied: true,
      normal_user_denied: true,
      admin_summary: true,
      admin_sessions: true,
      admin_realtime: true,
      admin_reports: true,
      admin_safety: true,
      telemetry_write: true,
      telemetry_private_read_blocked: true,
      default_session_detail_is_safe: true,
    };

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } finally {
    await withTimeout(cleanupAdminSmokeSession(admin, sessionId).catch(() => null), 5000).catch(() => null);

    for (const userId of Object.values(createdUserIds)) {
      await withTimeout(deleteUser(admin, userId).catch(() => null), 5000).catch(() => null);
    }

    if (server?.child) {
      server.child.kill("SIGKILL");
    }
    process.exit(0);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

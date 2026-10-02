import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminBlockRow,
  AdminFraudRiskEventRow,
  AdminModerationEnforcementRow,
  AdminPaginationResult,
  AdminRealtimeDiagnosticRow,
  AdminReportListItem,
  AdminSessionDetail,
  AdminSessionDetailMessage,
  AdminSessionListItem,
  AdminSummary,
} from "./admin-types";

function getTaipeiDayStartIso(now = new Date()) {
  // Taiwan does not observe DST. Shift to UTC+8 to get the Taipei calendar date,
  // then convert Taipei 00:00 back to UTC for Supabase timestamptz comparisons.
  const taipeiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(taipeiNow.getUTCFullYear(), taipeiNow.getUTCMonth(), taipeiNow.getUTCDate()) -
      8 * 60 * 60 * 1000
  ).toISOString();
}

function clampPageSize(value: number | null | undefined, fallback = 20, max = 100) {
  const next = Number.isFinite(value ?? NaN) ? Math.floor(Number(value)) : fallback;
  return Math.max(1, Math.min(max, next || fallback));
}

function clampPage(value: number | null | undefined, fallback = 1) {
  const next = Number.isFinite(value ?? NaN) ? Math.floor(Number(value)) : fallback;
  return Math.max(1, next || fallback);
}

function pairKey(userA: string, userB: string) {
  return [userA, userB].sort().join(":");
}

async function ensureOk<T>(promise: PromiseLike<{ data: T; error: { message?: string } | null }> | { data: T; error: { message?: string } | null }) {
  const result = await Promise.resolve(promise);
  if (result.error) {
    throw result.error;
  }

  return result.data;
}

function mapSessionMessages(rows: { session_id: string; created_at: string }[]) {
  const bySession = new Map<
    string,
    {
      count: number;
      lastMessageAt: string | null;
    }
  >();

  for (const row of rows) {
    const current = bySession.get(row.session_id) ?? { count: 0, lastMessageAt: null };
    current.count += 1;
    if (!current.lastMessageAt || row.created_at > current.lastMessageAt) {
      current.lastMessageAt = row.created_at;
    }
    bySession.set(row.session_id, current);
  }

  return bySession;
}

function mapReportSessionFlags(rows: { random_session_id: string | null }[]) {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.random_session_id) {
      set.add(row.random_session_id);
    }
  }
  return set;
}

function mapFraudSessionFlags(rows: { session_id: string | null }[]) {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.session_id) {
      set.add(row.session_id);
    }
  }
  return set;
}

function mapBlockPairs(rows: { blocker_id: string; blocked_user_id: string }[]) {
  const set = new Set<string>();
  for (const row of rows) {
    set.add(pairKey(row.blocker_id, row.blocked_user_id));
  }
  return set;
}

async function loadBlocksForUserIds(client: SupabaseClient, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) {
    return [] as { id: string; blocker_id: string; blocked_user_id: string; created_at: string }[];
  }

  const [asBlocker, asBlocked] = await Promise.all([
    client
      .from("blocks")
      .select("id,blocker_id,blocked_user_id,created_at")
      .in("blocker_id", uniqueUserIds),
    client
      .from("blocks")
      .select("id,blocker_id,blocked_user_id,created_at")
      .in("blocked_user_id", uniqueUserIds),
  ]);

  if (asBlocker.error) {
    throw asBlocker.error;
  }

  if (asBlocked.error) {
    throw asBlocked.error;
  }

  const rows = [...(asBlocker.data ?? []), ...(asBlocked.data ?? [])] as {
    id: string;
    blocker_id: string;
    blocked_user_id: string;
    created_at: string;
  }[];

  const deduped = new Map<string, { id: string; blocker_id: string; blocked_user_id: string; created_at: string }>();
  for (const row of rows) {
    deduped.set(row.id, row);
  }

  return [...deduped.values()];
}

function safeJsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function loadLayaServiceHealth() {
  const baseUrl = (process.env.LAYA_BASE_URL || "https://laya-production-e3f5.up.railway.app").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: process.env.LAYA_API_TOKEN
        ? { Authorization: `Bearer ${process.env.LAYA_API_TOKEN}` }
        : undefined,
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return { state: "error" as const, latencyMs };
    }

    const payload = (await response.json().catch(() => null)) as { state?: unknown; ok?: unknown } | null;
    const state = payload?.state;

    if (state === "ready") return { state: "ready" as const, latencyMs };
    if (state === "loading") return { state: "loading" as const, latencyMs };
    return { state: "error" as const, latencyMs };
  } catch {
    return { state: "unreachable" as const, latencyMs: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadAdminSummary(client: SupabaseClient): Promise<AdminSummary> {
  const dayStart = getTaipeiDayStartIso();
  const layaHealthPromise = loadLayaServiceHealth();

  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;
  const deploymentVersion = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const deploymentBranch = process.env.VERCEL_GIT_COMMIT_REF || null;
  const deploymentEnvironment = process.env.VERCEL_ENV || null;
  const deploymentUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

  const deploymentHealthPromise = deploymentId
    ? client.rpc("record_admin_deployment_health", {
        p_deployment_id: deploymentId,
        p_commit_sha: deploymentVersion,
        p_commit_ref: deploymentBranch,
        p_deployment_url: deploymentUrl,
        p_environment: deploymentEnvironment,
      })
    : Promise.resolve({ data: null, error: null });

  const [
    { data: anonymousStatsData, error: anonymousStatsError },
    { data: healthData, error: healthError },
    { data: recentErrorsData, error: recentErrorsError },
    { data: liveMatchData, error: liveMatchError },
    deploymentHealthResult,
  ] = await Promise.all([
    client.rpc("get_admin_random_chat_stats"),
    client.rpc("get_admin_health_metrics"),
    client.rpc("get_admin_recent_error_summary"),
    client.rpc("get_admin_live_match_metrics"),
    deploymentHealthPromise,
  ]);
  if (anonymousStatsError) {
    throw anonymousStatsError;
  }
  if (healthError) {
    throw healthError;
  }
  if (recentErrorsError) {
    throw recentErrorsError;
  }
  if (liveMatchError) {
    throw liveMatchError;
  }

  const anonymousStats = Array.isArray(anonymousStatsData)
    ? anonymousStatsData[0] ?? {}
    : anonymousStatsData ?? {};
  const healthStats = Array.isArray(healthData)
    ? healthData[0] ?? {}
    : healthData ?? {};
  const recentErrors = Array.isArray(recentErrorsData) ? recentErrorsData : [];
  const liveMatchStats = Array.isArray(liveMatchData)
    ? liveMatchData[0] ?? {}
    : liveMatchData ?? {};
  const lastSuccessfulDeploymentAt =
    deploymentHealthResult && !deploymentHealthResult.error && typeof deploymentHealthResult.data === "string"
      ? deploymentHealthResult.data
      : null;

  const safeCount = async (query: PromiseLike<{ count: number | null; error: { message?: string } | null }>) => {
    const result = await query;
    return result.error ? 0 : result.count ?? 0;
  };

  const [
    waitingCount,
    activeSessionCount,
    todayEndedSessionCount,
    todayReportCount,
    todayBlockCount,
    todayFraudCount,
    activePushSubscriptionCount,
    pendingPushEventCount,
    todayWebPushDeliveredCount,
    todayWebPushRevokedCount,
  ] = await Promise.all([
    safeCount(client.from("random_match_queue").select("user_id", { count: "exact", head: true }).eq("status", "waiting")),
    safeCount(client.from("random_chat_sessions").select("id", { count: "exact", head: true }).eq("status", "active")),
    safeCount(client.from("random_chat_sessions").select("id", { count: "exact", head: true }).eq("status", "ended").gte("ended_at", dayStart)),
    safeCount(client.from("reports").select("id", { count: "exact", head: true }).gte("created_at", dayStart)),
    safeCount(client.from("blocks").select("id", { count: "exact", head: true }).gte("created_at", dayStart)),
    safeCount(client.from("fraud_risk_events").select("id", { count: "exact", head: true }).gte("created_at", dayStart)),
    safeCount(client.from("web_push_subscriptions").select("id", { count: "exact", head: true }).is("revoked_at", null)),
    safeCount(client.from("push_notification_events").select("id", { count: "exact", head: true }).eq("status", "pending")),
    safeCount(client.from("web_push_deliveries").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", dayStart)),
    safeCount(client.from("web_push_deliveries").select("id", { count: "exact", head: true }).eq("status", "revoked").gte("created_at", dayStart)),
  ]);

  const asNumber = (value: unknown) => Number(value ?? 0);
  const layaHealth = await layaHealthPromise;

  return {
    generated_at: new Date().toISOString(),
    waiting_count: waitingCount,
    active_session_count: activeSessionCount,
    live_online_count: asNumber((liveMatchStats as any).online_now),
    live_avg_wait_seconds: asNumber((liveMatchStats as any).avg_wait_seconds),
    waiting_over_1m: asNumber((liveMatchStats as any).waiting_over_1m),
    waiting_over_3m: asNumber((liveMatchStats as any).waiting_over_3m),
    waiting_over_5m: asNumber((liveMatchStats as any).waiting_over_5m),
    today_anonymous_user_count: asNumber((anonymousStats as any).today_users),
    today_created_session_count: asNumber((anonymousStats as any).today_sessions),
    today_message_count: asNumber((anonymousStats as any).today_messages),
    today_queue_join_count: asNumber((anonymousStats as any).today_queue_joins),
    seven_day_anonymous_user_count: asNumber((anonymousStats as any).seven_day_users),
    seven_day_session_count: asNumber((anonymousStats as any).seven_day_sessions),
    seven_day_message_count: asNumber((anonymousStats as any).seven_day_messages),
    seven_day_queue_join_count: asNumber((anonymousStats as any).seven_day_queue_joins),
    today_ended_session_count: todayEndedSessionCount,
    today_report_count: todayReportCount,
    today_block_count: todayBlockCount,
    today_fraud_risk_event_count: todayFraudCount,
    active_push_subscription_count: activePushSubscriptionCount,
    pending_push_event_count: pendingPushEventCount,
    today_web_push_delivered_count: todayWebPushDeliveredCount,
    today_web_push_revoked_count: todayWebPushRevokedCount,
    today_match_success_rate: (healthStats as any).today_match_success_rate == null ? null : asNumber((healthStats as any).today_match_success_rate),
    today_avg_wait_seconds: (healthStats as any).today_avg_wait_seconds == null ? null : asNumber((healthStats as any).today_avg_wait_seconds),
    realtime_errors_1h: asNumber((healthStats as any).realtime_errors_1h),
    realtime_errors_10m: asNumber((healthStats as any).realtime_errors_10m),
    realtime_errors_5m: asNumber((healthStats as any).realtime_errors_5m),
    realtime_errors_1m: asNumber((healthStats as any).realtime_errors_1m),
    realtime_last_error_at: (healthStats as any).realtime_last_error_at ? String((healthStats as any).realtime_last_error_at) : null,
    today_push_success_rate: (healthStats as any).today_push_success_rate == null ? null : asNumber((healthStats as any).today_push_success_rate),
    today_laya_success_rate: (healthStats as any).today_laya_success_rate == null ? null : asNumber((healthStats as any).today_laya_success_rate),
    today_chat_assist_requests: asNumber((healthStats as any).today_chat_assist_requests),
    laya_service_state: layaHealth.state,
    laya_health_latency_ms: layaHealth.latencyMs,
    deployment_version: deploymentVersion,
    deployment_id: deploymentId,
    deployment_branch: deploymentBranch,
    deployment_environment: deploymentEnvironment,
    deployment_url: deploymentUrl,
    last_successful_deployment_at: lastSuccessfulDeploymentAt,
    recent_error_summary: recentErrors.map((item: any) => ({
      source: String(item.source ?? "unknown"),
      error_code: String(item.error_code ?? "UNKNOWN"),
      error_count: asNumber(item.error_count),
      last_seen: String(item.last_seen ?? ""),
    })),
  };
}

export async function loadAdminSessions(
  client: SupabaseClient,
  input: { page?: number; pageSize?: number; status?: string | null }
): Promise<AdminPaginationResult<AdminSessionListItem>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize, 20, 50);
  const offset = (page - 1) * pageSize;

  const { data, error } = await client.rpc("list_admin_random_sessions", {
    p_status: input.status && input.status !== "all" ? input.status : null,
    p_offset: offset,
    p_limit: pageSize,
  });
  if (error) throw error;

  const sessionRows = Array.isArray(data) ? data : [];
  const participantIds = new Set<string>();
  const sessionIds = sessionRows.map((row: any) => row.id);
  for (const row of sessionRows as any[]) {
    participantIds.add(row.user_a);
    participantIds.add(row.user_b);
  }

  const [reportRows, fraudRows, blockRows] = await Promise.all([
    sessionIds.length
      ? ensureOk(client.from("reports").select("random_session_id").in("random_session_id", sessionIds))
      : Promise.resolve([] as { random_session_id: string | null }[]),
    sessionIds.length
      ? ensureOk(client.from("fraud_risk_events").select("session_id").in("session_id", sessionIds))
      : Promise.resolve([] as { session_id: string | null }[]),
    participantIds.size
      ? loadBlocksForUserIds(client, [...participantIds])
      : Promise.resolve([] as { blocker_id: string; blocked_user_id: string; created_at: string }[]),
  ]);

  const reportedSessions = mapReportSessionFlags(reportRows ?? []);
  const fraudSessions = mapFraudSessionFlags(fraudRows ?? []);
  const blockPairs = mapBlockPairs(blockRows ?? []);

  return {
    items: sessionRows.map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status,
      participant_count: 2,
      message_count: Number(row.message_count ?? 0),
      first_message_at: row.first_message_at ?? null,
      last_message_at: row.last_message_at ?? null,
      ended_at: row.ended_at ?? null,
      ended_reason: row.ended_reason ?? null,
      user_a: row.user_a,
      user_b: row.user_b,
      has_report: reportedSessions.has(row.id),
      has_block: blockPairs.has(pairKey(row.user_a, row.user_b)),
      has_fraud_risk_event: fraudSessions.has(row.id),
    })),
    page,
    pageSize,
    total: Number(sessionRows[0]?.total_count ?? 0),
  };
}

export async function loadAdminSessionDetail(
  client: SupabaseClient,
  sessionId: string,
  options: { includeMessages?: boolean } = {}
): Promise<AdminSessionDetail | null> {
  const { data: sessionRow, error } = await client
    .from("random_chat_sessions")
    .select("id,user_a,user_b,status,created_at,ended_at,ended_by,ended_reason")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!sessionRow) {
    return null;
  }

  const [messagesResult, reportsResult, fraudResult, blocks] = await Promise.all([
    client
      .from("random_chat_messages")
      .select("id,session_id,sender_id,content,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    client.from("reports").select("id,created_at,random_session_id,category,reporter_id,reported_user_id,status,reviewed_at").eq("random_session_id", sessionId).order("created_at", { ascending: false }),
    client.from("fraud_risk_events").select("id,user_id,session_id,message_id,risk_level,risk_types,created_at").eq("session_id", sessionId).order("created_at", { ascending: false }),
    loadBlocksForUserIds(client, [sessionRow.user_a, sessionRow.user_b]),
  ]);

  if (messagesResult.error) {
    throw messagesResult.error;
  }
  if (reportsResult.error) {
    throw reportsResult.error;
  }
  if (fraudResult.error) {
    throw fraudResult.error;
  }
  const messages = (messagesResult.data ?? []) as AdminSessionDetailMessage[];
  const reports = (reportsResult.data ?? []).map((item) => ({
    id: item.id,
    created_at: item.created_at,
    random_session_id: item.random_session_id,
    category: item.category,
    reporter_id: item.reporter_id,
    reported_user_id: item.reported_user_id,
    status: item.status,
    reviewed_at: item.reviewed_at ?? null,
    session_status: sessionRow.status,
    has_block: false,
    has_fraud_risk_event: false,
  })) as AdminReportListItem[];
  const fraudRiskEvents = (fraudResult.data ?? []).map((item) => ({
    id: item.id,
    user_id: item.user_id,
    session_id: item.session_id,
    message_id: item.message_id,
    risk_level: item.risk_level,
    risk_types: item.risk_types ?? [],
    created_at: item.created_at,
  })) as AdminFraudRiskEventRow[];
  const reportHasBlock = new Set<string>();
  if (blocks.length > 0) {
    const pairs = new Set(blocks.map((item) => pairKey(item.blocker_id, item.blocked_user_id)));
    if (pairs.has(pairKey(sessionRow.user_a, sessionRow.user_b))) {
      reportHasBlock.add(sessionId);
    }
  }

  const reportHasFraud = fraudRiskEvents.length > 0;

  const decoratedReports = reports.map((item) => ({
    ...item,
    has_block: reportHasBlock.has(sessionId),
    has_fraud_risk_event: reportHasFraud,
  }));

  const loadedMessages = options.includeMessages
    ? messages.map((message) => ({
        id: message.id,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
      }))
    : undefined;

  return {
    id: sessionRow.id,
    created_at: sessionRow.created_at,
    status: sessionRow.status,
    ended_at: sessionRow.ended_at ?? null,
    ended_reason: sessionRow.ended_reason ?? null,
    ended_by: sessionRow.ended_by ?? null,
    user_a: sessionRow.user_a,
    user_b: sessionRow.user_b,
    participant_count: 2,
    message_count: messages.length,
    first_message_at: messages[0]?.created_at ?? null,
    last_message_at: messages[messages.length - 1]?.created_at ?? null,
    reports: decoratedReports,
    blocks,
    fraud_risk_events: fraudRiskEvents,
    messages: loadedMessages,
  };
}

export async function loadAdminRealtimeDiagnostics(
  client: SupabaseClient,
  input: { sessionId?: string | null; eventType?: string | null; page?: number; pageSize?: number }
): Promise<AdminPaginationResult<AdminRealtimeDiagnosticRow>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize, 50, 100);
  const offset = (page - 1) * pageSize;

  const { data, error } = await client.rpc("list_admin_realtime_diagnostics", {
    p_session_id: input.sessionId || null,
    p_event_type: input.eventType && input.eventType !== "all" ? input.eventType : null,
    p_offset: offset,
    p_limit: pageSize,
  });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];

  return {
    items: rows.map((item: any) => ({
      id: item.id,
      session_id: item.session_id,
      user_id: item.user_id,
      event_type: item.event_type,
      message_id: item.message_id,
      client_instance_id: item.client_instance_id,
      safe_error_code: item.safe_error_code,
      metadata: safeJsonObject(item.metadata),
      created_at: item.created_at,
    })),
    page,
    pageSize,
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export async function loadAdminReports(
  client: SupabaseClient,
  input: { page?: number; pageSize?: number; status?: string | null }
): Promise<AdminPaginationResult<AdminReportListItem>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize, 20, 50);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = client
    .from("reports")
    .select("id,created_at,random_session_id,category,reporter_id,reported_user_id,status,reviewed_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (input.status && input.status !== "all") {
    query = query.eq("status", input.status);
  }

  const { data, count, error } = await query;
  if (error) {
    throw error;
  }

  const reportRows = (data ?? []) as {
    id: string;
    created_at: string;
    random_session_id: string | null;
    category: string;
    reporter_id: string;
    reported_user_id: string;
    status: string;
    reviewed_at: string | null;
  }[];

  const sessionIds = reportRows.map((row) => row.random_session_id).filter((value): value is string => Boolean(value));
  const participantIds = new Set<string>();
  reportRows.forEach((row) => {
    participantIds.add(row.reporter_id);
    participantIds.add(row.reported_user_id);
  });

  const [sessionRows, blockRows, fraudRows] = await Promise.all([
    sessionIds.length
      ? ensureOk(client.from("random_chat_sessions").select("id,status").in("id", sessionIds))
      : Promise.resolve([] as { id: string; status: string }[]),
    participantIds.size
      ? loadBlocksForUserIds(client, [...participantIds])
      : Promise.resolve([] as { blocker_id: string; blocked_user_id: string; created_at: string }[]),
    sessionIds.length
      ? ensureOk(client.from("fraud_risk_events").select("session_id").in("session_id", sessionIds))
      : Promise.resolve([] as { session_id: string | null }[]),
  ]);

  const sessionStatusById = new Map((sessionRows ?? []).map((row) => [row.id, row.status] as const));
  const blockPairs = mapBlockPairs(blockRows ?? []);
  const fraudSessions = mapFraudSessionFlags(fraudRows ?? []);

  return {
    items: reportRows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      random_session_id: row.random_session_id,
      category: row.category,
      reporter_id: row.reporter_id,
      reported_user_id: row.reported_user_id,
      status: row.status,
      reviewed_at: row.reviewed_at,
      session_status: row.random_session_id ? sessionStatusById.get(row.random_session_id) ?? null : null,
      has_block: blockPairs.has(pairKey(row.reporter_id, row.reported_user_id)),
      has_fraud_risk_event: row.random_session_id ? fraudSessions.has(row.random_session_id) : false,
    })),
    page,
    pageSize,
    total: count ?? 0,
  };
}

export async function loadAdminSafety(
  client: SupabaseClient,
  input: { page?: number; pageSize?: number }
): Promise<{
  moderation_enforcements: AdminModerationEnforcementRow[];
  fraud_risk_events: AdminFraudRiskEventRow[];
  stats: {
    active_temporary_suspensions: number;
    active_permanent_bans: number;
    active_warnings: number;
  };
}> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize, 25, 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const [moderationResult, fraudResult] = await Promise.all([
    client
      .from("moderation_enforcements")
      .select("id,subject_user_id,enforcement_type,reason_code,status,created_at,expires_at,revoked_at,metadata", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to),
    client
      .from("fraud_risk_events")
      .select("id,user_id,session_id,message_id,risk_level,risk_types,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to),
  ]);

  if (moderationResult.error) {
    throw moderationResult.error;
  }

  if (fraudResult.error) {
    throw fraudResult.error;
  }

  const moderationRows = (moderationResult.data ?? []).map((item) => ({
    id: item.id,
    subject_user_id: item.subject_user_id,
    enforcement_type: item.enforcement_type,
    reason_code: item.reason_code,
    status: item.status,
    created_at: item.created_at,
    expires_at: item.expires_at ?? null,
    revoked_at: item.revoked_at ?? null,
    metadata: safeJsonObject(item.metadata),
  })) as AdminModerationEnforcementRow[];

  const fraudRows = (fraudResult.data ?? []).map((item) => ({
    id: item.id,
    user_id: item.user_id,
    session_id: item.session_id,
    message_id: item.message_id,
    risk_level: item.risk_level,
    risk_types: item.risk_types ?? [],
    created_at: item.created_at,
  })) as AdminFraudRiskEventRow[];

  return {
    moderation_enforcements: moderationRows,
    fraud_risk_events: fraudRows,
    stats: {
      active_temporary_suspensions: moderationRows.filter((item) => item.enforcement_type === "temporary_suspension" && item.status === "active").length,
      active_permanent_bans: moderationRows.filter((item) => item.enforcement_type === "permanent_ban" && item.status === "active").length,
      active_warnings: moderationRows.filter((item) => item.enforcement_type === "warning" && item.status === "active").length,
    },
  };
}

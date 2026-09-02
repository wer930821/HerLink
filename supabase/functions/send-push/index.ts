import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type EventType =
  | "new_match"
  | "new_message"
  | "verification_result"
  | "push_test"
  | "random_match"
  | "random_message";

type DeliveryTarget = "web" | "native" | "both";
type TargetName = "web" | "native";
type TargetStatus = "sent" | "failed" | "skipped";

interface PushEventRow {
  id: string;
  event_type: EventType;
  user_id: string;
  actor_user_id: string | null;
  match_id: string | null;
  message_id: string | null;
  verification_id: string | null;
  session_id: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  status: "pending" | "processing" | "sent" | "failed" | "skipped";
  delivery_attempts: number;
  event_created_at: string;
  delivery_started_at: string | null;
  delivered_at: string | null;
  processing_claim_token: string | null;
  delivery_target: DeliveryTarget;
  web_delivery_status: TargetStatus | null;
  native_delivery_status: TargetStatus | null;
  web_last_error: string | null;
  native_last_error: string | null;
  web_delivered_at: string | null;
  native_delivered_at: string | null;
}

interface PushTokenRow {
  id: string;
  user_id: string;
  expo_push_token: string;
  active: boolean;
}

interface WebPushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

interface DeliveryResult {
  target: TargetName;
  status: TargetStatus;
  error: string | null;
  sent: number;
  failed: number;
  skipped: number;
  revoked: number;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const REVOCABLE_EXPO_ERRORS = new Set(["DeviceNotRegistered", "MessageTooBig", "InvalidCredentials"]);

const PUSH_CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://her-link-ten.vercel.app",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function buildAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase function environment.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  });
}

function looksLikeExpoPushToken(token: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

async function ensureAuthorized(req: Request, supabaseAdmin: ReturnType<typeof buildAdminClient>) {
  if (PUSH_CRON_SECRET) {
    const cronSecret = req.headers.get("x-push-cron-secret");
    if (cronSecret && cronSecret === PUSH_CRON_SECRET) {
      return { kind: "cron" as const, userId: null };
    }
  }

  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const bearer = authHeader.slice("Bearer ".length).trim();
  if (!bearer) {
    throw new Error("Missing bearer token.");
  }

  if (serviceRoleKey && bearer === serviceRoleKey) {
    return { kind: "service_role" as const, userId: null };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(bearer);
  if (error || !data.user) {
    throw new Error("Unauthorized.");
  }

  return { kind: "user" as const, userId: data.user.id };
}

/**
 * Final event-level transition: clears the processing claim so the immediate
 * dispatcher / cron fallback can claim the event again only when it stays in a
 * retryable state. Per-target states are persisted independently beforehand, so
 * a later retry never re-sends a target that already reached a terminal state.
 */
async function updateEventStatus(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow,
  values: Record<string, unknown>
) {
  const { data, error } = await supabaseAdmin
    .from("push_notification_events")
    .update({ ...values, processing_claimed_at: null, processing_claim_token: null })
    .eq("id", event.id)
    .eq("status", "processing")
    .eq("processing_claim_token", event.processing_claim_token)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    console.warn(JSON.stringify({ scope: "push", message: "event_claim_lost", eventId: event.id }));
  }
}

/**
 * Persists one target's terminal result while keeping the event claim intact.
 * The other target and the overall event status remain independent of this
 * write, and a crash after this write cannot cause a duplicate for this target.
 */
async function persistTargetResult(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow,
  result: DeliveryResult
) {
  const now = new Date().toISOString();
  const targetPatch =
    result.target === "web"
      ? {
          web_delivery_status: result.status,
          web_last_error: result.error,
          web_delivered_at: result.status === "sent" ? now : null,
        }
      : {
          native_delivery_status: result.status,
          native_last_error: result.error,
          native_delivered_at: result.status === "sent" ? now : null,
        };

  const { data, error } = await supabaseAdmin
    .from("push_notification_events")
    .update(targetPatch)
    .eq("id", event.id)
    .eq("status", "processing")
    .eq("processing_claim_token", event.processing_claim_token)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    console.warn(
      JSON.stringify({
        scope: "push",
        message: "target_claim_lost",
        eventId: event.id,
        target: result.target,
      })
    );
  }
}

async function disableTokens(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  tokenIds: string[]
) {
  if (tokenIds.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("push_tokens")
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .in("id", tokenIds);

  if (error) {
    throw error;
  }
}

async function markSkipped(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow,
  reason: string
) {
  await updateEventStatus(supabaseAdmin, event, {
    status: "skipped",
    last_error: reason,
    processed_at: new Date().toISOString(),
    delivery_attempts: event.delivery_attempts + 1,
  });
}

async function loadRecipientProfile(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  userId: string
) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,account_status,onboarding_completed")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function shouldSendEvent(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  const profile = await loadRecipientProfile(supabaseAdmin, event.user_id);

  if (event.event_type === "verification_result") {
    return profile.account_status !== "deletion_pending";
  }

  return profile.account_status === "active" && profile.onboarding_completed === true;
}

async function isConversationPushStillAllowed(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  if (!event.match_id) {
    return false;
  }

  const { data: matchRow, error: matchError } = await supabaseAdmin
    .from("matches")
    .select("id,status,user_1_id,user_2_id")
    .eq("id", event.match_id)
    .maybeSingle();

  if (matchError) {
    throw matchError;
  }

  if (!matchRow || matchRow.status !== "active") {
    return false;
  }

  const actorId = event.actor_user_id;
  if (!actorId) {
    return true;
  }

  const { data: hasBlock, error: blockError } = await supabaseAdmin.rpc("has_block_between", {
    user_a: actorId,
    user_b: event.user_id,
  });

  if (blockError) {
    throw blockError;
  }

  return !hasBlock;
}

async function isRandomConversationPushStillAllowed(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  const sessionId =
    event.session_id ??
    (event.payload && typeof event.payload.session_id === "string"
      ? event.payload.session_id
      : null);

  if (!sessionId) {
    return false;
  }

  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("random_chat_sessions")
    .select("id,status,user_a,user_b")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    throw sessionError;
  }

  if (!sessionRow || sessionRow.status !== "active") {
    return false;
  }

  const actorId = event.actor_user_id;
  if (!actorId) {
    return true;
  }

  const { data: hasBlock, error: blockError } = await supabaseAdmin.rpc("has_block_between", {
    user_a: actorId,
    user_b: event.user_id,
  });

  if (blockError) {
    throw blockError;
  }

  return !hasBlock;
}

async function loadActiveTokens(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  userId: string
) {
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("id,user_id,expo_push_token,active")
    .eq("user_id", userId)
    .eq("active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as PushTokenRow[];
}

async function recordNativePushDelivery(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  values: {
    eventId: string | null;
    tokenId: string;
    userId: string;
    status: "sent" | "failed" | "revoked" | "skipped";
    errorCode: string | null;
  }
) {
  const { data, error } = await supabaseAdmin
    .from("native_push_deliveries")
    .insert({
      event_id: values.eventId,
      token_id: values.tokenId,
      user_id: values.userId,
      status: values.status,
      error_code: values.errorCode,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

async function handleMalformedTokens(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  tokens: PushTokenRow[],
  event: PushEventRow
) {
  const malformed = tokens.filter((token) => !looksLikeExpoPushToken(token.expo_push_token));
  if (malformed.length > 0) {
    await disableTokens(
      supabaseAdmin,
      malformed.map((token) => token.id)
    );
    for (const token of malformed) {
      await recordNativePushDelivery(supabaseAdmin, {
        eventId: event.id,
        tokenId: token.id,
        userId: token.user_id,
        status: "revoked",
        errorCode: "malformed_token",
      });
    }
  }

  return tokens.filter((token) => looksLikeExpoPushToken(token.expo_push_token));
}

async function sendExpoPush(messages: Array<Record<string, unknown>>) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(messages),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof payload?.errors?.[0]?.message === "string"
        ? payload.errors[0].message
        : `Expo push request failed with ${response.status}.`
    );
  }

  return payload;
}

async function loadActiveWebPushSubscriptions(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  userId: string
) {
  const { data, error } = await supabaseAdmin
    .from("web_push_subscriptions")
    .select("id,endpoint,p256dh,auth_key")
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (error) {
    throw error;
  }

  return (data ?? []) as WebPushSubscriptionRow[];
}

async function recordWebPushDelivery(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  eventId: string | null,
  subscriptionId: string,
  userId: string,
  status: "sent" | "failed" | "revoked" | "skipped",
  providerStatus: number | null,
  errorCode: string | null
) {
  const { data, error } = await supabaseAdmin
    .from("web_push_deliveries")
    .insert({ event_id: eventId, subscription_id: subscriptionId, user_id: userId, status, provider_status: providerStatus, error_code: errorCode })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

async function sendDirectWebPushTest(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  userId: string
) {
  const { data: subscription, error } = await supabaseAdmin
    .from("web_push_subscriptions")
    .select("id,endpoint,p256dh,auth_key")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!subscription) return { ok: false, error: "subscription_not_found" };
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { ok: false, error: "vapid_not_configured" };
  }

  const endpointHost = new URL(subscription.endpoint).host;
  try {
    const result = await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } },
      JSON.stringify({ title: "HerLink 測試通知", body: "如果看到這則通知，代表 Web Push 已成功。", target_url: "/" }),
      { TTL: 60, urgency: "high", vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY } }
    );
    const deliveryId = await recordWebPushDelivery(supabaseAdmin, null, subscription.id, userId, "sent", result?.statusCode ?? 201, null);
    return { ok: true, endpoint_host: endpointHost, provider_status: result?.statusCode ?? 201, delivery_audit_id: deliveryId };
  } catch (caught) {
    const failure = caught as { statusCode?: number; message?: string };
    const deliveryId = await recordWebPushDelivery(supabaseAdmin, null, subscription.id, userId, "failed", failure.statusCode ?? null, String(failure.message ?? "web_push_failed").slice(0, 500));
    return { ok: false, endpoint_host: endpointHost, provider_status: failure.statusCode ?? null, error: failure.message ?? "web_push_failed", delivery_audit_id: deliveryId };
  }
}

async function revokeWebPushSubscription(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  subscriptionId: string
) {
  const { error } = await supabaseAdmin
    .from("web_push_subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);

  if (error) {
    throw error;
  }
}

async function touchWebPushSubscription(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  subscriptionId: string
) {
  const { error } = await supabaseAdmin
    .from("web_push_subscriptions")
    .update({
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);

  if (error) {
    throw error;
  }
}

function eventSessionId(event: PushEventRow) {
  return (
    event.session_id ??
    (event.payload && typeof event.payload.session_id === "string"
      ? event.payload.session_id
      : null)
  );
}

function buildWebPushPayload(event: PushEventRow): Record<string, unknown> {
  const sessionId = eventSessionId(event);
  const messageId =
    event.message_id ??
    (event.payload && typeof event.payload.message_id === "string"
      ? event.payload.message_id
      : null);

  return {
    type: event.event_type === "random_match" ? "match" : "message",
    event_id: event.id,
    event_type: event.event_type,
    session_id: sessionId,
    message_id: messageId,
    title: event.title,
    body: event.body,
    target_url: sessionId ? `/session/${sessionId}` : "/",
  };
}

/**
 * Native push payload is intentionally minimal: navigation metadata only.
 * Never includes message content, image content, or sensitive profile data.
 * The Expo token set is always loaded by event.user_id server-side, so a token
 * cannot be addressed unless it is owned by the event's validated receiver.
 */
function buildNativePushData(event: PushEventRow): Record<string, unknown> {
  const sessionId = eventSessionId(event);
  const isRandomEvent = event.event_type === "random_match" || event.event_type === "random_message";
  const matchId =
    event.match_id ??
    (event.payload && typeof event.payload.match_id === "string"
      ? event.payload.match_id
      : null);

  let targetUrl = "/";
  if (isRandomEvent && sessionId) {
    targetUrl = `/random-session/${sessionId}`;
  } else if (matchId) {
    targetUrl = `/chat/${matchId}`;
  }

  return {
    event_type: event.event_type,
    session_id: sessionId,
    target_url: targetUrl,
  };
}

function targetsForDeliveryTarget(target: DeliveryTarget | null, event: PushEventRow): TargetName[] {
  const normalized =
    target ??
    (event.event_type === "random_match" || event.event_type === "random_message"
      ? "both"
      : "native");

  if (normalized === "both") {
    return ["web", "native"];
  }

  if (normalized === "web") {
    return ["web"];
  }

  return ["native"];
}

function storedTargetResult(event: PushEventRow, target: TargetName): DeliveryResult {
  const status = target === "web" ? event.web_delivery_status : event.native_delivery_status;
  const lastError = target === "web" ? event.web_last_error : event.native_last_error;
  return {
    target,
    status: status ?? "failed",
    error: lastError,
    sent: 0,
    failed: 0,
    skipped: 0,
    revoked: 0,
  };
}

async function deliverWebPush(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
): Promise<DeliveryResult> {
  const subscriptions = await loadActiveWebPushSubscriptions(supabaseAdmin, event.user_id);

  if (subscriptions.length === 0) {
    return { target: "web", status: "skipped", error: "no_active_subscriptions", sent: 0, failed: 0, skipped: 1, revoked: 0 };
  }

  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { target: "web", status: "failed", error: "vapid_not_configured", sent: 0, failed: 1, skipped: 0, revoked: 0 };
  }

  const payload = JSON.stringify(buildWebPushPayload(event));
  let delivered = 0;
  let revoked = 0;
  let transientFailed = 0;
  let lastError: string | null = null;

  for (const subscription of subscriptions) {
    try {
      const result = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth_key,
          },
        },
        payload,
        {
          TTL: 86400,
          urgency: "high",
          vapidDetails: {
            subject: VAPID_SUBJECT,
            publicKey: VAPID_PUBLIC_KEY,
            privateKey: VAPID_PRIVATE_KEY,
          },
        }
      );

      delivered += 1;
      await touchWebPushSubscription(supabaseAdmin, subscription.id);
      await recordWebPushDelivery(
        supabaseAdmin,
        event.id,
        subscription.id,
        event.user_id,
        "sent",
        typeof result?.statusCode === "number" ? result.statusCode : 201,
        null
      );
    } catch (error) {
      const err = error as { statusCode?: number; message?: string };
      const statusCode = typeof err?.statusCode === "number" ? err.statusCode : null;

      if (statusCode === 404 || statusCode === 410) {
        revoked += 1;
        await revokeWebPushSubscription(supabaseAdmin, subscription.id);
        await recordWebPushDelivery(
          supabaseAdmin,
          event.id,
          subscription.id,
          event.user_id,
          "revoked",
          statusCode,
          "subscription_gone"
        );
      } else {
        transientFailed += 1;
        lastError = err?.message ? String(err.message) : `web_push_failed_${statusCode ?? "unknown"}`;
        await recordWebPushDelivery(
          supabaseAdmin,
          event.id,
          subscription.id,
          event.user_id,
          "failed",
          statusCode,
          String(err?.message ?? "web_push_failed")
        );
      }
    }
  }

  if (delivered > 0 || revoked > 0) {
    return {
      target: "web",
      status: "sent",
      error: transientFailed > 0 ? `${transientFailed} subscription(s) failed` : null,
      sent: delivered,
      failed: transientFailed,
      skipped: 0,
      revoked,
    };
  }

  return {
    target: "web",
    status: "failed",
    error: lastError ?? "web_push_delivery_failed",
    sent: 0,
    failed: transientFailed,
    skipped: 0,
    revoked,
  };
}

async function deliverNativePush(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
): Promise<DeliveryResult> {
  // Server-side receiver binding: only active tokens owned by event.user_id are
  // eligible. There is no client-supplied token or receiver id in the payload.
  const activeTokens = await loadActiveTokens(supabaseAdmin, event.user_id);
  const validTokens = await handleMalformedTokens(supabaseAdmin, activeTokens, event);

  if (validTokens.length === 0) {
    return { target: "native", status: "skipped", error: "no_active_tokens", sent: 0, failed: 0, skipped: 1, revoked: 0 };
  }

  const messages = validTokens.map((token) => ({
    to: token.expo_push_token,
    title: event.title,
    body: event.body,
    sound: "default",
    data: buildNativePushData(event),
  }));

  let responsePayload: Record<string, unknown>;
  try {
    responsePayload = await sendExpoPush(messages);
  } catch (error) {
    return {
      target: "native",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      sent: 0,
      failed: messages.length,
      skipped: 0,
      revoked: 0,
    };
  }

  const tickets = Array.isArray(responsePayload?.data) ? (responsePayload.data as Array<Record<string, unknown>>) : [];
  if (tickets.length !== messages.length) {
    return {
      target: "native",
      status: "failed",
      error: "expo_push_ticket_mismatch",
      sent: 0,
      failed: messages.length,
      skipped: 0,
      revoked: 0,
    };
  }

  const disableIds: string[] = [];
  let sent = 0;
  let failed = 0;
  let revoked = 0;
  let lastError: string | null = null;

  for (let index = 0; index < messages.length; index += 1) {
    const token = validTokens[index];
    const ticket = tickets[index] ?? {};
    const details =
      ticket && typeof ticket === "object" && ticket.details && typeof ticket.details === "object"
        ? (ticket.details as Record<string, unknown>)
        : null;
    const errorCode = typeof details?.error === "string" ? details.error : null;
    const ticketOk = ticket?.status === "ok" && !errorCode;

    if (ticketOk) {
      sent += 1;
      await recordNativePushDelivery(supabaseAdmin, {
        eventId: event.id,
        tokenId: token.id,
        userId: token.user_id,
        status: "sent",
        errorCode: null,
      });
      continue;
    }

    const normalizedError = errorCode ?? "expo_push_ticket_error";
    if (errorCode && REVOCABLE_EXPO_ERRORS.has(errorCode)) {
      revoked += 1;
      disableIds.push(token.id);
      await recordNativePushDelivery(supabaseAdmin, {
        eventId: event.id,
        tokenId: token.id,
        userId: token.user_id,
        status: "revoked",
        errorCode: normalizedError,
      });
    } else {
      failed += 1;
      lastError = normalizedError;
      await recordNativePushDelivery(supabaseAdmin, {
        eventId: event.id,
        tokenId: token.id,
        userId: token.user_id,
        status: "failed",
        errorCode: normalizedError,
      });
    }
  }

  if (disableIds.length > 0) {
    await disableTokens(supabaseAdmin, disableIds);
  }

  if (sent > 0) {
    return {
      target: "native",
      status: "sent",
      error: failed > 0 ? `${failed} token(s) failed` : null,
      sent,
      failed,
      skipped: 0,
      revoked,
    };
  }

  return {
    target: "native",
    status: "failed",
    error: lastError ?? "expo_push_delivery_failed",
    sent: 0,
    failed,
    skipped: 0,
    revoked,
  };
}

function finalizeOverallStatus(results: DeliveryResult[]) {
  const failedTargets = results.filter((result) => result.status === "failed");
  const sentTargets = results.filter((result) => result.status === "sent");
  const status: "sent" | "failed" | "skipped" =
    failedTargets.length > 0
      ? "failed"
      : sentTargets.length > 0
        ? "sent"
        : "skipped";

  let lastError: string | null = null;
  if (failedTargets.length > 0) {
    lastError = failedTargets
      .map((result) => `${result.target}:${result.error ?? "delivery_failed"}`)
      .join("; ");
  } else if (status === "skipped") {
    lastError = results
      .map((result) => `${result.target}:${result.error ?? "skipped"}`)
      .join("; ");
  }

  return { status, lastError };
}

async function processEvent(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  if (!(await shouldSendEvent(supabaseAdmin, event))) {
    await markSkipped(supabaseAdmin, event, "recipient_not_eligible");
    return { sent: 0, skipped: 1, failed: 0 };
  }

  const isRandomEvent = event.event_type === "random_match" || event.event_type === "random_message";

  if (isRandomEvent) {
    if (!(await isRandomConversationPushStillAllowed(supabaseAdmin, event))) {
      await markSkipped(supabaseAdmin, event, "conversation_not_available");
      return { sent: 0, skipped: 1, failed: 0 };
    }

    if (event.event_type === "random_message" && event.actor_user_id === event.user_id) {
      await markSkipped(supabaseAdmin, event, "self_message_no_push");
      return { sent: 0, skipped: 1, failed: 0 };
    }
  } else if (
    (event.event_type === "new_match" || event.event_type === "new_message") &&
    !(await isConversationPushStillAllowed(supabaseAdmin, event))
  ) {
    await markSkipped(supabaseAdmin, event, "conversation_not_available");
    return { sent: 0, skipped: 1, failed: 0 };
  } else if (event.event_type === "new_message" && event.actor_user_id === event.user_id) {
    await markSkipped(supabaseAdmin, event, "self_message_no_push");
    return { sent: 0, skipped: 1, failed: 0 };
  }

  const targets = targetsForDeliveryTarget(event.delivery_target, event);
  const results: DeliveryResult[] = [];

  for (const target of targets) {
    const storedStatus = target === "web" ? event.web_delivery_status : event.native_delivery_status;

    if (storedStatus === "sent" || storedStatus === "skipped") {
      results.push(storedTargetResult(event, target));
      continue;
    }

    const result =
      target === "web"
        ? await deliverWebPush(supabaseAdmin, event)
        : await deliverNativePush(supabaseAdmin, event);

    await persistTargetResult(supabaseAdmin, event, result);
    results.push(result);
  }

  const overall = finalizeOverallStatus(results);
  const now = new Date().toISOString();
  const sentAny = overall.status === "sent";

  await updateEventStatus(supabaseAdmin, event, {
    status: overall.status,
    last_error: overall.lastError,
    sent_at: sentAny ? now : null,
    delivered_at: sentAny ? now : null,
    processed_at: now,
    delivery_attempts: event.delivery_attempts + 1,
  });

  console.info(
    JSON.stringify({
      scope: "push",
      message: "event_processed",
      eventId: event.id,
      eventType: event.event_type,
      userId: event.user_id,
      deliveryTarget: event.delivery_target,
      targets: results.map((result) => ({
        target: result.target,
        status: result.status,
        error: result.error,
        sent: result.sent,
        failed: result.failed,
        revoked: result.revoked,
      })),
      overallStatus: overall.status,
    })
  );

  if (overall.status === "sent") {
    return { sent: 1, skipped: 0, failed: 0 };
  }

  if (overall.status === "skipped") {
    return { sent: 0, skipped: 1, failed: 0 };
  }

  return { sent: 0, skipped: 0, failed: 1 };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    const supabaseAdmin = buildAdminClient();
    const authorization = await ensureAuthorized(req, supabaseAdmin);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (authorization.kind === "user") {
      if (body && typeof body === "object" && body.mode === "self_test") {
        return json(await sendDirectWebPushTest(supabaseAdmin, authorization.userId));
      }
      return json({ ok: false, error: "Service authorization required." }, 403);
    }
    const requestedLimit =
      body && typeof body === "object" && typeof body.limit === "number" ? body.limit : 10;
    const requestedEventId =
      body && typeof body === "object" && typeof body.eventId === "string" ? body.eventId : null;
    const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit)));

    // This is the sole transition into `processing`. PostgreSQL row locks make
    // the immediate pg_net invocation and the minutely cron fallback mutually
    // exclusive for every event.
    const { data: events, error } = await supabaseAdmin.rpc("claim_push_notification_events", {
      p_event_id: requestedEventId,
      p_limit: requestedEventId ? 1 : limit,
      p_include_failed: !requestedEventId,
    });

    if (error) {
      return json({ ok: false, error: error.message }, 500);
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const event of (events ?? []) as PushEventRow[]) {
      const result = await processEvent(supabaseAdmin, event);
      sent += result.sent;
      skipped += result.skipped;
      failed += result.failed;
    }

    return json({
      ok: true,
      processed: (events ?? []).length,
      sent,
      skipped,
      failed,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      401
    );
  }
});

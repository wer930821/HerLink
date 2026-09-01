import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type EventType =
  | "new_match"
  | "new_message"
  | "verification_result"
  | "push_test"
  | "random_match"
  | "random_message";

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
  status: "pending" | "sent" | "failed" | "skipped";
  delivery_attempts: number;
}

interface PushTokenRow {
  id: string;
  expo_push_token: string;
  active: boolean;
}

interface WebPushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const PUSH_CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
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

async function updateEventStatus(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  eventId: string,
  values: Record<string, unknown>
) {
  const { error } = await supabaseAdmin
    .from("push_notification_events")
    .update(values)
    .eq("id", eventId);

  if (error) {
    throw error;
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
  await updateEventStatus(supabaseAdmin, event.id, {
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
    .select("id,expo_push_token,active")
    .eq("user_id", userId)
    .eq("active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as PushTokenRow[];
}

async function handleMalformedTokens(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  tokens: PushTokenRow[]
) {
  const malformed = tokens.filter((token) => !looksLikeExpoPushToken(token.expo_push_token));
  if (malformed.length > 0) {
    await disableTokens(
      supabaseAdmin,
      malformed.map((token) => token.id)
    );
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
  const { error } = await supabaseAdmin.from("web_push_deliveries").insert({
    event_id: eventId,
    subscription_id: subscriptionId,
    user_id: userId,
    status,
    provider_status: providerStatus,
    error_code: errorCode,
  });

  if (error) {
    throw error;
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

function buildWebPushPayload(event: PushEventRow): Record<string, unknown> {
  const sessionId =
    event.session_id ??
    (event.payload && typeof event.payload.session_id === "string"
      ? event.payload.session_id
      : null);
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

async function deliverWebPush(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  const subscriptions = await loadActiveWebPushSubscriptions(supabaseAdmin, event.user_id);

  if (subscriptions.length === 0) {
    await markSkipped(supabaseAdmin, event, "no_active_subscriptions");
    return { sent: 0, skipped: 1, failed: 0 };
  }

  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    await updateEventStatus(supabaseAdmin, event.id, {
      status: "failed",
      last_error: "vapid_not_configured",
      processed_at: new Date().toISOString(),
      delivery_attempts: event.delivery_attempts + 1,
    });
    return { sent: 0, skipped: 0, failed: 1 };
  }

  const payload = JSON.stringify(buildWebPushPayload(event));
  const now = new Date().toISOString();
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
    await updateEventStatus(supabaseAdmin, event.id, {
      status: "sent",
      sent_at: now,
      processed_at: now,
      last_error: transientFailed > 0 ? `${transientFailed} subscription(s) failed` : null,
      delivery_attempts: event.delivery_attempts + 1,
    });
    return { sent: delivered > 0 ? 1 : 0, skipped: 0, failed: transientFailed };
  }

  await updateEventStatus(supabaseAdmin, event.id, {
    status: "failed",
    last_error: lastError ?? "web_push_delivery_failed",
    processed_at: now,
    delivery_attempts: event.delivery_attempts + 1,
  });

  return { sent: 0, skipped: 0, failed: 1 };
}

async function deliverExpoPush(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  const activeTokens = await loadActiveTokens(supabaseAdmin, event.user_id);
  const validTokens = await handleMalformedTokens(supabaseAdmin, activeTokens);

  if (validTokens.length === 0) {
    await markSkipped(supabaseAdmin, event, "no_active_tokens");
    return { sent: 0, skipped: 1, failed: 0 };
  }

  const now = new Date().toISOString();
  const messages = validTokens.map((token) => ({
    to: token.expo_push_token,
    title: event.title,
    body: event.body,
    sound: "default",
    data: {
      eventType: event.event_type,
      matchId: event.match_id,
      messageId: event.message_id,
      verificationId: event.verification_id,
      ...(event.payload ?? {}),
    },
  }));

  try {
    const result = await sendExpoPush(messages);
    const receipts = Array.isArray(result?.data) ? result.data : [];
    const invalidTokenIds: string[] = [];

    receipts.forEach((receipt: Record<string, unknown>, index: number) => {
      const details =
        receipt && typeof receipt === "object" && receipt.details && typeof receipt.details === "object"
          ? receipt.details as Record<string, unknown>
          : null;
      const errorCode = typeof details?.error === "string" ? details.error : null;
      if (errorCode === "DeviceNotRegistered" || errorCode === "MessageTooBig" || errorCode === "InvalidCredentials") {
        invalidTokenIds.push(validTokens[index].id);
      }
    });

    if (invalidTokenIds.length > 0) {
      await disableTokens(supabaseAdmin, invalidTokenIds);
    }

    await updateEventStatus(supabaseAdmin, event.id, {
      status: "sent",
      sent_at: now,
      processed_at: now,
      last_error: null,
      delivery_attempts: event.delivery_attempts + 1,
    });

    console.info(
      JSON.stringify({
        scope: "push",
        message: "event_sent",
        eventId: event.id,
        eventType: event.event_type,
        userId: event.user_id,
        tokenCount: validTokens.length,
        invalidatedTokenCount: invalidTokenIds.length,
      })
    );

    return { sent: 1, skipped: 0, failed: 0 };
  } catch (error) {
    await updateEventStatus(supabaseAdmin, event.id, {
      status: "failed",
      last_error: error instanceof Error ? error.message : String(error),
      processed_at: now,
      delivery_attempts: event.delivery_attempts + 1,
    });

    console.error(
      JSON.stringify({
        scope: "push",
        message: "event_failed",
        eventId: event.id,
        eventType: event.event_type,
        userId: event.user_id,
        error: error instanceof Error ? error.message : String(error),
      })
    );

    return { sent: 0, skipped: 0, failed: 1 };
  }
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

    return await deliverWebPush(supabaseAdmin, event);
  }

  if ((event.event_type === "new_match" || event.event_type === "new_message") &&
      !(await isConversationPushStillAllowed(supabaseAdmin, event))) {
    await markSkipped(supabaseAdmin, event, "conversation_not_available");
    return { sent: 0, skipped: 1, failed: 0 };
  }

  if (event.event_type === "new_message" && event.actor_user_id === event.user_id) {
    await markSkipped(supabaseAdmin, event, "self_message_no_push");
    return { sent: 0, skipped: 1, failed: 0 };
  }

  return await deliverExpoPush(supabaseAdmin, event);
}

Deno.serve(async (req) => {
  try {
    const supabaseAdmin = buildAdminClient();
    const authorization = await ensureAuthorized(req, supabaseAdmin);
    if (authorization.kind === "user") {
      return json({ ok: false, error: "Service authorization required." }, 403);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const requestedLimit =
      body && typeof body === "object" && typeof body.limit === "number" ? body.limit : 10;
    const requestedEventType =
      body && typeof body === "object" && typeof body.eventType === "string" ? body.eventType : null;
    const requestedEventId =
      body && typeof body === "object" && typeof body.eventId === "string" ? body.eventId : null;
    const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit)));
    const eventTypeFilter =
      requestedEventType &&
      ["new_match", "new_message", "verification_result", "push_test", "random_match", "random_message"].includes(requestedEventType)
        ? requestedEventType
        : null;

    let query = supabaseAdmin
      .from("push_notification_events")
      .select("id,event_type,user_id,actor_user_id,match_id,message_id,verification_id,session_id,title,body,payload,status,delivery_attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (eventTypeFilter) {
      query = query.eq("event_type", eventTypeFilter);
    }
    if (requestedEventId) {
      query = query.eq("id", requestedEventId);
    }

    const { data: events, error } = await query.limit(limit);

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

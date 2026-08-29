import { createClient } from "npm:@supabase/supabase-js@2";

type EventType = "new_match" | "new_message" | "verification_result" | "push_test";

interface PushEventRow {
  id: string;
  event_type: EventType;
  user_id: string;
  actor_user_id: string | null;
  match_id: string | null;
  message_id: string | null;
  verification_id: string | null;
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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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

async function processEvent(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  event: PushEventRow
) {
  if (!(await shouldSendEvent(supabaseAdmin, event))) {
    await markSkipped(supabaseAdmin, event, "recipient_not_eligible");
    return { sent: 0, skipped: 1, failed: 0 };
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

Deno.serve(async (req) => {
  try {
    const supabaseAdmin = buildAdminClient();
    await ensureAuthorized(req, supabaseAdmin);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const requestedLimit =
      body && typeof body === "object" && typeof body.limit === "number" ? body.limit : 10;
    const requestedEventType =
      body && typeof body === "object" && typeof body.eventType === "string" ? body.eventType : null;
    const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit)));
    const eventTypeFilter =
      requestedEventType && ["new_match", "new_message", "verification_result", "push_test"].includes(requestedEventType)
        ? requestedEventType
        : null;

    let query = supabaseAdmin
      .from("push_notification_events")
      .select("id,event_type,user_id,actor_user_id,match_id,message_id,verification_id,title,body,payload,status,delivery_attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (eventTypeFilter) {
      query = query.eq("event_type", eventTypeFilter);
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

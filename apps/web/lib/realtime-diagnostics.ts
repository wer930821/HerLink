"use client";

import { supabase } from "./supabase";

export const REALTIME_DIAGNOSTIC_EVENT_TYPES = [
  "realtime_subscribe_started",
  "realtime_subscribed",
  "realtime_subscribe_error",
  "realtime_disconnected",
  "realtime_reconnected",
  "message_received_realtime",
  "message_loaded_from_db",
] as const;

export type RealtimeDiagnosticEventType = (typeof REALTIME_DIAGNOSTIC_EVENT_TYPES)[number];

const LOCAL_ONLY_REALTIME_DIAGNOSTIC_EVENT_TYPES = new Set<RealtimeDiagnosticEventType>([
  "message_received_realtime",
  "message_loaded_from_db",
]);

export type RealtimeDiagnosticInput = {
  sessionId: string;
  eventType: RealtimeDiagnosticEventType;
  clientInstanceId: string;
  messageId?: string | null;
  safeErrorCode?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordRealtimeDiagnostic(input: RealtimeDiagnosticInput) {
  // Healthy per-message events are intentionally not persisted. They can occur
  // for every delivered message and every database refresh, so writing an RPC
  // for each one amplifies Database Egress without helping incident diagnosis.
  // Keep connection lifecycle and error events persisted below.
  if (LOCAL_ONLY_REALTIME_DIAGNOSTIC_EVENT_TYPES.has(input.eventType)) {
    return {
      data: null,
      error: null,
    };
  }

  const result = await supabase.rpc("record_realtime_diagnostic", {
    p_session_id: input.sessionId,
    p_event_type: input.eventType,
    p_client_instance_id: input.clientInstanceId,
    p_message_id: input.messageId ?? null,
    p_safe_error_code: input.safeErrorCode ?? null,
    p_metadata: input.metadata ?? {},
  });

  return {
    data: result.data,
    error: result.error,
  };
}

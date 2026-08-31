export type AdminSummary = {
  generated_at: string;
  waiting_count: number;
  active_session_count: number;
  today_created_session_count: number;
  today_message_count: number;
  today_ended_session_count: number;
  today_report_count: number;
  today_block_count: number;
  today_fraud_risk_event_count: number;
};

export type AdminSessionListItem = {
  id: string;
  created_at: string;
  status: "waiting" | "matched" | "ended";
  participant_count: number;
  message_count: number;
  last_message_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  user_a: string;
  user_b: string;
  has_report: boolean;
  has_block: boolean;
  has_fraud_risk_event: boolean;
};

export type AdminSessionDetailMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

export type AdminSessionDetail = {
  id: string;
  created_at: string;
  status: "waiting" | "matched" | "ended";
  ended_at: string | null;
  ended_reason: string | null;
  ended_by: string | null;
  user_a: string;
  user_b: string;
  participant_count: number;
  message_count: number;
  first_message_at: string | null;
  last_message_at: string | null;
  reports: AdminReportListItem[];
  blocks: AdminBlockRow[];
  fraud_risk_events: AdminFraudRiskEventRow[];
  messages?: AdminSessionDetailMessage[];
};

export type AdminRealtimeDiagnosticRow = {
  id: string;
  session_id: string;
  user_id: string;
  event_type:
    | "realtime_subscribe_started"
    | "realtime_subscribed"
    | "realtime_subscribe_error"
    | "realtime_disconnected"
    | "realtime_reconnected"
    | "message_received_realtime"
    | "message_loaded_from_db";
  message_id: string | null;
  client_instance_id: string;
  safe_error_code: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminReportListItem = {
  id: string;
  created_at: string;
  random_session_id: string | null;
  category: string;
  reporter_id: string;
  reported_user_id: string;
  status: string;
  reviewed_at: string | null;
  session_status: string | null;
  has_block: boolean;
  has_fraud_risk_event: boolean;
};

export type AdminFraudRiskEventRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  message_id: string | null;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_types: string[];
  created_at: string;
};

export type AdminBlockRow = {
  id: string;
  blocker_id: string;
  blocked_user_id: string;
  created_at: string;
};

export type AdminModerationEnforcementRow = {
  id: string;
  subject_user_id: string | null;
  enforcement_type: "warning" | "temporary_suspension" | "permanent_ban";
  reason_code: string | null;
  status: "active" | "expired" | "revoked";
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  metadata: Record<string, unknown>;
};

export type AdminPaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

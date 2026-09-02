import { supabase } from "./supabase";

export type RandomSessionStatus = "active" | "ended";

export type RandomSession = {
  id: string;
  status: RandomSessionStatus;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  ended_by_me: boolean | null;
  partner_anonymous_display_name: string;
  partner_anonymous_avatar: string | null;
  partner_verified: boolean;
  partner_age_display: string | null;
  partner_city: string | null;
  icebreaker_prompt: string | null;
  icebreaker_category: string | null;
  icebreaker_turn: number | null;
};

export type RandomMessage = {
  id: string;
  session_id: string;
  content: string;
  created_at: string;
  is_mine: boolean;
  risk_level: string | null;
  risk_types: string[] | null;
  message_type: "text" | "image";
  media_path: string | null;
  media_mime: string | null;
  media_size: number | null;
  media_width: number | null;
  media_height: number | null;
  reply_to_message_id: string | null;
  reply_message_id: string | null;
  reply_is_mine: boolean | null;
  reply_message_type: "text" | "image" | null;
  reply_body: string | null;
  reply_media_path: string | null;
};

export type RandomMatchResult = {
  status: "waiting" | "matched";
  session_id: string | null;
  matched_user_id: string | null;
};

export type RandomReportCategory =
  | "spam"
  | "scam"
  | "money_request"
  | "investment_scam"
  | "harassment"
  | "sexual_content"
  | "threat"
  | "impersonation"
  | "suspected_minor"
  | "other";

export const RANDOM_REPORT_CATEGORY_OPTIONS: Array<{
  value: RandomReportCategory;
  label: string;
}> = [
  { value: "spam", label: "垃圾訊息 / 廣告" },
  { value: "scam", label: "詐騙" },
  { value: "money_request", label: "索取金錢" },
  { value: "investment_scam", label: "投資詐騙" },
  { value: "harassment", label: "騷擾" },
  { value: "sexual_content", label: "露骨內容" },
  { value: "threat", label: "威脅" },
  { value: "impersonation", label: "冒名" },
  { value: "suspected_minor", label: "疑似未成年" },
  { value: "other", label: "其他" },
];

const rpc = supabase as any;

function firstRow<T>(rows: T[] | null | undefined): T | null {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function findOrJoinRandomMatch() {
  const { data, error } = await rpc.rpc("find_or_join_random_match");
  if (error) throw error;
  return (firstRow(data) ?? null) as RandomMatchResult | null;
}

export async function leaveRandomQueue() {
  const { error } = await rpc.rpc("leave_random_queue");
  if (error) throw error;
}

export async function leaveRandomSession(sessionId: string) {
  const { data, error } = await rpc.rpc("leave_random_session", { p_session_id: sessionId });
  if (error) throw error;
  return firstRow(data) as { ended: boolean; session_id: string | null } | null;
}

export async function nextRandomMatch(sessionId: string) {
  const { data, error } = await rpc.rpc("next_random_match", { p_session_id: sessionId });
  if (error) throw error;
  return (firstRow(data) ?? null) as RandomMatchResult | null;
}

export async function blockRandomUser(sessionId: string) {
  const { data, error } = await rpc.rpc("block_random_user", { p_session_id: sessionId });
  if (error) throw error;
  return (firstRow(data) ?? null) as { blocked: boolean; session_ended: boolean } | null;
}

export async function reportRandomUser(
  sessionId: string,
  category: RandomReportCategory,
  description?: string | null,
  block = false
) {
  const { data, error } = await rpc.rpc("report_random_user", {
    p_session_id: sessionId,
    p_category: category,
    p_description: description ?? null,
    p_block: block,
  });
  if (error) throw error;
  return (firstRow(data) ?? null) as {
    report_id: string;
    status: string;
    created_at: string;
    blocked: boolean;
  } | null;
}

export async function getRandomSession(sessionId: string) {
  const { data, error } = await rpc.rpc("get_my_random_session_view", { p_session_id: sessionId });
  if (error) throw error;
  return (firstRow(data) ?? null) as RandomSession | null;
}

export async function listRandomMessages(sessionId: string, limit = 100) {
  const { data, error } = await rpc.rpc("list_random_messages", {
    p_session_id: sessionId,
    p_limit: limit,
    p_before_created_at: null,
    p_before_id: null,
    p_after_created_at: null,
    p_after_id: null,
  });
  if (error) throw error;
  return (data ?? []) as RandomMessage[];
}

export async function listRandomMessagesAfter(
  sessionId: string,
  afterCreatedAt: string,
  afterId: string,
  limit = 100
) {
  const { data, error } = await rpc.rpc("list_random_messages", {
    p_session_id: sessionId,
    p_limit: limit,
    p_before_created_at: null,
    p_before_id: null,
    p_after_created_at: afterCreatedAt,
    p_after_id: afterId,
  });
  if (error) throw error;
  return (data ?? []) as RandomMessage[];
}

export async function getRandomMessageReplyPreview(sessionId: string, messageId: string) {
  const { data, error } = await rpc.rpc("get_random_message_reply_preview", {
    p_session_id: sessionId,
    p_message_id: messageId,
  });
  if (error) throw error;
  return (firstRow(data) ?? null) as {
    reply_message_id: string;
    reply_is_mine: boolean;
    reply_message_type: "text" | "image";
    reply_body: string | null;
    reply_media_path: string | null;
  } | null;
}

export async function sendRandomText(
  sessionId: string,
  content: string,
  replyToId?: string | null
) {
  const { data, error } = await rpc.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: content,
    p_message_type: "text",
    p_media_path: null,
    p_media_mime: null,
    p_media_size: null,
    p_media_width: null,
    p_media_height: null,
    p_reply_to_message_id: replyToId ?? null,
  });
  if (error) throw error;
  return (firstRow(data) ?? null) as RandomMessage | null;
}

export type RandomChatMediaUpload = {
  path: string;
  mime: string;
  size: number;
  width: number;
  height: number;
};

export async function sendRandomImageMessage(
  sessionId: string,
  media: RandomChatMediaUpload,
  replyToId?: string | null
) {
  const { data, error } = await rpc.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: null,
    p_message_type: "image",
    p_media_path: media.path,
    p_media_mime: media.mime,
    p_media_size: media.size,
    p_media_width: media.width,
    p_media_height: media.height,
    p_reply_to_message_id: replyToId ?? null,
  });
  if (error) throw error;
  return (firstRow(data) ?? null) as RandomMessage | null;
}

export async function uploadRandomChatImage(
  sessionId: string,
  userId: string,
  bytes: Uint8Array,
  extension: "jpg" | "png" | "webp"
) {
  const objectPath = `${sessionId}/${userId}/${randomObjectId()}.${extension}`;
  const { data, error } = await supabase.storage.from("chat-media").upload(objectPath, bytes, {
    contentType:
      extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return data.path;
}

export async function removeRandomChatImage(path: string) {
  const { error } = await supabase.storage.from("chat-media").remove([path]);
  if (error) throw error;
}

export async function createRandomChatImageUrl(path: string, expiresIn = 300) {
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

function randomObjectId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export async function getRandomIcebreaker(sessionId: string) {
  const { data, error } = await rpc.rpc("get_random_session_icebreaker", { p_session_id: sessionId });
  if (error) throw error;
  return (firstRow(data) ?? null) as {
    prompt: string;
    category: string;
    turn: number;
  } | null;
}

export async function advanceRandomIcebreaker(sessionId: string) {
  const { data, error } = await rpc.rpc("advance_random_chat_icebreaker", { p_session_id: sessionId });
  if (error) throw error;
  return (firstRow(data) ?? null) as {
    prompt: string;
    category: string;
    turn: number;
  } | null;
}

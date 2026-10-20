import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

// Native counterpart of the web station mailbox (apps/web/app/mailbox/page.tsx).
// Same tables, RPCs and storage bucket, so behavior matches web exactly.

const rpc = supabase as any;

export const MAIL_BUCKET = "station-mail";

export type StationMailThread = {
  id: string;
  subject: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  user_last_read_at: string | null;
};

export type StationMailMessage = {
  id: string;
  thread_id: string;
  sender_role: "user" | "admin";
  body: string;
  created_at: string;
  attachment_path: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
};

export const MAIL_CATEGORIES = [
  { key: "problem", label: "問題回報" },
  { key: "suggestion", label: "建議" },
  { key: "other", label: "其他" },
] as const;

export function threadStatusLabel(status: string) {
  if (status === "replied") return "站長已回覆";
  if (status === "closed") return "已結束";
  return "等待回覆";
}

export function isUnreadThread(t: StationMailThread) {
  return (
    t.status === "replied" &&
    (!t.user_last_read_at || new Date(t.updated_at).getTime() > new Date(t.user_last_read_at).getTime())
  );
}

export async function listMyMailThreads(): Promise<StationMailThread[]> {
  const { data, error } = await rpc
    .from("station_mail_threads")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message || "無法載入信件。");
  return (data ?? []) as StationMailThread[];
}

export async function listMailMessages(threadId: string): Promise<StationMailMessage[]> {
  const { data, error } = await rpc
    .from("station_mail_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message || "無法載入信件內容。");
  return (data ?? []) as StationMailMessage[];
}

export async function markMailThreadRead(threadId: string): Promise<void> {
  await rpc.rpc("station_mail_mark_user_read", { p_thread_id: threadId });
}

/** Returns the new thread id. */
export async function sendStationMail(subject: string, category: string, body: string): Promise<string> {
  const { data, error } = await rpc.rpc("station_mail_send", {
    p_subject: subject.trim(),
    p_category: category,
    p_body: body.trim(),
  });
  if (error) throw new Error(error.message || "寄送失敗，請稍後再試。");
  return data as string;
}

export async function attachMailPhoto(
  threadId: string,
  attachment: { path: string; mime: string; size: number }
): Promise<void> {
  const { error } = await rpc.rpc("station_mail_attach_photo", {
    p_thread_id: threadId,
    p_attachment_path: attachment.path,
    p_attachment_mime: attachment.mime,
    p_attachment_size: attachment.size,
  });
  if (error) throw new Error(error.message || "照片附加失敗。");
}

export async function replyStationMail(
  threadId: string,
  body: string,
  attachment?: { path: string; mime: string; size: number } | null
): Promise<void> {
  const { error } = await rpc.rpc("station_mail_user_reply_with_photo", {
    p_thread_id: threadId,
    p_body: body.trim() || "（照片）",
    p_attachment_path: attachment?.path ?? null,
    p_attachment_mime: attachment?.mime ?? null,
    p_attachment_size: attachment?.size ?? null,
  });
  if (error) throw new Error(error.message || "回覆失敗，請稍後再試。");
}

/** Uploads JPEG bytes prepared by prepareRandomChatImage; returns the storage path. */
export async function uploadMailPhoto(userId: string, bytes: Uint8Array): Promise<string> {
  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(MAIL_BUCKET).upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message || "照片上傳失敗。");
  return path;
}

export async function removeMailPhoto(path: string): Promise<void> {
  await supabase.storage.from(MAIL_BUCKET).remove([path]);
}

export async function createMailPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(MAIL_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

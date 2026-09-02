import { supabase } from "./supabase";

export type RandomSession = {
  id: string; status: "active" | "ended"; created_at: string; ended_at: string | null;
  ended_reason: string | null; partner_anonymous_display_name: string; partner_verified: boolean;
  icebreaker_prompt: string | null; icebreaker_category: string | null; icebreaker_turn: number | null;
};
export type RandomMessage = {
  id: string; session_id: string; content: string; created_at: string; is_mine: boolean;
  message_type: "text" | "image"; media_path: string | null; reply_to_message_id: string | null;
};

const rpc = supabase as any;

export async function findOrJoinRandomMatch() {
  const { data, error } = await rpc.rpc("find_or_join_random_match");
  if (error) throw error;
  return data?.[0] as { status: "waiting" | "matched"; session_id: string | null } | undefined;
}
export async function leaveRandomQueue() { const { error } = await rpc.rpc("leave_random_queue"); if (error) throw error; }
export async function leaveRandomSession(sessionId: string) { const { error } = await rpc.rpc("leave_random_session", { p_session_id: sessionId }); if (error) throw error; }
export async function getRandomSession(sessionId: string) { const { data, error } = await rpc.rpc("get_my_random_session_view", { p_session_id: sessionId }); if (error) throw error; return (data?.[0] ?? null) as RandomSession | null; }
export async function sendRandomText(sessionId: string, content: string, replyToId?: string | null) { const { data, error } = await rpc.rpc("send_random_message", { p_session_id: sessionId, p_content: content, p_message_type: "text", p_reply_to_message_id: replyToId ?? null }); if (error) throw error; return (data?.[0] ?? null) as RandomMessage | null; }
export async function getRandomIcebreaker(sessionId: string) { const { data, error } = await rpc.rpc("get_random_session_icebreaker", { p_session_id: sessionId }); if (error) throw error; return data?.[0] as { prompt: string; category: string; turn: number } | undefined; }
export async function advanceRandomIcebreaker(sessionId: string) { const { data, error } = await rpc.rpc("advance_random_chat_icebreaker", { p_session_id: sessionId }); if (error) throw error; return data?.[0] as { prompt: string; category: string; turn: number } | undefined; }

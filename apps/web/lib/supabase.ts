import { createClient, type Session } from "@supabase/supabase-js";
import { ANONYMOUS_AVATAR_OPTIONS, generateNextAnonymousDisplayName, isAnonymousAvatarId, validateAnonymousDisplayName } from "../../../lib/anonymous";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export type AnonymousAvatarId = (typeof ANONYMOUS_AVATAR_OPTIONS)[number]["id"];

export type WebProfile = {
  id: string;
  anonymous_mode_enabled: boolean | null;
  anonymous_display_name: string | null;
  anonymous_avatar: string | null;
  onboarding_completed: boolean | null;
  account_status: string | null;
};

export type RandomQueueRow = {
  user_id: string;
  status: "waiting" | "matched" | "left";
  joined_at: string;
  updated_at: string;
  matched_session_id: string | null;
};

export type RandomSessionRow = {
  id: string;
  status: "active" | "ended";
  created_at: string;
  ended_at: string | null;
  ended_by_me: boolean;
  ended_reason: string | null;
  partner_anonymous_display_name: string | null;
  partner_anonymous_avatar: string | null;
  partner_verified: boolean;
  partner_age_display: string | null;
  partner_city: string | null;
};

export type RandomMatchRow = {
  status: "waiting" | "matched";
  session_id: string | null;
  matched_user_id: string | null;
};

export type RandomChatMessageRow = {
  id: string;
  session_id: string;
  content: string;
  created_at: string;
  is_mine: boolean;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_types: string[];
};

export type RandomChatMessageRealtimeRow = {
  id: string;
  session_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  risk_types: string[] | null;
};

export type SafeAnonymousRow = {
  id: string;
  anonymous_display_name: string;
  anonymous_avatar: string;
  age_display: string | null;
  verified?: boolean;
};

export function isAnonymousProfileReady(profile: WebProfile | null | undefined) {
  if (!profile?.onboarding_completed || !profile.anonymous_mode_enabled) {
    return false;
  }

  return !validateAnonymousDisplayName(profile.anonymous_display_name);
}

export async function getCurrentSession() {
  return supabase.auth.getSession();
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export async function signInAnonymously() {
  return supabase.auth.signInAnonymously();
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function loadMyProfile(userId: string) {
  return supabase
    .from("profiles")
    .select("id, anonymous_mode_enabled, anonymous_display_name, anonymous_avatar, onboarding_completed, account_status")
    .eq("id", userId)
    .maybeSingle<WebProfile>();
}

export async function upsertAnonymousProfile(userId: string, profile: {
  anonymous_display_name: string;
  anonymous_avatar?: AnonymousAvatarId;
  anonymous_mode_enabled?: boolean;
  onboarding_completed?: boolean;
}) {
  return supabase.from("profiles").upsert({
    id: userId,
    anonymous_mode_enabled: profile.anonymous_mode_enabled ?? true,
    anonymous_display_name: profile.anonymous_display_name,
    anonymous_avatar: profile.anonymous_avatar ?? "avatar_01",
    onboarding_completed: profile.onboarding_completed ?? true,
  });
}

export async function saveAnonymousProfile(
  userId: string,
  profile: {
    anonymous_display_name: string;
    anonymous_avatar?: AnonymousAvatarId;
    anonymous_mode_enabled?: boolean;
    onboarding_completed?: boolean;
  }
) {
  return upsertAnonymousProfile(userId, profile);
}

export async function loadMyActiveRandomSession() {
  const result = await supabase.rpc("get_my_random_session_view");
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: RandomSessionRow | null;
    error: { message?: string } | null;
  };
}

export async function loadMyRandomSession(sessionId: string) {
  const result = await supabase.rpc("get_my_random_session_view", {
    p_session_id: sessionId,
  });
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: RandomSessionRow | null;
    error: { message?: string } | null;
  };
}

export async function loadMyRandomQueue(userId: string) {
  return supabase
    .from("random_match_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<RandomQueueRow>();
}

export async function loadRandomMessages(sessionId: string, limit = 100) {
  return supabase.rpc("list_random_messages", {
    p_session_id: sessionId,
    p_limit: limit,
  }) as unknown as Promise<{
    data: RandomChatMessageRow[] | null;
    error: { message?: string } | null;
  }>;
}

export async function loadSafeAnonymousProfiles(userIds: string[]) {
  return supabase.rpc("get_safe_anonymous_profiles", {
    p_user_ids: userIds,
  });
}

export async function findOrJoinRandomMatch() {
  return supabase.rpc("find_or_join_random_match");
}

export async function leaveRandomQueue() {
  return supabase.rpc("leave_random_queue");
}

export async function leaveRandomSession(sessionId?: string | null) {
  return supabase.rpc("leave_random_session", {
    p_session_id: sessionId ?? null,
  });
}

export async function blockRandomUser(sessionId: string) {
  return supabase.rpc("block_random_user", {
    p_session_id: sessionId,
  }) as unknown as Promise<{
    data: { blocked: boolean; session_ended: boolean }[] | null;
    error: { message?: string } | null;
  }>;
}

export const RANDOM_REPORT_CATEGORIES = [
  "spam",
  "scam",
  "money_request",
  "investment_scam",
  "harassment",
  "sexual_content",
  "threat",
  "impersonation",
  "suspected_minor",
  "other",
] as const;

export type RandomReportCategory = (typeof RANDOM_REPORT_CATEGORIES)[number];

export async function reportRandomUser(
  sessionId: string,
  category: RandomReportCategory,
  description?: string | null,
  block = false
) {
  return supabase.rpc("report_random_user", {
    p_session_id: sessionId,
    p_category: category,
    p_description: description ?? null,
    p_block: block,
  }) as unknown as Promise<{
    data: { report_id: string; status: string; created_at: string; blocked: boolean }[] | null;
    error: { message?: string } | null;
  }>;
}

export async function sendRandomMessage(sessionId: string, content: string) {
  return supabase.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: content,
  }) as unknown as Promise<{
    data: RandomChatMessageRow[] | null;
    error: { message?: string } | null;
  }>;
}

export async function nextRandomMatch(sessionId: string) {
  return supabase.rpc("next_random_match", {
    p_session_id: sessionId,
  }) as unknown as Promise<{
    data: RandomMatchRow[] | null;
    error: { message?: string } | null;
  }>;
}

export function getAnonymousNameSuggestion(currentName?: string | null) {
  return generateNextAnonymousDisplayName(currentName);
}

export function getAnonymousAvatarById(avatarId: string | null | undefined) {
  if (!isAnonymousAvatarId(avatarId)) {
    return ANONYMOUS_AVATAR_OPTIONS[0];
  }

  return ANONYMOUS_AVATAR_OPTIONS.find((option) => option.id === avatarId) ?? ANONYMOUS_AVATAR_OPTIONS[0];
}

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseDiagnostics() {
  return {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
  };
}

export type { Session };

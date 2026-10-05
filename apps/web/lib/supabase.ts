import { createClient, type Session } from "@supabase/supabase-js";
import { ANONYMOUS_AVATAR_OPTIONS, generateNextAnonymousDisplayName, isAnonymousAvatarId, validateAnonymousDisplayName } from "../../../lib/anonymous";
import { normalizeRecoveryResult } from "./recovery-result.mjs";

// Supabase public configuration is supplied by the deployment environment.
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

export type RandomQueueRow = { user_id:string; status:"waiting"|"matched"|"left"; joined_at:string; updated_at:string; matched_session_id:string|null };
export type RandomSessionRow = { id:string; status:"active"|"ended"; created_at:string; ended_at:string|null; ended_by_me:boolean; ended_reason:string|null; partner_anonymous_display_name:string|null; partner_anonymous_avatar:string|null; partner_verified:boolean; partner_age_display:string|null; partner_city:string|null };
export type RandomMatchRow = { status:"waiting"|"matched"; session_id:string|null; matched_user_id:string|null };
export type RandomChatMessageRow = { id:string; session_id:string; content:string; created_at:string; is_mine:boolean; risk_level:"low"|"medium"|"high"|"critical"; risk_types:string[] };
export type RandomChatMessageRealtimeRow = { id:string; session_id:string; sender_id:string; content:string; created_at:string; risk_level:"low"|"medium"|"high"|"critical"|null; risk_types:string[]|null };
export type SafeAnonymousRow = { id:string; anonymous_display_name:string; anonymous_avatar:string; age_display:string|null; verified?:boolean };

export function isAnonymousProfileReady(profile: WebProfile | null | undefined) {
  if (!profile?.onboarding_completed || !profile.anonymous_mode_enabled) return false;
  return !validateAnonymousDisplayName(profile.anonymous_display_name);
}

export type AdminRecoveryRequest = { id:string; session_id:string; recovery_code:string; status:string; created_at:string; expires_at:string };
export type AdminEasterEggEvent = { id:string; session_id:string; user_id:string; egg_kind:string; trigger_type:string; created_at:string };

export async function loadAdminEasterEggEvents(limit = 500) {
  return supabase.from("chat_easter_egg_events").select("id,session_id,user_id,egg_kind,trigger_type,created_at").order("created_at", { ascending:false }).limit(limit) as unknown as Promise<{data:AdminEasterEggEvent[]|null;error:{message?:string}|null}>;
}
export async function loadAdminRecoveryRequests(){ return supabase.rpc("get_admin_session_recovery_requests") as unknown as Promise<{data:AdminRecoveryRequest[]|null;error:{message?:string}|null}>; }
export async function approveAdminRecoveryRequest(code:string,side:"a"|"b"){ return supabase.rpc("approve_random_session_recovery",{p_recovery_code:code,p_side:side}); }
export async function getCurrentSession(){ return supabase.auth.getSession(); }
export async function signIn(email:string,password:string){ return supabase.auth.signInWithPassword({email,password}); }
export async function signUp(email:string,password:string){ return supabase.auth.signUp({email,password}); }
export async function signInAnonymously(){ return supabase.auth.signInAnonymously(); }

export async function requestRandomIdentityRecovery(displayName: string) {
  const result = await supabase.rpc("request_random_identity_recovery", { p_display_name: displayName.trim() });
  if (result.error) return result as unknown as { data:null; error:{message?:string} };
  const raw = Array.isArray(result.data) ? result.data[0] : result.data;
  try {
    const verified = normalizeRecoveryResult(raw);
    return { data:[verified], error:null } as unknown as { data:{id:string;recovery_code:string;expires_at:string}[]; error:null };
  } catch (error) {
    return { data:null, error:{ message:error instanceof Error ? error.message : "無法確認恢復申請" } };
  }
}

export async function signOut(){ return supabase.auth.signOut(); }
export async function loadMyProfile(userId:string){ return supabase.from("profiles").select("id, anonymous_mode_enabled, anonymous_display_name, anonymous_avatar, onboarding_completed, account_status").eq("id",userId).maybeSingle<WebProfile>(); }
export async function upsertAnonymousProfile(userId:string,profile:{anonymous_display_name:string;anonymous_avatar?:AnonymousAvatarId;anonymous_mode_enabled?:boolean;onboarding_completed?:boolean}){ return supabase.from("profiles").upsert({id:userId,anonymous_mode_enabled:profile.anonymous_mode_enabled??true,anonymous_display_name:profile.anonymous_display_name,anonymous_avatar:profile.anonymous_avatar??"avatar_01",onboarding_completed:profile.onboarding_completed??true}); }
export async function saveAnonymousProfile(userId:string,profile:{anonymous_display_name:string;anonymous_avatar:AnonymousAvatarId;anonymous_mode_enabled?:boolean;onboarding_completed?:boolean}){ return upsertAnonymousProfile(userId,profile); }

// The remainder of this module is intentionally preserved by the repository history; this guard only changes recovery creation semantics.

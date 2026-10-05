import type { Session } from "@supabase/supabase-js";
import { loadMyProfile, supabase, type WebProfile } from "./supabase";

export const ACCOUNT_BINDING_PRODUCTION_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
export const ACCOUNT_BINDING_TEST_USER_ID = process.env.NEXT_PUBLIC_PHASE1_TEST_USER_ID?.trim() ?? "";
export const ACCOUNT_BINDING_TEST_DISPLAY_NAME = "孤星企鵝_測試";
export const ACCOUNT_BINDING_SAFE_FAILURE = "帳號尚未完成綁定，你目前的匿名聊天室沒有受到影響。";

export function isAnonymousSession(session: Session | null | undefined) {
  return session?.user?.is_anonymous === true;
}

export function canTestAccountBinding(profile: WebProfile | null | undefined, session: Session | null | undefined) {
  return (
    Boolean(ACCOUNT_BINDING_TEST_USER_ID) &&
    ACCOUNT_BINDING_TEST_USER_ID !== ACCOUNT_BINDING_PRODUCTION_USER_ID &&
    isAnonymousSession(session) &&
    session?.user?.id === ACCOUNT_BINDING_TEST_USER_ID &&
    profile?.id === ACCOUNT_BINDING_TEST_USER_ID &&
    profile?.anonymous_display_name === ACCOUNT_BINDING_TEST_DISPLAY_NAME
  );
}

export async function saveAnonymousAccount(email: string, password: string) {
  const current = await supabase.auth.getSession();
  if (current.error || !isAnonymousSession(current.data.session)) {
    return { data: null, error: current.error ?? new Error(ACCOUNT_BINDING_SAFE_FAILURE) };
  }

  const userId = current.data.session!.user.id;
  const before = await loadMyProfile(userId);
  if (before.error || !canTestAccountBinding(before.data, current.data.session)) {
    return { data: null, error: before.error ?? new Error("目前僅開放孤星企鵝_測試身分。") };
  }

  const update = await supabase.auth.updateUser({ email: email.trim(), password });
  if (update.error || update.data.user.id !== userId) {
    return { data: null, error: update.error ?? new Error(ACCOUNT_BINDING_SAFE_FAILURE) };
  }

  const after = await loadMyProfile(userId);
  if (after.error || after.data?.id !== userId || after.data?.anonymous_display_name !== before.data?.anonymous_display_name) {
    return { data: null, error: after.error ?? new Error(ACCOUNT_BINDING_SAFE_FAILURE) };
  }

  return { data: { user: update.data.user, profile: after.data }, error: null };
}

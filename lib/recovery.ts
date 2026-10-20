import { supabase, SUPABASE_URL } from "./supabase";

// Native counterpart of the web recovery helpers
// (apps/web/lib/permanent-recovery.ts, permanent-recovery-code.ts and the
// recovery RPC wrappers in apps/web/lib/supabase.ts). Everything talks to the
// same backend: two Edge Functions plus plain RPCs, so behavior matches web.

const rpc = supabase as any;

export function normalizeRecoveryCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("請先建立目前的匿名身分。");
  return token;
}

async function callEdge<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "恢復失敗，請稍後再試。");
  }
  return payload as T;
}

// ---- Permanent recovery code management (Edge Function: anonymous-recovery-code) ----

export type PermanentCodeStatus = {
  hasRecoveryCode: boolean;
  hint: string | null;
  createdAt: string | null;
};

export type PermanentCodeResult = {
  recoveryCode: string;
  hint: string;
  createdAt?: string;
};

export const getPermanentRecoveryCodeStatus = () =>
  callEdge<PermanentCodeStatus>("anonymous-recovery-code", { method: "GET" });

export const createPermanentRecoveryCode = () =>
  callEdge<PermanentCodeResult>("anonymous-recovery-code", { method: "POST", body: { action: "create" } });

export const rotatePermanentRecoveryCode = () =>
  callEdge<PermanentCodeResult>("anonymous-recovery-code", { method: "POST", body: { action: "rotate" } });

// ---- Permanent recovery claim (Edge Function: anonymous-recovery-claim) ----

export type PermanentClaimPreview = { displayName: string };

export type PermanentClaimResult = {
  displayName: string;
  newRecoveryCode: string;
  createdAt?: string;
  identityId?: string;
  generation?: number;
};

export const previewPermanentRecovery = (code: string) =>
  callEdge<PermanentClaimPreview>("anonymous-recovery-claim", {
    method: "POST",
    body: { action: "preview", recoveryCode: normalizeRecoveryCode(code) },
  });

export const claimPermanentRecovery = (code: string) =>
  callEdge<PermanentClaimResult>("anonymous-recovery-claim", {
    method: "POST",
    body: { action: "claim", recoveryCode: normalizeRecoveryCode(code) },
  });

// ---- Admin-assisted recovery (RPCs, same as web) ----

export type RecoveryCodeRow = { recovery_code: string; expires_at: string | null };

export async function requestRandomIdentityRecovery(displayName: string): Promise<RecoveryCodeRow> {
  const { data, error } = await rpc.rpc("request_random_identity_recovery", {
    p_display_name: displayName.trim(),
  });
  if (error) throw new Error(error.message || "目前無法建立恢復碼。");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.recovery_code) throw new Error("目前無法建立恢復碼。");
  return row as RecoveryCodeRow;
}

export async function requestRandomSessionRecovery(sessionId: string): Promise<RecoveryCodeRow> {
  const { data, error } = await rpc.rpc("request_random_session_recovery", {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message || "目前無法取得恢復碼。");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.recovery_code) throw new Error("目前無法取得恢復碼。");
  return row as RecoveryCodeRow;
}

// ---- Identity bootstrap (mirrors web ensureAnonymousBootstrapProfile) ----

export type EffectiveProfile = {
  id: string;
  anonymous_display_name: string | null;
  anonymous_mode_enabled: boolean | null;
};

export async function loadMyEffectiveProfile(): Promise<EffectiveProfile | null> {
  const { data, error } = await rpc.rpc("get_my_effective_profile");
  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row) return row as EffectiveProfile;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, anonymous_mode_enabled, anonymous_display_name")
    .eq("id", userId)
    .maybeSingle();
  return (profile as EffectiveProfile | null) ?? null;
}

/**
 * Make sure the current principal is an anonymous auth user with a bootstrap
 * anonymous profile, like the web recovery flow's prepareReplacementPrincipal.
 * The claim then binds the recovered identity to this principal.
 */
export async function ensureAnonymousPrincipal(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  let user = sessionData.session?.user ?? null;
  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(error.message || "目前無法建立匿名工作階段。");
    user = data.user ?? data.session?.user ?? null;
  }
  if (!user) throw new Error("目前無法建立匿名工作階段。");
  if ((user as { is_anonymous?: boolean }).is_anonymous !== true) {
    throw new Error("目前登入的是一般帳號，請使用匿名工作階段進行聊天室恢復。");
  }

  const effective = await loadMyEffectiveProfile();
  if (effective?.anonymous_display_name) return;

  if (!effective) {
    const { error: upsertError } = await supabase.from("profiles").upsert(
      { id: user.id, anonymous_mode_enabled: true, anonymous_avatar: "avatar_01" },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (upsertError) throw new Error(upsertError.message || "目前無法準備匿名恢復身分。");
  }

  const { error: rotateError } = await rpc.rpc("rotate_my_anonymous_display_name");
  if (rotateError) throw new Error(rotateError.message || "目前無法準備匿名恢復身分。");
}

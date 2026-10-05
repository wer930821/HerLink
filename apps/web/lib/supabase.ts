import { createClient, type Session } from "@supabase/supabase-js";
import { ANONYMOUS_AVATAR_OPTIONS, isAnonymousAvatarId } from "../../../lib/anonymous";
import { getAnonymousInstallationId } from "./anonymous-install";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";

type SupabaseClientError = {
  message: string;
  code?: string;
  status?: number;
};

type MissingSupabaseResult<T> = Promise<{
  data: T;
  error: SupabaseClientError | null;
}>;

function createSupabaseClientError(message: string, status = 503): SupabaseClientError {
  return {
    message,
    code: "SUPABASE_NOT_CONFIGURED",
    status,
  };
}

function createMissingQueryBuilder(resource: string) {
  const error = createSupabaseClientError(`Supabase 尚未設定，無法存取 ${resource}。`);

  const builder: Record<string, unknown> = {
    select: () => builder,
    upsert: () => Promise.resolve({ data: null, error }) as MissingSupabaseResult<null>,
    insert: () => Promise.resolve({ data: null, error }) as MissingSupabaseResult<null>,
    update: () => Promise.resolve({ data: null, error }) as MissingSupabaseResult<null>,
    delete: () => Promise.resolve({ data: null, error }) as MissingSupabaseResult<null>,
    eq: () => builder,
    neq: () => builder,
    order: () => builder,
    limit: () => builder,
    in: () => builder,
    contains: () => builder,
    or: () => builder,
    ilike: () => builder,
    gte: () => builder,
    lte: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error }) as MissingSupabaseResult<null>,
    single: () => Promise.resolve({ data: null, error }) as MissingSupabaseResult<null>,
  };

  return builder;
}

function createMissingSupabaseClient() {
  const authError = createSupabaseClientError("Supabase 尚未設定，無法執行登入相關操作。");

  return {
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async signInWithPassword() {
        return { data: { user: null, session: null }, error: authError };
      },
      async signUp() {
        return { data: { user: null, session: null }, error: authError };
      },
      async signInAnonymously() {
        return { data: { user: null, session: null }, error: authError };
      },
      async signOut() {
        return { error: null };
      },
      async resetPasswordForEmail() {
        return { data: {}, error: authError };
      },
      async updateUser() {
        return { data: { user: null }, error: authError };
      },
      onAuthStateChange(callback: (event: string, session: { session: null }) => void) {
        callback("SIGNED_OUT", { session: null });
        return {
          data: {
            subscription: {
              unsubscribe() {
                return undefined;
              },
            },
          },
        };
      },
    },
    from(resource: string) {
      return createMissingQueryBuilder(resource);
    },
    rpc(name: string) {
      return Promise.resolve({
        data: null,
        error: createSupabaseClientError(`Supabase 尚未設定，無法執行 RPC：${name}。`),
      });
    },
    channel(name: string) {
      const channel = {
        name,
        presenceState() {
          return {};
        },
        send() {
          return Promise.resolve({ status: "ok" });
        },
        subscribe(callback?: (status: string) => void) {
          callback?.("SUBSCRIBED");
          return channel;
        },
        on() {
          return channel;
        },
        track() {
          return Promise.resolve();
        },
      };

      return {
        ...channel,
      };
    },
    async removeChannel() {
      return { error: null };
    },
  };
}

const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

const realSupabaseClient = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        // Auth callbacks are handled explicitly by /auth/callback and /auth/handoff.
        // Letting supabase-js also parse the URL can race with setSession/refresh and
        // reuse the same refresh token across tabs.
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;

export const supabase: any = realSupabaseClient ?? createMissingSupabaseClient();

export type AnonymousAvatarId = (typeof ANONYMOUS_AVATAR_OPTIONS)[number]["id"];

export type WebProfile = {
  id: string;
  anonymous_mode_enabled: boolean | null;
  anonymous_display_name: string | null;
  anonymous_avatar: string | null;
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
  icebreaker_turn: number | null;
  icebreaker_question_code: string | null;
  icebreaker_prompt: string | null;
  icebreaker_category: string | null;
  icebreaker_advanced_at: string | null;
};

export type LatestRandomSessionDiagnosticRow = {
  session_id: string;
  status: "active" | "ended";
  ended_reason: string | null;
  ended_at: string | null;
  created_at: string;
  ended_by_me: boolean | null;
  ended_by_partner: boolean | null;
};

export type RandomMatchRow = {
  status: "waiting" | "matched";
  session_id: string | null;
  matched_user_id: string | null;
};

export type AnonymousContactStatusRow = {
  contact_id: string;
  status: "pending" | "active";
  my_approved: boolean;
  partner_approved: boolean;
};

export type AnonymousContactRow = AnonymousContactStatusRow & {
  source_session_id: string | null;
  partner_user_id: string;
  partner_anonymous_display_name: string;
  partner_anonymous_avatar: string;
  partner_verified: boolean;
  created_at: string;
  activated_at: string | null;
  current_session_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type AnonymousContactSessionRow = {
  status: "created" | "existing";
  session_id: string;
};

export type RandomChatMessageRow = {
  id: string;
  session_id: string;
  content: string;
  created_at: string;
  is_mine: boolean;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_types: string[];
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
  reply_preview_state?: "loading" | "loaded" | "error" | "not_found";
};

export type RandomSessionIcebreakerRow = {
  session_id: string;
  turn: number;
  question_code: string;
  prompt: string;
  category: string;
  advanced_at: string;
  advanced_by_me: boolean;
};

export type RandomChatMessageRealtimeRow = {
  id: string;
  session_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  risk_types: string[] | null;
  message_type: "text" | "image" | null;
  media_path: string | null;
  media_mime: string | null;
  media_size: number | null;
  media_width: number | null;
  media_height: number | null;
  reply_to_message_id: string | null;
};

export type RandomChatMessageCursor = {
  created_at: string;
  id: string;
};

export type SafeAnonymousRow = {
  id: string;
  anonymous_display_name: string;
  anonymous_avatar: string;
  age_display: string | null;
  verified?: boolean;
};

export type AnonymousAbusePrecheckRow = {
  installation_key: string;
  current_user_id: string | null;
  decision: "allow" | "cooldown" | "temporary_suspension" | "blocked";
  reason_code: string | null;
  risk_score: number;
  cooldown_until: string | null;
  temporary_suspension_until: string | null;
  review_required: boolean;
};

export type AdminRecoveryRequest = { id:string; session_id:string; recovery_code:string; status:string; created_at:string; expires_at:string; a_anonymous_name:string; b_anonymous_name:string };

export async function loadAdminRecoveryRequests() {
  return supabase.rpc("get_admin_session_recovery_requests_v2") as unknown as Promise<{ data: AdminRecoveryRequest[] | null; error: { message?: string } | null }>;
}
export async function approveAdminRecoveryRequest(code:string, side:"a"|"b") {
  return supabase.rpc("approve_random_session_recovery",{p_recovery_code:code,p_side:side});
}

export async function adminRestoreRandomSessionToSelf(sessionId:string, side:"a"|"b", targetUserId?:string) {
  if (targetUserId) return supabase.rpc("admin_restore_random_session_to_user",{p_session_id:sessionId,p_side:side,p_target_user_id:targetUserId});
  return supabase.rpc("admin_restore_random_session_to_self",{p_session_id:sessionId,p_side:side});
}

export async function adminRestoreRandomSessionByName(sessionId:string, side:"a"|"b", targetName:string) {
  return supabase.rpc("admin_restore_random_session_by_name",{p_session_id:sessionId,p_side:side,p_target_name:targetName});
}

export async function getCurrentSession() {
  return supabase.auth.getSession();
}

export function buildBrowserHandoffUrl(session: Session, nextPath = "/") {
  if (typeof window === "undefined") return "";
  const next = nextPath.startsWith("/") ? nextPath : "/";
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    next,
  });
  return `${window.location.origin}/auth/handoff#${fragment.toString()}`;
}

export async function consumeBrowserHandoffFromHash() {
  if (typeof window === "undefined" || window.location.pathname !== "/auth/handoff") {
    return { restored: false, nextPath: "/" };
  }

  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  const rawNext = fragment.get("next") ?? "/";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  // Remove tokens from the address bar immediately so they are not kept in browser history.
  window.history.replaceState({}, document.title, "/auth/handoff");

  if (!accessToken || !refreshToken) {
    return { restored: false, nextPath };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    return { restored: false, nextPath, error };
  }

  // Do not refresh here. Refresh-token rotation in the destination browser can
  // invalidate the session that is still persisted in the original browser.
  // setSession already persists the transferred session locally; normal
  // auto-refresh can take over later without breaking the handoff immediately.
  return { restored: true, nextPath, session: data.session };
}

export async function waitForCurrentSession(timeoutMs = 2500, intervalMs = 100) {
  if (!hasSupabaseConfig) {
    return { data: { session: null }, error: null } as {
      data: { session: Session | null };
      error: null;
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await supabase.auth.getSession();
    if (result.data.session) {
      return result as {
        data: { session: Session | null };
        error: null;
      };
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }

  return await supabase.auth.getSession();
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

const ANONYMOUS_SESSION_BACKUP_COOKIE = "herlink_anon_session_backup";

function writeAnonymousSessionBackup(session: { access_token: string; refresh_token: string } | null) {
  if (typeof document === "undefined" || !session?.access_token || !session?.refresh_token) return;
  try {
    const value = encodeURIComponent(JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }));
    document.cookie = `${ANONYMOUS_SESSION_BACKUP_COOKIE}=${value}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
  } catch {
    // The normal Supabase persisted session remains the primary source.
  }
}

async function restoreAnonymousSessionBackup() {
  if (typeof document === "undefined") return null;
  try {
    const raw = document.cookie.split("; ").find((part) => part.startsWith(`${ANONYMOUS_SESSION_BACKUP_COOKIE}=`));
    if (!raw) return null;
    const value = raw.slice(raw.indexOf("=") + 1);
    const saved = JSON.parse(decodeURIComponent(value)) as { access_token?: string; refresh_token?: string };
    if (!saved.access_token || !saved.refresh_token) return null;
    const restored = await supabase.auth.setSession({
      access_token: saved.access_token,
      refresh_token: saved.refresh_token,
    });
    if (restored.data.session) writeAnonymousSessionBackup(restored.data.session);
    return restored;
  } catch {
    return null;
  }
}

export async function signInAnonymously() {
  // Keep the existing identity first. A redundant cookie copy protects against
  // the common case where localStorage/session persistence disappears while
  // cookies are still available.
  const current = await supabase.auth.getSession();
  if (current.data.session?.user) {
    writeAnonymousSessionBackup(current.data.session);
    return { data: { user: current.data.session.user, session: current.data.session }, error: null };
  }

  const restored = await restoreAnonymousSessionBackup();
  if (restored?.data.session?.user) {
    return { data: { user: restored.data.session.user, session: restored.data.session }, error: null };
  }

  const created = await supabase.auth.signInAnonymously();
  if (created.data.session) writeAnonymousSessionBackup(created.data.session);
  return created;
}

export async function requestRandomIdentityRecovery(displayName: string) {
  return supabase.rpc("request_random_identity_recovery", {
    p_display_name: displayName.trim(),
  }) as unknown as Promise<{
    data: { recovery_code: string; expires_at: string }[] | null;
    error: { message?: string } | null;
  }>;
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function sendPasswordResetEmail(email: string, redirectTo?: string) {
  return supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export function getWebAuthCallbackUrl() {
  if (typeof window === "undefined") {
    return "/auth/callback?next=/reset-password";
  }
  return `${window.location.origin}/auth/callback?next=/reset-password`;
}

export async function isCurrentUserAdmin(_userId?: string) {
  // The database decides from auth.uid(); never trust a caller-supplied user id.
  const result = await supabase.rpc("can_use_chat_assistant");
  return { data: result.data === true, error: result.error } as {
    data: boolean;
    error: { message?: string } | null;
  };
}

export async function getMyAdminFixedAnonymousIdentity() {
  const result = await (supabase as any).rpc("get_my_admin_fixed_anonymous_identity");
  return {
    data: typeof result.data === "string" ? result.data : null,
    error: result.error,
  } as { data: string | null; error: { message?: string } | null };
}

export async function bindMyAdminFixedAnonymousIdentity(profileId: string) {
  return (supabase as any).rpc("bind_my_admin_fixed_anonymous_identity", {
    p_fixed_profile_id: profileId,
  }) as Promise<{ data: boolean | null; error: { message?: string } | null }>;
}

export async function ensureMyAdminFixedAnonymousIdentity(profile: WebProfile | null) {
  if (!profile?.id) return { data: null, error: null };
  const admin = await isCurrentUserAdmin();
  if (admin.error || !admin.data) return { data: null, error: admin.error };
  const current = await getMyAdminFixedAnonymousIdentity();
  if (current.error || current.data) return current;
  if (profile.anonymous_display_name !== "孤星企鵝") return { data: null, error: null };
  const bound = await bindMyAdminFixedAnonymousIdentity(profile.id);
  return { data: bound.error ? null : profile.id, error: bound.error };
}

export async function loadMyProfile(userId: string) {
  return (supabase
    .from("profiles")
    .select("id, anonymous_mode_enabled, anonymous_display_name, anonymous_avatar, account_status")
    .eq("id", userId)
    .maybeSingle() as Promise<{ data: WebProfile | null; error: { message?: string } | null }>);
}

export type AnonymousNameRpcRow = {
  status: "OK" | "NAME_TAKEN" | string | null;
  anonymous_display_name: string | null;
};

export type AnonymousNameRpcResult = {
  data: AnonymousNameRpcRow | null;
  error: SupabaseClientError | null;
};

// Both alias RPCs share one shape: a one-row table of (status, anonymous_display_name).
function normalizeAnonymousNameRpcResult(result: { data?: unknown; error?: unknown } | null | undefined): AnonymousNameRpcResult {
  const error = (result?.error ?? null) as SupabaseClientError | null;
  const row = Array.isArray(result?.data) ? result?.data[0] ?? null : result?.data ?? null;

  if (!row || typeof row !== "object") {
    return { data: null, error };
  }

  const record = row as { status?: unknown; anonymous_display_name?: unknown };
  const name = typeof record.anonymous_display_name === "string" && record.anonymous_display_name.trim()
    ? record.anonymous_display_name.trim()
    : null;

  return {
    data: {
      status: typeof record.status === "string" ? record.status : null,
      anonymous_display_name: name,
    },
    error,
  };
}

export async function setMyAnonymousDisplayName(name: string) {
  const result = await supabase.rpc("set_my_anonymous_display_name", { p_name: name });
  return normalizeAnonymousNameRpcResult(result);
}

export async function rotateMyAnonymousDisplayName() {
  const result = await supabase.rpc("rotate_my_anonymous_display_name");
  return normalizeAnonymousNameRpcResult(result);
}

export async function ensureAnonymousBootstrapProfile(userId: string) {
  const existing = await loadMyProfile(userId);
  if (existing.error || existing.data?.anonymous_display_name) {
    return existing;
  }

  if (!existing.data) {
    const inserted = await supabase
      .from("profiles")
      .upsert({
      id: userId,
      anonymous_mode_enabled: true,
      anonymous_avatar: "avatar_01",
      }, { onConflict: "id", ignoreDuplicates: true });
    if (inserted.error) {
      return { data: null, error: inserted.error };
    }
  }

  const rotated = await rotateMyAnonymousDisplayName();
  if (rotated.error || !rotated.data?.anonymous_display_name) {
    return {
      data: null,
      error: rotated.error ?? createSupabaseClientError("目前無法產生匿名暱稱，請稍後再試。"),
    };
  }

  return loadMyProfile(userId);
}

export async function loadMyActiveRandomSessions() {
  const result = await supabase.rpc("list_my_active_random_sessions");
  return {
    data: Array.isArray(result.data) ? result.data : [],
    error: result.error,
  } as {
    data: RandomSessionRow[];
    error: { message?: string } | null;
  };
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

export async function loadMyLatestRandomSessionDiagnostic() {
  const result = await supabase.rpc("get_my_latest_random_session_diagnostic");
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: LatestRandomSessionDiagnosticRow | null;
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
  return (supabase
    .from("random_match_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle() as Promise<{ data: RandomQueueRow | null; error: { message?: string } | null }>);
}

export async function loadRandomMessages(
  sessionId: string,
  limit = 50,
  cursor?: {
    before?: RandomChatMessageCursor;
    after?: RandomChatMessageCursor;
  }
) {
  return supabase.rpc("list_random_messages", {
    p_session_id: sessionId,
    p_limit: limit,
    p_before_created_at: cursor?.before?.created_at ?? null,
    p_before_id: cursor?.before?.id ?? null,
    p_after_created_at: cursor?.after?.created_at ?? null,
    p_after_id: cursor?.after?.id ?? null,
  }) as unknown as Promise<{
    data: RandomChatMessageRow[] | null;
    error: { message?: string } | null;
  }>;
}

export async function loadRandomSessionIcebreaker(sessionId: string) {
  const result = await supabase.rpc("get_random_session_icebreaker", { p_session_id: sessionId });
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as { data: RandomSessionIcebreakerRow | null; error: { message?: string } | null };
}

export async function advanceRandomSessionIcebreaker(sessionId: string) {
  const result = await supabase.rpc("advance_random_chat_icebreaker", { p_session_id: sessionId });
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as { data: RandomSessionIcebreakerRow | null; error: { message?: string } | null };
}

export async function loadSafeAnonymousProfiles(userIds: string[]) {
  return supabase.rpc("get_safe_anonymous_profiles", {
    p_user_ids: userIds,
  });
}

export async function registerAnonymousAbuseIdentity() {
  const installationId = getAnonymousInstallationId();
  if (!installationId) {
    return {
      data: null,
      error: createSupabaseClientError("目前無法取得匿名裝置識別，請重新整理後再試。"),
    } as {
      data: AnonymousAbusePrecheckRow | null;
      error: SupabaseClientError | null;
    };
  }

  const result = await supabase.rpc("register_anonymous_abuse_identity", {
    p_installation_id: installationId,
  });

  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: AnonymousAbusePrecheckRow | null;
    error: SupabaseClientError | null;
  };
}

export async function restoreRandomSessionFromInstallation(sessionId: string) {
  const installationId = getAnonymousInstallationId();
  if (!installationId) {
    return { data: null, error: createSupabaseClientError("目前無法取得匿名裝置識別。") } as {
      data: RandomSessionRow | null;
      error: SupabaseClientError | null;
    };
  }

  const result = await supabase.rpc("restore_random_session_from_installation", {
    p_session_id: sessionId,
    p_installation_id: installationId,
  });

  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as { data: RandomSessionRow | null; error: SupabaseClientError | null };
}

export async function requestRandomSessionRecovery(sessionId: string) {
  const result = await supabase.rpc("request_random_session_recovery", { p_session_id: sessionId });
  const row = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
  return { data: row as { recovery_code: string; expires_at: string } | null, error: result.error };
}

export async function findOrJoinRandomMatch() {
  return supabase.rpc("find_or_join_random_match");
}

export async function loadAnonymousContactStatus(sessionId: string) {
  const result = await supabase.rpc("get_anonymous_contact_status", {
    p_session_id: sessionId,
  });
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: AnonymousContactStatusRow | null;
    error: { message?: string } | null;
  };
}

export async function requestAnonymousContact(sessionId: string) {
  const result = await supabase.rpc("request_anonymous_contact", {
    p_session_id: sessionId,
  });
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: AnonymousContactStatusRow | null;
    error: { message?: string } | null;
  };
}

export async function listMyAnonymousContacts() {
  return supabase.rpc("list_my_anonymous_contacts") as unknown as Promise<{
    data: AnonymousContactRow[] | null;
    error: { message?: string } | null;
  }>;
}

export async function markRandomSessionRead(sessionId: string) {
  return supabase.rpc("mark_random_session_read", { p_session_id: sessionId }) as Promise<{ data: boolean | null; error: { message?: string } | null }>;
}

export async function removeAnonymousContact(contactId: string) {
  return supabase.rpc("remove_anonymous_contact", {
    p_contact_id: contactId,
  }) as unknown as Promise<{
    data: boolean | null;
    error: { message?: string } | null;
  }>;
}

export async function startAnonymousContactSession(contactId: string) {
  const result = await supabase.rpc("start_anonymous_contact_session", {
    p_contact_id: contactId,
  });
  return {
    data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null,
    error: result.error,
  } as {
    data: AnonymousContactSessionRow | null;
    error: { message?: string } | null;
  };
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
  "suspected_male_impersonation",
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

export async function sendRandomMessage(sessionId: string, content: string, replyToMessageId?: string | null) {
  return supabase.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: content,
    p_message_type: "text",
    p_reply_to_message_id: replyToMessageId ?? null,
  }) as unknown as Promise<{
    data: RandomChatMessageRow[] | null;
    error: { message?: string } | null;
  }>;
}

export async function sendImageMessage(
  sessionId: string,
  media: {
    path: string;
    mime: string;
    size: number;
    width: number;
    height: number;
  },
  replyToMessageId?: string | null
) {
  return supabase.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: null,
    p_message_type: "image",
    p_media_path: media.path,
    p_media_mime: media.mime,
    p_media_size: media.size,
    p_media_width: media.width,
    p_media_height: media.height,
    p_reply_to_message_id: replyToMessageId ?? null,
  }) as unknown as Promise<{
    data: RandomChatMessageRow[] | null;
    error: { message?: string } | null;
  }>;
}

export async function getRandomMessageReplyPreview(sessionId: string, messageId: string) {
  return supabase.rpc("get_random_message_reply_preview", {
    p_session_id: sessionId,
    p_message_id: messageId,
  }) as unknown as Promise<{
    data:
      | {
          reply_message_id: string;
          reply_is_mine: boolean;
          reply_message_type: "text" | "image";
          reply_body: string | null;
          reply_media_path: string | null;
        }[]
      | null;
    error: { message?: string } | null;
  }>;
}

export async function uploadChatMedia(sessionId: string, userId: string, blob: Blob, extension: string) {
  const objectPath = `${sessionId}/${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("chat-media").upload(objectPath, blob, {
    contentType: blob.type,
    cacheControl: "3600",
    upsert: false,
  });
  return { path: objectPath, error };
}

export async function removeChatMedia(path: string) {
  return supabase.storage.from("chat-media").remove([path]);
}

export async function createChatMediaSignedUrl(path: string, expiresIn = 300) {
  return supabase.storage.from("chat-media").createSignedUrl(path, expiresIn);
}

export async function nextRandomMatch(sessionId: string) {
  return supabase.rpc("next_random_match", {
    p_session_id: sessionId,
  }) as unknown as Promise<{
    data: RandomMatchRow[] | null;
    error: { message?: string } | null;
  }>;
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


export async function getRandomChatMessageCount(sessionId: string) {
  return supabase.rpc("get_random_chat_message_count", {
    p_session_id: sessionId,
  }) as unknown as Promise<{
    data: number | null;
    error: { message?: string } | null;
  }>;
}

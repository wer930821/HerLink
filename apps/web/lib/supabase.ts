import { createClient, type Session } from "@supabase/supabase-js";
import { ANONYMOUS_AVATAR_OPTIONS, generateNextAnonymousDisplayName, isAnonymousAvatarId, validateAnonymousDisplayName } from "../../../lib/anonymous";
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
        detectSessionInUrl: true,
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
  return (supabase
    .from("profiles")
    .select("id, anonymous_mode_enabled, anonymous_display_name, anonymous_avatar, onboarding_completed, account_status")
    .eq("id", userId)
    .maybeSingle() as Promise<{ data: WebProfile | null; error: { message?: string } | null }>);
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

export async function ensureAnonymousBootstrapProfile(userId: string) {
  const existing = await loadMyProfile(userId);
  if (existing.error || existing.data) {
    return existing;
  }

  return supabase
    .from("profiles")
    .insert({
      id: userId,
      anonymous_mode_enabled: false,
      anonymous_display_name: generateNextAnonymousDisplayName(),
      anonymous_avatar: "avatar_01",
      onboarding_completed: false,
    })
    .select("id, anonymous_mode_enabled, anonymous_display_name, anonymous_avatar, onboarding_completed, account_status")
    .maybeSingle() as Promise<{ data: WebProfile | null; error: { message?: string } | null }>;
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
  return (supabase
    .from("random_match_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle() as Promise<{ data: RandomQueueRow | null; error: { message?: string } | null }>);
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

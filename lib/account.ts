import { supabase, completeAuthFromUrl, getAuthCallbackUrl } from "./supabase";

const rpc = supabase as any;

const WEB_ORIGIN = "https://her-link-ten.vercel.app";

type GoogleAuthResult = { url: string };

function googleRedirectUrl() {
  return getAuthCallbackUrl();
}

/**
 * Start Google OAuth without ever replacing an existing anonymous user.
 * Supabase's linkIdentity keeps the current auth user id, so its chats,
 * messages, contacts and recovery state remain attached to the same user.
 */
export async function startGoogleAuth(): Promise<GoogleAuthResult> {
  const { data } = await supabase.auth.getSession();
  const redirectTo = googleRedirectUrl();
  const current = data.session;

  if (current?.user?.is_anonymous) {
    const result = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo },
    });
    if (result.error || !result.data?.url) {
      if (/identity.*(already|exist|linked)|already.*identity|provider.*linked/i.test(result.error?.message ?? "")) {
        throw new Error("這個 Google 帳號已屬於其他 HerLink 帳號，為避免覆蓋資料已停止綁定。");
      }
      throw result.error ?? new Error("Google 綁定失敗，原匿名身分仍保留。");
    }
    return { url: result.data.url };
  }

  const result = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (result.error || !result.data?.url) {
    throw result.error ?? new Error("Google 登入失敗，請稍後再試。");
  }
  return { url: result.data.url };
}

/** Complete a native callback; errors are thrown without signing out. */
export async function completeGoogleAuth(rawUrl: string) {
  return completeAuthFromUrl(rawUrl);
}

// Friendly auth errors, ported from the web apps/web/lib/auth-ui.ts.
type AuthErrorLike = {
  code?: string | number | null;
  status?: number | null;
  message?: string | null;
};

function normalize(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

export function getFriendlyAuthErrorMessage(error: unknown, fallback: string): string {
  const authError = error as AuthErrorLike | null | undefined;
  const code = normalize(authError?.code);
  const message = normalize(authError?.message);
  const status = typeof authError?.status === "number" ? authError.status : null;

  if (status === 429 || message.includes("rate limit")) {
    if (message.includes("email")) {
      return "信箱驗證信寄送太頻繁，請稍後再試。";
    }
    return "操作太頻繁，請稍後再試。";
  }

  if (
    code === "invalid_login" ||
    message.includes("invalid login") ||
    message.includes("invalid credentials")
  ) {
    return "帳號或密碼不正確，請再試一次。";
  }

  if (message.includes("user already registered") || message.includes("already exists")) {
    return "這個信箱已經註冊過了，請改用登入或其他信箱。";
  }

  if (message.includes("password should be at least")) {
    return "密碼長度不足，請使用更長的密碼。";
  }

  if (message.includes("signup is disabled")) {
    return "目前暫時無法註冊，請稍後再試。";
  }

  return fallback;
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function isAlreadyRegistered(error: unknown): boolean {
  return /already registered|user already exists|email.*registered/i.test(rawMessage(error));
}

/** The anonymous chat identity attached to the current session, if any. */
export async function resolveActiveAnonymousIdentityId(): Promise<string | null> {
  const { data, error } = await rpc.rpc("resolve_active_anonymous_chat_identity");
  if (error || typeof data !== "string" || data.length === 0) return null;
  return data;
}

export type BindResult = { mode: "bind" } | { mode: "new"; hasSession: boolean };

/**
 * The web /signup submit flow: when the current session carries an
 * anonymous chat identity, bind by converting the anonymous auth user
 * with updateUser (same user id, so names, sessions, messages and
 * contacts are preserved). Otherwise create a brand-new account.
 */
export async function signUpOrBindAccount(
  email: string,
  password: string
): Promise<BindResult> {
  if (password.length < 8) {
    throw new Error("密碼至少需要 8 個字元。");
  }
  const trimmedEmail = email.trim();

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const identityId = session ? await resolveActiveAnonymousIdentityId() : null;

  if (session && identityId) {
    const authUserId = session.user.id;
    const { data, error } = await supabase.auth.updateUser({
      email: trimmedEmail,
      password,
    });
    if (error) {
      if (isAlreadyRegistered(error)) {
        throw new Error("這個電子郵件已經註冊過了，請改用登入帳號。");
      }
      throw error;
    }
    if (!data.user || data.user.id !== authUserId) {
      throw new Error("帳號綁定驗證失敗，請先不要登出。");
    }
    return { mode: "bind" };
  }

  const { data, error } = await supabase.auth.signUp({
    email: trimmedEmail,
    password,
  });
  if (error) {
    if (isAlreadyRegistered(error)) {
      throw new Error("這個電子郵件已經註冊過了，請改用登入帳號。");
    }
    throw error;
  }
  if (!data.user) {
    throw new Error("帳號建立失敗，請稍後再試。");
  }
  return { mode: "new", hasSession: Boolean(data.session) };
}

/**
 * The web /login submit flow (non-admin): logging into an existing
 * account while an anonymous session is active goes through the
 * account-bind-existing Edge Function, which merges server-side and
 * returns the formal session to adopt. Any other state signs in
 * directly (signing out a formal session first, like the web).
 */
export async function signInExistingAccount(email: string, password: string): Promise<void> {
  const trimmedEmail = email.trim();
  const { data: sessionData } = await supabase.auth.getSession();
  const current = sessionData.session;

  if (current?.user?.is_anonymous) {
    const { data, error } = await (supabase as any).functions.invoke(
      "account-bind-existing",
      { body: { email: trimmedEmail, password } }
    );
    if (error) throw error;
    if (!data?.ok || !data?.session?.access_token || !data?.session?.refresh_token) {
      throw new Error(data?.error || "帳號綁定失敗，原匿名身分仍保留，請稍後再試。");
    }
    const tokens = data.session as { access_token: string; refresh_token: string };
    const restored = await supabase.auth.setSession(tokens);
    if (restored.error || !restored.data.session) {
      throw restored.error ?? new Error("帳號登入失敗，請重新登入。");
    }
    return;
  }

  if (current) {
    await supabase.auth.signOut();
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });
  if (error) throw error;
}

/**
 * Password reset goes through the web callback like the web
 * /forgot-password page: the email link completes the reset on the
 * web, then the user signs in here with the new password.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${WEB_ORIGIN}/auth/callback?next=/reset-password`,
  });
  if (error) throw error;
}


export async function requestAccountDeletion(): Promise<void> {
  const { data, error } = await rpc.functions.invoke("delete-account", { body: {} });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "帳號刪除失敗，請稍後再試。");
}


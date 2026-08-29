type AuthErrorLike = {
  code?: string | number | null;
  status?: number | null;
  message?: string | null;
};

function normalize(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

export function getFriendlyAuthErrorMessage(error: unknown, fallback: string) {
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

  if (code === "invalid_login" || message.includes("invalid login") || message.includes("invalid credentials")) {
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

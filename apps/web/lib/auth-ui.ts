type AuthErrorLike = {
  code?: string | number | null;
  status?: number | null;
  message?: string | null;
};

export const ACCOUNT_BINDING_SAFE_FAILURE = "帳號尚未完成綁定，你目前的匿名聊天室沒有受到影響。";

function normalize(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

export function getFriendlyAuthErrorMessage(error: unknown, fallback: string) {
  const authError = error as AuthErrorLike | null | undefined;
  const code = normalize(authError?.code);
  const message = normalize(authError?.message);
  const status = typeof authError?.status === "number" ? authError.status : null;

  if (status === 429 || message.includes("rate limit")) {
    if (message.includes("email")) return "信箱驗證信寄送太頻繁，請稍後再試。";
    return "操作太頻繁，請稍後再試。";
  }
  if (code === "invalid_login" || message.includes("invalid login") || message.includes("invalid credentials")) return "帳號或密碼不正確，請再試一次。";
  if (message.includes("user already registered") || message.includes("already exists")) return "這個信箱已經註冊過了，請改用登入或其他信箱。";
  if (message.includes("password should be at least") || message.includes("weak password")) return "密碼強度不足，請使用至少 8 碼並混合英文與數字。";
  if (message.includes("invalid email")) return "信箱格式不正確，請重新確認。";
  if (message.includes("session") || message.includes("jwt") || message.includes("not authenticated")) return ACCOUNT_BINDING_SAFE_FAILURE;
  if (message.includes("signup is disabled")) return "目前暫時無法註冊，請稍後再試。";
  return fallback;
}

export function getAccountBindingErrorMessage(error: unknown) {
  const specific = getFriendlyAuthErrorMessage(error, ACCOUNT_BINDING_SAFE_FAILURE);
  return specific || ACCOUNT_BINDING_SAFE_FAILURE;
}

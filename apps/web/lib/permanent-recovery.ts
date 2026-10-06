import { supabase } from "./supabase";

export type PermanentRecoveryPreview = { displayName: string };
export type PermanentRecoveryClaim = {
  displayName: string;
  newRecoveryCode: string;
  createdAt?: string;
  identityId?: string;
  generation?: number;
};

export function normalizePermanentRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[\s-]+/g, "").replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function callRecovery<T>(action: "preview" | "claim", code: string): Promise<T> {
  const normalizedCode = normalizePermanentRecoveryCode(code);
  if (normalizedCode.length !== 8) throw new Error("請輸入完整 8 碼恢復碼。");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("請先建立目前瀏覽器的匿名身分。");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  if (!base) throw new Error("目前無法連線恢復服務。");
  const response = await fetch(`${base}/functions/v1/anonymous-recovery-claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, recoveryCode: normalizedCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "恢復失敗，請稍後再試。");
  return payload as T;
}

export const previewPermanentRecovery = (code: string) => callRecovery<PermanentRecoveryPreview>("preview", code);
export const claimPermanentRecovery = (code: string) => callRecovery<PermanentRecoveryClaim>("claim", code);

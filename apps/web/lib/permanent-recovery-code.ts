import { supabase } from "./supabase";

export type RecoveryCodeStatus = { hasRecoveryCode: boolean; hint: string | null; createdAt: string | null };
export type RecoveryCodeResult = { recoveryCode: string; hint: string; createdAt?: string };

async function callCode<T>(action?: "create" | "rotate"): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("請先建立匿名身分。");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const response = await fetch(`${base}/functions/v1/anonymous-recovery-code`, {
    method: action ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(action ? { body: JSON.stringify({ action }) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "目前無法處理永久恢復碼。");
  return payload as T;
}
export const getPermanentRecoveryStatus = () => callCode<RecoveryCodeStatus>();
export const createPermanentRecoveryCode = () => callCode<RecoveryCodeResult>("create");
export const rotatePermanentRecoveryCode = () => callCode<RecoveryCodeResult>("rotate");

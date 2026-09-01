import { supabase, withSupabaseTimeout } from "./supabase";

export type SignupDecision = "allow" | "needs_review" | "block" | "rate_limited";

export interface SignupPrecheckResult {
  ok: boolean;
  decision: SignupDecision;
  reasonCode: string | null;
}

export async function precheckSignup(email: string) {
  const { data, error } = await withSupabaseTimeout(
    supabase.functions.invoke("precheck-signup", {
      body: { email },
    }),
    "註冊檢查"
  );

  if (error) {
    throw error;
  }

  return (data ?? null) as SignupPrecheckResult | null;
}

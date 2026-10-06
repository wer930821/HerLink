import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  recoveryCodeHint,
} from "../_shared/anonymous-recovery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "需要目前的匿名身分。" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "恢復功能尚未完成伺服器設定。" }, 503);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authResult = await caller.auth.getUser();
  const user = authResult.data.user;
  if (authResult.error || !user) return json({ error: "匿名身分已失效，請重新整理後再試。" }, 401);

  const profileResult = await admin.from("profiles")
    .select("id, anonymous_mode_enabled, anonymous_display_name")
    .eq("id", user.id).maybeSingle();
  if (profileResult.error || !profileResult.data?.id || !profileResult.data.anonymous_mode_enabled) {
    return json({ error: "目前沒有可設定恢復碼的匿名身分。" }, 403);
  }

  const activeCredential = async () => await admin.from("anonymous_recovery_credentials")
    .select("id, code_hint, created_at, version")
    .eq("anonymous_identity_id", user.id)
    .is("used_at", null).is("revoked_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (req.method === "GET") {
    const current = await activeCredential();
    if (current.error) return json({ error: "目前無法讀取恢復碼狀態。" }, 500);
    return json({ hasRecoveryCode: Boolean(current.data), hint: current.data?.code_hint ?? null, createdAt: current.data?.created_at ?? null });
  }

  const body = await req.json().catch(() => ({})) as { action?: string };
  const action = body.action === "rotate" ? "rotate" : "create";
  const current = await activeCredential();
  if (current.error) return json({ error: "目前無法讀取恢復碼狀態。" }, 500);
  if (action === "create" && current.data) return json({ error: "已經設定永久恢復碼。若需要新碼，請使用更換恢復碼。", hasRecoveryCode: true, hint: current.data.code_hint }, 409);
  if (action === "rotate" && !current.data) return json({ error: "目前尚未設定永久恢復碼。" }, 409);

  const recoveryCode = generateRecoveryCode();
  let codeHash: string;
  try {
    codeHash = await hashRecoveryCode(recoveryCode);
  } catch {
    return json({ error: "恢復碼安全設定尚未完成。" }, 503);
  }
  const hint = recoveryCodeHint(recoveryCode);

  if (action === "rotate") {
    const rotated = await admin.rpc("rotate_anonymous_recovery_credential", {
      p_identity_id: user.id,
      p_new_code_hash: codeHash,
      p_new_code_hint: hint,
    });
    const row = Array.isArray(rotated.data) ? rotated.data[0] : rotated.data;
    if (rotated.error || !row) return json({ error: "目前無法更換恢復碼。" }, 500);
    return json({ recoveryCode, hint, createdAt: row.created_at });
  }

  const inserted = await admin.from("anonymous_recovery_credentials").insert({
    anonymous_identity_id: user.id,
    code_hash: codeHash,
    code_hint: hint,
    version: 1,
  }).select("created_at").single();
  if (inserted.error) return json({ error: "目前無法建立恢復碼。" }, 500);

  return json({ recoveryCode, hint, createdAt: inserted.data.created_at });
});

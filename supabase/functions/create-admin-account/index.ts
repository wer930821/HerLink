import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json().catch(() => null) as {
      email?: string;
      password?: string;
      inviteCode?: string;
    } | null;

    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    const inviteCode = body?.inviteCode?.trim() ?? "";

    if (!email || !email.includes("@") || password.length < 10 || !inviteCode) {
      return json({ error: "資料格式不正確。" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "後台建立功能尚未完成伺服器設定。" }, 503);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = forwarded || req.headers.get("cf-connecting-ip") || "unknown";
    const attemptKey = await sha256(clientIp);

    const rate = await admin.rpc("check_admin_invite_rate_limit", {
      p_attempt_key: attemptKey,
      p_max_attempts: 10,
      p_window_minutes: 10,
    });
    const allowed = Array.isArray(rate.data) ? rate.data[0] : rate.data;

    if (rate.error || allowed !== true) {
      return json({ error: "建立嘗試過於頻繁，請稍後再試。" }, 429);
    }

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (created.error || !created.data.user) {
      return json({ error: "目前無法建立管理員帳號。" }, 400);
    }

    const userId = created.data.user.id;
    const consume = await admin.rpc("consume_admin_invite_code", {
      p_code: inviteCode,
      p_user_id: userId,
    });
    const consumed = Array.isArray(consume.data) ? consume.data[0] : consume.data;

    if (consume.error || consumed !== true) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      return json({ error: "建立碼無效、已過期或已無法使用。" }, 400);
    }

    return json({ ok: true });
  } catch {
    return json({ error: "目前無法建立管理員帳號。" }, 500);
  }
});

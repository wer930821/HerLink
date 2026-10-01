export const dynamic = "force-dynamic";

import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SERVICE_ROLE_MISSING");

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function getAttemptKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const ip = forwarded || realIp || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
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

    const admin = getServiceClient();
    const attemptKey = getAttemptKey(request);

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
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_ROLE_MISSING") {
      return json({ error: "後台建立功能尚未完成伺服器設定。" }, 503);
    }
    return json({ error: "目前無法建立管理員帳號。" }, 500);
  }
}

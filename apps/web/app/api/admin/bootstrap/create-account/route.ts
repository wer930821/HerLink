export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !anonKey) {
      return json({ error: "後台建立功能尚未完成伺服器設定。" }, 503);
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/create-admin-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ email, password, inviteCode }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({ error: "目前無法建立管理員帳號。" }));
    return json(payload, response.status);
  } catch {
    return json({ error: "目前無法建立管理員帳號。" }, 500);
  }
}

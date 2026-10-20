export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * 輕量信箱檢查 API，供自動化排程快速查詢是否有新信。
 * 認證：query param ?token= 必須等於 MAILBOX_WATCH_SECRET 環境變數。
 * 回傳：{ hasNew: boolean, threads: [...] }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const secret = process.env.MAILBOX_WATCH_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 找未讀的 open threads（管理員還沒讀過的）
  const { data: threads, error } = await supabase
    .from("station_mail_threads")
    .select("id, subject, category, status, created_at, admin_last_read_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 過濾出真正未讀的（admin_last_read_at 為 null，或早於最後訊息）
  const unread: typeof threads = [];
  for (const t of threads ?? []) {
    if (!t.admin_last_read_at) {
      unread.push(t);
      continue;
    }
    // 查該 thread 最新訊息時間
    const { data: msgs } = await supabase
      .from("station_mail_messages")
      .select("created_at")
      .eq("thread_id", t.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const lastMsg = msgs?.[0]?.created_at;
    if (lastMsg && new Date(lastMsg) > new Date(t.admin_last_read_at)) {
      unread.push(t);
    }
  }

  // 為每封未讀信抓最新一則訊息內容摘要
  const result = [];
  for (const t of unread) {
    const { data: msgs } = await supabase
      .from("station_mail_messages")
      .select("body, sender_role, created_at")
      .eq("thread_id", t.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = msgs?.[0];
    result.push({
      id: t.id,
      subject: t.subject,
      category: t.category,
      created_at: t.created_at,
      latest_message: latest
        ? {
            content: String(latest.body ?? "").slice(0, 200),
            sender_role: latest.sender_role,
            created_at: latest.created_at,
          }
        : null,
    });
  }

  return NextResponse.json(
    { hasNew: result.length > 0, count: result.length, threads: result },
    { headers: { "Cache-Control": "no-store" } }
  );
}

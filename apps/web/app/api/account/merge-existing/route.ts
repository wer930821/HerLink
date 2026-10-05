import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const TEST_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const TEST_NAME = "孤星企鵝";

function clients(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !anon || !service) throw new Error("伺服器帳號綁定尚未設定完成。");
  return {
    authed: createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } }),
    admin: createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "請先以匿名身分登入。" }, { status: 401 });
    const token = auth.slice(7).trim();
    const { authed, admin } = clients(token);
    const { data: userData, error: userError } = await authed.auth.getUser(token);
    if (userError || !userData.user || userData.user.id !== TEST_USER_ID || !userData.user.is_anonymous) return NextResponse.json({ error: "目前只開放孤星企鵝測試帳號。" }, { status: 403 });
    const { data: profile } = await admin.from("profiles").select("anonymous_display_name").eq("id", TEST_USER_ID).maybeSingle();
    if (profile?.anonymous_display_name !== TEST_NAME) return NextResponse.json({ error: "測試匿名身分驗證失敗。" }, { status: 403 });

    const body = await request.json() as { email?: string; password?: string; dryRun?: boolean };
    const email = body.email?.trim().toLowerCase() || "";
    const password = body.password || "";
    const dryRun = body.dryRun !== false;
    if (!email || password.length < 8) return NextResponse.json({ error: "Email 或密碼格式不正確。" }, { status: 400 });

    // Verify the destination account credentials without replacing the caller's anonymous session.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
    const verifier = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await verifier.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.user) return NextResponse.json({ error: "既有帳號驗證失敗。" }, { status: 401 });
    const targetUserId = signed.data.user.id;
    if (targetUserId === TEST_USER_ID) return NextResponse.json({ error: "這已經是目前的匿名身分，不需要跨帳號合併。" }, { status: 409 });

    const { data, error } = await admin.rpc("admin_merge_anonymous_account", {
      p_source_user_id: TEST_USER_ID,
      p_target_user_id: targetUserId,
      p_dry_run: dryRun,
    });
    if (error) return NextResponse.json({ error: error.message, rolledBack: !dryRun }, { status: 409 });
    return NextResponse.json({ ok: true, dryRun, targetUserId, result: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "帳號合併失敗。" }, { status: 500 });
  }
}

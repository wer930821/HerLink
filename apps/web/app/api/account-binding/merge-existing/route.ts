import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const TEST_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const TEST_NAME = "孤星企鵝";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as {
      email?: string;
      password?: string;
      dryRun?: boolean;
    } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    if (!email || password.length < 8 || typeof body?.dryRun !== "boolean") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const url = env("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await caller.auth.getUser();
    if (callerError || callerData.user?.id !== TEST_USER_ID || !callerData.user.is_anonymous) {
      return NextResponse.json({ error: "test_account_only" }, { status: 403 });
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("anonymous_display_name")
      .eq("id", TEST_USER_ID)
      .single();
    if (profileError || profile?.anonymous_display_name !== TEST_NAME) {
      return NextResponse.json({ error: "test_identity_mismatch" }, { status: 403 });
    }

    // Verify ownership of the destination account without replacing the anonymous caller session.
    const verifier = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: targetAuth, error: targetError } = await verifier.auth.signInWithPassword({ email, password });
    if (targetError || !targetAuth.user) {
      return NextResponse.json({ error: "target_credentials_invalid" }, { status: 401 });
    }
    const targetUserId = targetAuth.user.id;
    if (targetUserId === TEST_USER_ID) {
      return NextResponse.json({ error: "invalid_target" }, { status: 409 });
    }

    const { data, error } = await admin.rpc("admin_merge_anonymous_account", {
      p_source_user_id: TEST_USER_ID,
      p_target_user_id: targetUserId,
      p_dry_run: body.dryRun,
    });

    if (error) {
      return NextResponse.json(
        { error: "merge_blocked", message: error.message, dryRun: body.dryRun, rolledBack: !body.dryRun },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, dryRun: body.dryRun, targetUserId, result: data });
  } catch {
    return NextResponse.json({ error: "server_configuration_error" }, { status: 500 });
  }
}

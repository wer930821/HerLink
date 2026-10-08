import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { buildDeepSeekMessages } from "../../../../lib/ai-helper-server";

const TEST_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const TEST_NAME = "孤星企鵝";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-flash";

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

    const body = (await request.json().catch(() => null)) as {
      message?: string;
      history?: unknown;
      matchingStatus?: "searching" | "paused";
    } | null;
    const message = body?.message?.trim() ?? "";
    if (!message || message.length > 2_000) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const url = env("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const deepSeekKey = env("DEEPSEEK_API_KEY");

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await caller.auth.getUser();
    if (callerError || callerData.user?.id !== TEST_USER_ID) {
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

    const messages = buildDeepSeekMessages({
      history: body?.history,
      userMessage: message,
      matchingStatus: body?.matchingStatus === "paused" ? "paused" : "searching",
    });

    const callDeepSeek = () =>
      fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deepSeekKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          thinking: { type: "disabled" },
          max_tokens: 240,
          stream: false,
        }),
        signal: AbortSignal.timeout(12_000),
      });

    let response = await callDeepSeek();
    if (!response.ok && response.status >= 500) {
      response = await callDeepSeek();
    }
    if (!response.ok) {
      return NextResponse.json({ error: "helper_unavailable" }, { status: 503 });
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const reply = result.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ error: "helper_unavailable" }, { status: 503 });
    }

    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json({ error: "helper_unavailable" }, { status: 503 });
  }
}

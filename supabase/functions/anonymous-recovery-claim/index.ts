import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode, recoveryCodeHint } from "../_shared/anonymous-recovery.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  const token = req.headers.get("authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!token || !url || !anonKey || !serviceKey) return reply({ error: "Recovery unavailable." }, 401);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: token } } });
  const admin = createClient(url, serviceKey);
  const auth = await caller.auth.getUser();
  const user = auth.data.user;
  if (!user) return reply({ error: "Current identity required." }, 401);

  const current = await admin.from("profiles").select("id, anonymous_mode_enabled").eq("id", user.id).maybeSingle();
  if (!current.data?.anonymous_mode_enabled) return reply({ error: "Current anonymous identity required." }, 403);

  const body = await req.json().catch(() => ({})) as { action?: string; recoveryCode?: string };
  const action = body.action === "claim" ? "claim" : "preview";
  let codeHash: string;
  try { codeHash = await hashRecoveryCode(normalizeRecoveryCode(body.recoveryCode ?? "")); }
  catch { return reply({ error: "Invalid recovery code." }, 400); }

  if (action === "preview") {
    const credential = await admin.from("anonymous_recovery_credentials").select("anonymous_identity_id").eq("code_hash", codeHash).is("used_at", null).is("revoked_at", null).maybeSingle();
    if (!credential.data) return reply({ error: "Invalid recovery code." }, 404);
    const profile = await admin.from("profiles").select("anonymous_display_name").eq("id", credential.data.anonymous_identity_id).maybeSingle();
    if (!profile.data?.anonymous_display_name) return reply({ error: "Invalid recovery code." }, 404);
    return reply({ displayName: profile.data.anonymous_display_name });
  }

  const newRecoveryCode = generateRecoveryCode();
  const newHash = await hashRecoveryCode(newRecoveryCode);
  const result = await admin.rpc("claim_anonymous_recovery_credential", {
    p_code_hash: codeHash,
    p_replacement_identity_id: user.id,
    p_new_code_hash: newHash,
    p_new_code_hint: recoveryCodeHint(newRecoveryCode),
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !row) return reply({ error: "Recovery failed." }, 409);
  return reply({ displayName: row.anonymous_display_name, newRecoveryCode, createdAt: row.created_at });
});

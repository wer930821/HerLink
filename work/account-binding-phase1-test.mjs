import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function resolveEnvPath() {
  const dedicated = path.resolve(".supabase.test.env");
  return fs.existsSync(dedicated) ? dedicated : path.resolve(".env");
}

function required(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function client(url, key) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

async function rpcRows(supabase, name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function deleteTestUser(admin, id) {
  if (!id) return;
  const { error } = await admin.auth.admin.deleteUser(id, false);
  if (error) throw error;
}

async function run() {
  const env = loadEnv(resolveEnvPath());
  const url = required("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL);
  const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
  const admin = client(url, serviceRoleKey);
  const stamp = Date.now();
  const password = `HerLink-Test-${stamp}!Aa9`;
  const email = `herlink-phase1-${stamp}@example.com`;
  let anonymousId = null;
  let partnerId = null;

  try {
    // RED until Phase 1 helper/hosted auth configuration supports in-place anonymous upgrade.
    const anonymousClient = client(url, anonKey);
    const anonymousSignIn = await anonymousClient.auth.signInAnonymously();
    if (anonymousSignIn.error) throw anonymousSignIn.error;
    anonymousId = anonymousSignIn.data.user?.id ?? null;
    assert(Boolean(anonymousId), "anonymous sign-in returns UUID");
    assert(anonymousSignIn.data.user?.is_anonymous === true, "fixture starts anonymous");

    const partner = await admin.auth.admin.createUser({
      email: `herlink-phase1-partner-${stamp}@example.com`,
      password,
      email_confirm: true,
    });
    if (partner.error) throw partner.error;
    partnerId = partner.data.user.id;

    const anonymousName = `Phase1孤星測試${String(stamp).slice(-6)}`;
    const partnerName = `Phase1對照${String(stamp).slice(-6)}`;
    for (const [id, name] of [[anonymousId, anonymousName], [partnerId, partnerName]]) {
      const { error } = await admin.from("profiles").upsert({
        id,
        anonymous_mode_enabled: true,
        anonymous_display_name: name,
        anonymous_avatar: "avatar_01",
        onboarding_completed: true,
      });
      if (error) throw error;
    }

    const low = anonymousId < partnerId ? anonymousId : partnerId;
    const high = anonymousId < partnerId ? partnerId : anonymousId;
    const insertedSession = await admin.from("random_chat_sessions").insert({
      user_a: low,
      user_b: high,
      status: "active",
    }).select("id,user_a,user_b,status").single();
    if (insertedSession.error) throw insertedSession.error;
    const sessionId = insertedSession.data.id;

    const insertedMessages = await admin.from("random_chat_messages").insert([
      { session_id: sessionId, sender_id: anonymousId, content: "phase1-preserve-a" },
      { session_id: sessionId, sender_id: partnerId, content: "phase1-preserve-b" },
    ]).select("id,session_id,sender_id,content").order("created_at", { ascending: true });
    if (insertedMessages.error) throw insertedMessages.error;
    const messageIdsBefore = insertedMessages.data.map((row) => row.id).sort();

    // Exercise the existing 8-code recovery request before upgrading. The test does not approve it.
    const recovery = await anonymousClient.rpc("request_random_identity_recovery", { p_display_name: anonymousName });
    if (recovery.error) throw recovery.error;
    const recoveryRow = Array.isArray(recovery.data) ? recovery.data[0] : recovery.data;
    assert(/^[A-Z0-9]{8}$/.test(recoveryRow?.recovery_code ?? ""), "recovery flow returns 8-character code");
    const recoveryCodeBefore = recoveryRow.recovery_code;

    const before = {
      uuid: anonymousId,
      sessionId,
      messageIds: messageIdsBefore,
      anonymousName,
      recoveryCode: recoveryCodeBefore,
    };

    // Supabase's supported anonymous -> permanent flow updates the signed-in user in place.
    // Email must be verified before password login is guaranteed; test environments should have
    // email confirmation disabled or otherwise provide a verified test email flow.
    const updateEmail = await anonymousClient.auth.updateUser({ email });
    if (updateEmail.error) throw updateEmail.error;
    assert(updateEmail.data.user?.id === before.uuid, "UUID unchanged immediately after email link");

    const updatePassword = await anonymousClient.auth.updateUser({ password });
    if (updatePassword.error) throw updatePassword.error;
    assert(updatePassword.data.user?.id === before.uuid, "UUID unchanged after password set");

    const profileAfter = await admin.from("profiles").select("id,anonymous_display_name").eq("id", before.uuid).single();
    if (profileAfter.error) throw profileAfter.error;
    assert(profileAfter.data.id === before.uuid, "profile UUID unchanged");
    assert(profileAfter.data.anonymous_display_name === before.anonymousName, "anonymous display name unchanged");

    const sessionAfter = await admin.from("random_chat_sessions").select("id,user_a,user_b,status").eq("id", before.sessionId).single();
    if (sessionAfter.error) throw sessionAfter.error;
    assert(sessionAfter.data.id === before.sessionId, "session ID unchanged");
    assert([sessionAfter.data.user_a, sessionAfter.data.user_b].includes(before.uuid), "session still belongs to same UUID");

    const messagesAfter = await admin.from("random_chat_messages").select("id,session_id,sender_id,content").eq("session_id", before.sessionId);
    if (messagesAfter.error) throw messagesAfter.error;
    const messageIdsAfter = messagesAfter.data.map((row) => row.id).sort();
    assert(JSON.stringify(messageIdsAfter) === JSON.stringify(before.messageIds), "message IDs unchanged");
    assert(messagesAfter.data.some((row) => row.sender_id === before.uuid), "message sender UUID unchanged");

    const recoveryAfter = await admin.from("anonymous_session_recovery_requests")
      .select("recovery_code,session_id,requester_user_id,status")
      .eq("recovery_code", before.recoveryCode)
      .single();
    if (recoveryAfter.error) throw recoveryAfter.error;
    assert(recoveryAfter.data.recovery_code === before.recoveryCode, "8-code recovery code unchanged");
    assert(recoveryAfter.data.requester_user_id === before.uuid, "recovery requester UUID unchanged");
    assert(recoveryAfter.data.session_id === before.sessionId, "recovery session unchanged");

    // A fresh client must sign back into the exact same UUID.
    await anonymousClient.auth.signOut();
    const freshClient = client(url, anonKey);
    const login = await freshClient.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    assert(login.data.user?.id === before.uuid, "fresh login restores original anonymous UUID");

    const ownSession = await freshClient.from("random_chat_sessions").select("id,user_a,user_b").eq("id", before.sessionId).maybeSingle();
    if (ownSession.error) throw ownSession.error;
    assert(ownSession.data?.id === before.sessionId, "fresh login can read original session");
    const ownMessages = await rpcRows(freshClient, "list_random_messages", { p_session_id: before.sessionId });
    assert(ownMessages.length === before.messageIds.length, "fresh login reads original messages");

    const stranger = await admin.auth.admin.createUser({
      email: `herlink-phase1-stranger-${stamp}@example.com`,
      password,
      email_confirm: true,
    });
    if (stranger.error) throw stranger.error;
    const strangerId = stranger.data.user.id;
    try {
      const strangerClient = client(url, anonKey);
      const strangerLogin = await strangerClient.auth.signInWithPassword({ email: `herlink-phase1-stranger-${stamp}@example.com`, password });
      if (strangerLogin.error) throw strangerLogin.error;
      const strangerRead = await strangerClient.from("random_chat_sessions").select("id").eq("id", before.sessionId).maybeSingle();
      assert(!strangerRead.error && strangerRead.data == null, "third party still cannot read session after upgrade");
    } finally {
      await deleteTestUser(admin, strangerId);
    }

    console.log(JSON.stringify({
      ok: true,
      invariants: {
        uuid: "unchanged",
        session: "unchanged",
        messages: "unchanged",
        anonymousDisplayName: "unchanged",
        recovery8Code: "unchanged",
        freshLogin: "same UUID",
        rls: "third party denied",
      },
    }, null, 2));
  } finally {
    // auth.users cascades only rows that are configured to cascade; delete fixture rows explicitly
    // by exact IDs so a shared environment can never be broadly cleaned.
    if (anonymousId || partnerId) {
      const ids = [anonymousId, partnerId].filter(Boolean);
      const sessions = await admin.from("random_chat_sessions").select("id").or(ids.map((id) => `user_a.eq.${id},user_b.eq.${id}`).join(","));
      const sessionIds = (sessions.data ?? []).map((row) => row.id);
      if (sessionIds.length) {
        await admin.from("anonymous_session_recovery_requests").delete().in("session_id", sessionIds);
        await admin.from("random_chat_messages").delete().in("session_id", sessionIds);
        await admin.from("random_chat_sessions").delete().in("id", sessionIds);
      }
      await admin.from("profiles").delete().in("id", ids);
    }
    await deleteTestUser(admin, anonymousId);
    await deleteTestUser(admin, partnerId);
  }
}

run().catch((error) => {
  console.error("Phase 1 identity preservation test FAILED:", error?.message ?? error);
  process.exitCode = 1;
});

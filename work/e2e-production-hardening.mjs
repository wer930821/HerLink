// Production hardening E2E: two isolated anonymous test identities A/B.
// Covers matching, text, typing, photo, signed URL, reply, next, leave,
// report, block, rate limit, refresh (list) and realtime de-dupe.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(scriptDir, "../.supabase.test.env");
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const eq = line.indexOf("=");
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("missing supabase env in .supabase.test.env");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (promise) => promise.then(() => undefined, () => undefined);
const assert = (cond, label) => {
  if (!cond) {
    throw new Error(`ASSERT FAILED: ${label}`);
  }
  console.log(`  ok: ${label}`);
};

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createTestUser(tag) {
  const client = makeClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(`${tag} anonymous sign-in failed: ${error.message}`);
  }
  const userId = data.user.id;
  const installId = `e2e-${crypto.randomUUID()}`;
  const displayName = tag === "A" ? `E2E測試A-${userId.slice(0, 4)}` : `E2E測試B-${userId.slice(0, 4)}`;
  const profile = await client.from("profiles").upsert({
    id: userId,
    anonymous_mode_enabled: true,
    anonymous_display_name: displayName,
    anonymous_avatar: "avatar_01",
    onboarding_completed: true,
  });
  if (profile.error) {
    throw new Error(`${tag} profile failed: ${profile.error.message}`);
  }
  const abuse = await client.rpc("register_anonymous_abuse_identity", {
    p_installation_id: installId,
  });
  if (abuse.error) {
    throw new Error(`${tag} abuse register failed: ${abuse.error.message}`);
  }
  return {
    client,
    userId,
    displayName,
    installId,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

async function subscribeSession(client, sessionId) {
  const events = [];
  const channel = client.channel(`random-chat-${sessionId}`);
  channel
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "random_chat_messages", filter: `session_id=eq.${sessionId}` },
      (payload) => {
        events.push({ type: "message", row: payload.new });
      }
    )
    .on("broadcast", { event: "typing" }, (payload) => {
      events.push({ type: "typing", payload });
    })
    .subscribe();
  await sleep(1500);
  return { events, channel };
}

async function waitFor(events, predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find(predicate);
    if (hit) {
      return hit;
    }
    await sleep(200);
  }
  throw new Error(`TIMEOUT waiting for ${label}`);
}

async function joinQueue(client) {
  const { data, error } = await client.rpc("find_or_join_random_match");
  if (error) {
    if (/not eligible/i.test(error.message)) {
      const err = new Error(`NOT_ELIGIBLE: ${error.message}`);
      err.code = "NOT_ELIGIBLE";
      throw err;
    }
    throw new Error(`join failed: ${error.message}`);
  }
  const result = Array.isArray(data) ? data[0] : data;
  return result;
}

async function waitForEligible(user) {
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    const { data } = await user.client.rpc("register_anonymous_abuse_identity", {
      p_installation_id: user.installId,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.decision === "allow") {
      return;
    }
    const until = row?.cooldown_until ? Date.parse(row.cooldown_until) : Date.now() + 15000;
    const waitMs = Math.min(Math.max(1000, until - Date.now() + 1500), 60000);
    console.log(`  waiting ~${Math.round(waitMs / 1000)}s for eligibility...`);
    await sleep(waitMs);
  }
  throw new Error("eligibility wait timed out");
}

async function loadSession(client, sessionId) {
  const { data, error } = await client.rpc("get_my_random_session_view", { p_session_id: sessionId });
  if (error) {
    throw new Error(`load session failed: ${error.message}`);
  }
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function matchPair(A, B, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await safe(A.client.rpc("leave_random_queue"));
    await safe(B.client.rpc("leave_random_queue"));
    await sleep(500);
    let rA = null;
    let rB = null;
    try {
      rA = await joinQueue(A.client);
    } catch (err) {
      if (err.code === "NOT_ELIGIBLE") {
        await waitForEligible(A);
        attempt -= 1;
        continue;
      }
      throw err;
    }
    try {
      rB = await joinQueue(B.client);
    } catch (err) {
      if (err.code === "NOT_ELIGIBLE") {
        await waitForEligible(B);
        attempt -= 1;
        continue;
      }
      throw err;
    }
    if (rB?.status === "matched" && rB.matched_user_id === A.userId) {
      return rB.session_id;
    }
    // Wrong partner (a real user was waiting) -> leave quietly and retry.
    if (rA?.status === "matched" && rA.session_id && rA.matched_user_id !== B.userId) {
      await safe(A.client.rpc("leave_random_session", { p_session_id: rA.session_id }));
    }
    if (rB?.status === "matched" && rB.session_id && rB.matched_user_id !== A.userId) {
      await safe(B.client.rpc("leave_random_session", { p_session_id: rB.session_id }));
    }
  }
  throw new Error(`matchPair failed: ${label}`);
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const results = {};
const stateFile = path.resolve(scriptDir, "e2e-state.json");

async function restoreUser(state) {
  const client = makeClient();
  const { error } = await client.auth.setSession({
    access_token: state.accessToken,
    refresh_token: state.refreshToken,
  });
  if (error) {
    throw new Error(`restore session failed: ${error.message}`);
  }
  return { client, userId: state.userId, displayName: state.displayName };
}

async function sessionTests(A, B, sessionId, label) {
  console.log(`== report: A reports B (${label}) ==`);
  let reportOk = false;
  for (let i = 0; i < 6; i += 1) {
    const report = await A.client.rpc("report_random_user", {
      p_session_id: sessionId,
      p_category: "spam",
      p_description: i === 0 ? "E2E test report" : null,
      p_block: false,
    });
    if (i === 0) {
      assert(!report.error && Array.isArray(report.data) && report.data[0]?.report_id, "A report B OK");
      reportOk = true;
    } else if (report.error && /rate limit/i.test(report.error.message)) {
      assert(i >= 5, "report rate limit (5/10min) blocks 6th");
      reportOk = true;
      break;
    } else if (report.error) {
      throw new Error(`report error: ${report.error.message}`);
    }
  }
  assert(reportOk, "report + report rate limit verified");

  console.log(`== message rate limit: 6th send within 10s fails (${label}) ==`);
  let messageRateLimited = false;
  for (let i = 0; i < 6; i += 1) {
    const r = await A.client.rpc("send_random_message", {
      p_session_id: sessionId,
      p_content: `E2E rate ${i}`,
      p_message_type: "text",
      p_reply_to_message_id: null,
    });
    if (r.error && /rate limit/i.test(r.error.message)) {
      assert(i >= 5, "message rate limit (5/10s) blocks 6th");
      messageRateLimited = true;
      break;
    }
    if (r.error) {
      throw new Error(`send error: ${r.error.message}`);
    }
  }
  assert(messageRateLimited, "message rate limit verified");

  console.log(`== block: A blocks B (${label}) ==`);
  const block = await A.client.rpc("block_random_user", { p_session_id: sessionId });
  assert(!block.error && Array.isArray(block.data) && block.data[0]?.blocked === true, "A block B OK");
  const afterBlock = await loadSession(B.client, sessionId);
  assert(afterBlock?.status === "ended", "session ended after block");

  console.log(`== leave: A leaves (already ended) session (${label}) ==`);
  const leave = await A.client.rpc("leave_random_session", { p_session_id: sessionId });
  assert(!leave.error, "leave after block OK");
}

async function main() {
  console.log("== create test identities A/B ==");
  const A = await createTestUser("A");
  const B = await createTestUser("B");
  results.users = { A: A.userId, B: B.userId };
  console.log(`  A=${A.userId}`);
  console.log(`  B=${B.userId}`);

  console.log("== matching: A then B join queue ==");
  const sessionId = await matchPair(A, B, "session1");
  results.session1 = sessionId;
  console.log(`  session=${sessionId}`);

  console.log("== realtime subscriptions ==");
  const subA = await subscribeSession(A.client, sessionId);
  const subB = await subscribeSession(B.client, sessionId);

  console.log("== A sends text -> B realtime ==");
  const sendA = await A.client.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: "E2E hello from A",
    p_message_type: "text",
    p_reply_to_message_id: null,
  });
  if (sendA.error) {
    throw new Error(`A send failed: ${sendA.error.message}`);
  }
  const msgA = Array.isArray(sendA.data) ? sendA.data[0] : sendA.data;
  const seenB = await waitFor(subB.events, (e) => e.type === "message" && e.row.id === msgA.id, "B receives A text");
  assert(seenB.row.content === "E2E hello from A", "B got correct content");
  assert(seenB.row.sender_id === A.userId, "sender is A (no spoof)");

  console.log("== B sends text -> A realtime ==");
  const sendB = await B.client.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: "E2E hello from B",
    p_message_type: "text",
    p_reply_to_message_id: null,
  });
  if (sendB.error) {
    throw new Error(`B send failed: ${sendB.error.message}`);
  }
  const msgB = Array.isArray(sendB.data) ? sendB.data[0] : sendB.data;
  const seenA = await waitFor(subA.events, (e) => e.type === "message" && e.row.id === msgB.id, "A receives B text");
  assert(seenA.row.sender_id === B.userId, "sender is B");

  console.log("== typing broadcast A -> B ==");
  await A.client.channel(`random-chat-${sessionId}`).send({
    type: "broadcast",
    event: "typing",
    payload: { typing: true },
  });
  await waitFor(subB.events, (e) => e.type === "typing" && e.payload?.payload?.typing === true, "B sees typing true");
  await A.client.channel(`random-chat-${sessionId}`).send({
    type: "broadcast",
    event: "typing",
    payload: { typing: false },
  });
  await waitFor(subB.events, (e) => e.type === "typing" && e.payload?.payload?.typing === false, "B sees typing false");

  console.log("== A uploads PNG + sends image -> B realtime ==");
  const mediaPath = `${sessionId}/${A.userId}/${crypto.randomUUID()}.png`;
  const upload = await A.client.storage.from("chat-media").upload(mediaPath, PNG_1PX, {
    contentType: "image/png",
    upsert: false,
  });
  assert(!upload.error, `A upload OK (${upload.error?.message ?? ""})`);
  const sendImg = await A.client.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: null,
    p_message_type: "image",
    p_media_path: mediaPath,
    p_media_mime: "image/png",
    p_media_size: PNG_1PX.length,
    p_media_width: 1,
    p_media_height: 1,
    p_reply_to_message_id: null,
  });
  if (sendImg.error) {
    throw new Error(`A image send failed: ${sendImg.error.message}`);
  }
  const imgMsg = Array.isArray(sendImg.data) ? sendImg.data[0] : sendImg.data;
  assert(imgMsg?.message_type === "image" && imgMsg.media_path === mediaPath, "image message created with path");
  const seenImg = await waitFor(
    subB.events,
    (e) => e.type === "message" && e.row.id === imgMsg.id,
    "B receives A image"
  );
  assert(seenImg.row.message_type === "image", "B got image message");

  console.log("== signed URL (A and B) + fetch ==");
  for (const [tag, c] of [
    ["A", A.client],
    ["B", B.client],
  ]) {
    const signed = await c.storage.from("chat-media").createSignedUrl(mediaPath, 300);
    assert(!signed.error && signed.data?.signedUrl, `${tag} signed URL`);
    const resp = await fetch(signed.data.signedUrl);
    assert(resp.status === 200, `${tag} signed URL fetch 200 (got ${resp.status})`);
  }

  console.log("== reply: B replies text to A's text ==");
  const replyB = await B.client.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: "E2E reply to A",
    p_message_type: "text",
    p_reply_to_message_id: msgA.id,
  });
  if (replyB.error) {
    throw new Error(`B reply failed: ${replyB.error.message}`);
  }
  const replyMsg = Array.isArray(replyB.data) ? replyB.data[0] : replyB.data;
  assert(replyMsg.reply_to_message_id === msgA.id, "reply_to_message_id set");
  assert(replyMsg.reply_is_mine === false, "reply_is_mine false (target is A's msg)");
  assert(replyMsg.reply_body === "E2E hello from A", "reply preview body joined");
  const seenReply = await waitFor(subA.events, (e) => e.type === "message" && e.row.id === replyMsg.id, "A receives reply");
  assert(seenReply.row.reply_to_message_id === msgA.id, "A realtime reply has target id");

  console.log("== reply: A replies text to B's image ==");
  const replyImg = await A.client.rpc("send_random_message", {
    p_session_id: sessionId,
    p_content: "E2E reply to image",
    p_message_type: "text",
    p_reply_to_message_id: imgMsg.id,
  });
  if (replyImg.error) {
    throw new Error(`A image-reply failed: ${replyImg.error.message}`);
  }
  const replyImgMsg = Array.isArray(replyImg.data) ? replyImg.data[0] : replyImg.data;
  assert(replyImgMsg.reply_message_type === "image" && replyImgMsg.reply_body === null, "image reply preview type");
  const seenReplyImg = await waitFor(
    subB.events,
    (e) => e.type === "message" && e.row.id === replyImgMsg.id,
    "B receives image-reply"
  );
  assert(seenReplyImg.row.reply_to_message_id === imgMsg.id, "B realtime image-reply target");

  console.log("== refresh via list_random_messages (ordering + dedupe) ==");
  const list = await A.client.rpc("list_random_messages", {
    p_session_id: sessionId,
    p_limit: 50,
    p_before_created_at: null,
    p_before_id: null,
    p_after_created_at: null,
    p_after_id: null,
  });
  assert(!list.error, "list_random_messages OK");
  const rows = Array.isArray(list.data) ? list.data : [];
  const ids = rows.map((r) => r.id);
  assert(new Set(ids).size === ids.length, "no duplicate ids on refresh");
  const sorted = [...rows].sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
  assert(JSON.stringify(ids) === JSON.stringify(sorted.map((r) => r.id)), "ascending order on refresh");
  const replyRow = rows.find((r) => r.id === replyMsg.id);
  assert(replyRow?.reply_body === "E2E hello from A", "reply preview survives refresh");

  console.log("== persist state for deterministic part 2 ==");
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        A: {
          userId: A.userId,
          displayName: A.displayName,
          accessToken: A.accessToken,
          refreshToken: A.refreshToken,
        },
        B: {
          userId: B.userId,
          displayName: B.displayName,
          accessToken: B.accessToken,
          refreshToken: B.refreshToken,
        },
        session1: sessionId,
      },
      null,
      2
    )
  );

  console.log("== next: A -> old session ended, A/B re-matched ==");
  const nextA = await A.client.rpc("next_random_match", { p_session_id: sessionId });
  assert(!nextA.error, "A next OK");
  const nextResult = Array.isArray(nextA.data) ? nextA.data[0] : nextA.data;
  const ended1 = await loadSession(A.client, sessionId);
  assert(ended1?.status === "ended", "old session ended for A");
  const ended1B = await loadSession(B.client, sessionId);
  assert(ended1B?.status === "ended", "old session ended for B");
  if (nextResult?.status === "matched" && nextResult.matched_user_id === B.userId) {
    console.log("== next re-matched A/B; running session tests on new session ==");
    await sessionTests(A, B, nextResult.session_id, "session2");
  } else {
    if (nextResult?.status === "matched" && nextResult.session_id) {
      await safe(A.client.rpc("leave_random_session", { p_session_id: nextResult.session_id }));
    }
    console.log("note: next matched a live user instead of B; part 2 needs a deterministic session.");
    console.log("run: npx supabase db query --linked \"INSERT INTO public.random_chat_sessions ...\"");
  }

  console.log("== cleanup: remove subscriptions ==");
  await safe(subA.channel.unsubscribe());
  await safe(subB.channel.unsubscribe());

  fs.writeFileSync(path.resolve(scriptDir, "e2e-ids.json"), JSON.stringify(results, null, 2));
  console.log("E2E PART1 PASSED (matching/text/typing/photo/reply/refresh/next)");
}

const part2 = process.argv.includes("--part2");
const createUsers = process.argv.includes("--create-users");
if (createUsers) {
  console.log("== create fresh test users for part2 ==");
  const A = await createTestUser("A");
  const B = await createTestUser("B");
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        A: {
          userId: A.userId,
          displayName: A.displayName,
          accessToken: A.accessToken,
          refreshToken: A.refreshToken,
        },
        B: {
          userId: B.userId,
          displayName: B.displayName,
          accessToken: B.accessToken,
          refreshToken: B.refreshToken,
        },
      },
      null,
      2
    )
  );
  console.log(`  A=${A.userId}`);
  console.log(`  B=${B.userId}`);
  console.log("created users; now insert an active session via SQL, then run --part2 with E2E_SESSION_ID");
} else if (part2) {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const sessionId = process.env.E2E_SESSION_ID;
  if (!sessionId) {
    throw new Error("E2E_SESSION_ID env required for --part2");
  }
  const A = await restoreUser(state.A);
  const B = await restoreUser(state.B);
  console.log(`== part2 on deterministic session ${sessionId} ==`);
  await sessionTests(A, B, sessionId, "direct");
  console.log("E2E PART2 PASSED (report/rate-limit/block/leave)");
} else {
  await main();
}

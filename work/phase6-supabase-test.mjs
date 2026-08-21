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
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

function assertEnv(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
}

function mask(value) {
  if (!value) return "(missing)";
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function summarizeError(error) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function makeClient(url, key, authHeader) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: authHeader
      ? {
          headers: {
            Authorization: `Bearer ${authHeader}`,
          },
        }
      : undefined,
  });
}

async function signIn(url, anonKey, email, password) {
  const client = makeClient(url, anonKey);
  const result = await client.auth.signInWithPassword({ email, password });
  return { client, result };
}

async function createTestUser(admin, email, password) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}

async function maybeDeleteUser(admin, userId) {
  if (!userId) return;
  await admin.auth.admin.deleteUser(userId, false);
}

async function setProfile(admin, profile) {
  const { error } = await admin.from("profiles").upsert(profile);
  if (error) throw error;
}

async function runStep(summary, label, fn) {
  try {
    const detail = await fn();
    summary.tests[label] = { ok: true, ...(detail ?? {}) };
  } catch (error) {
    summary.tests[label] = {
      ok: false,
      error: summarizeError(error),
    };
  }
}

function jpgBuffer(label) {
  return Buffer.from(`phase6-fake-jpg-${label}-${Date.now()}`, "utf8");
}

async function uploadObject(client, bucket, pathName, label, upsert = true) {
  return client.storage.from(bucket).upload(pathName, jpgBuffer(label), {
    contentType: "image/jpeg",
    upsert,
  });
}

async function createPhoto(client, label) {
  const { data, error } = await client.rpc("create_profile_photo", {
    p_file_extension: "jpg",
  });
  if (error) throw error;
  const photo = data?.[0];
  if (!photo) throw new Error("Photo row was not returned.");
  const upload = await uploadObject(client, "profile-photos", photo.storage_path, label, true);
  if (upload.error) throw upload.error;
  return photo;
}

async function waitForMessageEvent(channelClient, matchId, expectedIncrement, sendFn) {
  const events = [];
  let resolveEvent;
  let rejectEvent;
  const done = new Promise((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });

  const timeout = setTimeout(() => rejectEvent(new Error("Realtime event timeout.")), 12000);
  let resolveSubscribed;
  let rejectSubscribed;
  const subscribed = new Promise((resolve, reject) => {
    resolveSubscribed = resolve;
    rejectSubscribed = reject;
  });
  const channel = channelClient
    .channel(`phase6-${matchId}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
      (payload) => {
        events.push(payload.new.id);
        if (events.length >= expectedIncrement) {
          clearTimeout(timeout);
          resolveEvent(events);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        resolveSubscribed(status);
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        rejectSubscribed(new Error(`Realtime channel status: ${status}`));
      }
    });

  try {
    await subscribed;
    await sendFn();
    const result = await done;
    return { events: result, channel };
  } catch (error) {
    await channelClient.removeChannel(channel);
    throw error;
  }
}

async function getConversationRow(client, matchId) {
  const { data, error } = await client.rpc("list_active_conversations");
  if (error) throw error;
  return (data ?? []).find((row) => row.match_id === matchId) ?? null;
}

async function fetchWithRetry(url, attempts = 5, delayMs = 1000) {
  let lastResponse = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastResponse = await fetch(url);
    if (lastResponse.ok) {
      return lastResponse;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return lastResponse;
}

async function main() {
  const env = loadEnv(path.resolve(".env"));
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  assertEnv("EXPO_PUBLIC_SUPABASE_URL", url);
  assertEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  assertEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);

  const admin = makeClient(url, serviceRoleKey, serviceRoleKey);
  const summary = {
    env: {
      url: mask(url),
      anonKey: mask(anonKey),
      serviceRoleKey: mask(serviceRoleKey),
    },
    tests: {},
    cleanup: {},
  };

  const createdUserIds = [];

  try {
    const seed = Date.now();
    const password = `HerLink!${seed}Aa`;
    const emails = {
      a: `herlink.phase6.${seed}.a@example.com`,
      b: `herlink.phase6.${seed}.b@example.com`,
      c: `herlink.phase6.${seed}.c@example.com`,
      d: `herlink.phase6.${seed}.d@example.com`,
      e: `herlink.phase6.${seed}.e@example.com`,
      f: `herlink.phase6.${seed}.f@example.com`,
      g: `herlink.phase6.${seed}.g@example.com`,
      h: `herlink.phase6.${seed}.h@example.com`,
      i: `herlink.phase6.${seed}.i@example.com`,
    };

    const userIds = {};
    for (const [key, email] of Object.entries(emails)) {
      const userId = await createTestUser(admin, email, password);
      userIds[key] = userId;
      createdUserIds.push(userId);
    }

    const clients = {};
    for (const [key, email] of Object.entries(emails)) {
      const { client, result } = await signIn(url, anonKey, email, password);
      if (result.error) throw result.error;
      clients[key] = client;
    }

    const profileSeed = {
      [userIds.a]: {
        display_name: "Tester A",
        birthday: "1995-06-01",
        city: "Taipei",
        bio: "A likes reading and travel.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["長期關係"],
        interests: ["閱讀", "旅行"],
        verified: false,
      },
      [userIds.b]: {
        display_name: "Tester B",
        birthday: "1991-03-02",
        city: "Taipei",
        bio: "B likes reading and music.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["長期關係"],
        interests: ["閱讀", "音樂"],
        verified: true,
      },
      [userIds.c]: {
        display_name: "Tester C",
        birthday: "1998-09-12",
        city: "Taichung",
        bio: "C likes movies.",
        orientation: "雙性戀",
        identity_label: "Woman",
        relationship_goals: ["短期關係"],
        interests: ["電影"],
        verified: false,
      },
      [userIds.d]: {
        display_name: "Tester D",
        birthday: "1994-02-14",
        city: "Kaohsiung",
        bio: "D likes reading and outdoors.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["長期關係"],
        interests: ["閱讀", "戶外"],
        verified: true,
      },
      [userIds.e]: {
        display_name: "Tester E",
        birthday: "2000-01-05",
        city: "Taipei",
        bio: "E is suspended later.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["交朋友"],
        interests: ["藝術"],
        verified: true,
      },
      [userIds.f]: {
        display_name: "Tester F",
        birthday: "1996-05-20",
        city: "Tainan",
        bio: "F likes movies and music.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["長期關係"],
        interests: ["電影", "音樂"],
        verified: false,
      },
      [userIds.g]: {
        display_name: "Tester G",
        birthday: "1988-11-03",
        city: "Taipei",
        bio: "G likes reading.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["長期關係"],
        interests: ["閱讀"],
        verified: true,
      },
      [userIds.h]: {
        display_name: "Tester H",
        birthday: "2002-04-17",
        city: "Taipei",
        bio: "H likes music.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["不確定"],
        interests: ["音樂"],
        verified: false,
      },
      [userIds.i]: {
        display_name: "Tester I",
        birthday: "1993-07-08",
        city: "Hsinchu",
        bio: "I likes food and travel.",
        orientation: "女同志",
        identity_label: "Woman",
        relationship_goals: ["長期關係"],
        interests: ["美食", "旅行"],
        verified: false,
      },
    };

    for (const [id, data] of Object.entries(profileSeed)) {
      await setProfile(admin, {
        id,
        ...data,
        onboarding_completed: true,
        account_status: "active",
        trust_score: 50,
        created_at: new Date().toISOString(),
      });
    }

    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", userIds.e);

    const approvedPhotoB = await createPhoto(clients.b, "approved-b");
    const rejectedPhotoB = await createPhoto(clients.b, "rejected-b");
    const rejectedPhotoC = await createPhoto(clients.c, "rejected-c");

    await clients.a.rpc("like_user", { target_user_id: userIds.b });
    const matchAB = await clients.b.rpc("like_user", { target_user_id: userIds.a });
    if (matchAB.error) throw matchAB.error;
    const matchABId = matchAB.data?.[0]?.match_id;
    if (!matchABId) throw new Error("Failed to create A/B match.");

    await clients.a.rpc("like_user", { target_user_id: userIds.c });
    const matchAC = await clients.c.rpc("like_user", { target_user_id: userIds.a });
    if (matchAC.error) throw matchAC.error;
    const matchACId = matchAC.data?.[0]?.match_id;
    if (!matchACId) throw new Error("Failed to create A/C match.");

    await admin.rpc("review_profile_photo", {
      p_photo_id: approvedPhotoB.id,
      p_decision: "approved",
      p_reason: "phase6 approved",
    });
    await admin.rpc("review_profile_photo", {
      p_photo_id: rejectedPhotoB.id,
      p_decision: "rejected",
      p_reason: "phase6 rejected",
    });
    await admin.rpc("review_profile_photo", {
      p_photo_id: rejectedPhotoC.id,
      p_decision: "rejected",
      p_reason: "phase6 rejected",
    });

    await runStep(summary, "A_min_max_age_normal", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", {
        p_min_age: 30,
        p_max_age: 35,
        p_limit: 20,
      });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: ids.includes(userIds.b) && ids.includes(userIds.d) && !ids.includes(userIds.h),
      };
    });

    await runStep(summary, "B_city_filter_normal", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", {
        p_cities: ["Taipei"],
        p_limit: 20,
      });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: ids.includes(userIds.b) && ids.includes(userIds.g) && !ids.includes(userIds.c),
      };
    });

    await runStep(summary, "C_goal_filter_normal", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", {
        p_relationship_goals: ["長期關係"],
        p_limit: 20,
      });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: ids.includes(userIds.b) && ids.includes(userIds.d) && !ids.includes(userIds.c),
      };
    });

    await runStep(summary, "D_interests_filter_normal", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", {
        p_interests: ["閱讀"],
        p_limit: 20,
      });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: ids.includes(userIds.b) && ids.includes(userIds.d) && !ids.includes(userIds.c),
      };
    });

    await runStep(summary, "E_verified_only_normal", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", {
        p_verified_only: true,
        p_limit: 20,
      });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: ids.includes(userIds.b) && ids.includes(userIds.g) && !ids.includes(userIds.f),
      };
    });

    await runStep(summary, "F_blocked_user_never_appears", async () => {
      const blocked = await clients.a.rpc("block_user", { target_user_id: userIds.d });
      if (blocked.error) throw blocked.error;
      const { data, error } = await clients.a.rpc("list_discover_profiles", { p_limit: 20 });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: !ids.includes(userIds.d),
      };
    });

    await runStep(summary, "G_suspended_user_never_appears", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", { p_limit: 20 });
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      return {
        ids,
        passed: !ids.includes(userIds.e),
      };
    });

    await runStep(summary, "H_pagination_no_duplicates_no_obvious_omissions", async () => {
      const seen = [];
      let cursor = null;
      for (let page = 0; page < 4; page += 1) {
        const { data, error } = await clients.a.rpc("list_discover_profiles", {
          p_limit: 2,
          p_cursor_interest_count: cursor?.sort_interest_count ?? null,
          p_cursor_goal_count: cursor?.sort_goal_count ?? null,
          p_cursor_verified_rank: cursor?.sort_verified_rank ?? null,
          p_cursor_rotation_key: cursor?.sort_rotation_key ?? null,
          p_cursor_id: cursor?.id ?? null,
        });
        if (error) throw error;
        const rows = data ?? [];
        if (rows.length === 0) break;
        seen.push(...rows.map((row) => row.id));
        cursor = rows[rows.length - 1];
      }
      const expectedVisible = [userIds.b, userIds.c, userIds.f, userIds.g, userIds.h, userIds.i];
      const uniqueSeen = [...new Set(seen)];
      return {
        seen: uniqueSeen,
        passed: uniqueSeen.length === seen.length && expectedVisible.every((id) => uniqueSeen.includes(id)),
      };
    });

    await runStep(summary, "I_user_cannot_modify_verified", async () => {
      const { error } = await clients.a.from("profiles").update({ verified: true }).eq("id", userIds.a);
      if (!error) throw new Error("Regular user unexpectedly modified verified.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "J_user_cannot_modify_trust_score", async () => {
      const { error } = await clients.a.from("profiles").update({ trust_score: 99 }).eq("id", userIds.a);
      if (!error) throw new Error("Regular user unexpectedly modified trust_score.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "K_user_can_modify_own_bio", async () => {
      const bio = "A updated bio in phase 6 test.";
      const { error } = await clients.a.from("profiles").update({ bio }).eq("id", userIds.a);
      if (error) throw error;
      const { data, error: readError } = await admin.from("profiles").select("bio").eq("id", userIds.a).single();
      if (readError) throw readError;
      return { bio: data.bio, passed: data.bio === bio };
    });

    await runStep(summary, "L_user_cannot_modify_other_profile", async () => {
      const original = await admin.from("profiles").select("bio").eq("id", userIds.b).single();
      if (original.error) throw original.error;
      const update = await clients.a.from("profiles").update({ bio: "malicious edit" }).eq("id", userIds.b).select("bio");
      const after = await admin.from("profiles").select("bio").eq("id", userIds.b).single();
      if (after.error) throw after.error;
      return {
        attemptedRows: update.data?.length ?? 0,
        finalBio: after.data.bio,
        passed: (update.data?.length ?? 0) === 0 && after.data.bio === original.data.bio,
      };
    });

    await runStep(summary, "M_discover_shows_only_approved", async () => {
      const { data, error } = await clients.a.rpc("get_public_profile_photos", { p_user_ids: [userIds.b] });
      if (error) throw error;
      return {
        photoIds: (data ?? []).map((row) => row.id),
        passed: (data ?? []).length === 1 && data?.[0]?.id === approvedPhotoB.id,
      };
    });

    await runStep(summary, "N_rejected_photo_not_public", async () => {
      const { data, error } = await clients.a.rpc("get_public_profile_photos", { p_user_ids: [userIds.c] });
      if (error) throw error;
      return {
        count: data?.length ?? 0,
        passed: (data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "O_signed_url_normal_and_expires", async () => {
      const shortLived = await clients.a.storage.from("profile-photos").createSignedUrl(approvedPhotoB.storage_path, 1);
      if (shortLived.error) throw shortLived.error;
      const immediate = await fetchWithRetry(shortLived.data.signedUrl);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const expired = await fetch(shortLived.data.signedUrl);
      return {
        immediateStatus: immediate.status,
        expiredStatus: expired.status,
        passed: immediate.ok && !expired.ok,
      };
    });

    await runStep(summary, "P_unread_plus_one_on_incoming_message", async () => {
      const send = await clients.b.rpc("send_message", {
        p_match_id: matchABId,
        p_content: "phase6 unread check",
      });
      if (send.error) throw send.error;
      const row = await getConversationRow(clients.a, matchABId);
      return {
        unreadCount: row?.unread_count ?? null,
        passed: row?.unread_count === 1,
      };
    });

    await runStep(summary, "Q_open_chat_marks_read_zero", async () => {
      const { data, error } = await clients.a.rpc("mark_match_messages_read", { p_match_id: matchABId });
      if (error) throw error;
      const row = await getConversationRow(clients.a, matchABId);
      return {
        updatedRows: data,
        unreadCount: row?.unread_count ?? null,
        passed: row?.unread_count === 0,
      };
    });

    await runStep(summary, "R_user_cannot_modify_other_read_state", async () => {
      const { error } = await clients.a.from("match_reads").upsert({
        match_id: matchABId,
        user_id: userIds.b,
        last_read_at: new Date().toISOString(),
      });
      if (!error) throw new Error("Regular user unexpectedly modified another read state.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "S_own_messages_not_counted_unread", async () => {
      const send = await clients.a.rpc("send_message", {
        p_match_id: matchABId,
        p_content: "phase6 own message unread check",
      });
      if (send.error) throw send.error;
      const row = await getConversationRow(clients.a, matchABId);
      return {
        unreadCount: row?.unread_count ?? null,
        passed: row?.unread_count === 0,
      };
    });

    await runStep(summary, "T_single_server_message_delivered_once", async () => {
      const { events, channel } = await waitForMessageEvent(clients.b, matchABId, 1, async () => {
        const send = await clients.a.rpc("send_message", {
          p_match_id: matchABId,
          p_content: "phase6 realtime once",
        });
        if (send.error) throw send.error;
      });
      await clients.b.removeChannel(channel);
      return {
        events,
        passed: events.length === 1,
      };
    });

    await runStep(summary, "U_reconnect_does_not_duplicate", async () => {
      const first = await waitForMessageEvent(clients.b, matchABId, 1, async () => {
        const send = await clients.a.rpc("send_message", {
          p_match_id: matchABId,
          p_content: "phase6 reconnect one",
        });
        if (send.error) throw send.error;
      });
      await clients.b.removeChannel(first.channel);
      const second = await waitForMessageEvent(clients.b, matchABId, 1, async () => {
        const send = await clients.a.rpc("send_message", {
          p_match_id: matchABId,
          p_content: "phase6 reconnect two",
        });
        if (send.error) throw send.error;
      });
      await clients.b.removeChannel(second.channel);
      return {
        firstCount: first.events.length,
        secondCount: second.events.length,
        passed: first.events.length === 1 && second.events.length === 1,
      };
    });

    await runStep(summary, "V_unmatch_blocks_new_messages", async () => {
      const unmatch = await clients.a.rpc("unmatch_user", { p_match_id: matchABId });
      if (unmatch.error) throw unmatch.error;
      const sendA = await clients.a.rpc("send_message", {
        p_match_id: matchABId,
        p_content: "after unmatch A",
      });
      const sendB = await clients.b.rpc("send_message", {
        p_match_id: matchABId,
        p_content: "after unmatch B",
      });
      return {
        aDenied: !!sendA.error,
        bDenied: !!sendB.error,
        passed: !!sendA.error && !!sendB.error,
      };
    });

    await runStep(summary, "W_block_blocks_new_messages", async () => {
      const block = await clients.a.rpc("block_user", { target_user_id: userIds.c });
      if (block.error) throw block.error;
      const sendA = await clients.a.rpc("send_message", {
        p_match_id: matchACId,
        p_content: "after block A",
      });
      const sendC = await clients.c.rpc("send_message", {
        p_match_id: matchACId,
        p_content: "after block C",
      });
      return {
        aDenied: !!sendA.error,
        cDenied: !!sendC.error,
        passed: !!sendA.error && !!sendC.error,
      };
    });

    await runStep(summary, "X_mobile_source_has_no_service_role_key_reference", async () => {
      const sourceFiles = [
        "app",
        "components",
        "context",
        "lib",
      ];
      const patterns = ["SUPABASE_SERVICE_ROLE_KEY", "sb_secret_"];
      let found = [];
      for (const folder of sourceFiles) {
        const entries = fs.readdirSync(folder, { recursive: true });
        for (const entry of entries) {
          const fullPath = path.join(folder, entry.toString());
          if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
            continue;
          }
          const content = fs.readFileSync(fullPath, "utf8");
          if (patterns.some((pattern) => content.includes(pattern))) {
            found.push(fullPath);
          }
        }
      }
      return {
        found,
        passed: found.length === 0,
      };
    });

    await runStep(summary, "Y_public_profile_response_has_no_private_fields", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles", { p_limit: 1 });
      if (error) throw error;
      const sample = data?.[0] ?? {};
      const keys = Object.keys(sample);
      return {
        keys,
        passed: !keys.includes("birthday") && !keys.includes("trust_score") && !keys.includes("account_status"),
      };
    });
  } finally {
    for (const userId of createdUserIds) {
      try {
        await maybeDeleteUser(admin, userId);
      } catch (error) {
        summary.cleanup[userId] = summarizeError(error);
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        fatal: true,
        message: summarizeError(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

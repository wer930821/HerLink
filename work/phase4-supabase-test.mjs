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

async function completeOnboarding(client, userId, displayName) {
  const result = await client.from("profiles").upsert({
    id: userId,
    display_name: displayName,
    birthday: "1995-01-01",
    city: "Taipei",
    bio: `Profile for ${displayName}`,
    orientation: "Lesbian",
    identity_label: "Woman",
    relationship_goals: ["長期關係"],
    interests: ["閱讀"],
    onboarding_completed: true,
    created_at: new Date().toISOString(),
  });
  if (result.error) throw result.error;
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
  return Buffer.from(`fake-jpg-${label}-${Date.now()}`, "utf8");
}

async function uploadObject(client, bucket, pathName, label) {
  return client.storage.from(bucket).upload(pathName, jpgBuffer(label), {
    contentType: "image/jpeg",
    upsert: true,
  });
}

async function createPhoto(client, label) {
  const { data, error } = await client.rpc("create_profile_photo", {
    p_file_extension: "jpg",
  });
  if (error) throw error;
  const photo = data?.[0];
  if (!photo) throw new Error("Photo row was not returned.");
  const upload = await uploadObject(client, "profile-photos", photo.storage_path, label);
  if (upload.error) throw upload.error;
  return photo;
}

async function createVerification(client, label) {
  const { data, error } = await client.rpc("create_verification_submission", {
    p_method: "selfie_manual",
    p_file_extension: "jpg",
  });
  if (error) throw error;
  const verification = data?.[0];
  if (!verification) throw new Error("Verification row was not returned.");
  const upload = await client.storage.from("verification-private").upload(
    verification.media_path,
    jpgBuffer(label),
    {
      contentType: "image/jpeg",
    }
  );
  if (upload.error) throw upload.error;
  return verification;
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
  const anonClient = makeClient(url, anonKey);
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
      a: `herlink.phase4.${seed}.a@example.com`,
      b: `herlink.phase4.${seed}.b@example.com`,
      c: `herlink.phase4.${seed}.c@example.com`,
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

    await completeOnboarding(clients.a, userIds.a, "Tester A");
    await completeOnboarding(clients.b, userIds.b, "Tester B");
    await completeOnboarding(clients.c, userIds.c, "Tester C");

    let photoA1 = null;
    let photoA2 = null;
    let photoC1 = null;
    let verificationA = null;

    await runStep(summary, "A_upload_own_photo_success", async () => {
      photoA1 = await createPhoto(clients.a, "a-own-photo");
      return {
        photoId: photoA1.id,
        storagePath: photoA1.storage_path,
        passed: true,
      };
    });

    await runStep(summary, "B_upload_to_B_path_denied", async () => {
      const upload = await uploadObject(
        clients.a,
        "profile-photos",
        `${userIds.b}/forged-upload.jpg`,
        "forged"
      );
      if (!upload.error) {
        throw new Error("Upload to another user's path was unexpectedly allowed.");
      }
      return {
        error: upload.error.message,
        passed: true,
      };
    });

    await runStep(summary, "C_delete_own_photo_success", async () => {
      const { data, error } = await clients.a.rpc("delete_profile_photo", {
        p_photo_id: photoA1.id,
      });
      if (error) throw error;
      const { data: row, error: rowError } = await admin
        .from("profile_photos")
        .select("id")
        .eq("id", photoA1.id)
        .maybeSingle();
      if (rowError) throw rowError;
      return {
        rpcResult: data,
        rowExists: !!row,
        passed: data === true && row === null,
      };
    });

    photoA2 = await createPhoto(clients.a, "a-photo-2");

    await runStep(summary, "D_B_delete_A_photo_denied", async () => {
      const { error } = await clients.b.rpc("delete_profile_photo", {
        p_photo_id: photoA2.id,
      });
      if (!error) {
        throw new Error("Another user unexpectedly deleted the photo.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "E_more_than_six_photos_denied", async () => {
      const createdIds = [photoA2.id];
      for (let index = 0; index < 5; index += 1) {
        const photo = await createPhoto(clients.a, `a-extra-${index}`);
        createdIds.push(photo.id);
      }

      const extraAttempt = await clients.a.rpc("create_profile_photo", {
        p_file_extension: "jpg",
      });
      if (!extraAttempt.error) {
        throw new Error("A seventh photo was unexpectedly allowed.");
      }
      return {
        photoCountBeforeDenial: createdIds.length,
        error: extraAttempt.error.message,
        passed: createdIds.length === 6,
      };
    });

    await runStep(summary, "F_only_one_primary_photo", async () => {
      const { data: allPhotos, error: photosError } = await admin
        .from("profile_photos")
        .select("*")
        .eq("user_id", userIds.a)
        .order("sort_order");
      if (photosError) throw photosError;
      const targetId = allPhotos?.[allPhotos.length - 1]?.id;
      const { error } = await clients.a.rpc("set_primary_profile_photo", {
        p_photo_id: targetId,
      });
      if (error) throw error;
      const { data: photosAfter, error: afterError } = await admin
        .from("profile_photos")
        .select("id,is_primary")
        .eq("user_id", userIds.a);
      if (afterError) throw afterError;
      const primaryCount = (photosAfter ?? []).filter((photo) => photo.is_primary).length;
      return {
        primaryCount,
        passed: primaryCount === 1,
      };
    });

    photoC1 = await createPhoto(clients.c, "c-photo-pending");

    await runStep(summary, "G_pending_or_rejected_photo_hidden_from_discover", async () => {
      const pendingResult = await clients.b.rpc("get_public_primary_photos", {
        p_user_ids: [userIds.c],
      });
      if (pendingResult.error) throw pendingResult.error;
      await admin
        .from("profile_photos")
        .update({ moderation_status: "rejected", is_primary: true })
        .eq("id", photoC1.id);
      const rejectedResult = await clients.b.rpc("get_public_primary_photos", {
        p_user_ids: [userIds.c],
      });
      if (rejectedResult.error) throw rejectedResult.error;
      return {
        pendingCount: pendingResult.data?.length ?? 0,
        rejectedCount: rejectedResult.data?.length ?? 0,
        passed: (pendingResult.data?.length ?? 0) === 0 && (rejectedResult.data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "H_approved_primary_photo_visible_in_discover", async () => {
      const { data: photos, error: photosError } = await admin
        .from("profile_photos")
        .select("id,storage_path,is_primary")
        .eq("user_id", userIds.a);
      if (photosError) throw photosError;
      const primaryPhoto = photos?.find((photo) => photo.is_primary) ?? photos?.[0];
      await admin
        .from("profile_photos")
        .update({ moderation_status: "approved", is_primary: true })
        .eq("id", primaryPhoto.id);
      const { data, error } = await clients.b.rpc("get_public_primary_photos", {
        p_user_ids: [userIds.a],
      });
      if (error) throw error;
      const signed = await clients.b.storage
        .from("profile-photos")
        .createSignedUrl(primaryPhoto.storage_path, 60);
      if (signed.error) throw signed.error;
      return {
        visibleCount: data?.length ?? 0,
        signedUrlPresent: !!signed.data?.signedUrl,
        passed: (data?.length ?? 0) === 1 && !!signed.data?.signedUrl,
      };
    });

    await runStep(summary, "I_create_own_verification_success", async () => {
      verificationA = await createVerification(clients.a, "verification-a");
      return {
        verificationId: verificationA.id,
        status: verificationA.status,
        passed: verificationA.status === "pending",
      };
    });

    await runStep(summary, "J_create_B_verification_denied", async () => {
      const { error } = await clients.a.from("verifications").insert({
        user_id: userIds.b,
        status: "pending",
        method: "selfie_manual",
        media_path: `${userIds.b}/fake/verification.jpg`,
      });
      if (!error) {
        throw new Error("Client unexpectedly created another user's verification.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "K_upload_verification_media_success", async () => {
      const download = await admin.storage
        .from("verification-private")
        .download(verificationA.media_path);
      if (download.error) throw download.error;
      return {
        mediaPath: verificationA.media_path,
        passed: true,
      };
    });

    await runStep(summary, "L_B_cannot_read_A_verification_media", async () => {
      const download = await clients.b.storage
        .from("verification-private")
        .download(verificationA.media_path);
      if (!download.error) {
        throw new Error("Another authenticated user unexpectedly read verification media.");
      }
      return {
        error: download.error.message,
        passed: true,
      };
    });

    await runStep(summary, "M_anon_cannot_read_verification_media", async () => {
      const download = await anonClient.storage
        .from("verification-private")
        .download(verificationA.media_path);
      if (!download.error) {
        throw new Error("Anon unexpectedly read verification media.");
      }
      return {
        error: download.error.message,
        passed: true,
      };
    });

    await runStep(summary, "N_client_cannot_set_verification_verified", async () => {
      const { error } = await clients.a
        .from("verifications")
        .update({ status: "verified" })
        .eq("id", verificationA.id);
      if (!error) {
        throw new Error("Client unexpectedly updated verification status.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "O_client_cannot_set_profiles_verified_true", async () => {
      const { error } = await clients.a
        .from("profiles")
        .update({ verified: true })
        .eq("id", userIds.a);
      if (!error) {
        throw new Error("Client unexpectedly updated profiles.verified.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "P_service_role_verifies_A_success", async () => {
      const { data, error } = await admin.rpc("review_verification", {
        p_verification_id: verificationA.id,
        p_status: "verified",
      });
      if (error) throw error;
      return {
        result: data?.[0] ?? null,
        passed: data?.[0]?.profile_verified === true,
      };
    });

    await runStep(summary, "Q_verified_badge_displays_correctly", async () => {
      const ownProfile = await admin
        .from("profiles")
        .select("verified")
        .eq("id", userIds.a)
        .single();
      if (ownProfile.error) throw ownProfile.error;
      const publicProfile = await clients.c
        .from("public_profiles")
        .select("id,verified")
        .eq("id", userIds.a)
        .maybeSingle();
      if (publicProfile.error) throw publicProfile.error;
      return {
        ownVerified: ownProfile.data?.verified ?? false,
        publicVerified: publicProfile.data?.verified ?? false,
        passed: ownProfile.data?.verified === true && publicProfile.data?.verified === true,
      };
    });

    const sharedDeviceHash = "phase4-shared-device-hash-abcdefghijklmnop";

    await runStep(summary, "R_register_device_success", async () => {
      const { data, error } = await clients.a.rpc("register_device", {
        p_device_hash: sharedDeviceHash,
      });
      if (error) throw error;
      return {
        result: data?.[0] ?? null,
        passed: !!data?.[0]?.device_id,
      };
    });

    await runStep(summary, "S_forge_device_for_B_denied", async () => {
      const { error } = await clients.a.from("devices").insert({
        user_id: userIds.b,
        device_hash: "phase4-forged-device-hash-abcdefghijklmnop",
      });
      if (!error) {
        throw new Error("Client unexpectedly forged another user's device row.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "T_same_device_multiple_accounts_creates_risk_signal", async () => {
      const before = await admin
        .from("risk_events")
        .select("*")
        .eq("user_id", userIds.b)
        .eq("event_type", "repeated_device_accounts");
      if (before.error) throw before.error;
      const { data, error } = await clients.b.rpc("register_device", {
        p_device_hash: sharedDeviceHash,
      });
      if (error) throw error;
      const after = await admin
        .from("risk_events")
        .select("*")
        .eq("user_id", userIds.b)
        .eq("event_type", "repeated_device_accounts");
      if (after.error) throw after.error;
      return {
        result: data?.[0] ?? null,
        beforeCount: before.data?.length ?? 0,
        afterCount: after.data?.length ?? 0,
        passed: data?.[0]?.risk_signal_created === true && (after.data?.length ?? 0) === (before.data?.length ?? 0) + 1,
      };
    });

    await runStep(summary, "U_client_cannot_insert_risk_event", async () => {
      const { error } = await clients.a.from("risk_events").insert({
        user_id: userIds.a,
        event_type: "repeated_device_accounts",
        risk_score_delta: -10,
        metadata: { source: "client" },
      });
      if (!error) {
        throw new Error("Client unexpectedly inserted risk event.");
      }
      return {
        error: error.message,
        passed: true,
      };
    });

    await runStep(summary, "V_block_hides_public_photo_data", async () => {
      const like1 = await clients.a.rpc("like_user", { target_user_id: userIds.b });
      const like2 = await clients.b.rpc("like_user", { target_user_id: userIds.a });
      if (like1.error) throw like1.error;
      if (like2.error) throw like2.error;
      const block = await clients.a.rpc("block_user", { target_user_id: userIds.b });
      if (block.error) throw block.error;
      const hidden = await clients.b.rpc("get_public_primary_photos", {
        p_user_ids: [userIds.a],
      });
      if (hidden.error) throw hidden.error;
      return {
        visibleCount: hidden.data?.length ?? 0,
        passed: (hidden.data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "W_rejected_photo_not_readable_by_guessed_path", async () => {
      const { data: userCPhotos, error: userCPhotosError } = await admin
        .from("profile_photos")
        .select("*")
        .eq("user_id", userIds.c)
        .limit(1);
      if (userCPhotosError) throw userCPhotosError;
      const rejectedPhoto = userCPhotos?.[0];
      await admin
        .from("profile_photos")
        .update({ moderation_status: "rejected", is_primary: true })
        .eq("id", rejectedPhoto.id);
      const download = await clients.b.storage
        .from("profile-photos")
        .download(rejectedPhoto.storage_path);
      if (!download.error) {
        throw new Error("Rejected photo was unexpectedly readable.");
      }
      return {
        error: download.error.message,
        passed: true,
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
  console.error(JSON.stringify({
    fatal: true,
    message: summarizeError(error),
  }, null, 2));
  process.exitCode = 1;
});

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
  return Buffer.from(`phase5-fake-jpg-${label}-${Date.now()}`, "utf8");
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

async function createVerification(client, label) {
  const { data, error } = await client.rpc("create_verification_submission", {
    p_method: "selfie_manual",
    p_file_extension: "jpg",
  });
  if (error) throw error;
  const verification = data?.[0];
  if (!verification) throw new Error("Verification row was not returned.");
  const upload = await uploadObject(
    client,
    "verification-private",
    verification.media_path,
    label,
    false
  );
  if (upload.error) throw upload.error;
  return verification;
}

async function createAdminRecord(admin, userId, role, active = true) {
  const { error } = await admin.from("admin_users").upsert({
    user_id: userId,
    role,
    active,
  });
  if (error) throw error;
}

async function getLatestCase(admin, subjectUserId) {
  const { data, error } = await admin
    .from("moderation_cases")
    .select("*")
    .eq("subject_user_id", subjectUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function invokeCleanupFunction(url, secretKey) {
  const response = await fetch(`${url}/functions/v1/verification-media-cleanup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify({ source: "phase5-test" }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Cleanup function failed with ${response.status}`);
  }

  return payload;
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
      a: `herlink.phase5.${seed}.a@example.com`,
      b: `herlink.phase5.${seed}.b@example.com`,
      c: `herlink.phase5.${seed}.c@example.com`,
      d: `herlink.phase5.${seed}.d@example.com`,
      reviewer: `herlink.phase5.${seed}.reviewer@example.com`,
      moderator: `herlink.phase5.${seed}.moderator@example.com`,
      inactive: `herlink.phase5.${seed}.inactive@example.com`,
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
    await completeOnboarding(clients.d, userIds.d, "Tester D");
    await completeOnboarding(clients.reviewer, userIds.reviewer, "Reviewer");
    await completeOnboarding(clients.moderator, userIds.moderator, "Moderator");
    await completeOnboarding(clients.inactive, userIds.inactive, "Inactive Admin");

    await createAdminRecord(admin, userIds.reviewer, "reviewer", true);
    await createAdminRecord(admin, userIds.moderator, "moderator", true);
    await createAdminRecord(admin, userIds.inactive, "moderator", false);

    let activeMatchId = null;
    let verificationForApprove = null;
    let verificationForReject = null;
    let verificationForManual = null;
    let photoReject = null;
    let photoUnderReview = null;
    let photoApprove = null;
    let reportResolve = null;
    let reportDismiss = null;

    const likeAB1 = await clients.a.rpc("like_user", { target_user_id: userIds.b });
    if (likeAB1.error) throw likeAB1.error;
    const likeAB2 = await clients.b.rpc("like_user", { target_user_id: userIds.a });
    if (likeAB2.error) throw likeAB2.error;
    activeMatchId = likeAB2.data?.[0]?.match_id ?? null;
    if (!activeMatchId) throw new Error("Failed to create initial active match for A/B.");

    verificationForApprove = await createVerification(clients.c, "verification-approve");
    verificationForReject = await createVerification(clients.d, "verification-reject");
    verificationForManual = await createVerification(clients.a, "verification-manual");

    photoReject = await createPhoto(clients.b, "photo-reject");
    photoUnderReview = await createPhoto(clients.c, "photo-under-review");
    photoApprove = await createPhoto(clients.d, "photo-approve");

    reportResolve = await clients.a.rpc("report_user", {
      target_user_id: userIds.c,
      p_category: "scam",
      p_description: "Resolve this report in moderation flow.",
    });
    if (reportResolve.error) throw reportResolve.error;
    reportResolve = reportResolve.data?.[0];

    reportDismiss = await clients.a.rpc("report_user", {
      target_user_id: userIds.d,
      p_category: "harassment",
      p_description: "Dismiss this report in moderation flow.",
    });
    if (reportDismiss.error) throw reportDismiss.error;
    reportDismiss = reportDismiss.data?.[0];

    await runStep(summary, "A_regular_user_moderation_rpc_denied", async () => {
      const { error } = await clients.a.rpc("review_report", {
        p_report_id: reportResolve.report_id,
        p_decision: "resolved",
        p_reason: "forbidden",
      });
      if (!error) throw new Error("Regular user unexpectedly reviewed a report.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "B_reviewer_allowed_review_rpc", async () => {
      const { data, error } = await clients.reviewer.rpc("review_report", {
        p_report_id: reportResolve.report_id,
        p_decision: "resolved",
        p_reason: "Reviewer resolution",
      });
      if (error) throw error;
      return {
        status: data?.status ?? data?.[0]?.status ?? "resolved",
        passed: true,
      };
    });

    await runStep(summary, "C_inactive_admin_denied", async () => {
      const { error } = await clients.inactive.rpc("review_report", {
        p_report_id: reportDismiss.report_id,
        p_decision: "dismissed",
        p_reason: "inactive should fail",
      });
      if (!error) throw new Error("Inactive admin unexpectedly reviewed a report.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "D_client_forged_admin_id_invalid", async () => {
      const { error } = await clients.a.from("moderation_logs").insert({
        admin_user_id: userIds.reviewer,
        target_user_id: userIds.b,
        action: "account_suspended",
      });
      if (!error) throw new Error("Client unexpectedly forged a moderation log.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "E_suspected_male_report_creates_case", async () => {
      const report = await clients.a.rpc("report_user", {
        target_user_id: userIds.b,
        p_category: "suspected_male_impersonation",
        p_description: "Identity concern",
      });
      if (report.error) throw report.error;
      const moderationCase = await getLatestCase(admin, userIds.b);
      return {
        caseId: moderationCase?.id ?? null,
        caseType: moderationCase?.case_type ?? null,
        passed: moderationCase?.case_type === "suspected_male_impersonation",
      };
    });

    await runStep(summary, "F_single_report_no_auto_suspend", async () => {
      const { data, error } = await admin
        .from("profiles")
        .select("account_status")
        .eq("id", userIds.b)
        .single();
      if (error) throw error;
      return {
        accountStatus: data.account_status,
        passed: data.account_status !== "suspended",
      };
    });

    await runStep(summary, "G_multiple_identity_reports_escalate_priority", async () => {
      const reports = await Promise.all([
        clients.c.rpc("report_user", {
          target_user_id: userIds.b,
          p_category: "identity_mismatch",
          p_description: "Second identity signal",
        }),
        clients.d.rpc("report_user", {
          target_user_id: userIds.b,
          p_category: "stolen_photo",
          p_description: "Third identity signal",
        }),
      ]);
      for (const result of reports) {
        if (result.error) throw result.error;
      }
      const moderationCase = await getLatestCase(admin, userIds.b);
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("account_status")
        .eq("id", userIds.b)
        .single();
      if (profileError) throw profileError;
      return {
        priority: moderationCase?.priority ?? null,
        accountStatus: profile.account_status,
        passed: moderationCase?.priority === "high" && profile.account_status === "under_review",
      };
    });

    await runStep(summary, "H_reported_user_cannot_see_moderation_case", async () => {
      const result = await clients.b.from("moderation_cases").select("*");
      return {
        rowCount: result.data?.length ?? 0,
        error: result.error?.message ?? null,
        passed: !result.error ? (result.data?.length ?? 0) === 0 : true,
      };
    });

    await runStep(summary, "I_admin_sets_under_review_success", async () => {
      const { data, error } = await clients.moderator.rpc("moderate_account", {
        target_user_id: userIds.b,
        p_action: "under_review",
        p_reason: "Moderator review",
      });
      if (error) throw error;
      return {
        accountStatus: data?.account_status ?? null,
        passed: data?.account_status === "under_review",
      };
    });

    await runStep(summary, "J_under_review_user_disappears_from_discover", async () => {
      const { data, error } = await clients.a.rpc("list_discover_profiles");
      if (error) throw error;
      return {
        visible: (data ?? []).some((profile) => profile.id === userIds.b),
        passed: !(data ?? []).some((profile) => profile.id === userIds.b),
      };
    });

    await runStep(summary, "K_under_review_user_cannot_like_or_match", async () => {
      const { error } = await clients.b.rpc("like_user", {
        target_user_id: userIds.c,
      });
      if (!error) throw new Error("Under review user unexpectedly liked another user.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "L_under_review_user_cannot_send_new_messages", async () => {
      const { error } = await clients.b.rpc("send_message", {
        p_match_id: activeMatchId,
        p_content: "Can I still send this?",
      });
      if (!error) throw new Error("Under review user unexpectedly sent a message.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "M_restore_user_to_active", async () => {
      const { data, error } = await clients.moderator.rpc("moderate_account", {
        target_user_id: userIds.b,
        p_action: "restore",
        p_reason: "Restore after review",
      });
      if (error) throw error;
      return {
        accountStatus: data?.account_status ?? null,
        passed: data?.account_status === "active",
      };
    });

    await clients.a.rpc("block_user", { target_user_id: userIds.b });

    await runStep(summary, "N_restore_does_not_recover_blocked_connection", async () => {
      const { data: match, error } = await admin
        .from("matches")
        .select("status")
        .eq("id", activeMatchId)
        .single();
      if (error) throw error;
      return {
        matchStatus: match.status,
        passed: match.status === "blocked",
      };
    });

    await runStep(summary, "O_regular_user_cannot_review_verification", async () => {
      const { error } = await clients.a.rpc("review_verification", {
        p_verification_id: verificationForApprove.id,
        p_status: "verified",
      });
      if (!error) throw new Error("Regular user unexpectedly reviewed verification.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "P_admin_approve_verification_sets_verified_true", async () => {
      const { data, error } = await clients.reviewer.rpc("review_verification", {
        p_verification_id: verificationForApprove.id,
        p_status: "verified",
        p_rejection_reason: null,
      });
      if (error) throw error;
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("verified")
        .eq("id", verificationForApprove.user_id)
        .single();
      if (profileError) throw profileError;
      return {
        reviewStatus: data?.[0]?.status ?? null,
        verified: profile.verified,
        passed: profile.verified === true,
      };
    });

    await runStep(summary, "Q_reject_verification_sets_verified_false", async () => {
      const { error } = await clients.reviewer.rpc("review_verification", {
        p_verification_id: verificationForReject.id,
        p_status: "rejected",
        p_rejection_reason: "Rejected for test",
      });
      if (error) throw error;
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("verified")
        .eq("id", verificationForReject.user_id)
        .single();
      if (profileError) throw profileError;
      return {
        verified: profile.verified,
        passed: profile.verified === false,
      };
    });

    await runStep(summary, "R_manual_review_creates_moderation_case", async () => {
      const { error } = await clients.reviewer.rpc("review_verification", {
        p_verification_id: verificationForManual.id,
        p_status: "manual_review",
        p_rejection_reason: "Needs manual review",
      });
      if (error) throw error;
      const { data, error: caseError } = await admin
        .from("moderation_cases")
        .select("*")
        .eq("subject_user_id", verificationForManual.user_id)
        .eq("case_type", "verification_review")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (caseError) throw caseError;
      return {
        caseId: data?.id ?? null,
        passed: data?.case_type === "verification_review",
      };
    });

    await runStep(summary, "S_regular_user_cannot_review_photo", async () => {
      const { error } = await clients.a.rpc("review_profile_photo", {
        p_photo_id: photoReject.id,
        p_decision: "rejected",
        p_reason: "forbidden",
      });
      if (!error) throw new Error("Regular user unexpectedly reviewed a photo.");
      return { error: error.message, passed: true };
    });

    await runStep(summary, "T_admin_reject_primary_photo_not_public", async () => {
      const { error } = await clients.reviewer.rpc("review_profile_photo", {
        p_photo_id: photoReject.id,
        p_decision: "rejected",
        p_reason: "Rejected in test",
      });
      if (error) throw error;
      const visible = await clients.a.rpc("get_public_primary_photos", {
        p_user_ids: [photoReject.user_id],
      });
      if (visible.error) throw visible.error;
      return {
        visibleCount: visible.data?.length ?? 0,
        passed: (visible.data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "U_under_review_photo_not_public", async () => {
      const { error } = await clients.reviewer.rpc("review_profile_photo", {
        p_photo_id: photoUnderReview.id,
        p_decision: "under_review",
        p_reason: "Needs photo review",
      });
      if (error) throw error;
      const visible = await clients.a.rpc("get_public_primary_photos", {
        p_user_ids: [photoUnderReview.user_id],
      });
      if (visible.error) throw visible.error;
      return {
        visibleCount: visible.data?.length ?? 0,
        passed: (visible.data?.length ?? 0) === 0,
      };
    });

    await runStep(summary, "V_approved_photo_public", async () => {
      const { error } = await clients.reviewer.rpc("review_profile_photo", {
        p_photo_id: photoApprove.id,
        p_decision: "approved",
        p_reason: "Approved in test",
      });
      if (error) throw error;
      const visible = await clients.a.rpc("get_public_primary_photos", {
        p_user_ids: [photoApprove.user_id],
      });
      if (visible.error) throw visible.error;
      return {
        visibleCount: visible.data?.length ?? 0,
        passed: (visible.data?.length ?? 0) === 1,
      };
    });

    await runStep(summary, "W_admin_resolve_report_success_and_audit_log", async () => {
      const report = await clients.b.rpc("report_user", {
        target_user_id: userIds.d,
        p_category: "money_request",
        p_description: "Another resolved report",
      });
      if (report.error) throw report.error;
      const reportId = report.data?.[0]?.report_id;
      const { error } = await clients.reviewer.rpc("review_report", {
        p_report_id: reportId,
        p_decision: "resolved",
        p_reason: "Resolved in test",
      });
      if (error) throw error;
      const { data: logs, error: logsError } = await admin
        .from("moderation_logs")
        .select("*")
        .eq("action", "report_resolved")
        .eq("metadata->>report_id", reportId);
      if (logsError) throw logsError;
      return {
        logCount: logs?.length ?? 0,
        passed: (logs?.length ?? 0) >= 1,
      };
    });

    await runStep(summary, "X_dismissed_report_does_not_reduce_trust_score", async () => {
      const { data: beforeProfile, error: beforeError } = await admin
        .from("profiles")
        .select("trust_score")
        .eq("id", userIds.d)
        .single();
      if (beforeError) throw beforeError;
      const { error } = await clients.reviewer.rpc("review_report", {
        p_report_id: reportDismiss.report_id,
        p_decision: "dismissed",
        p_reason: "Dismissed in test",
      });
      if (error) throw error;
      const { data: afterProfile, error: afterError } = await admin
        .from("profiles")
        .select("trust_score")
        .eq("id", userIds.d)
        .single();
      if (afterError) throw afterError;
      return {
        before: beforeProfile.trust_score,
        after: afterProfile.trust_score,
        passed: beforeProfile.trust_score === afterProfile.trust_score,
      };
    });

    await runStep(summary, "Y_all_moderation_actions_write_audit_logs", async () => {
      const { data, error } = await admin
        .from("moderation_logs")
        .select("action")
        .in("action", [
          "account_under_review",
          "account_restored",
          "verification_approved",
          "verification_rejected",
          "photo_rejected",
          "photo_under_review",
          "photo_approved",
          "report_resolved",
          "report_dismissed",
        ]);
      if (error) throw error;
      const actions = new Set((data ?? []).map((item) => item.action));
      const required = [
        "account_under_review",
        "account_restored",
        "verification_approved",
        "verification_rejected",
        "photo_rejected",
        "photo_under_review",
        "photo_approved",
        "report_resolved",
        "report_dismissed",
      ];
      return {
        actions: [...actions],
        passed: required.every((action) => actions.has(action)),
      };
    });

    await runStep(summary, "Z_regular_user_cannot_read_moderation_logs", async () => {
      const result = await clients.a.from("moderation_logs").select("*");
      return {
        rowCount: result.data?.length ?? 0,
        error: result.error?.message ?? null,
        passed: !result.error ? (result.data?.length ?? 0) === 0 : true,
      };
    });

    await runStep(summary, "AA_expired_verified_media_cleanup_success", async () => {
      const { error: setPastError } = await admin
        .from("verifications")
        .update({ media_delete_after: "2000-01-01T00:00:00Z" })
        .eq("id", verificationForApprove.id);
      if (setPastError) throw setPastError;
      const cleanupResult = await invokeCleanupFunction(url, serviceRoleKey);
      const { data: verification, error: verificationError } = await admin
        .from("verifications")
        .select("media_path")
        .eq("id", verificationForApprove.id)
        .single();
      if (verificationError) throw verificationError;
      return {
        deletedRows: cleanupResult.deletedRows ?? 0,
        mediaPath: verification.media_path,
        passed: verification.media_path === null,
      };
    });

    await runStep(summary, "AB_pending_verification_media_not_cleaned", async () => {
      const pendingVerification = await createVerification(clients.b, "verification-pending-retain");
      const { error: updateError } = await admin
        .from("verifications")
        .update({ media_delete_after: "2000-01-01T00:00:00Z" })
        .eq("id", pendingVerification.id);
      if (updateError) throw updateError;
      await invokeCleanupFunction(url, serviceRoleKey);
      const { data: verification, error: verificationError } = await admin
        .from("verifications")
        .select("status,media_path")
        .eq("id", pendingVerification.id)
        .single();
      if (verificationError) throw verificationError;
      return {
        status: verification.status,
        mediaPathExists: !!verification.media_path,
        passed: verification.status === "pending" && !!verification.media_path,
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

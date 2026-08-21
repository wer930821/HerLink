import {
  AdminUser,
  ModerationCase,
  ModerateAccountResult,
  ProfilePhoto,
  Report,
  ReviewVerificationResult,
  supabase,
  Verification,
} from "./supabase";

export interface AdminDashboardCounts {
  pendingCases: number;
  pendingVerification: number;
  pendingReports: number;
  photosUnderReview: number;
}

export async function fetchMyAdminUser() {
  const { data, error } = await supabase
    .from("admin_users")
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AdminUser | null) ?? null;
}

export async function fetchAdminDashboardCounts() {
  const [cases, verifications, reports, photos] = await Promise.all([
    supabase.from("moderation_cases").select("id", { count: "exact", head: true }).in("status", [
      "pending",
      "reviewing",
    ]),
    supabase.from("verifications").select("id", { count: "exact", head: true }).in("status", [
      "pending",
      "manual_review",
    ]),
    supabase.from("reports").select("id", { count: "exact", head: true }).in("status", [
      "pending",
      "reviewing",
    ]),
    supabase.from("profile_photos").select("id", { count: "exact", head: true }).in(
      "moderation_status",
      ["pending", "under_review"]
    ),
  ]);

  for (const result of [cases, verifications, reports, photos]) {
    if (result.error) {
      throw result.error;
    }
  }

  return {
    pendingCases: cases.count ?? 0,
    pendingVerification: verifications.count ?? 0,
    pendingReports: reports.count ?? 0,
    photosUnderReview: photos.count ?? 0,
  } satisfies AdminDashboardCounts;
}

export async function fetchModerationCases() {
  const { data, error } = await supabase
    .from("moderation_cases")
    .select("*")
    .in("status", ["pending", "reviewing"])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as ModerationCase[];
}

export async function fetchPendingVerifications() {
  const { data, error } = await supabase
    .from("verifications")
    .select("*")
    .in("status", ["pending", "manual_review"])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Verification[];
}

export async function fetchPendingPhotos() {
  const { data, error } = await supabase
    .from("profile_photos")
    .select("*")
    .in("moderation_status", ["pending", "under_review"])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as ProfilePhoto[];
}

export async function fetchPendingReports() {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .in("status", ["pending", "reviewing"])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Report[];
}

export async function fetchProfilesByIds(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .in("id", ids);

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

export async function fetchReportsForUser(userId: string) {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("reported_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    throw error;
  }

  return (data ?? []) as Report[];
}

export async function fetchRiskEventsForUser(userId: string) {
  const { data, error } = await supabase
    .from("risk_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function createAdminSignedUrl(bucket: "verification-private" | "profile-photos", path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function reviewCase(caseId: string, decision: "resolved" | "dismissed", reason?: string) {
  const { data, error } = await supabase.rpc("review_moderation_case", {
    p_case_id: caseId,
    p_decision: decision,
    p_reason: reason ?? null,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function takeCase(caseId: string) {
  const { data, error } = await supabase.rpc("take_moderation_case", {
    p_case_id: caseId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function moderateAccount(targetUserId: string, action: "under_review" | "suspend" | "restore", reason?: string) {
  const { data, error } = await supabase.rpc("moderate_account", {
    target_user_id: targetUserId,
    p_action: action,
    p_reason: reason ?? null,
  });

  if (error) {
    throw error;
  }

  return data as ModerateAccountResult;
}

export async function reviewVerification(
  verificationId: string,
  decision: "verified" | "rejected" | "manual_review",
  reason?: string
) {
  const { data, error } = await supabase.rpc("review_verification", {
    p_verification_id: verificationId,
    p_status: decision,
    p_rejection_reason: reason ?? null,
  });

  if (error) {
    throw error;
  }

  return (data?.[0] ?? null) as ReviewVerificationResult | null;
}

export async function reviewProfilePhoto(
  photoId: string,
  decision: "approved" | "rejected" | "under_review",
  reason?: string
) {
  const { data, error } = await supabase.rpc("review_profile_photo", {
    p_photo_id: photoId,
    p_decision: decision,
    p_reason: reason ?? null,
  });

  if (error) {
    throw error;
  }

  return data as ProfilePhoto;
}

export async function reviewReport(reportId: string, decision: "resolved" | "dismissed", reason?: string) {
  const { data, error } = await supabase.rpc("review_report", {
    p_report_id: reportId,
    p_decision: decision,
    p_reason: reason ?? null,
  });

  if (error) {
    throw error;
  }

  return data as Report;
}

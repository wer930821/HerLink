import {
  ConversationRow,
  DiscoverProfileRow,
  Like,
  Match,
  Message,
  PublicProfile,
  Report,
  ReportCategory,
  SendMessageResult,
  supabase,
  Verification,
} from "./supabase";
import { fetchPublicPhotoGroups, fetchPublicPrimaryPhotoMap, SignedPhoto } from "./media";

export const REPORT_CATEGORIES: Array<{ value: ReportCategory; label: string }> = [
  { value: "suspected_male_impersonation", label: "疑似男性冒充" },
  { value: "identity_mismatch", label: "身份與社群資格不符" },
  { value: "stolen_photo", label: "疑似盜圖" },
  { value: "scam", label: "疑似詐騙" },
  { value: "money_request", label: "金錢要求" },
  { value: "investment_scam", label: "投資詐騙" },
  { value: "harassment", label: "騷擾" },
  { value: "sexual_harassment", label: "性騷擾" },
  { value: "threat", label: "威脅" },
  { value: "unsolicited_explicit_content", label: "未經同意露骨內容" },
  { value: "impersonation", label: "冒充他人" },
  { value: "suspected_minor", label: "疑似未成年" },
  { value: "other", label: "其他" },
];

export interface MatchListItem {
  match: Match;
  otherUserId: string;
  profile: PublicProfile | null;
  latestMessage: Message | null;
  unreadCount: number;
  primaryPhotoUrl: string | null;
}

export interface SentLikeListItem {
  like: Like;
  profile: PublicProfile | null;
  primaryPhotoUrl: string | null;
}

export interface DiscoverProfileCard {
  profile: PublicProfile;
  photos: SignedPhoto[];
  primaryPhotoUrl: string | null;
  cursor: DiscoverCursor;
}

export interface SafetyLevel {
  title: string;
  description: string;
}

export interface DiscoverFilters {
  minAge: number | null;
  maxAge: number | null;
  cities: string[];
  relationshipGoals: string[];
  interests: string[];
  verifiedOnly: boolean;
  identityLabels: string[];
}

export interface DiscoverCursor {
  interestCount: number;
  goalCount: number;
  verifiedRank: number;
  rotationKey: string;
  id: string;
}

export interface DiscoverPage {
  items: DiscoverProfileCard[];
  nextCursor: DiscoverCursor | null;
}

export interface ActiveConversation {
  match: Match;
  otherUserId: string;
  profile: PublicProfile;
  latestMessage: Message | null;
  unreadCount: number;
  primaryPhotoUrl: string | null;
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function getOtherUserId(match: Match, userId: string) {
  return match.user_1_id === userId ? match.user_2_id : match.user_1_id;
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getSafetyLevel(trustScore: number): SafetyLevel {
  if (trustScore >= 70) {
    return {
      title: "正常",
      description: "目前帳號狀態穩定，仍請持續留意對話中的安全訊號。",
    };
  }

  if (trustScore >= 40) {
    return {
      title: "觀察中",
      description: "系統最近有記錄到一些風險訊號，建議更謹慎使用外部聯絡與金錢往來。",
    };
  }

  if (trustScore >= 20) {
    return {
      title: "受限制",
      description: "帳號已有較明顯風險紀錄，部分功能可能受到限制。",
    };
  }

  return {
    title: "人工審核中",
    description: "系統已將帳號標記為需要人工審核，請等待後續處理。",
  };
}

export function getVerificationLabel(verification: Verification | null, verified: boolean) {
  if (verified) {
    return "已驗證";
  }

  switch (verification?.status) {
    case "pending":
      return "待審核";
    case "rejected":
      return "驗證失敗";
    case "manual_review":
      return "需要人工審核";
    case "verified":
      return "已驗證";
    default:
      return "未驗證";
  }
}

export async function fetchDiscoverProfiles() {
  return fetchDiscoverProfilesPage({}, null);
}

export async function fetchDiscoverProfilesPage(
  filters: Partial<DiscoverFilters>,
  cursor: DiscoverCursor | null
) {
  const { data, error } = await supabase.rpc("list_discover_profiles", {
    p_min_age: filters.minAge ?? null,
    p_max_age: filters.maxAge ?? null,
    p_cities: filters.cities?.length ? filters.cities : null,
    p_relationship_goals: filters.relationshipGoals?.length ? filters.relationshipGoals : null,
    p_interests: filters.interests?.length ? filters.interests : null,
    p_verified_only: filters.verifiedOnly ?? false,
    p_identity_labels: filters.identityLabels?.length ? filters.identityLabels : null,
    p_limit: 12,
    p_cursor_interest_count: cursor?.interestCount ?? null,
    p_cursor_goal_count: cursor?.goalCount ?? null,
    p_cursor_verified_rank: cursor?.verifiedRank ?? null,
    p_cursor_rotation_key: cursor?.rotationKey ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    throw error;
  }

  const profiles = (data ?? []) as DiscoverProfileRow[];
  const photoGroups = await fetchPublicPhotoGroups(profiles.map((profile) => profile.id));
  const items = profiles.map((profile) => {
    const photos = photoGroups.get(profile.id) ?? [];
    const { sort_interest_count, sort_goal_count, sort_rotation_key, sort_verified_rank, ...publicProfile } =
      profile;
    return {
      profile: publicProfile satisfies PublicProfile,
      photos,
      primaryPhotoUrl: photos[0]?.signedUrl ?? null,
      cursor: {
        interestCount: sort_interest_count,
        goalCount: sort_goal_count,
        verifiedRank: sort_verified_rank,
        rotationKey: sort_rotation_key,
        id: profile.id,
      },
    };
  }) satisfies DiscoverProfileCard[];

  return {
    items,
    nextCursor: items.length > 0 ? items[items.length - 1].cursor : null,
  } satisfies DiscoverPage;
}

export async function fetchPublicProfilesByIds(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, PublicProfile>();
  }

  const { data, error } = await supabase.rpc("get_visible_public_profiles", {
    p_user_ids: [...new Set(userIds)],
  });

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

export async function fetchVisiblePublicProfile(userId: string) {
  const profileMap = await fetchPublicProfilesByIds([userId]);
  return profileMap.get(userId) ?? null;
}

export async function fetchSentLikes(userId: string) {
  const { data, error } = await supabase
    .from("likes")
    .select("*")
    .eq("from_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const likes = data ?? [];
  const targetIds = likes.map((like) => like.to_user_id);
  const profileMap = await fetchPublicProfilesByIds(targetIds);
  const photoMap = await fetchPublicPrimaryPhotoMap(targetIds);

  return likes
    .filter((like) => profileMap.has(like.to_user_id))
    .map((like) => ({
      like,
      profile: profileMap.get(like.to_user_id) ?? null,
      primaryPhotoUrl: photoMap.get(like.to_user_id)?.signedUrl ?? null,
    })) satisfies SentLikeListItem[];
}

export async function fetchActiveMatches(userId: string) {
  const { data, error } = await supabase.rpc("list_active_conversations");

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ConversationRow[];
  const photoMap = await fetchPublicPrimaryPhotoMap(rows.map((row) => row.other_user_id));

  return rows.map((row) => ({
    match: {
      id: row.match_id,
      user_1_id: row.match_user_1_id,
      user_2_id: row.match_user_2_id,
      status: row.match_status,
      matched_at: row.matched_at,
      created_at: row.match_created_at,
    } satisfies Match,
    otherUserId: row.other_user_id,
    profile: {
      id: row.other_user_id,
      display_name: row.display_name,
      age: row.age,
      city: row.city,
      bio: row.bio,
      orientation: row.orientation,
      identity_label: row.identity_label,
      relationship_goals: row.relationship_goals,
      interests: row.interests,
      verified: row.verified,
    } satisfies PublicProfile,
    latestMessage: row.latest_message_id
      ? ({
          id: row.latest_message_id,
          match_id: row.match_id,
          sender_id: row.latest_message_sender_id ?? row.other_user_id,
          type: "text",
          content: row.latest_message_content ?? "",
          created_at: row.latest_message_created_at ?? row.matched_at,
          read_at: null,
        } satisfies Message)
      : null,
    unreadCount: row.unread_count,
    primaryPhotoUrl: photoMap.get(row.other_user_id)?.signedUrl ?? null,
  })) satisfies MatchListItem[];
}

export async function fetchMyReports() {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const reports = (data ?? []) as Report[];
  const targetIds = reports.map((report) => report.reported_user_id);
  const profileMap = await fetchPublicProfilesByIds(targetIds);
  const photoMap = await fetchPublicPrimaryPhotoMap(targetIds);

  return reports.map((report) => ({
    report,
    profile: profileMap.get(report.reported_user_id) ?? null,
    primaryPhotoUrl: photoMap.get(report.reported_user_id)?.signedUrl ?? null,
  }));
}

export async function sendChatMessage(matchId: string, content: string) {
  const { data, error } = await supabase.rpc("send_message", {
    p_match_id: matchId,
    p_content: content,
  });

  if (error) {
    throw error;
  }

  const result = data?.[0] ?? null;

  if (!result) {
    throw new Error("訊息送出後沒有收到資料。");
  }

  return result satisfies SendMessageResult;
}

export async function saveEditableProfile(
  userId: string,
  updates: {
    display_name: string;
    city: string;
    bio: string;
    orientation: string;
    identity_label: string;
    relationship_goals: string[];
    interests: string[];
  }
) {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

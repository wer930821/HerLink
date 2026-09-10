import {
  getIdentityDisplayLabel,
  getRelationshipGoalDisplayLabels,
} from "./profile-options";
import { containsSensitiveContactInfo } from "./contact-safety";

export const ANONYMOUS_AVATAR_OPTIONS = [
  { id: "avatar_01", icon: "moon-outline", bg: "#2E3148", fg: "#F3D9C7", label: "月光貓" },
  { id: "avatar_02", icon: "leaf-outline", bg: "#35524A", fg: "#E8D9C2", label: "森林葉" },
  { id: "avatar_03", icon: "planet-outline", bg: "#3A405A", fg: "#F0C7AE", label: "行星旅人" },
  { id: "avatar_04", icon: "paw-outline", bg: "#5A3E36", fg: "#F6D6C7", label: "夜行狐狸" },
  { id: "avatar_05", icon: "flower-outline", bg: "#5B4B6B", fg: "#F8E5D8", label: "暮色花" },
  { id: "avatar_06", icon: "fish-outline", bg: "#235B6C", fg: "#DCEEF1", label: "海風魚" },
  { id: "avatar_07", icon: "sparkles-outline", bg: "#62463E", fg: "#F4E4D7", label: "星光" },
  { id: "avatar_08", icon: "cafe-outline", bg: "#58463A", fg: "#F3DFC7", label: "咖啡杯" },
  { id: "avatar_09", icon: "musical-notes-outline", bg: "#31405A", fg: "#E2EAF8", label: "音符" },
  { id: "avatar_10", icon: "book-outline", bg: "#4C4A39", fg: "#F6ECD6", label: "書頁" },
  { id: "avatar_11", icon: "rainy-outline", bg: "#314B5A", fg: "#D9ECF4", label: "雨天窗" },
  { id: "avatar_12", icon: "sunny-outline", bg: "#6B4F33", fg: "#FBE6C8", label: "晨光" },
] as const;

export type AnonymousAvatarId = (typeof ANONYMOUS_AVATAR_OPTIONS)[number]["id"];
export const ANONYMOUS_AGE_VISIBILITY_OPTIONS = ["exact", "range", "hidden"] as const;
export type AnonymousAgeVisibility = (typeof ANONYMOUS_AGE_VISIBILITY_OPTIONS)[number];
export const DEFAULT_ANONYMOUS_AVATAR: AnonymousAvatarId = "avatar_01";
export const DEFAULT_ANONYMOUS_DISPLAY_NAME = "匿名使用者";


function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function getAnonymousAvatarOption(avatarId: string | null | undefined) {
  return ANONYMOUS_AVATAR_OPTIONS.find((option) => option.id === avatarId) ?? ANONYMOUS_AVATAR_OPTIONS[0];
}

export function isAnonymousAvatarId(value: string | null | undefined): value is AnonymousAvatarId {
  return ANONYMOUS_AVATAR_OPTIONS.some((option) => option.id === value);
}

export function validateAnonymousDisplayName(value: string | null | undefined) {
  if (value == null || /[\r\n\u0000-\u001F\u007F-\u009F]/u.test(value)) {
    return "名稱格式不正確";
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length < 2) {
    return "名稱至少需要 2 個字";
  }

  if (normalized.length > 12) {
    return "名稱最多 12 個字";
  }

  if (containsSensitiveContactInfo(normalized) || normalized.includes("@")) {
    return "匿名暱稱不可包含 email、電話或外部聯絡方式。";
  }

  return null;
}

export function validateAnonymousIntro(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (normalized.length < 5) {
    return "匿名自介至少需要 5 個字，可以先聊聊妳想認識什麼樣的人。";
  }

  if (normalized.length > 160) {
    return "匿名自介請控制在 160 個字以內。";
  }

  if (containsSensitiveContactInfo(normalized)) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[anonymous] intro validation blocked");
    }
    return "匿名自介請不要放聯絡方式，可以先在 HerLink 裡聊天。";
  }

  return null;
}

export interface AnonymousProfileLike {
  anonymous_mode_enabled?: boolean | null;
  anonymous_display_name?: string | null;
  anonymous_avatar?: string | null;
  anonymous_intro?: string | null;
  anonymous_age_visibility?: AnonymousAgeVisibility | string | null;
  anonymous_age_display?: string | null;
  age?: number | null;
  birthday?: string | null;
  city?: string | null;
  identity_label?: string | null;
  interested_in_identity_labels?: string[] | null;
  interests?: string[] | null;
}

export function isAnonymousModeEnabled(profile: AnonymousProfileLike | null | undefined) {
  return Boolean(profile?.anonymous_mode_enabled);
}

export function isAnonymousAgeVisibility(
  value: string | null | undefined
): value is AnonymousAgeVisibility {
  return ANONYMOUS_AGE_VISIBILITY_OPTIONS.includes(value as AnonymousAgeVisibility);
}

export function getAgeRange(age: number | null | undefined) {
  if (typeof age !== "number" || age < 18) {
    return null;
  }

  if (age <= 20) return "18–20 歲";
  if (age <= 24) return "21–24 歲";
  if (age <= 29) return "25–29 歲";
  if (age <= 34) return "30–34 歲";
  if (age <= 39) return "35–39 歲";
  if (age <= 44) return "40–44 歲";
  return "45+";
}

export function calculateAgeFromBirthday(birthday: string | null | undefined) {
  if (!birthday) {
    return null;
  }

  const birth = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age > 0 ? age : null;
}

export function getAnonymousAgeDisplay(profile: AnonymousProfileLike | null | undefined) {
  if (!profile) {
    return null;
  }

  if (normalizeText(profile.anonymous_age_display)) {
    return normalizeText(profile.anonymous_age_display);
  }

  const visibility = isAnonymousAgeVisibility(profile.anonymous_age_visibility)
    ? profile.anonymous_age_visibility
    : "range";
  const derivedAge = profile.age ?? calculateAgeFromBirthday(profile.birthday);

  if (visibility === "hidden") {
    return null;
  }

  if (visibility === "exact") {
    return typeof derivedAge === "number" ? `${derivedAge}` : null;
  }

  return getAgeRange(derivedAge);
}

export function getSafeAnonymousDisplayName(profile: {
  anonymous_display_name?: string | null;
} | null | undefined) {
  const anonymousDisplayName = normalizeText(profile?.anonymous_display_name);
  if (anonymousDisplayName) {
    return anonymousDisplayName;
  }

  return DEFAULT_ANONYMOUS_DISPLAY_NAME;
}

export function getVisibleProfileName(profile: {
  anonymous_display_name?: string | null;
} | null | undefined) {
  return getSafeAnonymousDisplayName(profile);
}

export function getVisibleProfileBio(profile: {
  anonymous_intro?: string | null;
  bio?: string | null;
} | null | undefined) {
  const anonymousIntro = normalizeText(profile?.anonymous_intro);
  if (anonymousIntro) {
    return anonymousIntro;
  }

  return "";
}

export function getSafeAnonymousAvatar(profile: {
  anonymous_avatar?: string | null;
} | null | undefined) {
  return isAnonymousAvatarId(profile?.anonymous_avatar) ? profile.anonymous_avatar : DEFAULT_ANONYMOUS_AVATAR;
}

export function getVisibleProfileAvatarId(profile: {
  anonymous_mode_enabled?: boolean | null;
  anonymous_avatar?: string | null;
} | null | undefined) {
  return profile?.anonymous_mode_enabled && isAnonymousAvatarId(profile.anonymous_avatar)
    ? profile.anonymous_avatar
    : null;
}

export function getVisibleProfileMeta(profile: {
  identity_label?: string | null;
  city?: string | null;
  age?: number | null;
}) {
  return {
    city: normalizeText(profile.city),
    age: profile.age ?? null,
    identityLabel: profile.identity_label ? getIdentityDisplayLabel(profile.identity_label) : "",
  };
}

export function buildAnonymousProfilePreview(profile: {
  identity_label?: string | null;
  interests?: string[] | null;
  relationship_goals?: string[] | null;
  custom_relationship_goal?: string | null;
}) {
  const parts: string[] = [];
  const identityLabel = getIdentityDisplayLabel(profile.identity_label);
  const interests = Array.isArray(profile.interests)
    ? profile.interests.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const relationshipGoals = getRelationshipGoalDisplayLabels(
    profile.relationship_goals,
    profile.custom_relationship_goal
  );

  if (identityLabel) {
    parts.push(identityLabel);
  }

  if (interests.length > 0) {
    parts.push(interests.slice(0, 2).join("、"));
  }

  if (relationshipGoals.length > 0) {
    parts.push(relationshipGoals[0]);
  }

  return parts.join(" · ");
}

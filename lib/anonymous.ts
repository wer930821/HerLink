import {
  getIdentityDisplayLabel,
  getRelationshipGoalDisplayLabels,
  getValidIdentityPreferenceValues,
  isIdentityLabelOption,
  normalizeIdentityLabel,
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

export const ANONYMOUS_NAME_OPTIONS = [
  "本人很正常",
  "理性路過",
  "目前沒意見",
  "今天準時睡",
  "明天再努力",
  "認真路過",
  "普通市民",
  "稍後回覆",
  "正在想名字",
  "今天不加班",
  "不方便透露",
  "有事再說",
  "暫時在線",
  "低調出現",
  "正常聊天",
  "沒有很忙",
  "等一下就走",
  "不吃香菜",
  "今天有空",
  "還沒下班",
  "隨便看看",
  "先聊再說",
  "明天開始減肥",
  "只是路過",
  "沒什麼意見",
  "請稍等一下",
  "今天先這樣",
  "名字想不到",
  "不知道聊什麼",
  "認真考慮中",
  "保持冷靜",
  "薪水已讀不回",
  "明天一定早睡",
  "老闆看不到我",
  "訊息正在輸入",
  "本人拒絕內耗",
  "今天沒有生氣",
  "先不要問星座",
  "我真的沒遲到",
  "目前情緒穩定",
  "已通過本人審核",
  "經研究後決定聊天",
  "等等要吃飯",
  "今天有點睏",
  "晚點再減肥",
  "其實不難聊",
  "正在想開場白",
  "香菜保持距離",
  "珍奶正常甜",
  "鬧鐘的受害者",
  "今天不談工作",
  "先不要太認真",
  "本人正在待機",
  "目前可以聊天",
  "沒有要幹嘛",
  "剛好經過這裡",
  "今天心情普通",
  "正在努力清醒",
  "晚餐還沒決定",
  "先聊五分鐘",
  "不保證有梗",
  "回覆速度正常",
  "社交電量尚可",
  "正在假裝忙",
  "今天沒有計畫",
  "剛剛才上線",
  "本人沒有失蹤",
  "目前沒有想法",
  "等等就認真",
  "明天再早起",
  "今天先不焦慮",
  "我只是來看看",
  "還在載入中",
  "本人保持低調",
  "今天也很和平",
  "正在等待下班",
  "暫時沒有問題",
  "先不要催我",
  "我有在聽",
  "目前一切正常",
  "請正常發揮",
  "今天不想動腦",
  "聊天可以慢慢來",
  "沒有特別的事",
  "剛好有點時間",
  "本人在線中",
  "今天沒有加班",
  "正在研究人生",
  "等等再想辦法",
  "先讓我想一下",
  "目前尚未放棄",
  "今天也有努力",
  "我沒有在摸魚",
  "只是稍微休息",
  "本人非常冷靜",
  "今天不做決定",
  "先喝口水再說",
  "目前還算清醒",
  "正在處理人生",
  "等等應該會好",
  "今天先求穩",
  "沒有要吵架",
  "本人沒有劇本",
  "先從你好開始",
  "正在練習聊天",
  "今天可以認識",
  "先不要有壓力",
  "目前沒有尷尬",
  "我應該算好聊",
  "正在找話題",
  "今天話不算少",
  "慢熟但有上線",
  "本人有在回覆",
  "先交換廢話",
  "聊天隨緣就好",
  "今天適合聊天",
  "不急慢慢聊",
  "正在正常生活",
  "沒有神秘背景",
  "本人沒有包袱",
  "先不要查戶口",
  "今天不聊投資",
  "拒絕可疑連結",
  "驗證碼不外借",
  "匯款先不要",
  "投資請找別人",
  "本人沒有內線",
  "不提供銀行帳號",
  "今天只聊日常",
  "先聊點正常的",
  "目前拒絕詐騙",
  "安全聊天第一",
  "陌生連結等等看",
  "本人沒有比特幣",
  "沒有快速致富",
  "今天不借錢",
  "先不要談報酬率",
  "本人財務保密",
  "銀行正在休息",
  "錢包保持沉默",
  "週一拒絕上線",
  "週末比較好聊",
  "星期五有精神",
  "今天像星期一",
  "假日正在倒數",
  "下班才是開始",
  "午休短暫出現",
  "晚點可能睡著",
  "咖啡還沒生效",
  "正在等外送",
  "早餐直接跳過",
  "宵夜考慮中",
  "珍奶半糖去冰",
  "咖啡需要加倍",
  "今天想吃火鍋",
  "晚餐交給命運",
  "冰箱沒有答案",
  "外送正在路上",
  "今天不吃苦",
  "只想吃甜的",
  "薯條需要加大",
  "雞排保持完整",
  "香菜真的不用",
  "蔥可以再討論",
  "本人沒有偶包",
  "今天表情正常",
  "正在維持禮貌",
  "笑點有點奇怪",
  "有時候會句點",
  "偶爾突然安靜",
  "今天沒有冷場",
  "尷尬可以接受",
  "本人不太會開場",
  "熟了可能很吵",
  "目前還很客氣",
  "先維持形象",
  "三分鐘後熟悉",
  "社交模式啟動",
  "話題正在搜尋",
  "大腦正在連線",
  "訊號目前良好",
  "聊天室已開機",
  "系統正常運作",
  "本人版本穩定",
  "今天沒有更新",
  "人生尚在測試",
  "功能大致正常",
  "目前沒有當機",
  "載入速度普通",
  "情緒版本最新",
  "正在重新整理",
  "暫無重大異常",
  "一切依計畫外",
  "計畫正在生成",
  "今天隨機出現",
  "本人無特殊技能",
  "沒有隱藏任務",
  "主線暫時擱置",
  "支線正在聊天",
  "今天沒有彩蛋",
  "普通路人一位",
  "路過順便聊天",
  "今天沒有設定",
  "角色尚未命名",
  "本人不是NPC",
  "劇情自由發展",
  "沒有標準答案",
  "先不要下結論",
  "目前持保留意見",
  "這題晚點回答",
  "正在蒐集資料",
  "本人依法聊天",
  "已閱讀並同意",
  "目前符合規定",
  "聊天程序正常",
  "正在排隊發言",
  "本人無補充意見",
  "今天照常營業",
  "暫停嚴肅三秒",
  "認真但不完全",
  "正經中帶一點怪",
  "大致上很合理",
  "理論上沒問題",
  "原則上可以聊",
] as const;

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function getAnonymousAvatarOption(avatarId: string | null | undefined) {
  return ANONYMOUS_AVATAR_OPTIONS.find((option) => option.id === avatarId) ?? ANONYMOUS_AVATAR_OPTIONS[0];
}

export function isAnonymousAvatarId(value: string | null | undefined): value is AnonymousAvatarId {
  return ANONYMOUS_AVATAR_OPTIONS.some((option) => option.id === value);
}

export function generateAnonymousDisplayName() {
  const randomIndex = Math.floor(Math.random() * ANONYMOUS_NAME_OPTIONS.length);
  const name = ANONYMOUS_NAME_OPTIONS[randomIndex];
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info("[anonymous] random name generated", { name });
  }
  return name;
}

export function generateNextAnonymousDisplayName(currentName?: string | null, maxAttempts = 5) {
  const normalizedCurrent = normalizeText(currentName);
  let nextName = generateAnonymousDisplayName();

  for (let attempt = 0; attempt < maxAttempts && normalizedCurrent && nextName === normalizedCurrent; attempt += 1) {
    nextName = generateAnonymousDisplayName();
  }

  return nextName;
}

export function validateAnonymousDisplayName(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (normalized.length < 2) {
    return "匿名暱稱至少需要 2 個字。";
  }

  if (normalized.length > 24) {
    return "匿名暱稱請控制在 24 個字以內。";
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
  onboarding_completed?: boolean | null;
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

export function isAnonymousProfileReady(profile: AnonymousProfileLike | null | undefined) {
  if (!profile?.onboarding_completed || !profile.anonymous_mode_enabled) {
    return false;
  }

  const displayNameReady = !validateAnonymousDisplayName(profile.anonymous_display_name);
  const avatarReady = isAnonymousAvatarId(profile.anonymous_avatar);
  const cityReady = normalizeText(profile.city).length > 0;
  const identityReady = isIdentityLabelOption(normalizeIdentityLabel(profile.identity_label));
  const preferenceReady = getValidIdentityPreferenceValues(profile.interested_in_identity_labels).length > 0;
  const introReady = normalizeText(profile.anonymous_intro).length > 0;
  const interestsReady = Array.isArray(profile.interests) && profile.interests.length > 0;

  return displayNameReady && avatarReady && cityReady && identityReady && preferenceReady && (introReady || interestsReady);
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

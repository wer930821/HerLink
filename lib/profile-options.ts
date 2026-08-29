import { containsSensitiveContactInfo } from "./contact-safety";

export const IDENTITY_OPTIONS = ["T", "P", "H", "Other"] as const;
export const IDENTITY_LABELS: Record<(typeof IDENTITY_OPTIONS)[number], string> = {
  T: "T",
  P: "P",
  H: "H",
  Other: "其他",
};
export const ORIENTATION_OPTIONS = [
  "Lesbian",
  "Bisexual",
  "Pansexual",
  "Asexual",
  "Queer",
  "Questioning",
  "Other",
] as const;
export const ORIENTATION_LABELS: Record<(typeof ORIENTATION_OPTIONS)[number], string> = {
  Lesbian: "女同性戀",
  Bisexual: "雙性戀",
  Pansexual: "泛性戀",
  Asexual: "無性戀",
  Queer: "酷兒",
  Questioning: "不確定",
  Other: "其他",
};

export const RELATIONSHIP_GOAL_OPTIONS = [
  "Chat",
  "Friends",
  "TakeItSlow",
  "ChatPartner",
  "Dating",
  "Relationship",
  "LongTermPartner",
  "SameInterests",
  "KpopBuddy",
  "FoodBuddy",
  "MovieBuddy",
  "TravelBuddy",
  "GoWithFlow",
  "Other",
] as const;
export const RELATIONSHIP_GOAL_LABELS: Record<(typeof RELATIONSHIP_GOAL_OPTIONS)[number], string> = {
  Chat: "聊聊天",
  Friends: "認識新朋友",
  TakeItSlow: "慢慢認識",
  ChatPartner: "找固定聊天對象",
  Dating: "約會",
  Relationship: "穩定交往",
  LongTermPartner: "長期伴侶",
  SameInterests: "找同興趣的人",
  KpopBuddy: "找一起追星的人",
  FoodBuddy: "找飯友",
  MovieBuddy: "找電影咖",
  TravelBuddy: "找旅伴",
  GoWithFlow: "看緣分",
  Other: "其他",
};
export const relationshipGoalOptions = [...RELATIONSHIP_GOAL_OPTIONS];
export const interestOptions = ["閱讀", "電影", "運動", "美食", "旅行", "音樂", "藝術", "戶外"];
export const cityOptions = [
  "基隆市",
  "台北市",
  "新北市",
  "桃園市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "台中市",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "台南市",
  "高雄市",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "台東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;
export const identityLabelOptions = [...IDENTITY_OPTIONS];
export const orientationOptions = [...ORIENTATION_OPTIONS];
export const MAX_PROFILE_INTERESTS = 10;
export const identityOptionItems = IDENTITY_OPTIONS.map((value) => ({
  value,
  label: IDENTITY_LABELS[value],
}));

export function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeMultiValueInput(value: string) {
  return [...new Set(value
    .split(/[,\n、]/)
    .map((item) => normalizeText(item))
    .filter(Boolean))];
}

export function normalizeStringArray(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map((item) => normalizeText(item)).filter(Boolean))];
}

export function normalizeInterestValue(value: string | null | undefined) {
  return normalizeText(value ?? "");
}

export function normalizeInterestValues(values: string[] | null | undefined) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawValue of values ?? []) {
    const value = normalizeInterestValue(rawValue);
    if (!value) {
      continue;
    }

    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

export function isDefaultInterest(value: string | null | undefined) {
  const normalized = normalizeInterestValue(value);
  if (!normalized) {
    return false;
  }

  return interestOptions.some((option) => option.toLocaleLowerCase("en-US") === normalized.toLocaleLowerCase("en-US"));
}

export function getCustomInterests(values: string[] | null | undefined) {
  return normalizeInterestValues(values).filter((value) => !isDefaultInterest(value));
}

export function hasInterestCapacity(values: string[] | null | undefined) {
  return normalizeInterestValues(values).length < MAX_PROFILE_INTERESTS;
}

export function validateCustomInterest(
  value: string | null | undefined,
  existingValues: string[] | null | undefined = []
) {
  const normalized = normalizeInterestValue(value);
  if (!normalized) {
    return "請輸入想新增的興趣。";
  }

  if (normalized.length > 20) {
    return "自定義興趣請控制在 20 個字以內。";
  }

  const existing = new Set(
    normalizeInterestValues(existingValues).map((item) => item.toLocaleLowerCase("en-US"))
  );
  if (existing.has(normalized.toLocaleLowerCase("en-US"))) {
    return "這個興趣已經存在。";
  }

  if (containsSensitiveContactInfo(normalized)) {
    return "興趣請不要放聯絡方式，可以先在 HerLink 裡聊天。";
  }

  return null;
}

export function normalizeIdentityLabel(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "");
  if (!normalized) {
    return "";
  }

  const aliasMap: Record<string, (typeof IDENTITY_OPTIONS)[number]> = {
    t: "T",
    p: "P",
    h: "H",
    other: "Other",
    其他: "Other",
  };

  const canonical =
    aliasMap[normalized.toLowerCase()] ??
    aliasMap[normalized] ??
    IDENTITY_OPTIONS.find((option) => option.toLowerCase() === normalized.toLowerCase());

  return canonical ?? normalized;
}

export function normalizeOrientation(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "");
  if (!normalized) {
    return "";
  }

  const aliasMap: Record<string, (typeof ORIENTATION_OPTIONS)[number]> = {
    "女同志": "Lesbian",
    "女同性戀": "Lesbian",
    lesbian: "Lesbian",
    les: "Lesbian",
    "雙性戀": "Bisexual",
    bisexual: "Bisexual",
    bi: "Bisexual",
    "泛性戀": "Pansexual",
    pansexual: "Pansexual",
    pan: "Pansexual",
    "無性戀": "Asexual",
    asexual: "Asexual",
    ace: "Asexual",
    "酷兒": "Queer",
    queer: "Queer",
    "不確定": "Questioning",
    questioning: "Questioning",
    unsure: "Questioning",
    "其他": "Other",
    other: "Other",
  };

  const canonical = aliasMap[normalized.toLowerCase()] ?? aliasMap[normalized] ?? ORIENTATION_OPTIONS.find(
    (option) => option.toLowerCase() === normalized.toLowerCase()
  );

  return canonical ?? normalized;
}

export function normalizeRelationshipGoal(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "");
  if (!normalized) {
    return "";
  }

  const aliasMap: Record<string, (typeof RELATIONSHIP_GOAL_OPTIONS)[number]> = {
    "聊聊天": "Chat",
    chat: "Chat",
    "認識新朋友": "Friends",
    "交朋友": "Friends",
    friends: "Friends",
    "慢慢認識": "TakeItSlow",
    takeitslow: "TakeItSlow",
    "找固定聊天對象": "ChatPartner",
    chatpartner: "ChatPartner",
    "約會": "Dating",
    dating: "Dating",
    "穩定交往": "Relationship",
    relationship: "Relationship",
    "長期伴侶": "LongTermPartner",
    "長期關係": "LongTermPartner",
    longtermpartner: "LongTermPartner",
    "找同興趣的人": "SameInterests",
    sameinterests: "SameInterests",
    "找一起追星的人": "KpopBuddy",
    kpopbuddy: "KpopBuddy",
    "找飯友": "FoodBuddy",
    foodbuddy: "FoodBuddy",
    "找電影咖": "MovieBuddy",
    moviebuddy: "MovieBuddy",
    "找旅伴": "TravelBuddy",
    travelbuddy: "TravelBuddy",
    "看緣分": "GoWithFlow",
    "不確定": "GoWithFlow",
    gowithflow: "GoWithFlow",
    other: "Other",
    "其他": "Other",
  };

  const canonical =
    aliasMap[normalized.toLowerCase()] ??
    aliasMap[normalized] ??
    RELATIONSHIP_GOAL_OPTIONS.find((option) => option.toLowerCase() === normalized.toLowerCase());

  return canonical ?? normalized;
}

export function isIdentityLabelOption(value: string | null | undefined): value is (typeof IDENTITY_OPTIONS)[number] {
  return IDENTITY_OPTIONS.includes(value as (typeof IDENTITY_OPTIONS)[number]);
}

export function isOrientationOption(value: string | null | undefined): value is (typeof ORIENTATION_OPTIONS)[number] {
  return ORIENTATION_OPTIONS.includes(value as (typeof ORIENTATION_OPTIONS)[number]);
}

export function isRelationshipGoalOption(
  value: string | null | undefined
): value is (typeof RELATIONSHIP_GOAL_OPTIONS)[number] {
  return RELATIONSHIP_GOAL_OPTIONS.includes(value as (typeof RELATIONSHIP_GOAL_OPTIONS)[number]);
}

export function normalizeRelationshipGoals(values: string[] | null | undefined) {
  return [...new Set(
    normalizeStringArray(values)
      .map((value) => normalizeRelationshipGoal(value))
      .filter((value): value is (typeof RELATIONSHIP_GOAL_OPTIONS)[number] => isRelationshipGoalOption(value))
  )];
}

export function getRelationshipGoalDisplayLabel(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const normalized = normalizeRelationshipGoal(value);
  if (isRelationshipGoalOption(normalized)) {
    return RELATIONSHIP_GOAL_LABELS[normalized];
  }

  return value;
}

export function getRelationshipGoalDisplayLabels(
  relationshipGoals: string[] | null | undefined,
  customRelationshipGoal?: string | null
) {
  const labels = normalizeRelationshipGoals(relationshipGoals)
    .filter((goal) => goal !== "Other")
    .map((goal) => getRelationshipGoalDisplayLabel(goal));
  const custom = normalizeText(customRelationshipGoal ?? "");
  if (custom) {
    labels.push(custom);
  } else if (normalizeRelationshipGoals(relationshipGoals).includes("Other")) {
    labels.push(getRelationshipGoalDisplayLabel("Other"));
  }
  return labels;
}

export function validateCustomRelationshipGoal(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "");
  if (!normalized) {
    return "請輸入自定義交友目的。";
  }

  if (normalized.length < 2) {
    return "自定義交友目的至少需要 2 個字。";
  }

  if (normalized.length > 30) {
    return "自定義交友目的請控制在 30 個字以內。";
  }

  if (containsSensitiveContactInfo(normalized)) {
    return "交友目的請不要放聯絡方式，可以先在 HerLink 裡聊天。";
  }

  return null;
}

export function normalizeCustomRelationshipGoal(value: string | null | undefined) {
  return normalizeText(value ?? "");
}

export function buildRelationshipGoalPayload(
  relationshipGoals: string[] | null | undefined,
  customRelationshipGoal: string | null | undefined
) {
  const normalizedGoals = normalizeRelationshipGoals(relationshipGoals).filter((goal) => goal !== "Other");
  const normalizedCustomGoal = normalizeCustomRelationshipGoal(customRelationshipGoal);

  return {
    relationshipGoals: normalizedCustomGoal ? [...normalizedGoals, "Other"] : normalizedGoals,
    customRelationshipGoal: normalizedCustomGoal || null,
  };
}

export function getValidIdentityPreferenceValues(values: string[] | null | undefined) {
  return [...new Set(
    normalizeStringArray(values)
      .map((value) => normalizeIdentityLabel(value))
      .filter((value): value is (typeof IDENTITY_OPTIONS)[number] => isIdentityLabelOption(value))
  )];
}

export function isIdentityPreferenceComplete(
  input:
    | string[]
    | null
    | undefined
    | {
        interested_in_identity_labels?: string[] | null;
      }
) {
  const values = Array.isArray(input) ? input : input?.interested_in_identity_labels;
  return getValidIdentityPreferenceValues(values).length > 0;
}

export function isIdentitySetupComplete(
  input:
    | null
    | undefined
    | {
        identity_label?: string | null;
        interested_in_identity_labels?: string[] | null;
      }
) {
  return (
    isIdentityLabelOption(normalizeIdentityLabel(input?.identity_label)) &&
    isIdentityPreferenceComplete(input)
  );
}

export function getIdentityDisplayLabel(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  if (isIdentityLabelOption(value)) {
    return IDENTITY_LABELS[value];
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn("[identity] Unknown identity label value", { value });
  }

  return value;
}

export function getOrientationDisplayLabel(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const normalized = normalizeOrientation(value);
  if (isOrientationOption(normalized)) {
    return ORIENTATION_LABELS[normalized];
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn("[orientation] Unknown orientation value", { value });
  }

  return value;
}

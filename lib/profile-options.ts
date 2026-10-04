export const relationshipGoalOptions = ["長期關係", "短期關係", "交朋友", "不確定"];
export const interestOptions = ["閱讀", "電影", "運動", "美食", "旅行", "音樂", "藝術", "戶外"];

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


/**
 * Backward-compatible profile helpers used by the anonymous profile flow.
 * Keep these tolerant of legacy/free-text values so older profiles continue to load.
 */
export const identityLabelOptions = ["T", "P", "H", "不分", "其他"] as const;

export function normalizeIdentityLabel(value: string | null | undefined) {
  return normalizeText(value ?? "");
}

export function isIdentityLabelOption(value: string | null | undefined) {
  return normalizeIdentityLabel(value).length > 0;
}

export function getValidIdentityPreferenceValues(values: string[] | null | undefined) {
  return normalizeStringArray(values);
}

export function getIdentityDisplayLabel(value: string | null | undefined) {
  return normalizeIdentityLabel(value);
}

export function getRelationshipGoalDisplayLabels(
  values: string[] | null | undefined,
  customValue?: string | null
) {
  const normalized = normalizeStringArray(values);
  const custom = normalizeText(customValue ?? "");
  return custom && !normalized.includes(custom) ? [...normalized, custom] : normalized;
}

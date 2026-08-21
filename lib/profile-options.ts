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

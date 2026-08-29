function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function containsSensitiveContactInfo(value: string | null | undefined) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(normalized) ||
    /(?:\+886[-\s]?9\d{2}[-\s]?\d{3}[-\s]?\d{3}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})/.test(normalized) ||
    /\bline\s*(?:id|帳號)?\s*[:：]?\s*@?[a-z0-9._-]{3,}\b/i.test(normalized) ||
    /\b(?:ig|instagram)\s*(?:id|帳號|account)?\s*[:：]?\s*@?[a-z0-9._]{3,}\b/i.test(normalized) ||
    /\b(?:telegram|tg)\s*(?:id|帳號)?\s*[:：]?\s*@?[a-z0-9_]{3,}\b/i.test(normalized) ||
    /\bdiscord\s*(?:id|帳號)?\s*[:：]?\s*[a-z0-9_.]{2,}(?:#\d{4})?\b/i.test(normalized) ||
    /\bwechat\s*(?:id|帳號)?\s*[:：]?\s*[a-z0-9_-]{3,}\b/i.test(normalized)
  );
}

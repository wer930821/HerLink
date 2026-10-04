const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?886[-\s]?)?0?9\d{2}[-\s]?\d{3}[-\s]?\d{3}/;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const SOCIAL_CONTACT_PATTERN = /(?:line|telegram|wechat|whatsapp|ig|instagram|threads|discord)\s*[:：@]?\s*[a-z0-9._-]{3,}/i;

export function containsSensitiveContactInfo(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return false;
  return EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text) || URL_PATTERN.test(text) || SOCIAL_CONTACT_PATTERN.test(text);
}

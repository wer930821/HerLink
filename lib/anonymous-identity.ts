import { supabase } from "./supabase";
import { loadMyEffectiveProfile } from "./recovery";

const rpc = supabase as any;

// Ported from the web apps/web/lib/anonymous-rename.ts: the server RPC is
// the only source of truth for anonymous names, including its validation
// rules (2-12 chars after NFKC normalization) and error messages.
export const ANONYMOUS_NAME_MIN_LENGTH = 2;
export const ANONYMOUS_NAME_MAX_LENGTH = 12;

export type AnonymousNameResult =
  | { ok: true; name: string }
  | { ok: false; message: string };

const ERROR_MESSAGES = {
  NAME_TAKEN: "這個匿名名稱已經有人使用了，換一個吧",
  TOO_SHORT: "名稱至少需要 2 個字",
  TOO_LONG: "名稱最多 12 個字",
  INVALID_NAME: "名稱格式不正確",
  RANDOM_NAME_UNAVAILABLE: "目前沒有可用的隨機名稱，請稍後再試",
  NETWORK_ERROR: "網路連線失敗，請稍後再試",
} as const;

type AnonymousNameErrorCode = keyof typeof ERROR_MESSAGES;

function fail(code: AnonymousNameErrorCode): AnonymousNameResult {
  return { ok: false, message: ERROR_MESSAGES[code] };
}

export function normalizeAnonymousNameDraft(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function validateAnonymousNameDraft(
  value: string | null | undefined
): AnonymousNameErrorCode | null {
  if (typeof value !== "string" || /[\r\n\u0000-\u001F\u007F-\u009F]/u.test(value)) {
    return "INVALID_NAME";
  }
  const normalized = normalizeAnonymousNameDraft(value);
  if (normalized.length < ANONYMOUS_NAME_MIN_LENGTH) return "TOO_SHORT";
  if (normalized.length > ANONYMOUS_NAME_MAX_LENGTH) return "TOO_LONG";
  return null;
}

function summarizeRpcError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { message, details, hint, code } = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    return [message, details, hint, code]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");
  }
  return "";
}

function toRenameErrorCode(error: unknown): AnonymousNameErrorCode {
  const summary = summarizeRpcError(error);
  if (summary.includes("NAME_TAKEN")) return "NAME_TAKEN";
  if (summary.includes("TOO_SHORT")) return "TOO_SHORT";
  if (summary.includes("TOO_LONG")) return "TOO_LONG";
  if (summary.includes("INVALID_NAME")) return "INVALID_NAME";
  if (summary.includes("RANDOM_NAME_UNAVAILABLE")) return "RANDOM_NAME_UNAVAILABLE";
  // The name unique index is the only unique constraint on the rename path.
  if (summary.includes("23505") || /duplicate key/i.test(summary)) return "NAME_TAKEN";
  return "NETWORK_ERROR";
}

function readServerName(data: unknown): { status: string | null; name: string | null } {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { status: null, name: null };
  const record = row as { status?: unknown; anonymous_display_name?: unknown };
  const name =
    typeof record.anonymous_display_name === "string"
      ? record.anonymous_display_name.trim()
      : "";
  return {
    status: typeof record.status === "string" ? record.status : null,
    name: name.length > 0 ? name : null,
  };
}

export async function loadMyAnonymousName(): Promise<string | null> {
  const profile = await loadMyEffectiveProfile();
  return profile?.anonymous_display_name ?? null;
}

export async function setMyAnonymousName(rawName: string): Promise<AnonymousNameResult> {
  const invalid = validateAnonymousNameDraft(rawName);
  if (invalid) return fail(invalid);

  let result: { data: unknown; error: unknown };
  try {
    result = await rpc.rpc("set_my_anonymous_display_name", {
      p_name: normalizeAnonymousNameDraft(rawName),
    });
  } catch {
    return fail("NETWORK_ERROR");
  }

  if (result?.error) return fail(toRenameErrorCode(result.error));
  const response = readServerName(result?.data);
  if (response?.status === "NAME_TAKEN") return fail("NAME_TAKEN");
  if (!response?.name) return fail("NETWORK_ERROR");
  // The displayed name is always the one the server stored, never the draft.
  return { ok: true, name: response.name };
}

export async function rotateMyAnonymousName(): Promise<AnonymousNameResult> {
  // A concurrent rename can still win the unique-name race after the RPC's
  // candidate check; retry a few times like the web does.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let result: { data: unknown; error: unknown };
    try {
      result = await rpc.rpc("rotate_my_anonymous_display_name");
    } catch {
      return fail("NETWORK_ERROR");
    }
    if (result?.error) {
      const code = toRenameErrorCode(result.error);
      if (code === "NAME_TAKEN" && attempt < 4) continue;
      return fail(code);
    }
    const response = readServerName(result?.data);
    if (response?.status === "NAME_TAKEN" && attempt < 4) continue;
    if (!response?.name) return fail("NETWORK_ERROR");
    return { ok: true, name: response.name };
  }
  return fail("NAME_TAKEN");
}

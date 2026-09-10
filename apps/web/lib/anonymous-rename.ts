import { rotateMyAnonymousDisplayName, setMyAnonymousDisplayName } from "./supabase";

// The server RPC is the only source of truth for anonymous names. The Web layer
// never generates a random name locally and never writes profiles directly.
export const ANONYMOUS_DISPLAY_NAME_MIN_LENGTH = 2;
export const ANONYMOUS_DISPLAY_NAME_MAX_LENGTH = 12;

export type AnonymousRenameErrorCode =
  | "NAME_TAKEN"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_NAME"
  | "RANDOM_NAME_UNAVAILABLE"
  | "NETWORK_ERROR";

export type AnonymousRenameError = {
  code: AnonymousRenameErrorCode;
  message: string;
};

export type AnonymousNameResult =
  | { ok: true; name: string }
  | ({ ok: false } & AnonymousRenameError);

export type AnonymousNameRpcResponse = {
  data: { status?: string | null; anonymous_display_name?: string | null } | null;
  error: unknown;
};

export type AnonymousRenameClient = {
  setMyAnonymousDisplayName: (name: string) => Promise<AnonymousNameRpcResponse>;
  rotateMyAnonymousDisplayName: () => Promise<AnonymousNameRpcResponse>;
};

export function anonymousRenameErrorMessage(code: AnonymousRenameErrorCode) {
  switch (code) {
    case "NAME_TAKEN":
      return "這個匿名名稱已經有人使用了，換一個吧";
    case "TOO_SHORT":
      return "名稱至少需要 2 個字";
    case "TOO_LONG":
      return "名稱最多 12 個字";
    case "INVALID_NAME":
      return "名稱格式不正確";
    case "RANDOM_NAME_UNAVAILABLE":
      return "目前沒有可用的隨機名稱，請稍後再試";
    default:
      return "網路連線失敗，請稍後再試";
  }
}

export function anonymousRenameError(code: AnonymousRenameErrorCode): AnonymousRenameError {
  return { code, message: anonymousRenameErrorMessage(code) };
}

export function validateAnonymousDisplayNameDraft(value: string | null | undefined): AnonymousRenameErrorCode | null {
  if (typeof value !== "string" || /[\r\n\u0000-\u001F\u007F-\u009F]/u.test(value)) {
    return "INVALID_NAME";
  }

  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length < ANONYMOUS_DISPLAY_NAME_MIN_LENGTH) {
    return "TOO_SHORT";
  }

  if (normalized.length > ANONYMOUS_DISPLAY_NAME_MAX_LENGTH) {
    return "TOO_LONG";
  }

  return null;
}

function summarizeRpcError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

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

function toRenameError(error: unknown): AnonymousRenameError {
  const summary = summarizeRpcError(error);
  if (summary.includes("NAME_TAKEN")) return anonymousRenameError("NAME_TAKEN");
  if (summary.includes("TOO_SHORT")) return anonymousRenameError("TOO_SHORT");
  if (summary.includes("TOO_LONG")) return anonymousRenameError("TOO_LONG");
  if (summary.includes("INVALID_NAME")) return anonymousRenameError("INVALID_NAME");
  if (summary.includes("RANDOM_NAME_UNAVAILABLE")) return anonymousRenameError("RANDOM_NAME_UNAVAILABLE");

  // The name unique index is the only unique constraint on the rename path, so a
  // raw unique violation is still the "someone already uses this name" outcome.
  if (summary.includes("23505") || /duplicate key/i.test(summary)) {
    return anonymousRenameError("NAME_TAKEN");
  }

  return anonymousRenameError("NETWORK_ERROR");
}

function readServerName(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as { status?: unknown; anonymous_display_name?: unknown };
  const name = typeof record.anonymous_display_name === "string" ? record.anonymous_display_name.trim() : "";
  return {
    status: typeof record.status === "string" ? record.status : null,
    name: name.length > 0 ? name : null,
  };
}

function renameClient(client?: AnonymousRenameClient): AnonymousRenameClient {
  return client ?? { setMyAnonymousDisplayName, rotateMyAnonymousDisplayName };
}

export async function renameAnonymousDisplayName(
  rawName: string,
  client?: AnonymousRenameClient
): Promise<AnonymousNameResult> {
  const invalid = validateAnonymousDisplayNameDraft(rawName);
  if (invalid) {
    return { ok: false, ...anonymousRenameError(invalid) };
  }

  let result: AnonymousNameRpcResponse;
  try {
    result = await renameClient(client).setMyAnonymousDisplayName(rawName);
  } catch {
    return { ok: false, ...anonymousRenameError("NETWORK_ERROR") };
  }

  if (result?.error) {
    return { ok: false, ...toRenameError(result.error) };
  }

  const response = readServerName(result?.data);
  if (response?.status === "NAME_TAKEN") {
    return { ok: false, ...anonymousRenameError("NAME_TAKEN") };
  }

  if (!response?.name) {
    return { ok: false, ...anonymousRenameError("NETWORK_ERROR") };
  }

  // The displayed name is always the one the server stored, never the draft.
  return { ok: true, name: response.name };
}

export async function randomizeAnonymousDisplayName(
  client?: AnonymousRenameClient
): Promise<AnonymousNameResult> {
  let result: AnonymousNameRpcResponse;
  try {
    result = await renameClient(client).rotateMyAnonymousDisplayName();
  } catch {
    return { ok: false, ...anonymousRenameError("NETWORK_ERROR") };
  }

  if (result?.error) {
    return { ok: false, ...toRenameError(result.error) };
  }

  const response = readServerName(result?.data);
  if (!response?.name) {
    return { ok: false, ...anonymousRenameError("NETWORK_ERROR") };
  }

  return { ok: true, name: response.name };
}

export const RECOVERY_CODE_LENGTH = 8;
export const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const RECOVERY_ATTEMPT_LIMIT = 5;
export const RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const RECOVERY_LOCKOUT_MS = 30 * 60 * 1000;

export type RecoveryAttemptState = {
  attempts: number[];
  lockedUntil?: number | null;
};

export function normalizeRecoveryCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function generateRecoveryCode(): string {
  const output: string[] = [];
  const alphabetLength = RECOVERY_CODE_ALPHABET.length;
  const rejectionLimit = 256 - (256 % alphabetLength);

  while (output.length < RECOVERY_CODE_LENGTH) {
    const bytes = new Uint8Array(RECOVERY_CODE_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= rejectionLimit) continue;
      output.push(RECOVERY_CODE_ALPHABET[byte % alphabetLength]);
      if (output.length === RECOVERY_CODE_LENGTH) break;
    }
  }

  return output.join("");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function importRecoveryHmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("RECOVERY_CODE_HMAC_SECRET is required");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hashRecoveryCode(code: string, secret?: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  if (!new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`).test(normalized)) {
    throw new Error("Invalid recovery code format");
  }

  const hmacSecret = secret ?? Deno.env.get("RECOVERY_CODE_HMAC_SECRET") ?? "";
  const key = await importRecoveryHmacKey(hmacSecret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalized));
  return bytesToHex(new Uint8Array(signature));
}

export function recoveryCodeHint(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 2) return "••••••";
  return `••••••${normalized.slice(-2)}`;
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export async function verifyRecoveryCodeHash(
  code: string,
  expectedHash: string,
  secret?: string,
): Promise<boolean> {
  let actualHash: string;
  try {
    actualHash = await hashRecoveryCode(code, secret);
  } catch {
    return false;
  }
  const actualBytes = hexToBytes(actualHash);
  const expectedBytes = hexToBytes(expectedHash);
  if (!actualBytes || !expectedBytes) return false;
  return constantTimeEqual(actualBytes, expectedBytes);
}

export function isRecoveryAttemptRateLimited(
  state: RecoveryAttemptState,
  now = Date.now(),
): { limited: boolean; retryAfterMs: number; nextState: RecoveryAttemptState } {
  if (state.lockedUntil && state.lockedUntil > now) {
    return {
      limited: true,
      retryAfterMs: state.lockedUntil - now,
      nextState: state,
    };
  }

  const attempts = (state.attempts ?? []).filter((time) => now - time < RECOVERY_ATTEMPT_WINDOW_MS);
  if (attempts.length >= RECOVERY_ATTEMPT_LIMIT) {
    const lockedUntil = now + RECOVERY_LOCKOUT_MS;
    return {
      limited: true,
      retryAfterMs: RECOVERY_LOCKOUT_MS,
      nextState: { attempts, lockedUntil },
    };
  }

  return {
    limited: false,
    retryAfterMs: 0,
    nextState: { attempts, lockedUntil: null },
  };
}

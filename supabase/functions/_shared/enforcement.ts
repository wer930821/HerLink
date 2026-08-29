export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeIp(value: string) {
  return value.trim();
}

function getSecret(name: string) {
  const secret = Deno.env.get(name);
  if (!secret) {
    throw new Error(`Missing function secret: ${name}`);
  }
  return secret;
}

async function hmacSha256(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashCredentialEmail(email: string) {
  const normalized = normalizeEmail(email);
  return {
    normalized,
    hash: normalized ? await hmacSha256(normalized, getSecret("HERLINK_CREDENTIAL_PEPPER")) : null,
  };
}

export async function hashIpAddress(ipAddress: string | null) {
  const normalized = ipAddress ? normalizeIp(ipAddress) : "";
  return {
    normalized,
    hash: normalized ? await hmacSha256(normalized, getSecret("HERLINK_IP_HASH_SECRET")) : null,
  };
}

export function getRequestIp(req: Request) {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("fly-client-ip"),
    req.headers.get("x-forwarded-for"),
  ];

  for (const rawValue of candidates) {
    if (!rawValue) {
      continue;
    }

    const first = rawValue.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return null;
}

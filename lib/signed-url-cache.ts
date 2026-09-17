type SignedUrlCacheEntry = {
  signedUrl: string;
  expiresAt: number;
};

type SignedUrlCacheOptions = {
  now?: number;
  ttlMs: number;
  refreshThresholdMs: number;
};

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
const signingRequests = new Map<string, Promise<string>>();

function isUsable(
  entry: SignedUrlCacheEntry | undefined,
  now: number,
  refreshThresholdMs: number
): entry is SignedUrlCacheEntry {
  return entry !== undefined && entry.expiresAt - now > refreshThresholdMs;
}

export async function getCachedSignedUrl(
  path: string,
  sign: () => Promise<string>,
  { now = Date.now(), ttlMs, refreshThresholdMs }: SignedUrlCacheOptions
) {
  const cached = signedUrlCache.get(path);
  if (isUsable(cached, now, refreshThresholdMs)) {
    return cached.signedUrl;
  }

  const inFlight = signingRequests.get(path);
  if (inFlight) {
    return inFlight;
  }

  const request = sign()
    .then((signedUrl) => {
      signedUrlCache.set(path, { signedUrl, expiresAt: now + ttlMs });
      return signedUrl;
    })
    .finally(() => {
      signingRequests.delete(path);
    });

  signingRequests.set(path, request);
  return request;
}

export function invalidateCachedSignedUrl(path: string) {
  signedUrlCache.delete(path);
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
  signingRequests.clear();
}

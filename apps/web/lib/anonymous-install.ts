const ANONYMOUS_INSTALLATION_ID_KEY = "herlink.web.anonymous.installation_id";

function createAnonymousInstallationId() {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `anon_${uuid}`;
}

export function getAnonymousInstallationId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const existing = window.localStorage.getItem(ANONYMOUS_INSTALLATION_ID_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }

    const next = createAnonymousInstallationId();
    window.localStorage.setItem(ANONYMOUS_INSTALLATION_ID_KEY, next);
    return next;
  } catch {
    return null;
  }
}

export function clearAnonymousInstallationId() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(ANONYMOUS_INSTALLATION_ID_KEY);
  } catch {
    // Ignore storage failures; callers will fall back to a fresh ID next time.
  }
}

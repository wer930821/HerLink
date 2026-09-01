export type NavigationDiagnosticEvent = {
  timestamp: string;
  pathname: string;
  event: string;
  reason: string | null;
  redirectReason: string | null;
  authState: "loading" | "ready" | "missing";
  sessionState: "loading" | "active" | "ended" | "missing" | "error";
  routeSessionIdShort: string | null;
  serverSessionIdShort: string | null;
  bootstrapRunId: number | null;
  activeSessionResult?: "RPC SUCCESS" | "NOT FOUND" | "RPC ERROR";
  authUserIdShort?: string | null;
  activeSessionError?: string | null;
};

const STORAGE_KEY = "herlink-navigation-debug";

export function getShortId(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function isNavigationDebugEnabled() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

export function withNavigationDebugParam(pathname: string) {
  return isNavigationDebugEnabled() ? `${pathname}?debug=1` : pathname;
}

export function recordNavigationDiagnostic(event: NavigationDiagnosticEvent) {
  if (typeof window === "undefined") return;

  const safeEvent = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    redirectReason: event.redirectReason ?? event.reason ?? null,
  };

  try {
    const previous = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
    const next = [...(Array.isArray(previous) ? previous : []), safeEvent].slice(-50);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics must never affect navigation.
  }

  console.info("[herlink] navigation diagnostic", safeEvent);
}

export function readLastNavigationDiagnostic(): NavigationDiagnosticEvent | null {
  if (typeof window === "undefined") return null;

  try {
    const previous = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(previous) || previous.length === 0) return null;
    return previous[previous.length - 1] as NavigationDiagnosticEvent;
  } catch {
    return null;
  }
}

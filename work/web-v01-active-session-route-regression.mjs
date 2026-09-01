import fs from "fs";
import path from "path";

function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

async function simulateRouteLifecycle({
  authDelayMs = 0,
  sessionDelayMs = 0,
  authMissing = false,
  sessionMissing = false,
  temporarySessionFailureCount = 0,
  timeoutMs = 2500,
}) {
  const redirects = [];
  let pathname = "/session/session-123";
  let authReady = false;
  let profileReady = false;
  let sessionReady = false;
  let sessionFetchAttempts = 0;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForCurrentSession = async () => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (authReady) {
        return authMissing ? null : { user: { id: "user-123" } };
      }

      await wait(100);
      if (Date.now() - start >= authDelayMs) {
        authReady = true;
      }
    }

    return authMissing ? null : { user: { id: "user-123" } };
  };

  const loadMyProfile = async () => {
    if (!authReady || authMissing) {
      return null;
    }

    profileReady = true;
    return { data: { id: "user-123", anonymous_mode_enabled: true, onboarding_completed: true } };
  };

  const loadMyRandomSession = async () => {
    if (!profileReady || sessionMissing) {
      return { data: null, error: null };
    }

    sessionFetchAttempts += 1;
    if (sessionFetchAttempts <= temporarySessionFailureCount) {
      return { data: null, error: { message: "temporary fetch error" } };
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < sessionDelayMs) {
      await wait(50);
    }

    sessionReady = true;
    return { data: { id: "session-123", status: "active" }, error: null };
  };

  const auth = await waitForCurrentSession();
  if (!auth) {
    redirects.push("/");
    return { pathname: "/", redirects, authReady, profileReady, sessionReady };
  }

  const profile = await loadMyProfile();
  if (!profile) {
    redirects.push("/onboarding");
    return { pathname: "/onboarding", redirects, authReady, profileReady, sessionReady };
  }

  let session = null;
  let temporarySessionError = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await loadMyRandomSession();
    if (result.error) {
      temporarySessionError = true;
      await wait(100);
      continue;
    }

    session = result.data;
    temporarySessionError = false;
    break;
  }

  if (!session) {
    if (temporarySessionError) {
      return { pathname, redirects, authReady, profileReady, sessionReady, temporarySessionError };
    }

    redirects.push("/");
    return { pathname: "/", redirects, authReady, profileReady, sessionReady, temporarySessionError };
  }

  pathname = `/session/${session.id}`;
  return { pathname, redirects, authReady, profileReady, sessionReady };
}

const homePage = read("apps/web/app/page.tsx");
const sessionPage = read("apps/web/app/session/[id]/page.tsx");

expect(
  homePage.includes("router.push(withNavigationDebugParam(`/session/${state.activeSession.id}`))"),
  "homepage continue should push session route"
);
expect(homePage.includes('type="button"'), "homepage continue buttons should be explicit buttons");
expect(homePage.includes("recordNavigationDiagnostic(nextEvent)"), "homepage continue should record navigation diagnostics");
expect(homePage.includes("withNavigationDebugParam(`/session/${state.activeSession.id}`)"), "homepage should preserve debug param");
expect(sessionPage.includes("waitForCurrentSession(2500, 100)"), "session bootstrap should wait for restored auth");
expect(sessionPage.includes('sessionBootstrapStateRef.current = "loading"'), "session bootstrap state should be explicit");
expect(sessionPage.includes('goHome("SESSION_CONFIRMED_MISSING"'), "session confirmed missing should be reason-coded");
expect(sessionPage.includes('reason: "BOOTSTRAP_EXCEPTION"'), "bootstrap exception should be diagnostic-only");
expect(sessionPage.includes("聊天室載入失敗，正在重試。"), "temporary bootstrap failure should show retry notice");

const diagnostics = read("apps/web/lib/navigation-diagnostics.ts");
expect(diagnostics.includes('"herlink-navigation-debug"'), "diagnostics should use sessionStorage debug key");
expect(diagnostics.includes("window.sessionStorage.setItem"), "diagnostics should persist to sessionStorage");
expect(diagnostics.includes("redirectReason"), "diagnostics should save redirect reason");

const slowRoute = await simulateRouteLifecycle({ authDelayMs: 500, sessionDelayMs: 500 });
expect(slowRoute.pathname === "/session/session-123", "slow auth/session restore should stay on session route");
expect(slowRoute.redirects.length === 0, "slow auth/session restore should not bounce home");

const temporaryFailure = await simulateRouteLifecycle({ temporarySessionFailureCount: 1 });
expect(temporaryFailure.pathname === "/session/session-123", "temporary session fetch failure should recover");
expect(temporaryFailure.redirects.length === 0, "temporary session fetch failure should not bounce home");

const persistentTemporaryFailure = await simulateRouteLifecycle({ temporarySessionFailureCount: 3 });
expect(persistentTemporaryFailure.pathname === "/session/session-123", "persistent temporary fetch failure should stay on session route");
expect(persistentTemporaryFailure.redirects.length === 0, "persistent temporary fetch failure should not be treated as missing");

const authMissing = await simulateRouteLifecycle({ authMissing: true });
expect(authMissing.pathname === "/", "missing auth should return home");
expect(authMissing.redirects[0] === "/", "missing auth should redirect home");

const sessionMissing = await simulateRouteLifecycle({ sessionMissing: true });
expect(sessionMissing.pathname === "/", "missing session should return home");
expect(sessionMissing.redirects[0] === "/", "missing session should redirect home");

console.log(JSON.stringify({ ok: true }));

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
  timeoutMs = 2500,
}) {
  const redirects = [];
  let pathname = "/session/session-123";
  let authReady = false;
  let profileReady = false;
  let sessionReady = false;

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
      return null;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < sessionDelayMs) {
      await wait(50);
    }

    sessionReady = true;
    return { id: "session-123", status: "active" };
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

  const session = await loadMyRandomSession();
  if (!session) {
    redirects.push("/");
    return { pathname: "/", redirects, authReady, profileReady, sessionReady };
  }

  pathname = `/session/${session.id}`;
  return { pathname, redirects, authReady, profileReady, sessionReady };
}

const homePage = read("apps/web/app/page.tsx");
const sessionPage = read("apps/web/app/session/[id]/page.tsx");

expect(homePage.includes("router.push(`/session/${state.activeSession.id}`)"), "homepage continue should push session route");
expect(homePage.includes('type="button"'), "homepage continue buttons should be explicit buttons");
expect(sessionPage.includes("waitForCurrentSession(2500, 100)"), "session bootstrap should wait for restored auth");
expect(sessionPage.includes('sessionBootstrapStateRef.current = "loading"'), "session bootstrap state should be explicit");

const slowRoute = await simulateRouteLifecycle({ authDelayMs: 500, sessionDelayMs: 500 });
expect(slowRoute.pathname === "/session/session-123", "slow auth/session restore should stay on session route");
expect(slowRoute.redirects.length === 0, "slow auth/session restore should not bounce home");

const authMissing = await simulateRouteLifecycle({ authMissing: true });
expect(authMissing.pathname === "/", "missing auth should return home");
expect(authMissing.redirects[0] === "/", "missing auth should redirect home");

const sessionMissing = await simulateRouteLifecycle({ sessionMissing: true });
expect(sessionMissing.pathname === "/", "missing session should return home");
expect(sessionMissing.redirects[0] === "/", "missing session should redirect home");

console.log(JSON.stringify({ ok: true }));

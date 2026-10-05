/* HerLink Web Push service worker (V3) */
const HERLINK_ORIGIN = self.location.origin;
const HERLINK_SW_VERSION = "2026-10-05.3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // HerLink does not provide an offline shell. Remove any caches left by
    // previous PWA/service-worker versions so stale HTML/CSS cannot survive a
    // production deployment.
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "herlink-sw-activated", version: HERLINK_SW_VERSION });
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "herlink-skip-waiting") {
    self.skipWaiting();
  }
});

function safeTargetUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  try {
    const url = new URL(raw, HERLINK_ORIGIN);
    if (url.origin !== HERLINK_ORIGIN) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

async function reportPushDiagnostic(type, detail) {
  console.info("[herlink-sw]", type, detail || "");
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "herlink-push-diagnostic", event: type, detail: detail || null });
}

self.addEventListener("push", (event) => {
  let data = null;
  try { data = event.data ? event.data.json() : null; } catch { data = null; }
  if (!data || typeof data !== "object") data = { title: "HerLink", body: "你有新的通知", target_url: "/" };

  const title = typeof data.title === "string" && data.title ? data.title : "HerLink";
  const body = typeof data.body === "string" && data.body ? data.body : "你有新的通知";
  const targetUrl = safeTargetUrl(data.target_url);
  const sessionId = typeof data.session_id === "string" ? data.session_id : null;

  event.waitUntil((async () => {
    await reportPushDiagnostic("sw_push_received");
    try {
      await self.registration.showNotification(title, { body, tag: sessionId ? `herlink:${sessionId}` : "herlink:general", data: { url: targetUrl } });
      await reportPushDiagnostic("sw_notification_shown");
    } catch (error) {
      await reportPushDiagnostic("sw_notification_error", error && error.name ? `${error.name}: ${error.message || ""}`.slice(0, 160) : "unknown");
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeTargetUrl(event.notification.data && typeof event.notification.data.url === "string" ? event.notification.data.url : "/");
  event.waitUntil((async () => {
    const targetUrl = new URL(target, HERLINK_ORIGIN).href;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (client.url === targetUrl) { await client.focus(); return; }
    }
    for (const client of clients) {
      let clientOrigin = null;
      try { clientOrigin = new URL(client.url).origin; } catch { clientOrigin = null; }
      if (clientOrigin === HERLINK_ORIGIN) { await client.navigate(target); await client.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "herlink-push-subscription-changed" });
  })());
});

import { supabase } from "./supabase";

export type PushPermissionState = "unsupported" | "default" | "granted" | "denied";

const SUBSCRIPTION_CHANGE_MESSAGE = "herlink-push-subscription-changed";

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
}

export function isIosSafariWithoutStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!ios) return false;
  const standalone =
    "standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true;
  return !standalone;
}

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
}

export function getNotificationPermission(): PushPermissionState {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return "default";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function subscriptionUsesVapidKey(subscription: PushSubscription, publicKey: string): boolean {
  const actual = subscription.options.applicationServerKey;
  if (!actual || !publicKey) return false;
  const expected = urlBase64ToUint8Array(publicKey);
  const received = new Uint8Array(actual);
  return received.length === expected.length && received.every((value, index) => value === expected[index]);
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function registerSubscriptionOnServer(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON();
  const endpoint = json.endpoint ?? "";
  const keys = json.keys as { p256dh?: string; auth?: string } | undefined;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return false;
  }

  const { error } = await supabase.rpc("register_web_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) || null : null,
  });

  return !error;
}

export async function syncPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (Notification.permission !== "granted") return false;
  return subscribeAndRegister();
}

async function subscribeAndRegister(): Promise<boolean> {
  const registration = await registerPushServiceWorker();
  if (!registration) return false;

  const publicKey = getVapidPublicKey();
  if (!publicKey) return false;

  const existing = await registration.pushManager.getSubscription();
  if (existing && subscriptionUsesVapidKey(existing, publicKey)) {
    return registerSubscriptionOnServer(existing);
  }

  if (existing) {
    await existing.unsubscribe();
  }

  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return registerSubscriptionOnServer(subscription);
  } catch {
    return false;
  }
}

async function revokeExistingSubscription(): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await registerPushServiceWorker();
  if (!registration) return;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.toJSON().endpoint;
  if (endpoint) {
    await supabase.rpc("revoke_web_push_subscription_by_endpoint", {
      p_endpoint: endpoint,
    });
  }
  await subscription.unsubscribe().catch(() => undefined);
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (!isPushSupported()) return "unsupported";

  if (Notification.permission === "granted") {
    const ok = await subscribeAndRegister();
    return ok ? "granted" : "default";
  }

  if (Notification.permission === "denied") {
    await revokeExistingSubscription();
    return "denied";
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "default";
  }

  const ok = await subscribeAndRegister();
  return ok ? "granted" : "default";
}

export async function listenForSubscriptionChanges(): Promise<void> {
  if (!isPushSupported()) return;

  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data && data.type === SUBSCRIPTION_CHANGE_MESSAGE) {
      void syncPushSubscription();
    }
  });
}

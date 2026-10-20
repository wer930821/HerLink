import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const rpc = supabase as any;

const INSTANCE_ID_KEY = "herlink:online-instance-id";
const WEB_ORIGIN = "https://her-link-ten.vercel.app";

function createInstanceId(): string {
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const variant = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

let cachedInstanceId: string | null = null;

export async function getPresenceInstanceId(): Promise<string> {
  if (cachedInstanceId) return cachedInstanceId;
  const existing = await AsyncStorage.getItem(INSTANCE_ID_KEY).catch(() => null);
  if (existing) {
    cachedInstanceId = existing;
    return existing;
  }
  const instanceId = createInstanceId();
  cachedInstanceId = instanceId;
  await AsyncStorage.setItem(INSTANCE_ID_KEY, instanceId).catch(() => undefined);
  return instanceId;
}

/**
 * Mirrors the web home presence system (apps/web/lib/realtime-presence.ts):
 * the server tracks online activity through the touch_online_activity RPC
 * heartbeat, and the visible counts come from get_online_user_count and
 * get_public_waiting_count.
 */
export async function touchOnlineActivity(): Promise<void> {
  const instanceId = await getPresenceInstanceId();
  await rpc.rpc("touch_online_activity", { p_instance_id: instanceId });
}

export async function getOnlineUserCount(): Promise<number | null> {
  const { data, error } = await rpc.rpc("get_online_user_count");
  if (error || typeof data !== "number") return null;
  return data;
}

export async function getPublicWaitingCount(): Promise<number | null> {
  const { data, error } = await rpc.rpc("get_public_waiting_count");
  if (error || typeof data !== "number") return null;
  return data;
}

/**
 * Same handoff link the web home builds for 跨瀏覽器續聊: the current
 * session tokens in the URL fragment of the web /auth/handoff page, so the
 * same anonymous identity continues in another browser.
 */
export function buildBrowserHandoffUrl(session: Session, nextPath = "/"): string {
  const next = nextPath.startsWith("/") ? nextPath : "/";
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    next,
  });
  return `${WEB_ORIGIN}/auth/handoff#${fragment.toString()}`;
}

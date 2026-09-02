import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { getDeviceHash } from "./device";

export type HerLinkPushData = {
  event_type?: string;
  session_id?: string;
  target_url?: string;
};

Notifications.setNotificationHandler({
  // Active chat already receives Realtime updates; never duplicate it with an OS alert.
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
}

export async function registerNativePushToken() {
  if (Platform.OS === "web" || !projectId()) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("herlink-chat", {
      name: "HerLink 聊天通知",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }

  const permissions = await Notifications.getPermissionsAsync();
  const permission = permissions.granted ? permissions : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
  await syncNativePushToken(token);
  return token;
}

export async function syncNativePushToken(token: string) {
  const deviceHash = await getDeviceHash();
  const { error } = await (supabase as any).rpc("create_or_update_push_token", {
    p_expo_push_token: token,
    p_device_hash: deviceHash,
    p_platform: Platform.OS === "android" ? "android" : "ios",
  });
  if (error) throw error;
  return token;
}

export async function disableNativePushToken(token: string | null | undefined) {
  if (!token) return;
  const { error } = await (supabase as any).rpc("disable_push_token", { p_expo_push_token: token });
  if (error) throw error;
}

export function pushNavigationSessionId(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as HerLinkPushData;
  return typeof data.session_id === "string" ? data.session_id : null;
}

export type PushNavigationTarget =
  | { kind: "random_session"; sessionId: string }
  | { kind: "match_chat"; matchId: string }
  | { kind: "home" };

export function pushNavigationTarget(
  response: Notifications.NotificationResponse
): PushNavigationTarget {
  const data = response.notification.request.content.data as HerLinkPushData;
  const targetUrl = typeof data.target_url === "string" ? data.target_url : "";
  const randomPrefix = "/random-session/";
  const chatPrefix = "/chat/";

  if (targetUrl.startsWith(randomPrefix)) {
    const sessionId = decodeURIComponent(targetUrl.slice(randomPrefix.length));
    if (sessionId) {
      return { kind: "random_session", sessionId };
    }
  }

  if (targetUrl.startsWith(chatPrefix)) {
    const matchId = decodeURIComponent(targetUrl.slice(chatPrefix.length));
    if (matchId) {
      return { kind: "match_chat", matchId };
    }
  }

  const sessionId = pushNavigationSessionId(response);
  if (sessionId) {
    return { kind: "random_session", sessionId };
  }

  return { kind: "home" };
}

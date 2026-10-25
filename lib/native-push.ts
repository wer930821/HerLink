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
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
}

export type PushRegistrationState =
  | "not_attempted"
  | "no_project_id"
  | "permission_denied"
  | "token_ok"
  | "failed";

export type PushRegistrationStatus = {
  state: PushRegistrationState;
  projectIdPresent: boolean;
  permissionGranted: boolean | null;
  step: string | null;
  error: string | null;
  tokenPrefix: string | null;
  updatedAt: string | null;
};

// 推播 token 註冊失敗時，登入流程只記 console.warn，使用者看不到原因，
// 從 2026-10-07 之後也沒有任何新 token 註冊成功過，卻無從知道是哪一步
// 卡住。把每一步的結果記在這裡，讓安全與設定頁可以顯示出來給使用者截圖。
let lastPushRegistrationStatus: PushRegistrationStatus = {
  state: "not_attempted",
  projectIdPresent: false,
  permissionGranted: null,
  step: null,
  error: null,
  tokenPrefix: null,
  updatedAt: null,
};

export function getNativePushRegistrationStatus(): PushRegistrationStatus {
  return { ...lastPushRegistrationStatus };
}

function errorMessage(error: unknown): string {
  // 208 實測教訓：Supabase RPC 錯誤是普通物件、不是 Error，String(error)
  // 只會得到「[object Object]」，完全看不出原因。先取 message／code／
  // details／hint，再用 JSON 兜底，並截斷避免畫面被長錯誤塞爆。
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = ["message", "code", "details", "hint"]
      .map((key) => (typeof record[key] === "string" && record[key] ? `${key}=${record[key]}` : null))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      return "未知錯誤物件";
    }
  }
  return String(error);
}

export async function registerNativePushToken() {
  const pid = projectId();
  if (Platform.OS === "web" || !pid) {
    lastPushRegistrationStatus = {
      state: "no_project_id",
      projectIdPresent: Boolean(pid),
      permissionGranted: null,
      step: "project_id",
      error: Platform.OS === "web" ? "web 平台不註冊原生推播" : "找不到 Expo 專案 ID（eas.projectId）",
      tokenPrefix: null,
      updatedAt: new Date().toISOString(),
    };
    return null;
  }

  let step = "channel";
  let permissionGranted: boolean | null = null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("herlink-chat", {
        name: "HerLink 聊天通知",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180, 120, 180],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    step = "permission";
    const permissions = await Notifications.getPermissionsAsync();
    const permission = permissions.granted ? permissions : await Notifications.requestPermissionsAsync();
    permissionGranted = permission.granted;
    if (!permission.granted) {
      lastPushRegistrationStatus = {
        state: "permission_denied",
        projectIdPresent: true,
        permissionGranted: false,
        step,
        error: "通知權限未授權",
        tokenPrefix: null,
        updatedAt: new Date().toISOString(),
      };
      return null;
    }

    step = "expo_token";
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: pid })).data;
    step = "rpc_sync";
    await syncNativePushToken(token);
    lastPushRegistrationStatus = {
      state: "token_ok",
      projectIdPresent: true,
      permissionGranted: true,
      step: "done",
      error: null,
      // 只顯示前綴，不在畫面上顯示完整 token。
      tokenPrefix: token.slice(0, 24),
      updatedAt: new Date().toISOString(),
    };
    return token;
  } catch (error) {
    lastPushRegistrationStatus = {
      state: "failed",
      projectIdPresent: true,
      permissionGranted,
      step,
      error: errorMessage(error).slice(0, 500),
      tokenPrefix: null,
      updatedAt: new Date().toISOString(),
    };
    throw error;
  }
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
  | { kind: "mailbox" }
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

  if (data.event_type === "station_mail_reply" || targetUrl === "/mailbox") {
    return { kind: "mailbox" };
  }

  const sessionId = pushNavigationSessionId(response);
  if (sessionId) {
    return { kind: "random_session", sessionId };
  }

  return { kind: "home" };
}

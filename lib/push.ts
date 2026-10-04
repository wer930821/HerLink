import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { getDeviceHash } from "./device";
import { supabase } from "./supabase";

const ADMIN_CHANNEL_ID = "admin-mail";

let registrationPromise: Promise<string | null> | null = null;

async function doRegisterPushNotifications() {
  if (Platform.OS === "web") return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ADMIN_CHANNEL_ID, {
      name: "站長信箱",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 120, 250],
      sound: "default",
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("找不到 Expo projectId，無法註冊推播。");

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!token || !/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token)) {
    throw new Error("取得的 Expo Push Token 無效。");
  }

  const deviceHash = await getDeviceHash();
  const { error } = await supabase.rpc("create_or_update_push_token", {
    p_expo_push_token: token,
    p_device_hash: deviceHash,
    p_platform: Platform.OS,
  });
  if (error) throw error;

  try {
    await supabase.functions.invoke("send-push", {
      body: { eventType: "admin_mail", limit: 20 },
    });
  } catch (error) {
    console.warn("[push] 補送站長信箱通知失敗", error);
  }

  return token;
}

export async function registerPushNotifications() {
  if (registrationPromise) return registrationPromise;

  registrationPromise = doRegisterPushNotifications().finally(() => {
    registrationPromise = null;
  });
  return registrationPromise;
}

export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export function addPushRegistrationLifecycleListener(onError?: (error: unknown) => void) {
  const register = () => {
    void registerPushNotifications().catch((error) => {
      console.error("[push] 註冊通知失敗", error);
      onError?.(error);
    });
  };

  register();

  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") register();
  });
  const tokenSubscription = Notifications.addPushTokenListener(() => {
    register();
  });

  return {
    remove() {
      appStateSubscription.remove();
      tokenSubscription.remove();
    },
  };
}

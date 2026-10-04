import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { getDeviceHash } from "./device";
import { supabase } from "./supabase";

const ADMIN_CHANNEL_ID = "admin-mail";

let registrationPromise: Promise<string | null> | null = null;\n\nasync function doRegisterPushNotifications() {
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
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("找不到 Expo projectId，無法註冊推播。");

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;\n  if (!token || !/^(ExponentPushToken|ExpoPushToken)\\[[^\\]]+\\]$/.test(token)) {\n    throw new Error("取得的 Expo Push Token 無效。");\n  }
  const deviceHash = await getDeviceHash();
  const { error } = await supabase.rpc("create_or_update_push_token", {
    p_expo_push_token: token,
    p_device_hash: deviceHash,
    p_platform: Platform.OS,
  });
  if (error) throw error;
  return token;
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


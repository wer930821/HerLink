import { Stack, useRouter } from "expo-router";
import { AuthProvider, useAuth } from "../context/auth";
import { useEffect, useRef } from "react";
import { SplashScreen } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Alert, AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { pushNavigationTarget, syncNativePushToken } from "../lib/native-push";
import { downloadAndInstallHerLinkUpdate, getAvailableHerLinkUpdate } from "../lib/app-update";
import Constants from "expo-constants";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const updateCheckBusyRef = useRef(false);
  const lastUpdateCheckRef = useRef(0);
  const notifiedUpdateVersionRef = useRef<number | null>(null);
  const playStoreBuild = Constants.expoConfig?.extra?.playStoreBuild === true;

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  useEffect(() => {
    if (__DEV__ || Platform.OS !== "android" || playStoreBuild) return;

    let disposed = false;
    const checkUpdate = async () => {
      const now = Date.now();
      if (updateCheckBusyRef.current || now - lastUpdateCheckRef.current < 60_000) return;
      updateCheckBusyRef.current = true;
      lastUpdateCheckRef.current = now;
      try {
        const info = await getAvailableHerLinkUpdate();
        if (!info || disposed || notifiedUpdateVersionRef.current === info.versionCode) return;
        notifiedUpdateVersionRef.current = info.versionCode;
        Alert.alert("HerLink 有新版本", `版本 ${info.versionName} 已可更新。`, [
          { text: "稍後", style: "cancel" },
          {
            text: "立即更新",
            onPress: () => {
              void downloadAndInstallHerLinkUpdate(info).catch(() => {
                Alert.alert("更新失敗", "新版下載或驗證失敗，請稍後再試。");
              });
            },
          },
        ]);
      } catch {
        // 更新檢查失敗不影響正常聊天。
      } finally {
        updateCheckBusyRef.current = false;
      }
    };

    void checkUpdate();
    const timer = setInterval(() => void checkUpdate(), 60_000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        lastUpdateCheckRef.current = 0;
        void checkUpdate();
      }
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [playStoreBuild]);

  useEffect(() => {
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void syncNativePushToken(token.data).catch((error) => console.warn("Native push token refresh failed", error));
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = pushNavigationTarget(response);
      if (session && target.kind === "random_session") {
        router.replace({ pathname: "/random-session/[sessionId]", params: { sessionId: target.sessionId } } as never);
      } else if (session && target.kind === "mailbox") {
        router.replace("/mailbox" as never);
      } else {
        router.replace("/(tabs)");
      }
    });
    return () => {
      tokenSubscription.remove();
      responseSubscription.remove();
    };
  }, [router, session]);

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {session ? <Stack.Screen name="(tabs)" /> : <Stack.Screen name="login" />}
      <Stack.Screen name="random-session/[sessionId]" />
      <Stack.Screen name="modal" options={{ presentation: "modal", headerShown: true, title: "視窗" }} />
      <Stack.Screen name="privacy" options={{ headerShown: true, title: "隱私權政策" }} />
      <Stack.Screen name="terms" options={{ headerShown: true, title: "服務條款" }} />
      <Stack.Screen name="community-guidelines" options={{ headerShown: true, title: "社群守則" }} />
      <Stack.Screen name="recovery" options={{ headerShown: true, title: "找回聊天室" }} />
      <Stack.Screen name="support" options={{ headerShown: true, title: "支持 HerLink" }} />
      <Stack.Screen name="mailbox" options={{ headerShown: true, title: "站長信箱" }} />
      <Stack.Screen name="collection" options={{ headerShown: true, title: "彩蛋圖鑑" }} />
      <Stack.Screen name="chats" options={{ headerShown: true, title: "我的聊天" }} />
      <Stack.Screen name="account-signup" options={{ headerShown: true, title: "申請帳號" }} />
      <Stack.Screen name="account-login" options={{ headerShown: true, title: "登入帳號" }} />
      <Stack.Screen name="account-forgot" options={{ headerShown: true, title: "忘記密碼" }} />
    </Stack>
  );
}

import { Stack, useRouter } from "expo-router";
import { AuthProvider, useAuth } from "../context/auth";
import { useEffect, useRef } from "react";
import { SplashScreen } from "expo-router";
import { Alert, AppState, Platform } from "react-native";
import { colors } from "../theme/colors";
import * as Notifications from "expo-notifications";
import { pushNavigationTarget, syncNativePushToken } from "../lib/native-push";
import { downloadAndInstallHerLinkUpdate, getAvailableHerLinkUpdate } from "../lib/app-update";

// Prevent the splash screen from auto-hiding before asset loading is complete.
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

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  useEffect(() => {
    if (__DEV__ || Platform.OS !== "android") return;

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
        Alert.alert(
          "HerLink 有新版本",
          `版本 ${info.versionName} 已可更新。`,
          [
            { text: "稍後", style: "cancel" },
            {
              text: "立即更新",
              onPress: () => {
                let lastShown = -1;
                void downloadAndInstallHerLinkUpdate(info, (progress) => {
                  const percent = Math.round(progress * 100);
                  if (percent === 100 || percent - lastShown >= 10) {
                    lastShown = percent;
                    console.log(`[HerLink Update] 下載進度 ${percent}%`);
                  }
                }).catch((error: any) => {
                  if (error?.code === "APK_INSTALL_PERMISSION_REQUIRED" || error?.message === "APK_INSTALL_PERMISSION_REQUIRED") {
                    Alert.alert(
                      "需要安裝權限",
                      "請允許 HerLink 安裝未知應用程式。開啟權限後回到 HerLink，系統會再次檢查更新；已下載完成的 APK 不會重複下載。",
                      [{ text: "知道了" }]
                    );
                    return;
                  }
                  Alert.alert(
                    "更新失敗",
                    "新版下載或驗證失敗。可以直接重新嘗試，不需要到 GitHub 手動下載。",
                    [
                      { text: "稍後", style: "cancel" },
                      {
                        text: "重新嘗試",
                        onPress: () => {
                          notifiedUpdateVersionRef.current = null;
                          lastUpdateCheckRef.current = 0;
                          void checkUpdate();
                        },
                      },
                    ]
                  );
                });
              },
            },
          ]
        );
      } catch {
        // GitHub 暫時不可用時不影響正常聊天。
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
  }, []);



  useEffect(() => {
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void syncNativePushToken(token.data).catch((error) => console.warn("Native push token refresh failed", error));
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = pushNavigationTarget(response);
      if (session && target.kind === "random_session") {
        router.replace({
          pathname: "/random-session/[sessionId]",
          params: { sessionId: target.sessionId },
        } as never);
      } else {
        router.replace("/(tabs)");
      }
    });
    return () => {
      tokenSubscription.remove();
      responseSubscription.remove();
    };
  }, [router, session]);

  if (loading) {
    return null; // 或者顯示一個全屏的 loading 指示器
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {session ? <Stack.Screen name="(tabs)" /> : <Stack.Screen name="login" />}
      <Stack.Screen name="random-session/[sessionId]" />
      <Stack.Screen name="modal" options={{ presentation: "modal", headerShown: true, title: "視窗" }} />
      <Stack.Screen name="privacy" options={{ headerShown: true, title: "隱私權政策" }} />
      <Stack.Screen name="terms" options={{ headerShown: true, title: "服務條款" }} />
      <Stack.Screen name="community-guidelines" options={{ headerShown: true, title: "社群守則" }} />
    </Stack>
  );
}


import { Stack, useRouter } from "expo-router";
import { AuthProvider, useAuth } from "../context/auth";
import { useEffect } from "react";
import { SplashScreen } from "expo-router";
import { colors } from "../theme/colors";
import * as Notifications from "expo-notifications";
import { pushNavigationTarget, syncNativePushToken } from "../lib/native-push";

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
  const { session, loading, profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

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
      } else if (session && target.kind === "match_chat") {
        router.replace({ pathname: "/chat/[matchId]", params: { matchId: target.matchId } } as never);
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
      {session && profile?.onboarding_completed ? (
        <Stack.Screen name="(tabs)" />
      ) : session && !profile?.onboarding_completed ? (
        <Stack.Screen name="onboarding" />
      ) : (
        <Stack.Screen name="login" />
      )}
      <Stack.Screen name="admin" />
      <Stack.Screen name="chat/[matchId]" />
      <Stack.Screen name="random-session/[sessionId]" />
      <Stack.Screen name="person/[userId]" />
      <Stack.Screen name="modal" options={{ presentation: "modal", headerShown: true, title: "Modal" }} />
      <Stack.Screen name="signup" options={{ presentation: "modal", headerShown: true, title: "註冊" }} />
      <Stack.Screen
        name="forgot-password"
        options={{
          presentation: "modal",
          headerShown: true,
          title: "忘記密碼",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="reset-password"
        options={{
          headerShown: true,
          title: "重設密碼",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="privacy" options={{ headerShown: true, title: "隱私權政策" }} />
      <Stack.Screen name="terms" options={{ headerShown: true, title: "服務條款" }} />
      <Stack.Screen name="community-guidelines" options={{ headerShown: true, title: "社群守則" }} />
    </Stack>
  );
}


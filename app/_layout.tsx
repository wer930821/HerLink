import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "../context/auth";
import { useEffect } from "react";
import { SplashScreen, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { addPushRegistrationLifecycleListener, configureNotificationHandler } from "../lib/push";

configureNotificationHandler();

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
    if (!session?.user?.id) return;
    void registerPushNotifications().catch(() => undefined);
    const tokenSub = addPushTokenRefreshListener();
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (data?.eventType === "admin_mail" || data?.type === "admin_mail") router.push("/admin");
    });
    return () => { pushSub.remove(); responseSub.remove(); };
  }, [session?.user?.id, router]);

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
      <Stack.Screen name="person/[userId]" />
      <Stack.Screen name="modal" options={{ presentation: "modal", headerShown: true, title: "Modal" }} />
      <Stack.Screen name="signup" options={{ presentation: "modal", headerShown: true, title: "註冊" }} />
    </Stack>
  );
}

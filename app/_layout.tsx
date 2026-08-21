import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "../context/auth";
import { useEffect } from "react";
import { SplashScreen } from "expo-router";

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

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  if (loading) {
    return null; // 或者顯示一個全屏的 loading 指示器
  }

  return (
    <Stack>
      {session && profile?.onboarding_completed ? (
        // 已登入且完成 onboarding，導向 tabs (主頁)
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      ) : session && !profile?.onboarding_completed ? (
        // 已登入但未完成 onboarding，導向 onboarding 頁面
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      ) : (
        // 未登入，導向登入頁面
        <Stack.Screen name="login" options={{ headerShown: false }} />
      )}
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[matchId]" options={{ headerShown: false }} />
      <Stack.Screen name="person/[userId]" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      <Stack.Screen name="signup" options={{ presentation: "modal" }} />
    </Stack>
  );
}


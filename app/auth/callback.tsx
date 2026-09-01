import { useEffect, useMemo, useState } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { ScreenState } from "../../components/ScreenState";
import { useAuth } from "../../context/auth";
import { completeAuthFromUrl } from "../../lib/supabase";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { retryAuthRestore } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUrl = Linking.useURL();

  const fallbackBody = useMemo(
    () => "正在完成電子郵件驗證與登入狀態同步。",
    []
  );

  useEffect(() => {
    let active = true;

    async function handleCallback() {
      setLoading(true);
      setError(null);

      try {
        const rawUrl = currentUrl ?? (await Linking.getInitialURL());
        console.info("[auth-callback] start", { hasUrl: Boolean(rawUrl) });

        if (!rawUrl) {
          throw new Error("沒有收到驗證連結內容。");
        }

        const completed = await completeAuthFromUrl(rawUrl);
        console.info("[auth-callback] session established");
        await retryAuthRestore();

        if (!active) {
          return;
        }

        router.replace(completed.type === "recovery" ? "/reset-password" : "/(tabs)");
      } catch (callbackError) {
        console.error("[auth-callback] failed", callbackError);

        if (!active) {
          return;
        }

        setError(
          callbackError instanceof Error
            ? callbackError.message
            : "電子郵件驗證處理失敗，請回到登入頁再試一次。"
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void handleCallback();

    return () => {
      active = false;
    };
  }, [currentUrl, retryAuthRestore, router]);

  if (loading) {
    return <ScreenState loading title="完成電子郵件驗證中..." body={fallbackBody} />;
  }

  if (error) {
    return (
      <ScreenState
        title="電子郵件驗證失敗"
        body={error}
        actionLabel="回到登入"
        onAction={() => router.replace("/login")}
      />
    );
  }

  return (
    <ScreenState
      title="驗證完成"
      body="正在回到 HerLink。"
      actionLabel="前往登入"
      onAction={() => router.replace("/login")}
    />
  );
}

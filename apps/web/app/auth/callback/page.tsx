"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { PageHero } from "../../../components/ui";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let mounted = true;
    const code = searchParams.get("code");
    const next = searchParams.get("next") ?? "/";
    const oauthError = searchParams.get("error");

    async function handleCallback() {
      // OAuth failures must leave the current anonymous session untouched.
      // Return to login so the user can retry or keep chatting anonymously.
      if (oauthError) {
        if (mounted) router.replace(`/login?error=google_${encodeURIComponent(oauthError)}`);
        return;
      }
      let sessionReady = false;

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        sessionReady = Boolean(data?.session);
        if (error && !sessionReady) {
          const current = await supabase.auth.getSession();
          sessionReady = Boolean(current.data.session);
        }
      } else if (typeof window !== "undefined" && window.location.hash) {
        // Supabase password-recovery links can still arrive using the implicit
        // fragment flow. Handle those tokens explicitly because this callback
        // otherwise redirects before the recovery session is persisted.
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = fragment.get("access_token");
        const refreshToken = fragment.get("refresh_token");

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          sessionReady = !error && Boolean(data.session);
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
      }

      if (!sessionReady) {
        const current = await supabase.auth.getSession();
        sessionReady = Boolean(current.data.session);
      }

      if (!sessionReady) {
        if (mounted) router.replace("/login?error=invalid_link");
        return;
      }

      if (mounted) {
        router.replace(next);
      }
    }

    void handleCallback();
    return () => {
      mounted = false;
    };
  }, [router, searchParams]);

  return <PageHero title="正在處理登入…" description="請稍候，正在確認你的登入狀態。" />;
}

export default function AuthCallbackPage() {
  return (
    <main className="stack">
      <Suspense fallback={<PageHero title="正在處理登入…" description="請稍候…" />}>
        <AuthCallbackInner />
      </Suspense>
    </main>
  );
}


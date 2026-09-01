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

    async function handleCallback() {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            if (mounted) {
              router.replace("/login?error=invalid_link");
            }
            return;
          }
        }
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

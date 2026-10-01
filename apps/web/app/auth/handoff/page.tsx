"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeBrowserHandoffFromHash, ensureAnonymousBootstrapProfile, loadMyActiveRandomSession } from "../../../lib/supabase";

export default function AuthHandoffPage() {
  const router = useRouter();
  const [message, setMessage] = useState("正在恢復匿名身份與聊天…");

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const result = await consumeBrowserHandoffFromHash();
      if (!mounted) return;

      if (!result.restored || !result.session) {
        setMessage("無法恢復原本的匿名身份，請回原本瀏覽器重新產生續聊連結。");
        return;
      }

      await ensureAnonymousBootstrapProfile(result.session.user.id);
      const active = await loadMyActiveRandomSession();
      if (!mounted) return;

      if (!active.error && active.data?.id) {
        router.replace(`/session/${active.data.id}`);
        return;
      }

      router.replace(result.nextPath || "/");
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <main className="stack home-fixed home-premium">
      <section className="hero">
        <h1 className="hero-title">HerLink</h1>
        <p className="hero-copy">{message}</p>
      </section>
    </main>
  );
}

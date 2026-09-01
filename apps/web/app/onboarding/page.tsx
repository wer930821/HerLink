"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { generateNextAnonymousDisplayName } from "../../../../lib/anonymous";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import {
  isAnonymousProfileReady,
  loadMyProfile,
  saveAnonymousProfile,
  supabase,
  type WebProfile,
} from "../../lib/supabase";

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<WebProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymousDisplayName, setAnonymousDisplayName] = useState<string>(generateNextAnonymousDisplayName());

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data }: { data: { session: Session | null } }) => {
      try {
        const session = data.session;
        if (!session) {
          router.replace("/");
          return;
        }

        const profileResult = await loadMyProfile(session.user.id);
        if (!mounted) return;

        setUserId(session.user.id);
        setProfile(profileResult.data ?? null);
        if (profileResult.data?.anonymous_display_name) {
          setAnonymousDisplayName(profileResult.data.anonymous_display_name);
        }
      } catch {
        if (mounted) {
          setError("目前無法載入匿名設定，請稍後再試。");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [router]);

  const ready = useMemo(() => Boolean(anonymousDisplayName.trim()), [anonymousDisplayName]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;

    setSaving(true);
    setError(null);
    try {
      const { error: saveError } = await saveAnonymousProfile(userId, {
        anonymous_display_name: anonymousDisplayName.trim(),
        anonymous_mode_enabled: true,
        onboarding_completed: true,
      });
      if (saveError) {
        throw saveError;
      }
      router.replace("/");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "設定匿名身份失敗，請稍後再試。"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="hero">
        <h1 className="hero-title">設定匿名身份</h1>
        <p className="hero-copy">正在載入你的匿名設定…</p>
      </main>
    );
  }

  return (
    <main className="stack">
      <section className="hero">
        <h1 className="hero-title">設定匿名身份</h1>
        <p className="hero-copy">在 HerLink，你只需要一個匿名名稱，不必公開任何真實身份資訊。</p>
      </section>

      <form className="panel" onSubmit={onSubmit}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="field" style={{ flex: 1 }}>
            <span className="label">匿名名稱</span>
            <input
              className="input"
              value={anonymousDisplayName}
              onChange={(e) => setAnonymousDisplayName(e.target.value)}
              placeholder="例如：本人很正常"
              maxLength={24}
            />
          </div>
          <button
            className="ghost"
            type="button"
            onClick={() => setAnonymousDisplayName((current) => generateNextAnonymousDisplayName(current))}
          >
            換一個
          </button>
        </div>

        {error ? <div className="notice" style={{ color: "var(--color-danger)" }}>{error}</div> : null}
        <button className="button" type="submit" disabled={saving || !ready}>
          {saving ? "儲存中…" : "開始聊天"}
        </button>
      </form>
    </main>
  );
}

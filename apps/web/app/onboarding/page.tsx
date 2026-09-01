"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { generateNextAnonymousDisplayName } from "../../../../lib/anonymous";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";
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
      <main className="stack">
        <PageHero title="設定匿名身份" description="正在載入你的匿名設定…" />
      </main>
    );
  }

  return (
    <main className="stack">
      <PageHero title="設定匿名身份" description="在 HerLink，你只需要一個匿名名稱，不必公開任何真實身份資訊。" />

      <Surface as="form" elevation={1} onSubmit={onSubmit}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Field label="匿名名稱" htmlFor="onboarding-name" className="grow">
            <input
              id="onboarding-name"
              className="input"
              value={anonymousDisplayName}
              onChange={(e) => setAnonymousDisplayName(e.target.value)}
              placeholder="例如：本人很正常"
              maxLength={24}
            />
          </Field>
          <Button
            variant="ghost"
            size="lg"
            type="button"
            onClick={() => setAnonymousDisplayName((current) => generateNextAnonymousDisplayName(current))}
          >
            換一個
          </Button>
        </div>

        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Button type="submit" size="lg" disabled={saving || !ready}>
          {saving ? "儲存中…" : "開始聊天"}
        </Button>
      </Surface>
    </main>
  );
}

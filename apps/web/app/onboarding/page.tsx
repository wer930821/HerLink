"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import {
  loadMyProfile,
  saveAnonymousProfile,
  supabase,
} from "../../lib/supabase";

type NameRpcRow = { status: string; anonymous_display_name: string | null };

function firstRpcRow(data: unknown): NameRpcRow | null {
  if (Array.isArray(data)) return (data[0] as NameRpcRow | undefined) ?? null;
  return (data as NameRpcRow | null) ?? null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingName, setGeneratingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymousDisplayName, setAnonymousDisplayName] = useState("");

  const rotateName = async () => {
    setGeneratingName(true);
    setError(null);
    try {
      const result = await supabase.rpc("rotate_my_anonymous_display_name");
      if (result.error) throw result.error;
      const row = firstRpcRow(result.data);
      if (!row?.anonymous_display_name) {
        setError("目前無法產生隨機暱稱，請自行輸入一個暱稱。");
        return null;
      }
      setAnonymousDisplayName(row.anonymous_display_name);
      return row.anonymous_display_name;
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "目前無法產生隨機暱稱，請稍後再試。"));
      return null;
    } finally {
      setGeneratingName(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      try {
        const session = data.session;
        if (!session) {
          router.replace("/");
          return;
        }

        const profileResult = await loadMyProfile(session.user.id);
        if (!mounted) return;
        setUserId(session.user.id);

        if (profileResult.data?.anonymous_display_name) {
          setAnonymousDisplayName(profileResult.data.anonymous_display_name);
        } else {
          await rotateName();
        }
      } catch {
        if (mounted) setError("目前無法載入匿名設定，請稍後再試。");
      } finally {
        if (mounted) setLoading(false);
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

    const enteredName = anonymousDisplayName.trim();
    if (!enteredName) {
      setError("請輸入匿名暱稱，或按「換一個」取得隨機暱稱。");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // The database owns the canonical anonymous name. This RPC performs the
      // normalized uniqueness check without exposing other users' profiles.
      const nameResult = await supabase.rpc("set_my_anonymous_display_name", { p_name: enteredName });
      if (nameResult.error) throw nameResult.error;
      const row = firstRpcRow(nameResult.data);
      if (row?.status === "NAME_TAKEN") {
        setError("該暱稱已使用，請換一個名稱。");
        return;
      }

      const canonicalName = row?.anonymous_display_name?.trim() || enteredName;
      setAnonymousDisplayName(canonicalName);

      const { error: saveError } = await saveAnonymousProfile(userId, {
        anonymous_display_name: canonicalName,
        anonymous_avatar: "avatar_01",
        anonymous_mode_enabled: true,
        onboarding_completed: true,
      });
      if (saveError) throw saveError;

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
              onChange={(event) => {
                setAnonymousDisplayName(event.target.value);
                setError(null);
              }}
              placeholder="例如：本人很正常"
              maxLength={12}
            />
          </div>
          <button
            className="ghost"
            type="button"
            disabled={generatingName || saving}
            onClick={() => void rotateName()}
          >
            {generatingName ? "產生中…" : "換一個"}
          </button>
        </div>

        {error ? <div className="notice" style={{ color: "#ffb3b3" }}>{error}</div> : null}
        <button className="button" type="submit" disabled={saving || generatingName || !ready}>
          {saving ? "儲存中…" : "開始聊天"}
        </button>
      </form>
    </main>
  );
}

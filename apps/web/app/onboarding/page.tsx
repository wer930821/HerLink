"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ANONYMOUS_NAME_OPTIONS, generateNextAnonymousDisplayName } from "../../../../lib/anonymous";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import {
  loadMyProfile,
  saveAnonymousProfile,
  supabase,
  type WebProfile,
} from "../../lib/supabase";

const RANDOM_NAME_RETRY_LIMIT = 5;

function isDuplicateNameError(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string } | null;
  const text = `${value?.message ?? ""} ${value?.details ?? ""}`.toLowerCase();
  return value?.code === "23505" || text.includes("duplicate key") || text.includes("already") || text.includes("已使用");
}

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<WebProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingName, setGeneratingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymousDisplayName, setAnonymousDisplayName] = useState<string>("");
  const [randomName, setRandomName] = useState(false);

  const findAvailableRandomName = async (currentName?: string | null) => {
    const shuffled = [...ANONYMOUS_NAME_OPTIONS].sort(() => Math.random() - 0.5);
    const normalizedCurrent = (currentName ?? "").trim();

    for (const candidate of shuffled) {
      if (candidate === normalizedCurrent) continue;
      const { data, error: lookupError } = await supabase
        .from("profiles")
        .select("id")
        .eq("anonymous_display_name", candidate)
        .limit(1);
      if (lookupError) throw lookupError;
      if (!data?.length) return candidate;
    }
    return null;
  };

  const generateAvailableName = async (currentName?: string | null) => {
    setGeneratingName(true);
    setError(null);
    try {
      const nextName = await findAvailableRandomName(currentName);
      if (!nextName) {
        setError("目前隨機暱稱已用完，請自行輸入一個暱稱。");
        return null;
      }
      setAnonymousDisplayName(nextName);
      setRandomName(true);
      return nextName;
    } catch {
      // If profile lookup is unavailable, keep the button useful and let the DB
      // uniqueness constraint make the final decision on submit.
      const fallback = generateNextAnonymousDisplayName(currentName);
      setAnonymousDisplayName(fallback);
      setRandomName(true);
      return fallback;
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
        setProfile(profileResult.data ?? null);
        if (profileResult.data?.anonymous_display_name) {
          setAnonymousDisplayName(profileResult.data.anonymous_display_name);
          setRandomName(false);
        } else {
          await generateAvailableName();
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

  const saveName = async (name: string) => {
    if (!userId) return { error: { message: "找不到目前 Web 身分。" } };
    return saveAnonymousProfile(userId, {
      anonymous_display_name: name.trim(),
      anonymous_avatar: "avatar_01",
      anonymous_mode_enabled: true,
      onboarding_completed: true,
    });
  };

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
      let nameToSave = enteredName;
      let result = await saveName(nameToSave);

      if (result.error && randomName && isDuplicateNameError(result.error)) {
        for (let attempt = 0; attempt < RANDOM_NAME_RETRY_LIMIT; attempt += 1) {
          const replacement = await findAvailableRandomName(nameToSave);
          if (!replacement) break;
          nameToSave = replacement;
          setAnonymousDisplayName(replacement);
          result = await saveName(replacement);
          if (!result.error) break;
          if (!isDuplicateNameError(result.error)) break;
        }
      }

      if (result.error) {
        if (isDuplicateNameError(result.error)) {
          if (randomName) {
            setError("目前隨機暱稱較多人使用，請再按一次換一個。");
          } else {
            setError("該暱稱已使用，請換一個名稱。");
          }
          return;
        }
        throw result.error;
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
              onChange={(e) => {
                setAnonymousDisplayName(e.target.value);
                setRandomName(false);
                setError(null);
              }}
              placeholder="例如：本人很正常"
              maxLength={24}
            />
          </div>
          <button
            className="ghost"
            type="button"
            disabled={generatingName || saving}
            onClick={() => void generateAvailableName(anonymousDisplayName)}
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

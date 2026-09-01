"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { supabase, updatePassword } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (mounted) {
        setReady(Boolean(data.session));
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) {
      setError("密碼至少需要 8 個字元。");
      return;
    }
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await updatePassword(password);
      if (updateError) {
        throw updateError;
      }
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "目前無法更新密碼，請重新開啟信件中的連結再試一次。"));
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <main className="stack">
        <PageHero title="重設密碼" description="正在確認你的重設連結…" />
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="stack">
        <PageHero
          title="連結無效或已過期"
          description="請回到忘記密碼頁面重新索取重設密碼信。"
          actions={<Button size="lg" href="/forgot-password">重新索取</Button>}
        />
      </main>
    );
  }

  return (
    <main className="stack">
      <PageHero title="重設密碼" description="請輸入新密碼。建議使用長度足夠且不重複的密碼。" />
      <Surface as="form" elevation={1} onSubmit={onSubmit}>
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Field label="新密碼" htmlFor="new-password">
          <input
            id="new-password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </Field>
        <Field label="再次輸入新密碼" htmlFor="confirm-password">
          <input
            id="confirm-password"
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </Field>
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "更新中…" : "更新密碼"}
        </Button>
      </Surface>
    </main>
  );
}

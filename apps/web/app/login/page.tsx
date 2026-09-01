"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signIn, supabase } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) {
        router.replace("/");
      }
    });
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: authError } = await signIn(email.trim(), password);
      if (authError) {
        throw authError;
      }
      router.replace("/");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "登入失敗，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="stack">
      <PageHero title="登入 HerLink" description="登入後會先進入匿名設定，再開始隨機配對。" />
      <Surface as="form" elevation={1} onSubmit={onSubmit}>
        <Field label="電子郵件" htmlFor="login-email">
          <input
            id="login-email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="name@example.com"
          />
        </Field>
        <Field label="密碼" htmlFor="login-password">
          <input
            id="login-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </Field>
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "登入中…" : "登入"}
        </Button>
        <Button variant="ghost" size="lg" type="button" onClick={() => router.push("/signup")} disabled={loading}>
          還沒有帳號？前往註冊
        </Button>
      </Surface>
    </main>
  );
}

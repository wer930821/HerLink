"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signUp, supabase } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage(null);
    try {
      const { data, error: authError } = await signUp(email.trim(), password);
      if (authError) {
        throw authError;
      }

      if (data.session) {
        router.replace("/onboarding");
        return;
      }

      setMessage("註冊完成。若需要確認信箱，請先完成驗證後再登入。");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "註冊失敗，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="stack">
      <PageHero title="註冊 HerLink" description="只需要電子郵件與密碼，接著設定匿名身份即可開始。" />
      <Surface as="form" elevation={1} onSubmit={onSubmit}>
        <Field label="電子郵件" htmlFor="signup-email">
          <input
            id="signup-email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="name@example.com"
          />
        </Field>
        <Field label="密碼" htmlFor="signup-password">
          <input
            id="signup-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
          />
        </Field>
        {error ? <Notice variant="danger">{error}</Notice> : null}
        {message ? <Notice variant="success">{message}</Notice> : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "註冊中…" : "註冊"}
        </Button>
        <Button variant="ghost" size="lg" type="button" onClick={() => router.push("/login")} disabled={loading}>
          已有帳號？前往登入
        </Button>
      </Surface>
    </main>
  );
}

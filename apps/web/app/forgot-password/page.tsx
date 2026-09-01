"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { getWebAuthCallbackUrl, sendPasswordResetEmail } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSent(false);
    try {
      const { error: resetError } = await sendPasswordResetEmail(email.trim(), getWebAuthCallbackUrl());
      if (resetError) {
        throw resetError;
      }
      setSent(true);
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "目前無法送出重設密碼郵件，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="stack">
      <PageHero title="忘記密碼" description="輸入你的 Email，如果帳號存在，HerLink 會寄出重設密碼信。" />
      <Surface as="form" elevation={1} onSubmit={onSubmit}>
        {sent ? (
          <Notice variant="success" title="已送出">
            如果這個 Email 可用，你會在幾分鐘內收到重設密碼信。
          </Notice>
        ) : null}
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Field label="電子郵件" htmlFor="forgot-email">
          <input
            id="forgot-email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="name@example.com"
          />
        </Field>
        <Button type="submit" size="lg" disabled={loading || sent}>
          {loading ? "送出中…" : "寄送重設密碼信"}
        </Button>
        <Button variant="ghost" size="lg" type="button" onClick={() => router.push("/login")} disabled={loading}>
          返回登入
        </Button>
      </Surface>
    </main>
  );
}

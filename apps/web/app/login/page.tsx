"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signIn, supabase } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

function getLoginDestination() {
  if (typeof window === "undefined") return "/";
  return new URLSearchParams(window.location.search).get("next") === "/admin" ? "/admin" : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [destination, setDestination] = useState("/");
  const isAdminLogin = destination === "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextDestination = getLoginDestination();
    setDestination(nextDestination);
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (nextDestination === "/admin" && data.session?.user.is_anonymous) {
        void supabase.auth.signOut();
        return;
      }
      if (data.session && nextDestination !== "/admin") {
        router.replace(nextDestination);
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
      router.replace(getLoginDestination());
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "登入失敗，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="stack">
      <PageHero
        title={isAdminLogin ? "登入管理員帳號" : "登入 HerLink"}
        description={isAdminLogin ? "使用固定管理員 Email/Password 登入後台。" : "登入後會先進入匿名設定，再開始隨機配對。"}
      />
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
        {!isAdminLogin ? (
          <Button variant="ghost" size="lg" type="button" onClick={() => router.push("/signup")} disabled={loading}>
            還沒有帳號？前往註冊
          </Button>
        ) : null}
        <Button variant="link" type="button" onClick={() => router.push("/forgot-password")} disabled={loading}>
          忘記密碼？
        </Button>
      </Surface>
    </main>
  );
}

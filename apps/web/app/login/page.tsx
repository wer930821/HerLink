"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signIn, supabase } from "../../lib/supabase";

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
      <section className="hero">
        <h1 className="hero-title">登入 HerLink</h1>
        <p className="hero-copy">登入後會先進入匿名設定，再開始隨機配對。</p>
      </section>
      <form className="panel" onSubmit={onSubmit}>
        <label className="field">
          <span className="label">電子郵件</span>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="name@example.com"
          />
        </label>
        <label className="field">
          <span className="label">密碼</span>
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <div className="notice" style={{ color: "var(--color-danger)" }}>{error}</div> : null}
        <button className="button" type="submit" disabled={loading}>
          {loading ? "登入中…" : "登入"}
        </button>
        <button className="ghost" type="button" onClick={() => router.push("/signup")} disabled={loading}>
          還沒有帳號？前往註冊
        </button>
      </form>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signUp, supabase } from "../../lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
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
      <section className="hero">
        <h1 className="hero-title">註冊 HerLink</h1>
        <p className="hero-copy">只需要電子郵件與密碼，接著設定匿名身份即可開始。</p>
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
            autoComplete="new-password"
          />
        </label>
        {error ? <div className="notice" style={{ color: "#ffb3b3" }}>{error}</div> : null}
        {message ? <div className="notice">{message}</div> : null}
        <button className="button" type="submit" disabled={loading}>
          {loading ? "註冊中…" : "註冊"}
        </button>
        <button className="ghost" type="button" onClick={() => router.push("/login")} disabled={loading}>
          已有帳號？前往登入
        </button>
      </form>
    </main>
  );
}

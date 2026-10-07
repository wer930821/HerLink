"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { beginAnonymousAccountBinding, finishAnonymousAccountBinding, supabase } from "../../lib/supabase";

const BINDING_USER_ID_KEY = "herlink_account_binding_user_id";
const BINDING_PASSWORD_KEY = "herlink_account_binding_password";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/");
        return;
      }

      const isAnonymous = session.user.is_anonymous === true;
      const expectedUserId = sessionStorage.getItem(BINDING_USER_ID_KEY);
      const pendingPassword = sessionStorage.getItem(BINDING_PASSWORD_KEY);

      if (!isAnonymous && expectedUserId && pendingPassword) {
        if (session.user.id !== expectedUserId) {
          sessionStorage.removeItem(BINDING_USER_ID_KEY);
          sessionStorage.removeItem(BINDING_PASSWORD_KEY);
          setError("帳號驗證失敗：匿名身份不一致，聊天室沒有被移轉。");
          return;
        }

        setLoading(true);
        const { error: passwordError } = await finishAnonymousAccountBinding(pendingPassword);
        if (passwordError) {
          setError(getFriendlyAuthErrorMessage(passwordError, "密碼設定失敗，請稍後再試。"));
          setLoading(false);
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user || user.id !== expectedUserId) {
          setError("帳號驗證失敗：身份已變更，聊天室沒有被移轉。");
          setLoading(false);
          return;
        }

        sessionStorage.removeItem(BINDING_USER_ID_KEY);
        sessionStorage.removeItem(BINDING_PASSWORD_KEY);
        setMessage("帳號綁定完成，原本的聊天室已保存。");
        setLoading(false);
        return;
      }

      if (!isAnonymous && !expectedUserId) {
        router.replace("/");
      }
    })();
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.is_anonymous !== true) {
        throw new Error("anonymous session required");
      }

      sessionStorage.setItem(BINDING_USER_ID_KEY, user.id);
      sessionStorage.setItem(BINDING_PASSWORD_KEY, password);

      const { error: authError } = await beginAnonymousAccountBinding(email);
      if (authError) {
        sessionStorage.removeItem(BINDING_USER_ID_KEY);
        sessionStorage.removeItem(BINDING_PASSWORD_KEY);
        throw authError;
      }

      setMessage("驗證信已寄出。請使用同一個瀏覽器開啟驗證信，完成後會保留原本聊天室並設定密碼。");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, "帳號綁定失敗，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="stack">
      <section className="hero">
        <h1 className="hero-title">保存我的 HerLink 帳號</h1>
        <p className="hero-copy">綁定信箱後會保留目前匿名身份與聊天室，不會建立另一個匿名身份。</p>
      </section>
      <form className="panel" onSubmit={onSubmit}>
        <label className="field">
          <span className="label">電子郵件</span>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" required />
        </label>
        <label className="field">
          <span className="label">密碼</span>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required />
        </label>
        {error ? <div className="notice" style={{ color: "#ffb3b3" }}>{error}</div> : null}
        {message ? <div className="notice">{message}</div> : null}
        <button className="button" type="submit" disabled={loading}>{loading ? "處理中…" : "寄送驗證信"}</button>
        <button className="ghost" type="button" onClick={() => router.push("/login")} disabled={loading}>已有帳號？前往登入</button>
      </form>
    </main>
  );
}

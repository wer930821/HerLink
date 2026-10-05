"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../lib/auth-ui";
import { ACCOUNT_BINDING_PRODUCTION_USER_ID, canTestAccountBinding, saveAnonymousAccount } from "../lib/account-binding";
import { getCurrentSession, loadMyProfile, signOut, supabase, type Session, type WebProfile } from "../lib/supabase";

export function AccountApplicationTest() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<WebProfile | null>(null);
  const [isPreviewHost, setIsPreviewHost] = useState(false);
  const [mode, setMode] = useState<"apply" | "login" | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let mounted = true;
    setIsPreviewHost(window.location.hostname.endsWith(".vercel.app"));
    void (async () => {
      const { data } = await getCurrentSession();
      const currentSession = data.session ?? null;
      if (!mounted) return;
      setSession(currentSession);
      if (!currentSession) { setProfile(null); return; }
      const result = await loadMyProfile(currentSession.user.id);
      if (!mounted) return;
      setProfile(result.data ?? null);
    })();
    return () => { mounted = false; };
  }, [pathname]);

  const previewAnonymous = Boolean(
    isPreviewHost &&
    session?.user?.is_anonymous === true &&
    session.user.id !== ACCOUNT_BINDING_PRODUCTION_USER_ID &&
    profile?.id === session.user.id
  );
  const previewBoundAccount = Boolean(
    isPreviewHost &&
    session?.user?.is_anonymous === false &&
    session.user.id !== ACCOUNT_BINDING_PRODUCTION_USER_ID &&
    profile?.id === session.user.id &&
    profile?.anonymous_display_name?.startsWith("孤星測_")
  );
  if (!isPreviewHost) return null;
  if (session && !previewAnonymous && !previewBoundAccount && !completed) return null;

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    if (!accountEmail.trim()) { setMessage("請輸入 Email。"); return; }
    if (accountPassword.length < 8) { setMessage("密碼至少需要 8 個字元。"); return; }
    if (accountPassword !== confirmPassword) { setMessage("兩次輸入的密碼不一致。"); return; }
    if (!canTestAccountBinding(profile, session)) { setMessage("目前僅開放 Preview 測試身分申請帳號。"); return; }

    setBusy(true);
    const result = await saveAnonymousAccount(accountEmail, accountPassword);
    setBusy(false);
    if (result.error) {
      setMessage(getFriendlyAuthErrorMessage(result.error, "帳號申請失敗；目前匿名聊天室沒有受到影響。"));
      return;
    }

    setCompleted(true);
    setMode(null);
    setAccountPassword("");
    setConfirmPassword("");
    setMessage("帳號申請完成。原本的匿名身分與聊天室仍會保留。");
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    if (!accountEmail.trim()) { setMessage("請輸入 Email。"); return; }
    if (!accountPassword) { setMessage("請輸入密碼。"); return; }

    setBusy(true);
    try {
      if (session?.user?.is_anonymous) {
        const out = await signOut();
        if (out.error) throw out.error;
      }
      const login = await supabase.auth.signInWithPassword({ email: accountEmail.trim(), password: accountPassword });
      if (login.error || !login.data.user) throw login.error ?? new Error("登入失敗");
      if (login.data.user.id === ACCOUNT_BINDING_PRODUCTION_USER_ID) {
        await signOut();
        throw new Error("目前 Preview 不允許登入正式測試身分。");
      }
      const restored = await loadMyProfile(login.data.user.id);
      if (restored.error || !restored.data?.id || !restored.data.anonymous_display_name?.startsWith("孤星測_")) {
        await signOut();
        throw restored.error ?? new Error("這個帳號不是目前的 Preview 測試帳號。");
      }

      setSession(login.data.session);
      setProfile(restored.data);
      setCompleted(true);
      setMode(null);
      setAccountPassword("");
      setConfirmPassword("");
      setMessage(`登入成功，已恢復匿名身分「${restored.data.anonymous_display_name}」。`);
      window.setTimeout(() => window.location.assign("/"), 500);
    } catch (error) {
      setMessage(getFriendlyAuthErrorMessage(error, error instanceof Error ? error.message : "登入失敗，請確認 Email 與密碼。"));
    } finally {
      setBusy(false);
    }
  };

  const canApply = previewAnonymous && canTestAccountBinding(profile, session);
  const canLogin = !session || previewAnonymous || previewBoundAccount;

  return (
    <section className="panel" style={{ marginBottom: 14 }} data-phase1-account-application>
      <div>
        <p className="title" style={{ marginBottom: 4 }}>帳號保存測試</p>
        <p className="small muted">Phase 1 Preview 測試。申請或登入後仍使用原本匿名身分。</p>
      </div>

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        {canApply && !completed ? <button className="ghost" type="button" onClick={() => { setMode(mode === "apply" ? null : "apply"); setMessage(null); }} disabled={busy}>{mode === "apply" ? "收起" : "申請帳號"}</button> : null}
        {canLogin && !completed ? <button className="ghost" type="button" onClick={() => { setMode(mode === "login" ? null : "login"); setMessage(null); }} disabled={busy}>{mode === "login" ? "收起" : "登入原有帳號"}</button> : null}
      </div>

      {mode === "apply" && canApply && !completed ? (
        <form onSubmit={submitApplication} style={{ marginTop: 14 }}>
          <label className="small" htmlFor="phase1-account-email">Email</label>
          <input id="phase1-account-email" type="email" autoComplete="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} disabled={busy} required style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
          <label className="small" htmlFor="phase1-account-password">密碼</label>
          <input id="phase1-account-password" type="password" autoComplete="new-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} disabled={busy} minLength={8} required style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
          <label className="small" htmlFor="phase1-account-password-confirm">再次輸入密碼</label>
          <input id="phase1-account-password-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={busy} minLength={8} required style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
          <p className="small muted">送出只會把目前匿名 Supabase 使用者原地綁定 Email 與密碼，不會建立新的聊天身分。</p>
          <button className="button" type="submit" disabled={busy}>{busy ? "申請中…" : "確認申請帳號"}</button>
        </form>
      ) : null}

      {mode === "login" && canLogin && !completed ? (
        <form onSubmit={submitLogin} style={{ marginTop: 14 }}>
          <label className="small" htmlFor="phase1-login-email">Email</label>
          <input id="phase1-login-email" type="email" autoComplete="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} disabled={busy} required style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
          <label className="small" htmlFor="phase1-login-password">密碼</label>
          <input id="phase1-login-password" type="password" autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} disabled={busy} required style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
          <p className="small muted">登入成功後會使用帳號原本的 UUID 載入匿名身分與既有聊天室。</p>
          <button className="button" type="submit" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
        </form>
      ) : null}

      {message ? <div className="notice" style={{ marginTop: 12 }}>{message}</div> : null}
    </section>
  );
}

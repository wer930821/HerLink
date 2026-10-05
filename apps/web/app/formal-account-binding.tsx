"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const FORMAL_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const FORMAL_NAME = "孤星企鵝";

export function FormalAccountBinding() {
  const [formalSession, setFormalSession] = useState(false);
  const [loginMode, setLoginMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLoginMode(params.get("account") === "login");
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || user.id !== FORMAL_USER_ID) return;
      const profile = await supabase.from("profiles").select("id, anonymous_display_name").eq("id", user.id).maybeSingle();
      if (profile.data?.id === FORMAL_USER_ID && profile.data.anonymous_display_name === FORMAL_NAME) setFormalSession(true);
    })();
  }, []);

  const bind = async (event: FormEvent) => {
    event.preventDefault();
    if (!formalSession || busy) return;
    if (!email.trim()) { setMessage("請輸入 Email。"); return; }
    if (password.length < 8) { setMessage("密碼至少需要 8 個字元。"); return; }
    if (password !== confirm) { setMessage("兩次輸入的密碼不一致。"); return; }
    setBusy(true); setMessage(null);
    const before = await supabase.auth.getUser();
    if (before.data.user?.id !== FORMAL_USER_ID) { setBusy(false); setMessage("身分核對失敗，沒有修改任何資料。"); return; }
    const result = await supabase.auth.updateUser({ email: email.trim(), password: password });
    if (result.error) { setBusy(false); setMessage(`帳號綁定失敗：${result.error.message}`); return; }
    const after = await supabase.auth.getUser();
    const profile = await supabase.from("profiles").select("id, anonymous_display_name").eq("id", FORMAL_USER_ID).maybeSingle();
    setBusy(false); setPassword(""); setConfirm("");
    if (after.data.user?.id !== FORMAL_USER_ID || profile.data?.anonymous_display_name !== FORMAL_NAME) {
      setMessage("帳號已更新，但身分核對異常，請先不要登出。"); return;
    }
    setMessage("帳號綁定完成。孤星企鵝的 UUID 與匿名名稱保持不變。");
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error || result.data.user?.id !== FORMAL_USER_ID) {
      if (result.data.user) await supabase.auth.signOut();
      setBusy(false); setMessage("登入失敗，請確認 Email 與密碼。"); return;
    }
    const profile = await supabase.from("profiles").select("id, anonymous_display_name").eq("id", result.data.user.id).maybeSingle();
    if (profile.data?.anonymous_display_name !== FORMAL_NAME) {
      await supabase.auth.signOut(); setBusy(false); setMessage("登入身分核對失敗。"); return;
    }
    setBusy(false); setPassword(""); setMessage("登入成功，已恢復孤星企鵝。");
    window.setTimeout(() => window.location.assign("/"), 500);
  };

  if (!formalSession && !loginMode) return null;

  return (
    <section className="panel" style={{ marginBottom: 14 }} data-formal-account-binding>
      <p className="title">{loginMode && !formalSession ? "登入帳號" : "孤星企鵝帳號保存"}</p>
      <p className="small muted">帳號只用於找回原本匿名身分，不會改變匿名名稱或聊天室歸屬。</p>
      <form onSubmit={loginMode && !formalSession ? login : bind} style={{ marginTop: 12 }}>
        <label className="small">Email</label>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
        <label className="small">密碼</label>
        <input type="password" autoComplete={loginMode && !formalSession ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} />
        {formalSession && !loginMode ? <><label className="small">再次輸入密碼</label><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }} /></> : null}
        <button className="button" type="submit" disabled={busy}>{busy ? "處理中…" : loginMode && !formalSession ? "登入" : "綁定帳號"}</button>
      </form>
      {message ? <div className="notice" style={{ marginTop: 10 }}>{message}</div> : null}
    </section>
  );
}

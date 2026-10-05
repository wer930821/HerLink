"use client";

import { FormEvent, useEffect, useState } from "react";
import { canTestAccountBinding, saveAnonymousAccount } from "../lib/account-binding";
import { getCurrentSession, loadMyProfile, type Session, type WebProfile } from "../lib/supabase";

export function AccountApplicationTest() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<WebProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data } = await getCurrentSession();
      const currentSession = data.session ?? null;
      if (!mounted || !currentSession) return;
      const result = await loadMyProfile(currentSession.user.id);
      if (!mounted) return;
      setSession(currentSession);
      setProfile(result.data ?? null);
    })();
    return () => { mounted = false; };
  }, []);

  if (!canTestAccountBinding(profile, session) && !completed) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    if (!accountEmail.trim()) {
      setMessage("請輸入 Email。");
      return;
    }
    if (accountPassword.length < 8) {
      setMessage("密碼至少需要 8 個字元。");
      return;
    }
    if (accountPassword !== confirmPassword) {
      setMessage("兩次輸入的密碼不一致。");
      return;
    }

    setBusy(true);
    const result = await saveAnonymousAccount(accountEmail, accountPassword);
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message || "帳號申請失敗；目前匿名聊天室沒有受到影響。");
      return;
    }

    setCompleted(true);
    setOpen(false);
    setAccountPassword("");
    setConfirmPassword("");
    setMessage("帳號申請完成。原本的匿名身分與聊天室仍會保留。");
  };

  return (
    <section className="panel" style={{ marginBottom: 14 }} data-phase1-account-application>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p className="title" style={{ marginBottom: 4 }}>帳號保存測試</p>
          <p className="small muted">僅孤星企鵝可見。申請後仍使用原本匿名身分。</p>
        </div>
        {!completed ? (
          <button className="ghost" type="button" onClick={() => setOpen((value) => !value)} disabled={busy}>
            {open ? "收起" : "申請帳號"}
          </button>
        ) : null}
      </div>

      {open && !completed ? (
        <form onSubmit={submit} style={{ marginTop: 14 }}>
          <label className="small" htmlFor="phase1-account-email">Email</label>
          <input
            id="phase1-account-email"
            type="email"
            autoComplete="email"
            value={accountEmail}
            onChange={(event) => setAccountEmail(event.target.value)}
            disabled={busy}
            required
            style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }}
          />
          <label className="small" htmlFor="phase1-account-password">密碼</label>
          <input
            id="phase1-account-password"
            type="password"
            autoComplete="new-password"
            value={accountPassword}
            onChange={(event) => setAccountPassword(event.target.value)}
            disabled={busy}
            minLength={8}
            required
            style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }}
          />
          <label className="small" htmlFor="phase1-account-password-confirm">再次輸入密碼</label>
          <input
            id="phase1-account-password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={busy}
            minLength={8}
            required
            style={{ width: "100%", padding: 12, borderRadius: 12, margin: "6px 0 10px" }}
          />
          <p className="small muted">送出只會把目前匿名 Supabase 使用者原地綁定 Email 與密碼，不會建立新的聊天身分。</p>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "申請中…" : "確認申請帳號"}
          </button>
        </form>
      ) : null}

      {message ? <div className="notice" style={{ marginTop: 12 }}>{message}</div> : null}
    </section>
  );
}

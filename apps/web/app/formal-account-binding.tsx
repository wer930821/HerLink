"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const FORMAL_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const FORMAL_NAME = "孤星企鵝";

type Mode = "entry" | "bind" | "login";

async function loadFormalProfile(userId: string) {
  return supabase
    .from("profiles")
    .select("id, anonymous_display_name")
    .eq("id", userId)
    .maybeSingle();
}

export function FormalAccountBinding() {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("entry");
  const [formalSession, setFormalSession] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (pathname !== "/") return;

    const inspect = async () => {
      const loginRequested = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("account") === "login";
      const sessionResult = await supabase.auth.getSession();
      const user = sessionResult.data.session?.user;
      if (!user || user.id !== FORMAL_USER_ID) {
        if (!cancelled) {
          setFormalSession(false);
          setMode(loginRequested ? "login" : "entry");
        }
        return;
      }

      const profile = await loadFormalProfile(user.id);
      const valid = !profile.error && profile.data?.id === FORMAL_USER_ID && profile.data?.anonymous_display_name === FORMAL_NAME;
      if (!cancelled) {
        setFormalSession(valid);
        setMode(loginRequested ? "login" : valid ? "bind" : "entry");
      }
    };

    void inspect();
    return () => { cancelled = true; };
  }, [pathname]);

  if (pathname !== "/") return null;

  const resetSecretFields = () => {
    setPassword("");
    setConfirmPassword("");
  };

  const bindAccount = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!formalSession) return setMessage("目前不是孤星企鵝的原本匿名身分，無法綁定。");
    if (!email.trim()) return setMessage("請輸入 Email。");
    if (password.length < 8) return setMessage("密碼至少需要 8 個字元。");
    if (password !== confirmPassword) return setMessage("兩次輸入的密碼不一致。");

    setBusy(true);
    try {
      const before = await supabase.auth.getUser();
      if (before.data.user?.id !== FORMAL_USER_ID) throw new Error("正式匿名身分驗證失敗。");

      const updated = await supabase.auth.updateUser({
        email: email.trim(),
        password: password,
      });
      if (updated.error) throw updated.error;
      if (updated.data.user?.id !== FORMAL_USER_ID) throw new Error("綁定後 UUID 不一致，已停止流程。");

      const profile = await loadFormalProfile(FORMAL_USER_ID);
      if (profile.error || profile.data?.id !== FORMAL_USER_ID || profile.data?.anonymous_display_name !== FORMAL_NAME) {
        throw new Error("綁定後匿名身分核對失敗。");
      }

      resetSecretFields();
      setMessage("帳號綁定完成。孤星企鵝的匿名身分保持不變。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "帳號綁定失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  const loginAccount = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!email.trim() || !password) return setMessage("請輸入 Email 與密碼。");

    setBusy(true);
    try {
      const login = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (login.error) throw login.error;
      if (login.data.user?.id !== FORMAL_USER_ID) {
        if (login.data.user) await supabase.auth.signOut();
        throw new Error("這個帳號不是孤星企鵝的正式身分。");
      }

      const profile = await loadFormalProfile(login.data.user.id);
      if (profile.error || profile.data?.id !== FORMAL_USER_ID || profile.data?.anonymous_display_name !== FORMAL_NAME) {
        await supabase.auth.signOut();
        throw new Error("登入後匿名身分核對失敗。");
      }

      resetSecretFields();
      setMessage("登入成功，已恢復孤星企鵝。");
      window.setTimeout(() => router.replace("/"), 350);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登入失敗，請確認 Email 與密碼。");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "entry") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode("login")}>已有帳號？登入</button>
      </div>
    );
  }

  return (
    <section className="surface surface-elevation-1" style={{ marginBottom: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong>{mode === "bind" ? "保存孤星企鵝帳號" : "登入原有帳號"}</strong>
          <div style={{ marginTop: 4, fontSize: 13, opacity: 0.72 }}>
            {mode === "bind" ? "綁定後仍使用目前的匿名身分與原本資料。" : "使用已綁定的 Email 與密碼恢復原本匿名身分。"}
          </div>
        </div>
        {mode === "login" ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setMode(formalSession ? "bind" : "entry"); setMessage(""); resetSecretFields(); }}>關閉</button> : null}
      </div>

      <form onSubmit={mode === "bind" ? bindAccount : loginAccount} style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="field">
          <span className="label">密碼</span>
          <input className="input" type="password" autoComplete={mode === "bind" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
        {mode === "bind" ? (
          <label className="field">
            <span className="label">再次輸入密碼</span>
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
          </label>
        ) : null}
        <button className="btn btn-primary btn-md" type="submit" disabled={busy}>{busy ? "處理中…" : mode === "bind" ? "綁定帳號" : "登入"}</button>
      </form>
      {message ? <div role="status" style={{ marginTop: 10, fontSize: 14 }}>{message}</div> : null}
    </section>
  );
}

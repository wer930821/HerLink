"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signUp, supabase } from "../../lib/supabase";
import { Button, Field, Notice } from "../../components/ui";

type SignupMode = "new" | "bind";
type BindingStage = "email" | "verify" | "password" | "done";

const BINDING_USER_ID_KEY = "herlink_account_binding_user_id";

export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<SignupMode>("new");
  const [stage, setStage] = useState<BindingStage>("email");
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshBindingState = useCallback(async () => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setMode("new");
      setStage("email");
      setChecking(false);
      return;
    }

    const { data: identityId, error: identityError } = await (supabase as any).rpc("resolve_active_anonymous_chat_identity");
    const hasAnonymousIdentity = !identityError && typeof identityId === "string" && identityId.length > 0;
    const expectedUserId = sessionStorage.getItem(BINDING_USER_ID_KEY);

    if (expectedUserId && user.id !== expectedUserId) {
      sessionStorage.removeItem(BINDING_USER_ID_KEY);
      setError("帳號驗證失敗：匿名身份不一致，原本聊天室沒有被變更。");
      setMode(hasAnonymousIdentity ? "bind" : "new");
      setStage("email");
      setChecking(false);
      return;
    }

    if (expectedUserId) {
      setMode("bind");
      setEmail(user.email ?? "");
      setStage(user.email_confirmed_at ? "password" : "verify");
      setChecking(false);
      return;
    }

    setMode(hasAnonymousIdentity ? "bind" : "new");
    setStage("email");
    setChecking(false);
  }, []);

  useEffect(() => { void refreshBindingState(); }, [refreshBindingState]);

  const beginBinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("匿名登入狀態已失效，請重新整理後再試。");
      const { data: identityId, error: identityError } = await (supabase as any).rpc("resolve_active_anonymous_chat_identity");
      if (identityError || typeof identityId !== "string" || !identityId) throw new Error("匿名身分已失效，請重新整理後再試。");

      sessionStorage.setItem(BINDING_USER_ID_KEY, user.id);
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=/signup`;
      const { data, error: authError } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo });
      if (authError) {
        sessionStorage.removeItem(BINDING_USER_ID_KEY);
        throw authError;
      }
      if (!data.user || data.user.id !== user.id) throw new Error("帳號綁定驗證失敗，請先不要登出。");
      setStage(data.user.email_confirmed_at ? "password" : "verify");
      setMessage(data.user.email_confirmed_at ? "信箱已驗證，請設定登入密碼。" : "驗證信已寄出。請使用同一個瀏覽器開啟驗證信，再回來完成密碼設定。");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, err instanceof Error ? err.message : "帳號綁定失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  const checkVerification = async () => {
    setLoading(true); setError(null); setMessage(null);
    try {
      const expectedUserId = sessionStorage.getItem(BINDING_USER_ID_KEY);
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user || !expectedUserId) throw new Error("找不到待完成的帳號綁定，請重新申請。");
      if (user.id !== expectedUserId) throw new Error("帳號驗證失敗：匿名身份不一致，原本聊天室沒有被變更。");
      if (!user.email_confirmed_at) {
        setMessage("尚未完成信箱驗證。請先開啟驗證信，再按一次確認。");
        return;
      }
      setEmail(user.email ?? email);
      setStage("password");
      setMessage("信箱驗證完成。請設定登入密碼。");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, err instanceof Error ? err.message : "驗證失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  const finishBinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      if (password.length < 8) throw new Error("密碼至少需要 8 個字元。");
      const expectedUserId = sessionStorage.getItem(BINDING_USER_ID_KEY);
      const before = await supabase.auth.getUser();
      const user = before.data.user;
      if (!user || !expectedUserId || user.id !== expectedUserId) throw new Error("帳號驗證失敗：匿名身份不一致，請先不要登出。");
      if (!user.email_confirmed_at) throw new Error("請先完成信箱驗證，再設定密碼。");

      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      const after = await supabase.auth.getUser();
      if (!after.data.user || after.data.user.id !== expectedUserId) throw new Error("帳號驗證失敗：身份已變更，請先不要登出。");

      sessionStorage.removeItem(BINDING_USER_ID_KEY);
      setPassword("");
      setStage("done");
      setMessage("帳號綁定完成，原本的匿名名稱、聊天室、訊息紀錄與聯絡人都已保留。");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, err instanceof Error ? err.message : "密碼設定失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      if (password.length < 8) throw new Error("密碼至少需要 8 個字元。");
      const { data, error: authError } = await signUp(email.trim(), password);
      if (authError) throw authError;
      if (!data.user) throw new Error("帳號建立失敗，請稍後再試。");
      setMessage(data.session ? "帳號建立完成，現在已登入。" : "帳號建立完成。若收到驗證信，請先完成信箱驗證後再登入。");
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, err instanceof Error ? err.message : "申請失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  if (checking) return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",background:"#0d0a12",color:"#bdb6c7",fontSize:16}}>正在確認帳號狀態…</main>;

  const description = mode === "bind" ? "為目前的匿名身分建立登入方式。綁定後會保留原本的匿名名稱、聊天室、訊息紀錄與聯絡人。" : "建立 HerLink 帳號後即可登入使用；之後建立的匿名聊天資料會跟著這個帳號。";
  const shell = {display:"grid",gap:18} as const;

  return <main style={{minHeight:"100dvh",background:"radial-gradient(circle at 50% 0%, #291b38 0, #130e19 36%, #0d0a12 72%)",color:"#fff",padding:"max(18px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom))"}}><div style={{width:"min(100%,520px)",margin:"0 auto"}}>
    <button type="button" onClick={()=>router.push("/")} style={{border:0,background:"transparent",color:"#d9d1e2",fontSize:16,fontWeight:800,padding:"10px 0 24px",cursor:"pointer"}}>‹ 返回 HerLink</button>
    <div style={{fontSize:13,fontWeight:900,letterSpacing:2,color:"#c69cff",marginBottom:10}}>HERLINK ACCOUNT</div><h1 style={{fontSize:"clamp(30px,8vw,42px)",lineHeight:1.08,margin:"0 0 12px",fontWeight:950}}>申請帳號</h1><p style={{margin:"0 0 30px",color:"#bdb6c7",fontSize:16,lineHeight:1.7}}>{description}</p>
    {mode === "new" ? <form onSubmit={createAccount} style={shell}><Field label="電子郵件" htmlFor="signup-email"><input id="signup-email" className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="email" /></Field><Field label="密碼" htmlFor="signup-password" hint="至少 8 個字元"><input id="signup-password" className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required minLength={8} autoComplete="new-password" /></Field><Button type="submit" size="lg" disabled={loading}>{loading ? "申請中…" : "申請帳號"}</Button></form> : stage === "email" ? <form onSubmit={beginBinding} style={shell}><Field label="電子郵件" htmlFor="bind-email"><input id="bind-email" className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="email" /></Field><Button type="submit" size="lg" disabled={loading || !email.trim()}>{loading ? "寄送中…" : "寄送驗證信"}</Button></form> : stage === "verify" ? <div style={shell}><Notice>驗證信已寄出。完成信箱驗證後再按下方按鈕。</Notice><Button type="button" size="lg" onClick={checkVerification} disabled={loading}>{loading ? "確認中…" : "我已完成信箱驗證"}</Button></div> : stage === "password" ? <form onSubmit={finishBinding} style={shell}><Notice>信箱已驗證。現在設定登入密碼，完成後才會顯示綁定成功。</Notice><Field label="密碼" htmlFor="bind-password" hint="至少 8 個字元"><input id="bind-password" className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required minLength={8} autoComplete="new-password" /></Field><Button type="submit" size="lg" disabled={loading || password.length < 8}>{loading ? "設定中…" : "完成帳號綁定"}</Button></form> : <Notice variant="success">帳號綁定完成，可以使用信箱與密碼登入。</Notice>}
    {error ? <div style={{marginTop:16}}><Notice variant="danger">{error}</Notice></div> : null}{message ? <div style={{marginTop:16}}><Notice variant="success">{message}</Notice></div> : null}
    <div style={{marginTop:28,paddingTop:22,borderTop:"1px solid rgba(255,255,255,.09)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,color:"#aaa2b3"}}><span>已經有帳號？</span><Button variant="link" type="button" onClick={()=>router.push("/login")}>登入帳號</Button></div>
  </div></main>;
}

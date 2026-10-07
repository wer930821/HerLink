"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signUp, supabase } from "../../lib/supabase";
import { Button, Field, Notice } from "../../components/ui";

type SignupMode = "new" | "bind";

export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<SignupMode>("new");
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(async ({ data }: any) => {
      if (!alive) return;
      if (!data.session) {
        setMode("new");
        setChecking(false);
        return;
      }
      const { data: identityId, error: identityError } = await (supabase as any).rpc("resolve_active_anonymous_chat_identity");
      if (!alive) return;
      setMode(!identityError && typeof identityId === "string" && identityId.length > 0 ? "bind" : "new");
      setChecking(false);
    }).catch(() => {
      if (alive) { setMode("new"); setChecking(false); }
    });
    return () => { alive = false; };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      if (password.length < 8) throw new Error("密碼至少需要 8 個字元。");

      if (mode === "bind") {
        const before = await supabase.auth.getSession();
        if (!before.data.session) throw new Error("匿名登入狀態已失效，請重新整理後再試。");
        const { data: identityId, error: identityError } = await (supabase as any).rpc("resolve_active_anonymous_chat_identity");
        if (identityError || typeof identityId !== "string" || !identityId) throw new Error("匿名身分已失效，請重新整理後再試。");
        const authUserId = before.data.session.user.id;
        const { data, error: authError } = await supabase.auth.updateUser({ email: email.trim(), password });
        if (authError) throw authError;
        if (!data.user || data.user.id !== authUserId) throw new Error("帳號綁定驗證失敗，請先不要登出。");
        setMessage("申請完成。原本的匿名名稱、聊天室、訊息紀錄與聯絡人都會保留。若收到驗證信，請完成信箱驗證後再跨瀏覽器登入。");
      } else {
        const { data, error: authError } = await signUp(email.trim(), password);
        if (authError) throw authError;
        if (!data.user) throw new Error("帳號建立失敗，請稍後再試。");
        setMessage(data.session ? "帳號建立完成，現在已登入。" : "帳號建立完成。若收到驗證信，請先完成信箱驗證後再登入。");
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "";
      const alreadyRegistered = /already registered|user already exists|email.*registered/i.test(rawMessage);
      setError(alreadyRegistered ? "這個電子郵件已經註冊過了，請改用登入帳號。" : rawMessage || getFriendlyAuthErrorMessage(err, "申請失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  if (checking) return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",background:"#0d0a12",color:"#bdb6c7",fontSize:16}}>正在確認帳號狀態…</main>;

  const description = mode === "bind"
    ? "為目前的匿名身分建立登入方式。綁定後會保留原本的匿名名稱、聊天室、訊息紀錄與聯絡人。"
    : "建立 HerLink 帳號後即可登入使用；之後建立的匿名聊天資料會跟著這個帳號。";

  return <main style={{minHeight:"100dvh",background:"radial-gradient(circle at 50% 0%, #291b38 0, #130e19 36%, #0d0a12 72%)",color:"#fff",padding:"max(18px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom))"}}><div style={{width:"min(100%,520px)",margin:"0 auto"}}>
    <button type="button" onClick={()=>router.push("/")} style={{border:0,background:"transparent",color:"#d9d1e2",fontSize:16,fontWeight:800,padding:"10px 0 24px",cursor:"pointer"}}>‹ 返回 HerLink</button>
    <div style={{fontSize:13,fontWeight:900,letterSpacing:2,color:"#c69cff",marginBottom:10}}>HERLINK ACCOUNT</div><h1 style={{fontSize:"clamp(30px,8vw,42px)",lineHeight:1.08,margin:"0 0 12px",fontWeight:950}}>申請帳號</h1><p style={{margin:"0 0 30px",color:"#bdb6c7",fontSize:16,lineHeight:1.7}}>{description}</p>
    <form onSubmit={onSubmit} style={{display:"grid",gap:18}}><Field label="電子郵件" htmlFor="signup-email"><input id="signup-email" className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="email" placeholder="輸入電子郵件" style={{minHeight:54,fontSize:17}} /></Field><Field label="密碼" htmlFor="signup-password" hint="至少 8 個字元"><input id="signup-password" className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required minLength={8} autoComplete="new-password" placeholder="設定登入密碼" style={{minHeight:54,fontSize:17}} /></Field>{error ? <Notice variant="danger">{error}</Notice> : null}{message ? <Notice variant="success">{message}</Notice> : null}<Button type="submit" size="lg" disabled={loading || !email.trim() || password.length < 8}>{loading ? "申請中…" : mode === "bind" ? "申請並綁定" : "申請帳號"}</Button></form>
    <div style={{marginTop:28,paddingTop:22,borderTop:"1px solid rgba(255,255,255,.09)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,color:"#aaa2b3"}}><span>已經有帳號？</span><Button variant="link" type="button" onClick={()=>router.push("/login")}>登入帳號</Button></div>
  </div></main>;
}

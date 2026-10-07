"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { supabase } from "../../lib/supabase";
import { Button, Field, Notice } from "../../components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const user = data.session?.user;
      setAllowed(Boolean(user?.is_anonymous));
      setChecking(false);
    });
    return () => { alive = false; };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allowed) return;
    setLoading(true); setError(null); setMessage(null);
    try {
      if (password.length < 8) throw new Error("密碼至少需要 8 個字元。");
      const before = await supabase.auth.getSession();
      if (!before.data.session?.user?.is_anonymous) throw new Error("目前沒有可綁定的匿名身分，請先回首頁建立匿名身分。");
      const { data, error: authError } = await supabase.auth.updateUser({ email: email.trim(), password });
      if (authError) throw authError;
      if (!data.user || data.user.id !== before.data.session.user.id) throw new Error("帳號綁定驗證失敗，請先不要登出。");
      setMessage("申請完成。原本的匿名名稱、聊天室、訊息紀錄與聯絡人都會保留。若收到驗證信，請完成信箱驗證後再跨瀏覽器登入。");
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "";
      const alreadyRegistered = /already registered|user already exists|email.*registered/i.test(rawMessage);
      setError(alreadyRegistered
        ? "這個電子郵件已經註冊過了，請改用登入帳號。"
        : rawMessage || getFriendlyAuthErrorMessage(err, "申請失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  if (checking) return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",background:"#0d0a12",color:"#bdb6c7",fontSize:16}}>正在確認匿名身分…</main>;
  if (!allowed) return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",background:"#0d0a12",color:"#fff",padding:24,textAlign:"center"}}><div><p style={{fontSize:18,lineHeight:1.7}}>目前沒有可綁定的匿名身分。</p><Button type="button" size="lg" onClick={()=>router.push("/")}>回首頁</Button></div></main>;

  return (
    <main style={{minHeight:"100dvh",background:"radial-gradient(circle at 50% 0%, #291b38 0, #130e19 36%, #0d0a12 72%)",color:"#fff",padding:"max(18px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom))"}}>
      <div style={{width:"min(100%,520px)",margin:"0 auto"}}>
        <button type="button" onClick={()=>router.push("/")} style={{border:0,background:"transparent",color:"#d9d1e2",fontSize:16,fontWeight:800,padding:"10px 0 24px",cursor:"pointer"}}>‹ 返回 HerLink</button>
        <div style={{fontSize:13,fontWeight:900,letterSpacing:2,color:"#c69cff",marginBottom:10}}>HERLINK ACCOUNT</div>
        <h1 style={{fontSize:"clamp(30px,8vw,42px)",lineHeight:1.08,margin:"0 0 12px",fontWeight:950}}>申請帳號</h1>
        <p style={{margin:"0 0 30px",color:"#bdb6c7",fontSize:16,lineHeight:1.7}}>為目前的匿名身分建立登入方式。綁定後會保留原本的匿名名稱、聊天室、訊息紀錄與聯絡人。</p>

        <form onSubmit={onSubmit} style={{display:"grid",gap:18}}>
          <Field label="電子郵件" htmlFor="signup-email">
            <input id="signup-email" className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="email" placeholder="輸入電子郵件" style={{minHeight:54,fontSize:17}} />
          </Field>
          <Field label="密碼" htmlFor="signup-password" hint="至少 8 個字元">
            <input id="signup-password" className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required minLength={8} autoComplete="new-password" placeholder="設定登入密碼" style={{minHeight:54,fontSize:17}} />
          </Field>
          {error ? <Notice variant="danger">{error}</Notice> : null}
          {message ? <Notice variant="success">{message}</Notice> : null}
          <Button type="submit" size="lg" disabled={loading || !email.trim() || password.length < 8}>{loading ? "申請中…" : "申請帳號"}</Button>
        </form>

        <div style={{marginTop:28,paddingTop:22,borderTop:"1px solid rgba(255,255,255,.09)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,color:"#aaa2b3"}}>
          <span>已經有帳號？</span>
          <Button variant="link" type="button" onClick={()=>router.push("/login")}>登入帳號</Button>
        </div>
      </div>
    </main>
  );
}

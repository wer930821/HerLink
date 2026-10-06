"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signUp } from "../../lib/supabase";
import { Button, Field, Notice } from "../../components/ui";

const TEST_NAME = "孤星企鵝";

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
    // The signup entry is public. Do not redirect users back to the home page
    // before they can even open the account form.
    setAllowed(true);
    setChecking(false);
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allowed) return;
    setLoading(true); setError(null); setMessage(null);
    try {
      if (password.length < 8) throw new Error("密碼至少需要 8 個字元。");
      const { data, error: authError } = await signUp(email.trim(), password);
      if (authError) throw authError;
      if (data.session) { router.replace("/"); return; }
      setMessage("申請完成。若收到驗證信，請先完成信箱驗證後再登入。");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : getFriendlyAuthErrorMessage(err, "申請失敗，請稍後再試。"));
    } finally { setLoading(false); }
  };

  if (checking || !allowed) return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",background:"#0d0a12",color:"#bdb6c7",fontSize:16}}>正在確認測試身分…</main>;

  return (
    <main style={{minHeight:"100dvh",background:"radial-gradient(circle at 50% 0%, #291b38 0, #130e19 36%, #0d0a12 72%)",color:"#fff",padding:"max(18px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom))"}}>
      <div style={{width:"min(100%,520px)",margin:"0 auto"}}>
        <button type="button" onClick={()=>router.push("/")} style={{border:0,background:"transparent",color:"#d9d1e2",fontSize:16,fontWeight:800,padding:"10px 0 24px",cursor:"pointer"}}>‹ 返回 HerLink</button>
        <div style={{fontSize:13,fontWeight:900,letterSpacing:2,color:"#c69cff",marginBottom:10}}>HERLINK ACCOUNT</div>
        <h1 style={{fontSize:"clamp(30px,8vw,42px)",lineHeight:1.08,margin:"0 0 12px",fontWeight:950}}>申請帳號</h1>
        <p style={{margin:"0 0 30px",color:"#bdb6c7",fontSize:16,lineHeight:1.7}}>為目前的匿名身份建立登入方式。這是孤星企鵝專用測試頁面。</p>

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

"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signIn, supabase } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

const TEST_NAME = "孤星企鵝";
function getLoginDestination(){if(typeof window==="undefined")return "/";return new URLSearchParams(window.location.search).get("next")==="/admin"?"/admin":"/"}

export default function LoginPage(){
 const router=useRouter();
 const [destination,setDestination]=useState("/"); const isAdminLogin=destination==="/admin";
 const [allowed,setAllowed]=useState(false); const [checking,setChecking]=useState(true);
 const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [confirmPassword,setConfirmPassword]=useState("");
 const [adminCreateMode,setAdminCreateMode]=useState(false); const [bootstrapAvailable,setBootstrapAvailable]=useState(false);
 const [success,setSuccess]=useState<string|null>(null); const [loading,setLoading]=useState(false); const [error,setError]=useState<string|null>(null);

 useEffect(()=>{let mounted=true;const next=getLoginDestination();setDestination(next);
   if(next==="/admin"){
     setAllowed(true);setChecking(false);
     void supabase.rpc("admin_bootstrap_available").then(({data}:{data:boolean|null})=>setBootstrapAvailable(data===true)).catch(()=>setBootstrapAvailable(false));
     void supabase.auth.getSession().then(({data}:{data:{session:Session|null}})=>{if(data.session?.user.is_anonymous)void supabase.auth.signOut()});
     return()=>{mounted=false};
   }
   void (async()=>{const {data}=await supabase.auth.getSession();const userId=data.session?.user.id;if(!userId){router.replace("/");return}
     const {data:profile}=await supabase.from("profiles").select("anonymous_display_name").eq("id",userId).maybeSingle();if(!mounted)return;
     if(profile?.anonymous_display_name!==TEST_NAME){router.replace("/");return}setAllowed(true);setChecking(false);
   })();return()=>{mounted=false};
 },[router]);

 const onSubmit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!allowed)return;setLoading(true);setError(null);setSuccess(null);try{
   if(isAdminLogin&&adminCreateMode){if(password.length<10)throw new Error("管理員密碼至少需要 10 個字元。");if(password!==confirmPassword)throw new Error("兩次輸入的密碼不一致。");const redirectTo=`${window.location.origin}/auth/callback?next=/admin`;const {data,error:signUpError}=await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:redirectTo}});if(signUpError)throw signUpError;if(data.session)router.replace("/admin");else setSuccess("確認信已寄出，請到 Email 點擊確認連結。確認後會自動取得後台管理員權限。");return}
   const {error:authError}=await signIn(email.trim(),password);if(authError)throw authError;router.replace(getLoginDestination());
 }catch(err){const message=err instanceof Error?err.message:"";setError(message||getFriendlyAuthErrorMessage(err,"登入失敗，請稍後再試。"))}finally{setLoading(false)}};

 if(!isAdminLogin&&(checking||!allowed))return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",background:"#0d0a12",color:"#bdb6c7",fontSize:16}}>正在確認測試身分…</main>;

 if(isAdminLogin)return <main className="stack admin-login-page"><PageHero title={adminCreateMode?"建立管理員帳號":"登入管理員帳號"} description={adminCreateMode?"首次啟用僅限已設定的管理員 Email。完成 Email 驗證後會自動取得後台權限。":"使用管理員 Email / 密碼登入後台。"}/><Surface as="form" elevation={1} onSubmit={onSubmit}><Field label="電子郵件" htmlFor="login-email"><input id="login-email" className="input" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="請輸入電子郵件"/></Field><Field label="密碼" htmlFor="login-password" hint={adminCreateMode?"至少 10 個字元":undefined}><input id="login-password" className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete={adminCreateMode?"new-password":"current-password"}/></Field>{adminCreateMode?<Field label="確認密碼" htmlFor="login-confirm-password"><input id="login-confirm-password" className="input" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} type="password" autoComplete="new-password"/></Field>:null}{error?<Notice variant="danger">{error}</Notice>:null}{success?<Notice variant="success">{success}</Notice>:null}<Button type="submit" size="lg" disabled={loading}>{loading?(adminCreateMode?"建立中…":"登入中…"):adminCreateMode?"建立並登入":"登入"}</Button>{(bootstrapAvailable||adminCreateMode)?<Button variant="link" type="button" onClick={()=>{setAdminCreateMode(v=>!v);setError(null);setConfirmPassword("");setSuccess(null)}} disabled={loading}>{adminCreateMode?"已有管理員帳號？回到登入":"第一次使用？啟用管理員帳號"}</Button>:null}{!adminCreateMode?<Button variant="link" type="button" onClick={()=>router.push("/forgot-password")} disabled={loading}>忘記密碼？</Button>:null}</Surface></main>;

 return <main style={{minHeight:"100dvh",background:"radial-gradient(circle at 50% 0%, #211a38 0, #120e1a 36%, #0d0a12 72%)",color:"#fff",padding:"max(18px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom))"}}><div style={{width:"min(100%,520px)",margin:"0 auto"}}>
   <button type="button" onClick={()=>router.push("/")} style={{border:0,background:"transparent",color:"#d9d1e2",fontSize:16,fontWeight:800,padding:"10px 0 24px",cursor:"pointer"}}>‹ 返回 HerLink</button>
   <div style={{fontSize:13,fontWeight:900,letterSpacing:2,color:"#9fb3ff",marginBottom:10}}>HERLINK ACCOUNT</div><h1 style={{fontSize:"clamp(30px,8vw,42px)",lineHeight:1.08,margin:"0 0 12px",fontWeight:950}}>登入帳號</h1><p style={{margin:"0 0 30px",color:"#bdb6c7",fontSize:16,lineHeight:1.7}}>登入已建立的 HerLink 帳號。這是孤星企鵝專用測試頁面。</p>
   <form onSubmit={onSubmit} style={{display:"grid",gap:18}}><Field label="電子郵件" htmlFor="login-email"><input id="login-email" className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="email" placeholder="輸入電子郵件" style={{minHeight:54,fontSize:17}}/></Field><Field label="密碼" htmlFor="login-password"><input id="login-password" className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required autoComplete="current-password" placeholder="輸入登入密碼" style={{minHeight:54,fontSize:17}}/></Field>{error?<Notice variant="danger">{error}</Notice>:null}<Button type="submit" size="lg" disabled={loading||!email.trim()||!password}>{loading?"登入中…":"登入帳號"}</Button><Button variant="link" type="button" onClick={()=>router.push("/forgot-password")} disabled={loading}>忘記密碼？</Button></form>
   <div style={{marginTop:28,paddingTop:22,borderTop:"1px solid rgba(255,255,255,.09)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,color:"#aaa2b3"}}><span>還沒有帳號？</span><Button variant="link" type="button" onClick={()=>router.push("/signup")}>申請帳號</Button></div>
 </div></main>;
}

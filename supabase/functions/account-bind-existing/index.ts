import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://her-link-ten.vercel.app", "https://her-link-kivora3.vercel.app"]);
function cors(req: Request) { const origin=req.headers.get("Origin")??""; return {"Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://her-link-ten.vercel.app","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Cache-Control":"no-store"}; }
function json(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json; charset=utf-8"}})}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST") return json(req,{ok:false,error:"Method not allowed."},405);
  const authorization=req.headers.get("authorization")??"";
  const url=Deno.env.get("SUPABASE_URL")??"", anonKey=Deno.env.get("SUPABASE_ANON_KEY")??"", serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!authorization.toLowerCase().startsWith("bearer ")||!url||!anonKey||!serviceKey) return json(req,{ok:false,error:"目前匿名身分已失效。"},401);
  const caller=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const sourceAuth=await caller.auth.getUser(); const sourceUser=sourceAuth.data.user;
  if(sourceAuth.error||!sourceUser) return json(req,{ok:false,error:"目前匿名身分已失效。"},401);
  const resolved=await caller.rpc("resolve_active_anonymous_chat_identity");
  if(resolved.error||typeof resolved.data!=="string"||!resolved.data) return json(req,{ok:false,error:"無法確認目前匿名身分。"},409);
  const sourceIdentityId=resolved.data;
  const sourceProfile=await admin.from("profiles").select("id,anonymous_mode_enabled,anonymous_display_name").eq("id",sourceIdentityId).maybeSingle();
  if(sourceProfile.error||!sourceProfile.data?.anonymous_mode_enabled||!sourceProfile.data.anonymous_display_name) return json(req,{ok:false,error:"目前沒有可綁定的匿名身分。"},409);
  const body=await req.json().catch(()=>({})) as {email?:string;password?:string}; const email=(body.email??"").trim(); const password=body.password??"";
  if(!email||!password) return json(req,{ok:false,error:"請輸入電子郵件與密碼。"},400);
  const targetClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const targetLogin=await targetClient.auth.signInWithPassword({email,password});
  const targetUser=targetLogin.data.user, targetSession=targetLogin.data.session;
  if(targetLogin.error||!targetUser||!targetSession) return json(req,{ok:false,error:"電子郵件或密碼錯誤。"},401);
  if(targetUser.id===sourceUser.id) return json(req,{ok:true,alreadyBound:true,displayName:sourceProfile.data.anonymous_display_name,session:{access_token:targetSession.access_token,refresh_token:targetSession.refresh_token}});
  const targetState=await admin.from("anonymous_identity_device_state").select("anonymous_identity_id").eq("active_auth_user_id",targetUser.id).maybeSingle();
  if(targetState.error) return json(req,{ok:false,error:"目前無法檢查帳號狀態。"},500);
  if(targetState.data?.anonymous_identity_id&&targetState.data.anonymous_identity_id!==sourceIdentityId) return json(req,{ok:false,error:"這個帳號已綁定其他匿名身分，為避免覆蓋資料已停止綁定。"},409);
  const targetProfile=await admin.from("profiles").select("anonymous_display_name").eq("id",targetUser.id).maybeSingle();
  if(targetProfile.error) return json(req,{ok:false,error:"目前無法檢查帳號資料。"},500);
  if(targetProfile.data?.anonymous_display_name&&targetUser.id!==sourceIdentityId) return json(req,{ok:false,error:"這個帳號已有匿名資料，為避免覆蓋資料已停止綁定。"},409);
  const state=await admin.from("anonymous_identity_device_state").select("generation").eq("anonymous_identity_id",sourceIdentityId).maybeSingle();
  if(state.error) return json(req,{ok:false,error:"目前無法綁定匿名身分。"},500);
  if(state.data){
    const updated=await admin.from("anonymous_identity_device_state").update({active_auth_user_id:targetUser.id,generation:Number(state.data.generation)+1,updated_at:new Date().toISOString()}).eq("anonymous_identity_id",sourceIdentityId).eq("generation",state.data.generation).select("anonymous_identity_id").maybeSingle();
    if(updated.error||!updated.data) return json(req,{ok:false,error:"匿名身分剛剛已在其他裝置變更，請重新整理後再試。"},409);
  } else {
    const inserted=await admin.from("anonymous_identity_device_state").insert({anonymous_identity_id:sourceIdentityId,active_auth_user_id:targetUser.id,generation:1}).select("anonymous_identity_id").single();
    if(inserted.error) return json(req,{ok:false,error:"目前無法綁定匿名身分。"},409);
  }
  return json(req,{ok:true,displayName:sourceProfile.data.anonymous_display_name,session:{access_token:targetSession.access_token,refresh_token:targetSession.refresh_token}});
});

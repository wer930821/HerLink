"use client";
import { useCallback,useEffect,useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useAdminSession } from "../../../lib/admin-client";

export function AdminMailboxNavLink(){
 const {session}=useAdminSession(); const [count,setCount]=useState(0);
 const refresh=useCallback(async()=>{if(!session){setCount(0);return;}const {data}=await (supabase as any).rpc("station_mail_admin_unread_count");setCount(Number(data??0)); try { (window as any).ReactNativeWebView?.postMessage(JSON.stringify({type:"mailbox-unread",count:Number(data??0)})); } catch {}},[session]);
 useEffect(()=>{if(!session)return;void refresh();
  const onNativePushToken=async(event:Event)=>{
   const token=String((event as CustomEvent<{token?:string}>).detail?.token??"").trim();
   if(!token)return;
   const {error}=await (supabase as any).rpc("create_or_update_push_token",{p_expo_push_token:token,p_device_hash:"herlink-admin-app",p_platform:"android"});
   try {(window as any).ReactNativeWebView?.postMessage(JSON.stringify({type:"admin-push-registration",ok:!error,error:error?.message??null}));} catch {}
  };
  window.addEventListener("herlink-admin-push-token",onNativePushToken as EventListener);
  try {(window as any).ReactNativeWebView?.postMessage(JSON.stringify({type:"admin-push-token-request"}));} catch {}
  const c=supabase.channel("admin-mailbox-nav")
  .on("postgres_changes",{event:"*",schema:"public",table:"station_mail_threads"},()=>void refresh())
  .on("postgres_changes",{event:"*",schema:"public",table:"station_mail_messages"},()=>void refresh())
  .subscribe();return()=>{window.removeEventListener("herlink-admin-push-token",onNativePushToken as EventListener);void supabase.removeChannel(c)}},[session,refresh]);
 return <a className="admin-nav-link admin-mailbox-nav-link" href="/admin/mailbox"><span>站長信箱</span>{count>0?<span className="admin-mailbox-unread">{count>99?"99+":count}</span>:null}</a>
}
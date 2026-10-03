"use client";
import { useCallback,useEffect,useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useAdminSession } from "../../../lib/admin-client";

export function AdminMailboxNavLink(){
 const {session}=useAdminSession(); const [count,setCount]=useState(0);
 const refresh=useCallback(async()=>{if(!session){setCount(0);return;}const {data}=await (supabase as any).rpc("station_mail_admin_unread_count");setCount(Number(data??0)); try { (window as any).ReactNativeWebView?.postMessage(JSON.stringify({type:"mailbox-unread",count:Number(data??0)})); } catch {}},[session]);
 useEffect(()=>{if(!session)return;void refresh();const c=supabase.channel("admin-mailbox-nav")
  .on("postgres_changes",{event:"*",schema:"public",table:"station_mail_threads"},()=>void refresh())
  .on("postgres_changes",{event:"*",schema:"public",table:"station_mail_messages"},()=>void refresh())
  .subscribe();return()=>{void supabase.removeChannel(c)}},[session,refresh]);
 return <a className="admin-nav-link admin-mailbox-nav-link" href="/admin/mailbox"><span>站長信箱</span>{count>0?<span className="admin-mailbox-unread">{count>99?"99+":count}</span>:null}</a>
}
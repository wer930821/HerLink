"use client";
import { useCallback,useEffect,useState } from "react";
import { useAdminSession } from "../../../lib/admin-client";
import { supabase } from "../../../lib/supabase";
import { AdminEmpty,AdminSection } from "../_components";
import { Button,Field,Notice } from "../../../components/ui";

type T={id:string;user_id:string;subject:string;category:string;status:string;updated_at:string;unread:boolean};
type M={id:string;sender_role:"user"|"admin";body:string;created_at:string};
export default function AdminMailbox(){
 const {session,loading}=useAdminSession();const [items,setItems]=useState<T[]>([]);const [sel,setSel]=useState<T|null>(null);const [msgs,setMsgs]=useState<M[]>([]);const [reply,setReply]=useState("");const [err,setErr]=useState<string|null>(null);
 const load=useCallback(async()=>{const {data,error}=await (supabase as any).rpc("station_mail_admin_inbox");if(error)setErr("無法載入站長信箱。");else setItems((data??[]) as T[])},[]);
 useEffect(()=>{if(!session)return;void load();const c=supabase.channel("admin-mailbox-page").on("postgres_changes",{event:"*",schema:"public",table:"station_mail_threads"},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"station_mail_messages"},async(payload)=>{void load();if(sel){const row=(payload as any).new as {thread_id?:string};if(row?.thread_id===sel.id){const {data}=await (supabase as any).rpc("station_mail_admin_messages",{p_thread_id:sel.id});setMsgs((data??[]) as M[])}}}).subscribe();return()=>{void supabase.removeChannel(c)}},[session,load,sel]);
 const open=async(t:T)=>{setSel(t);const {data,error}=await (supabase as any).rpc("station_mail_admin_messages",{p_thread_id:t.id});if(error)return setErr("無法載入信件。");setMsgs((data??[]) as M[]);await (supabase as any).rpc("station_mail_admin_mark_read",{p_thread_id:t.id});void load()};
 const send=async()=>{if(!sel||!reply.trim())return;const {error}=await (supabase as any).rpc("station_mail_admin_reply",{p_thread_id:sel.id,p_body:reply.trim()});if(error)return setErr("回覆失敗。");setReply("");void open(sel)};
 if(loading)return <AdminEmpty>正在載入…</AdminEmpty>; if(!session)return <AdminEmpty>請先登入管理員。</AdminEmpty>;
 return <AdminSection title="站長信箱">{err&&<Notice variant="warning">{err}</Notice>}{sel?<><Button variant="secondary" onClick={()=>setSel(null)}>返回收件匣</Button><h2>{sel.subject}</h2><div style={{display:"grid",gap:10}}>{msgs.map(m=><div key={m.id} style={{padding:12,borderRadius:12,background:m.sender_role==="admin"?"rgba(212,175,55,.14)":"rgba(255,255,255,.06)"}}><strong>{m.sender_role==="admin"?"站長":"使用者"}</strong><div>{m.body}</div><small>{new Date(m.created_at).toLocaleString("zh-TW")}</small></div>)}</div><Field label="管理員回覆"><textarea className="admin-mailbox-reply" value={reply} onChange={e=>setReply(e.target.value)} maxLength={2000}/></Field><Button onClick={send}>回覆使用者</Button></>:items.length===0?<AdminEmpty>目前沒有信件。</AdminEmpty>:<div style={{display:"grid",gap:8}}>{items.map(t=><button key={t.id} onClick={()=>void open(t)} style={{padding:14,textAlign:"left"}}><strong>{t.unread?"● ":""}{t.subject}</strong><div>{t.status==="replied"?"已回覆":"待處理"} · {new Date(t.updated_at).toLocaleString("zh-TW")}</div></button>)}</div>}</AdminSection>
}
"use client";
import { useCallback,useEffect,useState } from "react";
import { approveAdminRecoveryRequest,loadAdminRecoveryRequests,supabase,type AdminRecoveryRequest } from "../../../lib/supabase";
import { AdminEmpty,AdminSection,formatAdminTime } from "../_components";
import { Button,Notice } from "../../../components/ui";

function isExpired(x:AdminRecoveryRequest){
 return x.status==="pending" && new Date(x.expires_at).getTime()<=Date.now();
}

export default function RecoveryPage(){
 const [items,setItems]=useState<AdminRecoveryRequest[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const [busy,setBusy]=useState("");
 const load=useCallback(async()=>{setLoading(true);setError(null);const r=await loadAdminRecoveryRequests();if(r.error)setError(r.error.message||"無法載入恢復申請");else setItems((r.data??[]).filter(x=>x.status==="pending"));setLoading(false)},[]);
 useEffect(()=>{void load()},[load]);
 async function approve(x:AdminRecoveryRequest,side:"a"|"b"){if(!confirm(`確定將恢復碼 ${x.recovery_code} 恢復為 ${side.toUpperCase()} 方？`))return;setBusy(x.id+side);setError(null);const r=await approveAdminRecoveryRequest(x.recovery_code,side);if(r.error)setError(r.error.message);else await load();setBusy("")}
 async function reactivate(x:AdminRecoveryRequest){
  if(!confirm(`確定將恢復碼 ${x.recovery_code} 重新啟用 30 分鐘？`))return;
  setBusy(x.id+"reactivate");setError(null);
  const r=await supabase.functions.invoke("admin-reactivate-session-recovery",{body:{recoveryCode:x.recovery_code}});
  if(r.error)setError(r.error.message||"重新啟用失敗。");else await load();
  setBusy("");
 }
 return <AdminSection title="聊天室恢復申請" description="核對原匿名名稱與恢復碼後，將新匿名身份接回原聊天室。">
  {error?<Notice variant="danger">{error}</Notice>:null}
  {loading?<AdminEmpty>正在載入恢復申請…</AdminEmpty>:items.length===0?<AdminEmpty>目前沒有待處理的恢復申請。</AdminEmpty>:
   <div className="stack">{items.map(x=>{const expired=isExpired(x);return <div className="admin-card" key={x.id}><h3>恢復碼：{x.recovery_code}</h3><p className="muted">建立：{formatAdminTime(x.created_at)}</p><p className="muted">聊天室：{x.session_id}</p>{expired?<><p><strong>已過期</strong></p><div className="row"><Button variant="secondary" type="button" disabled={!!busy} onClick={()=>void reactivate(x)}>{busy===x.id+"reactivate"?"重新啟用中…":"重新啟用 30 分鐘"}</Button></div></>:<div className="row"><Button type="button" disabled={!!busy} onClick={()=>void approve(x,"a")}>恢復 A 方｜{x.a_anonymous_name}</Button><Button variant="secondary" type="button" disabled={!!busy} onClick={()=>void approve(x,"b")}>恢復 B 方｜{x.b_anonymous_name}</Button></div>}</div>})}</div>}
  <div className="row"><Button variant="secondary" type="button" onClick={()=>void load()}>重新整理</Button></div>
 </AdminSection>
}

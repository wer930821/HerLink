"use client";

import { useCallback, useEffect, useState } from "react";
import { approveAdminRecoveryRequest, getCurrentSession, loadAdminRecoveryRequests, type AdminRecoveryRequest } from "../../lib/supabase";

export default function AdminPage() {
  const [items,setItems]=useState<AdminRecoveryRequest[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");

  const load=useCallback(async()=>{
    setLoading(true); setError("");
    const {data:sessionData}=await getCurrentSession();
    if(!sessionData.session){ setError("請先使用管理員帳號登入。"); setLoading(false); return; }
    const result=await loadAdminRecoveryRequests();
    if(result.error){ setError(result.error.message || "無法載入聊天室恢復申請。"); }
    else setItems(result.data ?? []);
    setLoading(false);
  },[]);

  useEffect(()=>{ void load(); },[load]);

  async function approve(item:AdminRecoveryRequest,side:"a"|"b"){
    if(!confirm(`確定將恢復碼 ${item.recovery_code} 恢復為 ${side.toUpperCase()} 方？`)) return;
    setBusy(item.id+side); setError("");
    const result=await approveAdminRecoveryRequest(item.recovery_code,side);
    if(result.error) setError(result.error.message || "恢復失敗。");
    else await load();
    setBusy("");
  }

  return <main className="panel" style={{maxWidth:760,margin:"32px auto",padding:"24px"}}>
    <h1 className="hero-title">HerLink 後台</h1>
    <h2 style={{marginTop:28}}>聊天室恢復申請</h2>
    <p className="hero-copy">確認使用者原匿名身份後，再選擇原本的 A 方或 B 方。</p>
    {error ? <p style={{color:"#b42318"}}>{error}</p> : null}
    {loading ? <p>正在載入…</p> : items.length===0 ? <p>目前沒有待處理的恢復申請。</p> :
      items.map(item=><section key={item.id} style={{marginTop:16,padding:18,border:"1px solid #ead9cd",borderRadius:18}}>
        <strong style={{fontSize:20}}>恢復碼：{item.recovery_code}</strong>
        <p>建立時間：{new Date(item.created_at).toLocaleString("zh-TW")}</p>
        <p style={{wordBreak:"break-all"}}>聊天室：{item.session_id}</p>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button disabled={!!busy} onClick={()=>void approve(item,"a")}>恢復 A 方</button>
          <button disabled={!!busy} onClick={()=>void approve(item,"b")}>恢復 B 方</button>
        </div>
      </section>)}
    <button style={{marginTop:20}} onClick={()=>void load()}>重新整理</button>
  </main>;
}

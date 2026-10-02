"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveAdminRecoveryRequest,
  getCurrentSession,
  loadAdminEasterEggEvents,
  loadAdminRecoveryRequests,
  type AdminEasterEggEvent,
  type AdminRecoveryRequest,
} from "../../lib/supabase";

const EGG_LABELS: Record<string,string> = {
  thousand_messages: "1000 則訊息大彩蛋",
};

export default function AdminPage() {
  const [items,setItems]=useState<AdminRecoveryRequest[]>([]);
  const [eggEvents,setEggEvents]=useState<AdminEasterEggEvent[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");

  const load=useCallback(async()=>{
    setLoading(true); setError("");
    const {data:sessionData}=await getCurrentSession();
    if(!sessionData.session){ setError("請先使用管理員帳號登入。"); setLoading(false); return; }
    const [recoveryResult,eggResult]=await Promise.all([
      loadAdminRecoveryRequests(),
      loadAdminEasterEggEvents(),
    ]);
    if(recoveryResult.error) setError(recoveryResult.error.message || "無法載入聊天室恢復申請。");
    else setItems(recoveryResult.data ?? []);
    if(eggResult.error) setError(current=>current || eggResult.error?.message || "無法載入彩蛋紀錄。");
    else setEggEvents(eggResult.data ?? []);
    setLoading(false);
  },[]);

  useEffect(()=>{ void load(); },[load]);

  const eggStats=useMemo(()=>{
    const official=eggEvents.filter(item=>item.trigger_type!=="test");
    const counts=new Map<string,{kind:string,count:number,users:Set<string>,last:string}>();
    official.forEach(item=>{
      const row=counts.get(item.egg_kind) ?? {kind:item.egg_kind,count:0,users:new Set<string>(),last:item.created_at};
      row.count+=1; row.users.add(item.user_id);
      if(item.created_at>row.last) row.last=item.created_at;
      counts.set(item.egg_kind,row);
    });
    return [...counts.values()].sort((a,b)=>b.count-a.count);
  },[eggEvents]);

  async function approve(item:AdminRecoveryRequest,side:"a"|"b"){
    if(!confirm(`確定將恢復碼 ${item.recovery_code} 恢復為 ${side.toUpperCase()} 方？`)) return;
    setBusy(item.id+side); setError("");
    const result=await approveAdminRecoveryRequest(item.recovery_code,side);
    if(result.error) setError(result.error.message || "恢復失敗。");
    else await load();
    setBusy("");
  }

  return <main className="panel" style={{maxWidth:900,margin:"32px auto",padding:"24px"}}>
    <h1 className="hero-title">HerLink 後台</h1>

    <section style={{marginTop:28}}>
      <h2>彩蛋紀錄</h2>
      <p className="hero-copy">獨立統計正式彩蛋觸發；測試觸發不列入「最多彩蛋」排名。</p>
      {loading ? <p>正在載入…</p> : <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginTop:16}}>
          <div style={{padding:16,border:"1px solid #ead9cd",borderRadius:18}}><strong>正式觸發</strong><div style={{fontSize:28}}>{eggEvents.filter(x=>x.trigger_type!=="test").length}</div></div>
          <div style={{padding:16,border:"1px solid #ead9cd",borderRadius:18}}><strong>觸發人數</strong><div style={{fontSize:28}}>{new Set(eggEvents.filter(x=>x.trigger_type!=="test").map(x=>x.user_id)).size}</div></div>
          <div style={{padding:16,border:"1px solid #ead9cd",borderRadius:18}}><strong>測試觸發</strong><div style={{fontSize:28}}>{eggEvents.filter(x=>x.trigger_type==="test").length}</div></div>
        </div>
        <h3 style={{marginTop:22}}>彩蛋觸發排行</h3>
        {eggStats.length===0 ? <p>目前還沒有正式彩蛋觸發紀錄。</p> :
          eggStats.map((row,index)=><div key={row.kind} style={{display:"flex",justifyContent:"space-between",gap:16,padding:"12px 0",borderBottom:"1px solid #ead9cd"}}>
            <div><strong>#{index+1} {EGG_LABELS[row.kind] ?? row.kind}</strong><div style={{fontSize:13,opacity:.7}}>最近：{new Date(row.last).toLocaleString("zh-TW")}</div></div>
            <div style={{textAlign:"right"}}><strong>{row.count} 次</strong><div style={{fontSize:13,opacity:.7}}>{row.users.size} 人</div></div>
          </div>)}
        <h3 style={{marginTop:22}}>最近觸發</h3>
        {eggEvents.length===0 ? <p>目前沒有彩蛋紀錄。</p> :
          eggEvents.slice(0,50).map(item=><div key={item.id} style={{padding:"10px 0",borderBottom:"1px solid #ead9cd"}}>
            <strong>{EGG_LABELS[item.egg_kind] ?? item.egg_kind}</strong>
            <span style={{marginLeft:8}}>{item.trigger_type==="test" ? "測試" : "正式"}</span>
            <div style={{fontSize:13,opacity:.7}}>{new Date(item.created_at).toLocaleString("zh-TW")} · 聊天室 {item.session_id.slice(0,8)}</div>
          </div>)}
      </>}
    </section>

    <section style={{marginTop:36}}>
      <h2>聊天室恢復申請</h2>
      <p className="hero-copy">確認使用者原匿名身份後，再選擇原本的 A 方或 B 方。</p>
      {error ? <p style={{color:"#b42318"}}>{error}</p> : null}
      {!loading && (items.length===0 ? <p>目前沒有待處理的恢復申請。</p> :
        items.map(item=><section key={item.id} style={{marginTop:16,padding:18,border:"1px solid #ead9cd",borderRadius:18}}>
          <strong style={{fontSize:20}}>恢復碼：{item.recovery_code}</strong>
          <p>建立時間：{new Date(item.created_at).toLocaleString("zh-TW")}</p>
          <p style={{wordBreak:"break-all"}}>聊天室：{item.session_id}</p>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button disabled={!!busy} onClick={()=>void approve(item,"a")}>恢復 A 方</button>
            <button disabled={!!busy} onClick={()=>void approve(item,"b")}>恢復 B 方</button>
          </div>
        </section>))}
    </section>
    <button style={{marginTop:20}} onClick={()=>void load()}>重新整理</button>
  </main>;
}

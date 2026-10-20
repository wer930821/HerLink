"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../../../lib/admin-client";
import { AdminBadge, AdminEmpty, AdminSection, AdminStat, AdminStatGrid, AdminTable, AdminTableWrap, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

type Repair = { id:string; job_id:string; status:string; risk:string; summary:string; attempt_count:number; branch_name:string|null; pr_number:number|null; last_error:string|null; result:Record<string,unknown>; updated_at:string; created_at:string; completed_at:string|null; };
const tone=(status:string) => ["completed"].includes(status) ? "success" : ["failed","human_review"].includes(status) ? "danger" : ["queued","dispatched","waiting_ci","waiting_deploy","verifying"].includes(status) ? "warning" : "default";
const label=(status:string) => ({queued:"排隊中",dispatched:"已派送",waiting_ci:"等待 CI",waiting_deploy:"等待部署",verifying:"驗證中",completed:"完成",human_review:"需要人工確認",failed:"失敗"} as Record<string,string>)[status] ?? status;

export default function AdminRepairPage() {
  const { session, loading, accessToken } = useAdminSession();
  const [items,setItems]=useState<Repair[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [refreshing,setRefreshing]=useState(false);
  const load=useCallback(async()=>{ if(!accessToken)return; setRefreshing(true); setError(null); try { const res=await fetch("/api/admin/repairs?limit=100",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"}); const body=await res.json(); if(!res.ok) throw new Error(body.error||"載入失敗"); setItems(body.items??[]); } catch(e) { setError(e instanceof Error?e.message:"無法載入 AI 維修狀態。"); } finally { setRefreshing(false); } },[accessToken]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!accessToken)return;const id=window.setInterval(()=>void load(),30000);return()=>window.clearInterval(id)},[accessToken,load]);
  if(loading)return <AdminEmpty>正在載入…</AdminEmpty>;
  if(!session)return <AdminEmpty>請先登入管理員。</AdminEmpty>;
  const queued=items.filter(x=>["queued","dispatched","waiting_ci","waiting_deploy","verifying"].includes(x.status)).length;
  const review=items.filter(x=>x.status==="human_review").length;
  return <div className="stack"><AdminSection title="AI 維修員" description="唯讀監控 Repair Engine 的自主分析、風險門與 Draft PR 狀態。" action={<Button variant="secondary" size="sm" onClick={()=>void load()} disabled={refreshing}>{refreshing?"更新中…":"重新整理"}</Button>}>{error?<Notice variant="danger">{error}</Notice>:null}<AdminStatGrid><AdminStat label="目前處理中" value={queued} tone={queued?"warning":"default"}/><AdminStat label="需要人工確認" value={review} tone={review?"danger":"default"}/><AdminStat label="最近記錄" value={items.length}/></AdminStatGrid></AdminSection><AdminSection title="Repair 狀態"><AdminTableWrap><AdminTable label="Repair 狀態"><thead><tr><th>時間</th><th>Repair</th><th>狀態</th><th>風險</th><th>摘要</th><th>分支／PR</th><th>錯誤</th></tr></thead><tbody>{items.length?items.map(item=><tr key={item.id}><td>{formatAdminTime(item.updated_at)}</td><td><code>{shortId(item.id)}</code><div className="muted small">Job {shortId(item.job_id)}</div></td><td><AdminBadge tone={tone(item.status) as any}>{label(item.status)}</AdminBadge><div className="muted small">第 {item.attempt_count}/2 次</div></td><td>{item.risk==="low"?"低":"高"}</td><td style={{maxWidth:280}}>{item.summary||"—"}</td><td>{item.branch_name?<code>{item.branch_name}</code>:"—"}{item.pr_number?<div><a href={`https://github.com/wer930821/HerLink/pull/${item.pr_number}`} target="_blank" rel="noreferrer">Draft PR #{item.pr_number}</a></div>:null}</td><td>{item.last_error||"—"}</td></tr>):<tr><td colSpan={7}><AdminEmpty>目前沒有 Repair 記錄。</AdminEmpty></td></tr>}</tbody></AdminTable></AdminTableWrap></AdminSection></div>;
}

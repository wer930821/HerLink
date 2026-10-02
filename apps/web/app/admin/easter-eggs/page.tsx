"use client";

import { useEffect, useState } from "react";
import { fetchAdminJson, useAdminSession } from "../../../lib/admin-client";
import type { AdminEasterEggSummary } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminStat, AdminStatGrid, AdminTable, AdminTableWrap, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

const labels: Record<string,string> = {
  goodnight:"晚安", morning:"早安", hello:"安安／哈囉", hi:"Hi／Hello", penguin:"企鵝",
  sync:"默契", aurora:"想念極光", meteor:"加油流星", secret:"心動秘密", tired:"好累",
  offwork:"下班", food:"吃飯", curious:"在幹嘛", surprised:"真的假的", cute:"好可愛",
  sleepless:"睡不著", tomorrow:"明天見", hundred:"100 則", twoHundred:"200 則",
  threeHundred:"300 則", fourHundred:"400 則", fiveHundred:"500 則", thousand:"1000 則傳說級",
};
const eggLabel=(kind:string)=>labels[kind]??kind;

export default function EasterEggAdminPage() {
  const { session, loading, accessToken } = useAdminSession();
  const [data,setData]=useState<AdminEasterEggSummary|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [refreshing,setRefreshing]=useState(false);

  const load=async()=>{
    if(!accessToken) return;
    setRefreshing(true); setError(null);
    try { setData(await fetchAdminJson<AdminEasterEggSummary>(accessToken,"/api/admin/easter-eggs",{headers:{Authorization:`Bearer ${accessToken}`}})); }
    catch(err){ setError(err instanceof Error?err.message:"無法載入彩蛋紀錄。"); }
    finally { setRefreshing(false); }
  };

  useEffect(()=>{ void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[accessToken]);

  if(loading) return <AdminEmpty>正在載入後台驗證…</AdminEmpty>;
  if(!session||!accessToken) return <AdminEmpty>請先登入管理員帳號。</AdminEmpty>;

  return <div className="stack">
    <AdminSection title="彩蛋紀錄" description="獨立查看所有正式彩蛋的觸發排行與最近紀錄。" action={<Button variant="secondary" size="sm" type="button" disabled={refreshing} onClick={()=>void load()}>{refreshing?"更新中…":"重新整理"}</Button>}>
      {error?<Notice variant="danger">{error}</Notice>:null}
      <AdminStatGrid>
        <AdminStat label="累計觸發" value={(data?.total_count??0).toLocaleString("zh-TW")} />
        <AdminStat label="今日觸發" value={(data?.today_count??0).toLocaleString("zh-TW")} tone={(data?.today_count??0)>0?"success":"default"} />
        <AdminStat label="觸發人數" value={(data?.unique_user_count??0).toLocaleString("zh-TW")} />
        <AdminStat label="最多彩蛋" value={data?.ranking?.[0]?eggLabel(data.ranking[0].egg_kind):"—"} tone={data?.ranking?.[0]?"success":"default"} />
      </AdminStatGrid>
    </AdminSection>

    <AdminSection title="最多彩蛋排行" description="依累計觸發次數由高到低排列；同時顯示觸發人數與最近觸發時間。">
      {data?.ranking?.length?<AdminTableWrap><AdminTable label="彩蛋觸發排行">
        <thead><tr><th>排名</th><th>彩蛋</th><th>類型</th><th>觸發次數</th><th>觸發人數</th><th>最近觸發</th></tr></thead>
        <tbody>{data.ranking.map((item,index)=><tr key={item.egg_kind}>
          <td>#{index+1}</td><td><strong>{eggLabel(item.egg_kind)}</strong></td>
          <td><AdminBadge tone={item.trigger_type==="milestone"?"success":"default"}>{item.trigger_type==="milestone"?"訊息里程碑":"文字彩蛋"}</AdminBadge></td>
          <td>{item.trigger_count.toLocaleString("zh-TW")}</td><td>{item.unique_user_count.toLocaleString("zh-TW")}</td><td>{formatAdminTime(item.last_triggered_at)}</td>
        </tr>)}</tbody>
      </AdminTable></AdminTableWrap>:<AdminEmpty>目前還沒有正式彩蛋觸發紀錄。</AdminEmpty>}
    </AdminSection>

    <AdminSection title="最近紀錄" description="顯示最近 100 筆正式彩蛋觸發，不保存聊天正文。">
      {data?.recent_events?.length?<AdminTableWrap><AdminTable label="最近彩蛋紀錄">
        <thead><tr><th>時間</th><th>彩蛋</th><th>類型</th><th>場次</th></tr></thead>
        <tbody>{data.recent_events.map(item=><tr key={item.id}><td>{formatAdminTime(item.created_at)}</td><td>{eggLabel(item.egg_kind)}</td><td>{item.trigger_type==="milestone"?"訊息里程碑":"文字彩蛋"}</td><td>{shortId(item.session_id)}</td></tr>)}</tbody>
      </AdminTable></AdminTableWrap>:<AdminEmpty>目前還沒有彩蛋紀錄。</AdminEmpty>}
    </AdminSection>
  </div>;
}

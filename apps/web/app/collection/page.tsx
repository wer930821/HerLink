"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "collection" | "missions" | "achievements";
const eggs = [["早安","普通"],["Hi","普通"],["今天也遇見你了","稀有"],["極光","稀有"],["流星雨","史詩"],["秘密基地","史詩"],["100 則","稀有"],["500 則","史詩"],["1,000 傳說","傳說"],["10,000 永恆","神話"]];

export default function CollectionPage() {
  const router = useRouter();
  const [tab,setTab] = useState<Tab>("collection");
  return <main className="collection-page">
    <header className="collection-page-header"><button type="button" onClick={()=>router.back()}>‹</button><div><b>彩蛋圖鑑與任務</b><small>HerLink 收藏室</small></div></header>
    <section className="collection-page-hero"><span>♛</span><div><small>COLLECTION</small><h1>把聊天裡的小驚喜收集起來</h1><p>探索彩蛋、完成任務，留下屬於這個聊天室的成就。</p></div></section>
    <nav className="collection-page-tabs">{([["collection","圖鑑"],["missions","任務"],["achievements","成就"]] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==="collection"?<section className="collection-page-grid">{eggs.map(([name,rarity])=><article key={name} className={`rarity-${rarity}`}><span>✦</span><div><b>{name}</b><small>{rarity}</small></div></article>)}</section>:null}
    {tab==="missions"?<section className="collection-page-list"><h2>今日任務</h2><article><div><b>第一次驚喜</b><small>自然觸發任意 1 種文字彩蛋</small></div><strong>0 / 1</strong></article><article><div><b>聊得正起勁</b><small>同一聊天室自然增加 50 則訊息</small></div><strong>0 / 50</strong></article><article><div><b>彩蛋收藏家</b><small>解鎖 3 種不同彩蛋</small></div><strong>0 / 3</strong></article><article><div><b>永恆之路</b><small>同一聊天室累積 10,000 則訊息</small></div><strong>0 / 10,000</strong></article><p>測試按鈕不計進度；相同彩蛋重複觸發不重複計分。</p></section>:null}
    {tab==="achievements"?<section className="collection-page-list"><h2>聊天室成就</h2><article><i>✦</i><div><b>初次相遇</b><small>完成第一場匿名聊天</small></div></article><article><i>★</i><div><b>話題不斷</b><small>同一聊天室達到 500 則訊息</small></div></article><article><i>♛</i><div><b>傳說級聊天室</b><small>同一聊天室達到 1,000 則訊息</small></div></article><article className="eternal"><i>♛</i><div><b>永恆聊天室</b><small>同一聊天室達到 10,000 則訊息</small></div></article></section>:null}
  </main>;
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "collection" | "missions" | "achievements";
const eggs = [["早安","普通"],["安安","普通"],["Hi","普通"],["今天也遇見你了","稀有"],["晚安","稀有"],["極光","稀有"],["流星雨","史詩"],["秘密基地","史詩"],["100 則","稀有"],["200 則","稀有"],["300 則","稀有"],["400 則","史詩"],["500 則","史詩"],["1,000 傳說","傳說"],["10,000 永恆","神話"]];

const missions = [
  ["第一次驚喜","自然觸發任意 1 種文字彩蛋","0 / 1"],
  ["今天有聊到","今天自然送出 20 則訊息","0 / 20"],
  ["聊得正起勁","同一聊天室自然增加 50 則訊息","0 / 50"],
  ["百則同行","同一聊天室累積達到 100 則訊息","0 / 100"],
  ["彩蛋收藏家","解鎖 3 種不同彩蛋","0 / 3"],
  ["稀有獵人","解鎖 1 個稀有以上彩蛋","0 / 1"],
  ["默契升溫","同一聊天室累積達到 300 則訊息","0 / 300"],
  ["長聊不散場","同一聊天室累積達到 500 則訊息","0 / 500"],
  ["傳說前夜","同一聊天室累積達到 999 則訊息","0 / 999"],
  ["永恆之路","同一聊天室累積 10,000 則訊息","0 / 10,000"],
];

const achievements = [
  ["✦","初次相遇","完成第一場匿名聊天",""],
  ["✧","第一顆彩蛋","首次自然觸發彩蛋",""],
  ["★","百則紀念","同一聊天室達到 100 則訊息",""],
  ["★","默契漸長","同一聊天室達到 300 則訊息",""],
  ["★","話題不斷","同一聊天室達到 500 則訊息",""],
  ["♛","傳說級聊天室","同一聊天室達到 1,000 則訊息",""],
  ["✺","彩蛋獵人","累積解鎖 5 種不同彩蛋",""],
  ["♜","全圖鑑探索者","解鎖 10 種不同彩蛋",""],
  ["♛","永恆聊天室","同一聊天室達到 10,000 則訊息","eternal"],
];

export default function CollectionPage() {
  const router = useRouter();
  const [tab,setTab] = useState<Tab>("collection");
  return <main className="collection-page">
    <header className="collection-page-header"><button type="button" onClick={()=>router.back()}>‹</button><div><b>彩蛋圖鑑與任務</b><small>HerLink 收藏室</small></div></header>
    <section className="collection-page-hero"><span>♛</span><div><small>COLLECTION</small><h1>把聊天裡的小驚喜收集起來</h1><p>探索彩蛋、完成任務，留下屬於這個聊天室的成就。</p></div></section>
    <nav className="collection-page-tabs">{([["collection","圖鑑"],["missions","任務"],["achievements","成就"]] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==="collection"?<section className="collection-page-grid">{eggs.map(([name,rarity])=><article key={name} className={`rarity-${rarity}`}><span>✦</span><div><b>{name}</b><small>{rarity}</small></div></article>)}</section>:null}
    {tab==="missions"?<section className="collection-page-list"><h2>今日與長期任務</h2>{missions.map(([name,desc,progress])=><article key={name}><div><b>{name}</b><small>{desc}</small></div><strong>{progress}</strong></article>)}<p>測試按鈕不計進度；相同彩蛋重複觸發不重複計分。</p></section>:null}
    {tab==="achievements"?<section className="collection-page-list"><h2>聊天室成就</h2>{achievements.map(([icon,name,desc,className])=><article key={name} className={className}><i>{icon}</i><div><b>{name}</b><small>{desc}</small></div></article>)}</section>:null}
  </main>;
}

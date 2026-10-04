"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

type Tab = "collection" | "missions" | "achievements";
type GameState={xp:number;level:number;level_xp:number;next_level_xp:number;today_sent:number;sent_total:number;sessions:number;max_messages:number;distinct_eggs:number;text_eggs:number;egg_kinds:string[];claimed:string[]};
type Reward={key:string;name:string;desc:string;target:number;xp:number;metric:keyof Pick<GameState,"today_sent"|"sessions"|"max_messages"|"distinct_eggs"|"text_eggs">;icon?:string;className?:string};

const eggs:[string,string,string][]=[
 ["早安","普通","morning"],["安安","普通","hello"],["Hi","普通","hi"],["今天也遇見你了","稀有","sync"],["晚安","稀有","goodnight"],
 ["極光","稀有","aurora"],["流星雨","史詩","meteor"],["秘密基地","史詩","secret"],["100 則","稀有","hundred"],["200 則","稀有","twoHundred"],
 ["300 則","稀有","threeHundred"],["400 則","史詩","fourHundred"],["500 則","史詩","fiveHundred"],["1,000 傳說","傳說","thousand"],["10,000 永恆","神話","tenThousand"]
];
const missions:Reward[]=[
 {key:"mission_first_egg",name:"第一次驚喜",desc:"自然觸發任意 1 種文字彩蛋",target:1,xp:40,metric:"text_eggs"},
 {key:"mission_today20",name:"今天有聊到",desc:"今天自然送出 20 則訊息",target:20,xp:30,metric:"today_sent"},
 {key:"mission_50",name:"聊得正起勁",desc:"同一聊天室累積 50 則訊息",target:50,xp:50,metric:"max_messages"},
 {key:"mission_100",name:"百則同行",desc:"同一聊天室累積達到 100 則訊息",target:100,xp:70,metric:"max_messages"},
 {key:"mission_3eggs",name:"彩蛋收藏家",desc:"解鎖 3 種不同彩蛋",target:3,xp:60,metric:"distinct_eggs"},
 {key:"mission_rare",name:"稀有獵人",desc:"解鎖至少 1 種彩蛋",target:1,xp:40,metric:"distinct_eggs"},
 {key:"mission_300",name:"默契升溫",desc:"同一聊天室累積達到 300 則訊息",target:300,xp:100,metric:"max_messages"},
 {key:"mission_500",name:"長聊不散場",desc:"同一聊天室累積達到 500 則訊息",target:500,xp:140,metric:"max_messages"},
 {key:"mission_999",name:"傳說前夜",desc:"同一聊天室累積達到 999 則訊息",target:999,xp:200,metric:"max_messages"},
 {key:"mission_10000",name:"永恆之路",desc:"同一聊天室累積 10,000 則訊息",target:10000,xp:1000,metric:"max_messages"}
];
const achievements:Reward[]=[
 {key:"achievement_first_chat",icon:"✦",name:"初次相遇",desc:"完成第一場匿名聊天",target:1,xp:30,metric:"sessions"},
 {key:"achievement_first_egg",icon:"✧",name:"第一顆彩蛋",desc:"首次自然觸發彩蛋",target:1,xp:30,metric:"distinct_eggs"},
 {key:"achievement_100",icon:"★",name:"百則紀念",desc:"同一聊天室達到 100 則訊息",target:100,xp:60,metric:"max_messages"},
 {key:"achievement_300",icon:"★",name:"默契漸長",desc:"同一聊天室達到 300 則訊息",target:300,xp:90,metric:"max_messages"},
 {key:"achievement_500",icon:"★",name:"話題不斷",desc:"同一聊天室達到 500 則訊息",target:500,xp:120,metric:"max_messages"},
 {key:"achievement_1000",icon:"♛",name:"傳說級聊天室",desc:"同一聊天室達到 1,000 則訊息",target:1000,xp:250,metric:"max_messages"},
 {key:"achievement_5eggs",icon:"✺",name:"彩蛋獵人",desc:"累積解鎖 5 種不同彩蛋",target:5,xp:100,metric:"distinct_eggs"},
 {key:"achievement_10eggs",icon:"♜",name:"全圖鑑探索者",desc:"解鎖 10 種不同彩蛋",target:10,xp:180,metric:"distinct_eggs"},
 {key:"achievement_10000",icon:"♛",name:"永恆聊天室",desc:"同一聊天室達到 10,000 則訊息",target:10000,xp:1200,metric:"max_messages",className:"eternal"}
];
const MAX_LEVEL=100;
const levelTitle=(level:number)=>level>=100?"永恆":level>=80?"傳說":level>=50?"羈絆":level>=30?"默契":level>=10?"熟悉":"初遇";
const empty:GameState={xp:0,level:1,level_xp:0,next_level_xp:250,today_sent:0,sent_total:0,sessions:0,max_messages:0,distinct_eggs:0,text_eggs:0,egg_kinds:[],claimed:[]};

export default function CollectionPage(){
 const router=useRouter(); const [tab,setTab]=useState<Tab>("collection"); const [state,setState]=useState<GameState>(empty); const [loading,setLoading]=useState(true); const [claiming,setClaiming]=useState<string|null>(null); const [isTester,setIsTester]=useState<boolean|null>(null);
 const load=useCallback(async()=>{setLoading(true);const {data}=await supabase.rpc("get_my_collection_game_state");if(data)setState(data as GameState);setLoading(false)},[]);
 useEffect(()=>{void supabase.auth.getUser().then(async({data}:{data:{user:{id:string}|null}})=>{if(!data.user){setIsTester(false);return}const {data:profile}=await supabase.from("profiles").select("anonymous_display_name").eq("id",data.user.id).maybeSingle();setIsTester(profile?.anonymous_display_name==="孤星企鵝")})},[]);
 useEffect(()=>{if(isTester)void load();else if(isTester===false)setLoading(false)},[load,isTester]);
 const claim=async(key:string)=>{setClaiming(key);const {data}=await supabase.rpc("claim_collection_reward",{p_reward_key:key});if((data as any)?.claimed)await load();setClaiming(null)};
 const card=(r:Reward)=>{const progress=Math.min(Number(state[r.metric]??0),r.target);const done=progress>=r.target;const claimed=state.claimed.includes(r.key);return <article key={r.key} className={r.className??""}>{r.icon?<i>{r.icon}</i>:null}<div><b>{r.name}</b><small>{r.desc}</small><small>{progress.toLocaleString()} / {r.target.toLocaleString()} · +{r.xp} XP</small></div>{claimed?<strong>已領取</strong>:done?<button type="button" disabled={claiming===r.key} onClick={()=>void claim(r.key)}>{claiming===r.key?"領取中…":"領取"}</button>:<strong>{Math.round(progress/r.target*100)}%</strong>}</article>};
 if(isTester===null)return <main className="collection-page"><div className="collection-page-bg" aria-hidden="true"/><p>載入中…</p></main>;
 if(!isTester)return <main className="collection-page"><div className="collection-page-bg" aria-hidden="true"/><header className="collection-page-header"><button type="button" onClick={()=>router.back()}>‹</button><div><b>彩蛋圖鑑與任務</b><small>HerLink 收藏室</small></div></header><section className="collection-page-hero"><span>♛</span><div><small>COLLECTION</small><h1>把聊天裡的小驚喜收集起來</h1><p>探索彩蛋、完成任務，留下屬於這個聊天室的成就。</p></div></section></main>;
 return <main className="collection-page">
  <header className="collection-page-header"><button type="button" onClick={()=>router.back()}>‹</button><div><b>彩蛋圖鑑與任務</b><small>HerLink 收藏室</small></div></header>
  <section className="collection-page-hero"><span>♛</span><div><small>{levelTitle(Math.min(state.level,MAX_LEVEL))} · LEVEL {Math.min(state.level,MAX_LEVEL)}</small><h1>Lv.{Math.min(state.level,MAX_LEVEL)} · {state.xp.toLocaleString()} XP</h1><p>{loading?"正在計算進度…":state.level>=MAX_LEVEL?"已達最高等級 · 永恆":`距離下一級還有 ${Math.max(0,state.next_level_xp-state.level_xp)} XP`}</p><progress value={state.level>=MAX_LEVEL?state.next_level_xp:state.level_xp} max={state.next_level_xp}/></div></section>
  <nav className="collection-page-tabs">{([["collection","圖鑑"],["missions","任務"],["achievements","成就"]] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  {tab==="collection"?<section className="collection-page-grid">{eggs.map(([name,rarity,kind])=>{const unlocked=state.egg_kinds.includes(kind);return <article key={name} className={`rarity-${rarity} ${unlocked?"unlocked":"locked"}`}><span>{unlocked?"✦":"?"}</span><div><b>{unlocked?name:"尚未解鎖"}</b><small>{rarity}{unlocked?" · 已收集":""}</small></div></article>})}</section>:null}
  {tab==="missions"?<section className="collection-page-list"><h2>今日與長期任務</h2>{missions.map(card)}<p>進度由實際聊天和彩蛋紀錄計算；測試按鈕不計進度。完成後需手動領取 XP。</p></section>:null}
  {tab==="achievements"?<section className="collection-page-list"><h2>聊天室成就</h2>{achievements.map(card)}</section>:null}
 </main>;
}
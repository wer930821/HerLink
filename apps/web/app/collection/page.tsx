"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

type Tab = "collection" | "missions" | "achievements";
type GameState={xp:number;level:number;level_xp:number;next_level_xp:number;today_sent:number;sent_total:number;sessions:number;max_messages:number;distinct_eggs:number;text_eggs:number;egg_kinds:string[];claimed:string[]};
type Reward={key:string;name:string;desc:string;target:number;xp:number;metric:keyof Pick<GameState,"today_sent"|"sessions"|"max_messages"|"distinct_eggs"|"text_eggs">;icon?:string;className?:string};

const eggs:[string,string,string][]=[
 ["早安","普通","morning"],
 ["安安","普通","hello"],
 ["Hi","普通","hi"],
 ["晚安","普通","goodnight"],
 ["今天也遇見你了","稀有","sync"],
 ["午安","普通","afternoon"],
 ["嗨嗨","普通","heyhey"],
 ["你好呀","普通","hello_you"],
 ["吃飯了嗎","普通","meal"],
 ["下班了","普通","offwork"],
 ["睡不著","普通","sleepless"],
 ["哈哈哈","普通","haha"],
 ["辛苦了","普通","hardwork"],
 ["想你了","稀有","missyou"],
 ["好巧","稀有","coincidence"],
 ["又遇到你了","稀有","meet_again"],
 ["秘密","稀有","secret_word"],
 ["月亮","稀有","moon"],
 ["星星","稀有","stars"],
 ["極光","稀有","aurora"],
 ["流星雨","史詩","meteor"],
 ["秘密基地","史詩","secret"],
 ["命中注定","史詩","destiny"],
 ["心有靈犀","史詩","telepathy"],
 ["不想說再見","史詩","no_goodbye"],
 ["50 則","普通","fifty"],
 ["100 則","稀有","hundred"],
 ["200 則","稀有","twoHundred"],
 ["300 則","稀有","threeHundred"],
 ["400 則","史詩","fourHundred"],
 ["500 則","史詩","fiveHundred"],
 ["600 則","史詩","sixHundred"],
 ["700 則","史詩","sevenHundred"],
 ["800 則","史詩","eightHundred"],
 ["900 則","史詩","nineHundred"],
 ["1,000 傳說","傳說","thousand"],
 ["1,500 則","傳說","fifteenHundred"],
 ["2,000 則","傳說","twoThousand"],
 ["3,000 則","傳說","threeThousand"],
 ["5,000 則","神話","fiveThousand"],
 ["10,000 永恆","神話","tenThousand"],
 ["連續聊天 3 天","稀有","streak3"],
 ["連續聊天 7 天","史詩","streak7"],
 ["深夜相遇","稀有","midnight"],
 ["凌晨三點","史詩","threeam"],
 ["週末夜聊","稀有","weekend"],
 ["雙方各 100 則","史詩","balanced100"],
 ["同日 200 則","史詩","daily200"],
 ["第 10 次相遇","傳說","meet10"],
 ["永恆之約","神話","eternal_bond"]
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
const SPECIAL_REPLAY_META:Record<string,{icon:string;title:string;copy:string;scene:string}>={
 meteor:{icon:"☄",title:"流星雨",copy:"許個願吧，這場流星雨只出現幾秒",scene:"meteor"},
 secret:{icon:"◇",title:"秘密基地",copy:"秘密入口已開啟",scene:"secret"},
 destiny:{icon:"∞",title:"命中注定",copy:"兩條軌跡，在這一刻交會",scene:"destiny"},
 telepathy:{icon:"〰",title:"心有靈犀",copy:"你們的頻率正在同步",scene:"telepathy"},
 no_goodbye:{icon:"↶",title:"不想說再見",copy:"把這一刻，再留久一點",scene:"no-goodbye"},
 fourHundred:{icon:"400",title:"四方光門",copy:"第 400 則訊息",scene:"milestone"},
 fiveHundred:{icon:"500",title:"半千煙火",copy:"聊天默契升級",scene:"firework"},
 sixHundred:{icon:"600",title:"六芒星陣",copy:"六重光陣展開",scene:"hex"},
 sevenHundred:{icon:"700",title:"七星降臨",copy:"七星正在降臨",scene:"stars"},
 eightHundred:{icon:"800",title:"無限雙環",copy:"軌跡交疊成無限",scene:"rings"},
 nineHundred:{icon:"900",title:"九重光階",copy:"九重光階逐層點亮",scene:"stairs"},
 thousand:{icon:"♛",title:"LEGENDARY CHAT",copy:"傳說級聊天室",scene:"legendary"},
 fifteenHundred:{icon:"1500",title:"星河航行",copy:"一起穿越星河",scene:"galaxy"},
 twoThousand:{icon:"2000",title:"水晶覺醒",copy:"史詩級聊天室",scene:"crystal"},
 threeThousand:{icon:"3000",title:"銀河漩渦",copy:"靈魂同頻",scene:"vortex"},
 fiveThousand:{icon:"5000",title:"神話之門",copy:"命定聊天室",scene:"mythic"},
 tenThousand:{icon:"10000",title:"ETERNAL CHAT",copy:"永恆聊天室",scene:"eternal-chat"},
 streak7:{icon:"🌈",title:"七日彩虹橋",copy:"連續七天的相遇",scene:"rainbow"},
 threeam:{icon:"03:00",title:"凌晨三點",copy:"世界安靜，只剩這場對話",scene:"threeam"},
 balanced100:{icon:"⚖",title:"完美天秤",copy:"雙方各留下 100 則訊息",scene:"balance"},
 daily200:{icon:"200!",title:"今日爆表",copy:"今天已經聊了 200 則",scene:"daily"},
 meet10:{icon:"⑩",title:"十次輪迴",copy:"第十次，又遇見了",scene:"orbit"}
};
const MAX_LEVEL=100;
const levelTitle=(level:number)=>level>=100?"永恆":level>=80?"傳說":level>=50?"羈絆":level>=30?"默契":level>=10?"熟悉":"初遇";
const empty:GameState={xp:0,level:1,level_xp:0,next_level_xp:250,today_sent:0,sent_total:0,sessions:0,max_messages:0,distinct_eggs:0,text_eggs:0,egg_kinds:[],claimed:[]};

export default function CollectionPage(){
 const router=useRouter(); const [tab,setTab]=useState<Tab>("collection"); const [preview,setPreview]=useState<string|null>(null); const [state,setState]=useState<GameState>(empty); const [loading,setLoading]=useState(true); const [claiming,setClaiming]=useState<string|null>(null); const [isTester,setIsTester]=useState<boolean|null>(null);
 const load=useCallback(async()=>{setLoading(true);const {data,error}=await supabase.rpc("get_my_collection_game_state");if(!error&&data){const next=data as Partial<GameState>;setState({...empty,...next,egg_kinds:Array.isArray(next.egg_kinds)?next.egg_kinds:[],claimed:Array.isArray(next.claimed)?next.claimed:[]})}setLoading(false)},[]);
 useEffect(()=>{void supabase.auth.getUser().then(async({data}:{data:{user:{id:string}|null}})=>{if(!data.user){setIsTester(false);return}const {data:profile}=await supabase.from("profiles").select("anonymous_display_name").eq("id",data.user.id).maybeSingle();setIsTester(profile?.anonymous_display_name==="孤星企鵝")})},[]);
 useEffect(()=>{if(isTester)void load();else if(isTester===false)setLoading(false)},[load,isTester]);
 const playEternalBond=()=>{
  if(!state.egg_kinds.includes("eternal_bond"))return;
  setPreview("eternal_bond");
  try{
   navigator.vibrate?.([80,45,120,60,180,80,260]);
   const AC=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   if(AC){
    const audio=new AC(); void audio.resume(); const start=audio.currentTime+.03; const master=audio.createGain();
    master.gain.setValueAtTime(.0001,start);master.gain.exponentialRampToValueAtTime(.42,start+.35);master.gain.setValueAtTime(.42,start+8.8);master.gain.exponentialRampToValueAtTime(.0001,start+11.7);master.connect(audio.destination);
    const note=(freq:number,at:number,len:number,type:OscillatorType,gainValue:number)=>{const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.0001,start+at);g.gain.exponentialRampToValueAtTime(gainValue,start+at+.08);g.gain.exponentialRampToValueAtTime(.0001,start+at+len);o.connect(g);g.connect(master);o.start(start+at);o.stop(start+at+len+.05)};
    [65.41,98,130.81].forEach((n,i)=>note(n,0,5.2,"sine",.16-i*.025));
    [[261.63,1.1],[329.63,1.45],[392,1.8],[523.25,2.15],[659.25,2.55],[783.99,2.95]].forEach(([n,t])=>note(n,t,2.5,"sine",.11));
    [523.25,659.25,783.99,1046.5,1318.51].forEach((n,i)=>note(n,4.2+i*.18,3.6,"triangle",.08));
    [1046.5,1318.51,1567.98,2093].forEach((n,i)=>note(n,6.5+i*.32,1.8,"sine",.065));
    [[196,3.45],[293.66,3.45],[392,3.45],[261.63,5.15],[392,5.15],[523.25,5.15],[329.63,7.05],[493.88,7.05],[659.25,7.05]].forEach(([n,t],i)=>note(n,t,2.1,i%2?"sawtooth":"triangle",.055));
    [2093,1760,1567.98,1318.51,1174.66,1046.5].forEach((n,i)=>note(n,5.8+i*.22,1.55,"sine",.045));
    [130.81,196,261.63,329.63,392,523.25,659.25,783.99,1046.5].forEach((n,i)=>note(n,9.25+i*.035,2.35,i<3?"triangle":"sine",i<3?.075:.05));
    window.setTimeout(()=>void audio.close(),12500);
   }
  }catch{}
  window.setTimeout(()=>setPreview(p=>p==="eternal_bond"?null:p),12000);
 };
 const claim=async(key:string)=>{setClaiming(key);const {data}=await supabase.rpc("claim_collection_reward",{p_reward_key:key});if((data as any)?.claimed)await load();setClaiming(null)};
 const card=(r:Reward)=>{const progress=Math.min(Number(state[r.metric]??0),r.target);const done=progress>=r.target;const claimed=state.claimed.includes(r.key);return <article key={r.key} className={r.className??""}>{r.icon?<i>{r.icon}</i>:null}<div><b>{r.name}</b><small>{r.desc}</small><small>{progress.toLocaleString()} / {r.target.toLocaleString()} · +{r.xp} XP</small></div>{claimed?<strong>已領取</strong>:done?<button type="button" disabled={claiming===r.key} onClick={()=>void claim(r.key)}>{claiming===r.key?"領取中…":"領取"}</button>:<strong>{Math.round(progress/r.target*100)}%</strong>}</article>};
 if(isTester===null)return <main className="collection-page"><div className="collection-page-bg" aria-hidden="true"/><p>載入中…</p></main>;
 if(!isTester)return <main className="collection-page"><div className="collection-page-bg" aria-hidden="true"/><header className="collection-page-header"><button type="button" onClick={()=>router.back()}>‹</button><div><b>彩蛋圖鑑與任務</b><small>HerLink 收藏室</small></div></header><section className="collection-page-hero"><span>♛</span><div><small>COLLECTION</small><h1>把聊天裡的小驚喜收集起來</h1><p>探索彩蛋、完成任務，留下屬於這個聊天室的成就。</p></div></section></main>;
 return <main className="collection-page">
  <header className="collection-page-header"><button type="button" onClick={()=>router.back()}>‹</button><div><b>彩蛋圖鑑與任務</b><small>HerLink 收藏室</small></div></header>
  <section className="collection-page-hero"><span>♛</span><div><small>{levelTitle(Math.min(state.level,MAX_LEVEL))} · LEVEL {Math.min(state.level,MAX_LEVEL)}</small><h1>Lv.{Math.min(state.level,MAX_LEVEL)} · {state.xp.toLocaleString()} XP</h1><p>{loading?"正在計算進度…":state.level>=MAX_LEVEL?"已達最高等級 · 永恆":`距離下一級還有 ${Math.max(0,state.next_level_xp-state.level_xp)} XP`}</p><progress value={state.level>=MAX_LEVEL?state.next_level_xp:state.level_xp} max={state.next_level_xp}/></div></section>
  <nav className="collection-page-tabs">{([["collection","圖鑑"],["missions","任務"],["achievements","成就"]] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  {tab==="collection"?<section className="collection-page-grid">{eggs.map(([name,rarity,kind])=>{const unlocked=state.egg_kinds.includes(kind);const special=["史詩","傳說","神話"].includes(rarity);return <article key={name} className={`rarity-${rarity} ${unlocked?"unlocked":"locked"}`}><span>{unlocked?"✦":"?"}</span><div><b>{unlocked?name:"尚未解鎖"}</b><small>{rarity}{unlocked?" · 已收集":""}</small>{unlocked&&special?<button type="button" className="collection-play" onClick={()=>{sessionStorage.setItem("herlink:replay-egg",kind);const returnTo=sessionStorage.getItem("herlink:collection-return");if(returnTo)router.push(returnTo);else setPreview(kind)}}>▶ 播放</button>:null}</div></article>})}</section>:null}
  {preview==="eternal_bond"?<div className="egg-effect collection-eternal-replay"><div className="egg-eternal-bond"><i className="eternal-veil"/><i className="eternal-gate"/><i className="eternal-ring r1"/><i className="eternal-ring r2"/><i className="eternal-ring r3"/><i className="eternal-wing left"/><i className="eternal-wing right"/><i className="eternal-beam"/><i className="eternal-core">♾</i><i className="eternal-stars"/><i className="eternal-shockwave s1"/><i className="eternal-shockwave s2"/><i className="eternal-shockwave s3"/><i className="eternal-crown">♛</i><i className="eternal-runes">✦　◇　∞　◇　✦</i><strong>永恆之約</strong><b>ETERNAL BOND</b><small>兩個陌生的靈魂，在時間裡選擇留下</small></div><button className="collection-eternal-close" type="button" onClick={()=>setPreview(null)}>×</button></div>:preview&&SPECIAL_REPLAY_META[preview]?<div className={`collection-special-replay replay-${SPECIAL_REPLAY_META[preview].scene}`}><div className="replay-sky"/><div className="replay-orbit o1"/><div className="replay-orbit o2"/><div className="replay-burst"/><div className="replay-symbol">{SPECIAL_REPLAY_META[preview].icon}</div><strong>{SPECIAL_REPLAY_META[preview].title}</strong><small>{SPECIAL_REPLAY_META[preview].copy}</small><button type="button" onClick={()=>setPreview(null)}>×</button></div>:null}
  {tab==="missions"?<section className="collection-page-list"><h2>今日與長期任務</h2>{missions.map(card)}<p>進度由實際聊天和彩蛋紀錄計算；測試按鈕不計進度。完成後需手動領取 XP。</p></section>:null}
  {tab==="achievements"?<section className="collection-page-list"><h2>聊天室成就</h2>{achievements.map(card)}</section>:null}
 </main>;
}
// Native counterpart of the web easter egg system
// (apps/web/app/session/[id]/RandomSessionClient.tsx, maybeTriggerEasterEgg
// + COLLECTION_EGG_META). Title/icon are ported from web; the native overlay
// is deliberately simplified (icon + title, no web CSS animations, no sound),
// so it works in React Native without porting the whole web effect engine.
//
// Phase 1: text triggers, same order and patterns as web. Time-based eggs
// (midnight / threeam / weekend) are NOT triggered per message here — that
// was the web weekend bug fixed in #129 — they are played once per session
// mount by the chat screen instead, via timeEggKindForNow().
// Phase 2: milestone eggs are played by the chat screen when the session
// message count crosses a threshold, and text eggs are also played on
// incoming partner messages, so web-to-app and app-to-app both see them.

export type EasterEggKind =
  | "goodnight"
  | "morning"
  | "hello"
  | "hi"
  | "penguin"
  | "sync"
  | "aurora"
  | "meteor"
  | "secret"
  | "hundred"
  | "twoHundred"
  | "threeHundred"
  | "fourHundred"
  | "tired"
  | "offwork"
  | "food"
  | "curious"
  | "surprised"
  | "cute"
  | "sleepless"
  | "tomorrow"
  | "fiveHundred"
  | "thousand"
  | "afternoon"
  | "heyhey"
  | "hello_you"
  | "meal"
  | "haha"
  | "hardwork"
  | "missyou"
  | "coincidence"
  | "meet_again"
  | "secret_word"
  | "moon"
  | "stars"
  | "destiny"
  | "telepathy"
  | "no_goodbye"
  | "fifty"
  | "sixHundred"
  | "sevenHundred"
  | "eightHundred"
  | "nineHundred"
  | "fifteenHundred"
  | "twoThousand"
  | "threeThousand"
  | "fiveThousand"
  | "tenThousand"
  | "streak3"
  | "streak7"
  | "midnight"
  | "threeam"
  | "weekend"
  | "balanced100"
  | "daily200"
  | "meet10"
  | "eternal_bond";

export const EASTER_EGG_META: Record<EasterEggKind, { title: string; icon: string }> = {
  morning: { title: "晨曦升起", icon: "☀" },
  hello: { title: "招手泡泡", icon: "安" },
  hi: { title: "訊號接通", icon: "HI" },
  goodnight: { title: "月夜入眠", icon: "☾" },
  sync: { title: "再次相遇", icon: "✦" },
  afternoon: { title: "午後光窗", icon: "◒" },
  heyhey: { title: "雙重招呼", icon: "嗨" },
  hello_you: { title: "紙飛機問候", icon: "➤" },
  meal: { title: "開飯鐘", icon: "♨" },
  offwork: { title: "打卡成功", icon: "✓" },
  sleepless: { title: "失眠羊群", icon: "🐑" },
  haha: { title: "笑聲震波", icon: "哈" },
  hardwork: { title: "充電補給", icon: "▰" },
  missyou: { title: "思念信號", icon: "♡" },
  coincidence: { title: "交錯軌跡", icon: "✣" },
  meet_again: { title: "迴圈重逢", icon: "↻" },
  secret_word: { title: "封蠟密信", icon: "✉" },
  moon: { title: "月相輪轉", icon: "◐" },
  stars: { title: "星座連線", icon: "★" },
  aurora: { title: "極光天幕", icon: "≋" },
  meteor: { title: "流星暴雨", icon: "☄" },
  secret: { title: "隱藏入口", icon: "◇" },
  destiny: { title: "命運紅線", icon: "∞" },
  telepathy: { title: "腦波同步", icon: "〰" },
  no_goodbye: { title: "時間倒流", icon: "↶" },
  fifty: { title: "50 氣球", icon: "50" },
  hundred: { title: "百則印章", icon: "100" },
  twoHundred: { title: "雙環紀念", icon: "200" },
  threeHundred: { title: "三重星爆", icon: "300" },
  fourHundred: { title: "四方光門", icon: "400" },
  fiveHundred: { title: "半千煙火", icon: "500" },
  sixHundred: { title: "六芒星陣", icon: "600" },
  sevenHundred: { title: "七星降臨", icon: "700" },
  eightHundred: { title: "無限雙環", icon: "800" },
  nineHundred: { title: "九重光階", icon: "900" },
  thousand: { title: "LEGENDARY CHAT", icon: "♛" },
  fifteenHundred: { title: "星河航行", icon: "1500" },
  twoThousand: { title: "水晶覺醒", icon: "2000" },
  threeThousand: { title: "銀河漩渦", icon: "3000" },
  fiveThousand: { title: "神話之門", icon: "5000" },
  tenThousand: { title: "ETERNAL CHAT", icon: "10000" },
  streak3: { title: "三日火苗", icon: "🔥" },
  streak7: { title: "七日彩虹橋", icon: "🌈" },
  midnight: { title: "午夜城市", icon: "00:00" },
  threeam: { title: "03:00 靜止時刻", icon: "03:00" },
  weekend: { title: "週末霓虹", icon: "WEEKEND" },
  balanced100: { title: "完美天秤", icon: "⚖" },
  daily200: { title: "今日爆表", icon: "200!" },
  meet10: { title: "十次輪迴", icon: "⑩" },
  eternal_bond: { title: "永恆契約", icon: "♾" },
  penguin: { title: "企鵝路過", icon: "🐧" },
  tired: { title: "電量不足", icon: "▱" },
  food: { title: "吃飯時間", icon: "🍚" },
  curious: { title: "在幹嘛？", icon: "👀" },
  surprised: { title: "真的假的！", icon: "?!" },
  cute: { title: "可愛警報", icon: "♡" },
  tomorrow: { title: "明天見", icon: "✦" },
};

// Milestone thresholds in message count order, matching the web catalog.
export const MILESTONE_EGGS: { count: number; kind: EasterEggKind }[] = [
  { count: 50, kind: "fifty" },
  { count: 100, kind: "hundred" },
  { count: 200, kind: "twoHundred" },
  { count: 300, kind: "threeHundred" },
  { count: 400, kind: "fourHundred" },
  { count: 500, kind: "fiveHundred" },
  { count: 600, kind: "sixHundred" },
  { count: 700, kind: "sevenHundred" },
  { count: 800, kind: "eightHundred" },
  { count: 900, kind: "nineHundred" },
  { count: 1000, kind: "thousand" },
  { count: 1500, kind: "fifteenHundred" },
  { count: 2000, kind: "twoThousand" },
  { count: 3000, kind: "threeThousand" },
  { count: 5000, kind: "fiveThousand" },
  { count: 10000, kind: "tenThousand" },
];

/**
 * Match a message against the web text-trigger list, in web order.
 * First match wins, exactly like web maybeTriggerEasterEgg. Time-based
 * eggs are intentionally excluded here: they must not fire per message.
 */
export function matchTextEasterEgg(content: string, partnerAlsoLaughed: boolean): EasterEggKind | null {
  const normalized = content.replace(/\s+/g, "");
  if (/今天也遇見你了|今天又遇見你了|今天也遇見妳了|今天又遇見妳了/.test(normalized)) return "sync";
  if (/午安/.test(normalized)) return "afternoon";
  if (/嗨嗨/.test(normalized)) return "heyhey";
  if (/你好呀|你好啊/.test(normalized)) return "hello_you";
  if (/吃飯了嗎|吃飯沒|吃了嗎/.test(normalized)) return "meal";
  if (/哈哈哈|笑死/.test(normalized)) return "haha";
  if (/辛苦了/.test(normalized)) return "hardwork";
  if (/想你了|想妳了|好想你|好想妳/.test(normalized)) return "missyou";
  if (/好巧|這麼巧/.test(normalized)) return "coincidence";
  if (/又遇到你了|又遇到妳了/.test(normalized)) return "meet_again";
  if (/秘密/.test(normalized)) return "secret_word";
  if (/月亮/.test(normalized)) return "moon";
  if (/星星/.test(normalized)) return "stars";
  if (/命中注定/.test(normalized)) return "destiny";
  if (/心有靈犀/.test(normalized)) return "telepathy";
  if (/不想說再見|捨不得說再見/.test(normalized)) return "no_goodbye";
  if (/睡不著/.test(normalized)) return "sleepless";
  if (/想你|想妳|想念|好想|想你了|想妳了/.test(normalized)) return "aurora";
  if (/好累|累死|累爆|累慘/.test(normalized)) return "tired";
  if (/下班了|下班啦|終於下班/.test(normalized)) return "offwork";
  if (/加油|祝你|祝妳|希望|順利|辛苦了/.test(normalized)) return "meteor";
  if (/好可愛|可愛死|太可愛/.test(normalized)) return "cute";
  if (/喜歡你|喜歡妳|喜歡|心動|愛你|愛妳/.test(normalized)) return "secret";
  if (/早安|早啊|早呀|早上好/.test(normalized)) return "morning";
  if (/^(hi|hey|hello)$/i.test(normalized)) return "hi";
  if (/安安|嗨嗨|哈囉|哈啰/.test(normalized)) return "hello";
  if (/明天見/.test(normalized)) return "tomorrow";
  if (/晚安|先睡了|我要睡了/.test(normalized)) return "goodnight";
  if (/企鵝/.test(normalized)) return "penguin";
  if (/吃飯了嗎|吃飽了嗎|吃飯沒|吃了嗎|吃什麼/.test(normalized)) return "food";
  if (/在幹嘛|在幹麻|幹嘛呢|在做什麼/.test(normalized)) return "curious";
  if (/真的假的|真的嗎|不會吧|蛤真的/.test(normalized)) return "surprised";
  if (/哈{2,}/.test(content) && partnerAlsoLaughed) return "sync";
  return null;
}

/**
 * Time-based egg for "now", played at most once per chat screen mount.
 * Priority matches web intent: 03:00 wins over midnight, weekend is
 * separate from both. Returns null on weekdays outside 00:00-04:59.
 * Uses Taipei time, like the server-side collection evaluator.
 */
export function timeEggKindForNow(now = new Date()): EasterEggKind | null {
  const taipei = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const hour = taipei.getHours();
  const day = taipei.getDay();
  if (hour === 3) return "threeam";
  if (hour >= 0 && hour < 5) return "midnight";
  if (day === 0 || day === 6) return "weekend";
  return null;
}

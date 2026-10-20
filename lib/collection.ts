import { supabase } from "./supabase";

// Native counterpart of the web collection page (apps/web/app/collection/page.tsx).
// The catalog below is ported verbatim from web; game state and reward claims
// go through the same RPCs (get_my_collection_game_state / claim_collection_reward).

const rpc = supabase as any;

export type CollectionGameState = {
  xp: number;
  level: number;
  level_xp: number;
  next_level_xp: number;
  today_sent: number;
  sent_total: number;
  sessions: number;
  max_messages: number;
  distinct_eggs: number;
  text_eggs: number;
  egg_kinds: string[];
  claimed: string[];
};

export const EMPTY_COLLECTION_STATE: CollectionGameState = {
  xp: 0,
  level: 1,
  level_xp: 0,
  next_level_xp: 250,
  today_sent: 0,
  sent_total: 0,
  sessions: 0,
  max_messages: 0,
  distinct_eggs: 0,
  text_eggs: 0,
  egg_kinds: [],
  claimed: [],
};

type RewardMetric = "today_sent" | "sessions" | "max_messages" | "distinct_eggs" | "text_eggs";

export type CollectionReward = {
  key: string;
  name: string;
  desc: string;
  target: number;
  xp: number;
  metric: RewardMetric;
  icon?: string;
  eternal?: boolean;
};

/** [name, rarity, kind] — same order as web. */
export const EGG_CATALOG: [string, string, string][] = [
  ["早安", "普通", "morning"], ["安安", "普通", "hello"], ["Hi", "普通", "hi"], ["晚安", "普通", "goodnight"],
  ["今天也遇見你了", "稀有", "sync"], ["午安", "普通", "afternoon"], ["嗨嗨", "普通", "heyhey"], ["你好呀", "普通", "hello_you"],
  ["吃飯了嗎", "普通", "meal"], ["下班了", "普通", "offwork"], ["睡不著", "普通", "sleepless"], ["哈哈哈", "普通", "haha"],
  ["辛苦了", "普通", "hardwork"], ["想你了", "稀有", "missyou"], ["好巧", "稀有", "coincidence"], ["又遇到你了", "稀有", "meet_again"],
  ["秘密", "稀有", "secret_word"], ["月亮", "稀有", "moon"], ["星星", "稀有", "stars"], ["極光", "稀有", "aurora"],
  ["流星雨", "史詩", "meteor"], ["秘密基地", "史詩", "secret"], ["命中注定", "史詩", "destiny"], ["心有靈犀", "史詩", "telepathy"],
  ["不想說再見", "史詩", "no_goodbye"], ["50 則", "普通", "fifty"], ["100 則", "稀有", "hundred"], ["200 則", "稀有", "twoHundred"],
  ["300 則", "稀有", "threeHundred"], ["400 則", "史詩", "fourHundred"], ["500 則", "史詩", "fiveHundred"], ["600 則", "史詩", "sixHundred"],
  ["700 則", "史詩", "sevenHundred"], ["800 則", "史詩", "eightHundred"], ["900 則", "史詩", "nineHundred"], ["1,000 傳說", "傳說", "thousand"],
  ["1,500 則", "傳說", "fifteenHundred"], ["2,000 則", "傳說", "twoThousand"], ["3,000 則", "傳說", "threeThousand"],
  ["5,000 則", "神話", "fiveThousand"], ["10,000 永恆", "神話", "tenThousand"], ["連續聊天 3 天", "稀有", "streak3"],
  ["連續聊天 7 天", "史詩", "streak7"], ["深夜相遇", "稀有", "midnight"], ["凌晨三點", "史詩", "threeam"],
  ["週末夜聊", "稀有", "weekend"], ["雙方各 100 則", "史詩", "balanced100"], ["同日 200 則", "史詩", "daily200"],
  ["第 10 次相遇", "傳說", "meet10"], ["永恆之約", "神話", "eternal_bond"],
];

export const COLLECTION_MISSIONS: CollectionReward[] = [
  { key: "mission_first_egg", name: "第一次驚喜", desc: "自然觸發任意 1 種文字彩蛋", target: 1, xp: 40, metric: "text_eggs" },
  { key: "mission_today20", name: "今天有聊到", desc: "今天自然送出 20 則訊息", target: 20, xp: 30, metric: "today_sent" },
  { key: "mission_50", name: "聊得正起勁", desc: "同一聊天室累積 50 則訊息", target: 50, xp: 50, metric: "max_messages" },
  { key: "mission_100", name: "百則同行", desc: "同一聊天室累積達到 100 則訊息", target: 100, xp: 70, metric: "max_messages" },
  { key: "mission_3eggs", name: "彩蛋收藏家", desc: "解鎖 3 種不同彩蛋", target: 3, xp: 60, metric: "distinct_eggs" },
  { key: "mission_rare", name: "稀有獵人", desc: "解鎖至少 1 種彩蛋", target: 1, xp: 40, metric: "distinct_eggs" },
  { key: "mission_300", name: "默契升溫", desc: "同一聊天室累積達到 300 則訊息", target: 300, xp: 100, metric: "max_messages" },
  { key: "mission_500", name: "長聊不散場", desc: "同一聊天室累積達到 500 則訊息", target: 500, xp: 140, metric: "max_messages" },
  { key: "mission_999", name: "傳說前夜", desc: "同一聊天室累積達到 999 則訊息", target: 999, xp: 200, metric: "max_messages" },
  { key: "mission_10000", name: "永恆之路", desc: "同一聊天室累積 10,000 則訊息", target: 10000, xp: 1000, metric: "max_messages" },
];

export const COLLECTION_ACHIEVEMENTS: CollectionReward[] = [
  { key: "achievement_first_chat", icon: "✦", name: "初次相遇", desc: "完成第一場匿名聊天", target: 1, xp: 30, metric: "sessions" },
  { key: "achievement_first_egg", icon: "✧", name: "第一顆彩蛋", desc: "首次自然觸發彩蛋", target: 1, xp: 30, metric: "distinct_eggs" },
  { key: "achievement_100", icon: "★", name: "百則紀念", desc: "同一聊天室達到 100 則訊息", target: 100, xp: 60, metric: "max_messages" },
  { key: "achievement_300", icon: "★", name: "默契漸長", desc: "同一聊天室達到 300 則訊息", target: 300, xp: 90, metric: "max_messages" },
  { key: "achievement_500", icon: "★", name: "話題不斷", desc: "同一聊天室達到 500 則訊息", target: 500, xp: 120, metric: "max_messages" },
  { key: "achievement_1000", icon: "♛", name: "傳說級聊天室", desc: "同一聊天室達到 1,000 則訊息", target: 1000, xp: 250, metric: "max_messages" },
  { key: "achievement_5eggs", icon: "✺", name: "彩蛋獵人", desc: "累積解鎖 5 種不同彩蛋", target: 5, xp: 100, metric: "distinct_eggs" },
  { key: "achievement_10eggs", icon: "♜", name: "全圖鑑探索者", desc: "解鎖 10 種不同彩蛋", target: 10, xp: 180, metric: "distinct_eggs" },
  { key: "achievement_10000", icon: "♛", name: "永恆聊天室", desc: "同一聊天室達到 10,000 則訊息", target: 10000, xp: 1200, metric: "max_messages", eternal: true },
];

export const MAX_COLLECTION_LEVEL = 100;

export function collectionLevelTitle(level: number) {
  return level >= 100 ? "永恆" : level >= 80 ? "傳說" : level >= 50 ? "羈絆" : level >= 30 ? "默契" : level >= 10 ? "熟悉" : "初遇";
}

export function isSpecialEggRarity(rarity: string) {
  return rarity === "史詩" || rarity === "傳說" || rarity === "神話";
}

export async function loadCollectionGameState(): Promise<CollectionGameState> {
  const { data, error } = await rpc.rpc("get_my_collection_game_state");
  if (error || !data) return EMPTY_COLLECTION_STATE;
  const next = data as Partial<CollectionGameState>;
  return {
    ...EMPTY_COLLECTION_STATE,
    ...next,
    egg_kinds: Array.isArray(next.egg_kinds) ? next.egg_kinds : [],
    claimed: Array.isArray(next.claimed) ? next.claimed : [],
  };
}

/** Returns true when the reward was actually claimed. */
export async function claimCollectionReward(rewardKey: string): Promise<boolean> {
  const { data } = await rpc.rpc("claim_collection_reward", { p_reward_key: rewardKey });
  return (data as { claimed?: boolean } | null)?.claimed === true;
}

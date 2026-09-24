import { createClient } from "@supabase/supabase-js";

type ChatAssistMessage = {
  role: "me" | "partner";
  text: string;
};

type ConversationState = "flowing" | "quiet" | "awkward" | "tense";
type NextMove = "continue_current_topic" | "ask_open_question" | "change_topic" | "empathize" | "slow_down";

type LayaAnswer = {
  choice?: string;
  noul?: number;
  probabilities?: Record<string, number>;
};

function json(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function requireUser(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!token || !url || !key) return null;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}

function sanitizeMessages(value: unknown): ChatAssistMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .map((item): ChatAssistMessage | null => {
      if (!item || typeof item !== "object") return null;
      const role = (item as { role?: unknown }).role;
      const rawText = (item as { text?: unknown }).text;
      if ((role !== "me" && role !== "partner") || typeof rawText !== "string") return null;
      const text = rawText.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 500);
      return text ? { role, text } : null;
    })
    .filter((item): item is ChatAssistMessage => Boolean(item));
}

function getFallback(messages: ChatAssistMessage[]) {
  const last = messages[messages.length - 1];
  const partnerMessages = messages.filter((item) => item.role === "partner");
  const recentShort = partnerMessages.slice(-3).filter((item) => item.text.length <= 10).length;
  const riskText = messages.map((item) => item.text).join(" ");
  const riskPattern = /(匯款|轉帳|投資|保證獲利|驗證碼|otp|銀行帳號|信用卡|借錢|代購付款|虛擬幣|加密貨幣)/i;
  const riskProbability = riskPattern.test(riskText) ? 0.9 : 0.08;

  let conversationState: ConversationState = "flowing";
  let nextMove: NextMove = "continue_current_topic";

  if (recentShort >= 2) {
    conversationState = "quiet";
    nextMove = "change_topic";
  } else if (last?.role === "partner" && /(累|難過|不舒服|煩|壓力|失眠|哭|心情不好)/.test(last.text)) {
    conversationState = "tense";
    nextMove = "empathize";
  } else if (last?.role === "me") {
    conversationState = "quiet";
    nextMove = "ask_open_question";
  }

  return {
    conversationState,
    nextMove,
    riskProbability,
    contactReadiness: messages.length >= 10 && partnerMessages.length >= 4 ? 0.74 : 0.35,
  };
}

function findRecentOwnText(messages: ChatAssistMessage[], pattern: RegExp) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "me" && pattern.test(message.text)) {
      return message.text;
    }
  }
  return null;
}

function contextualQuestionSuggestions(messages: ChatAssistMessage[]) {
  const lastPartner = [...messages].reverse().find((message) => message.role === "partner");
  if (!lastPartner) return null;

  const text = lastPartner.text.trim();
  const isQuestion = /[？?]$/.test(text) || /^(你|妳|那你|那妳|所以你|所以妳|最近|平常|平時|今天|現在|為什麼|怎麼|哪|什麼|有沒有|會不會|喜不喜歡|最)/.test(text);
  if (!isQuestion) return null;

  if (/(歌|音樂|歌手|團|專輯|spotify|播放清單|歌單|循環)/i.test(text)) {
    const prior = findRecentOwnText(messages, /(歌|音樂|歌手|團|專輯|spotify|播放清單|歌單|循環|le sserafim|itzy|ive|aespa)/i);
    if (prior) {
      return [
        `我前面有提到，${prior.replace(/[。！？!?]+$/g, "")}。你呢？`,
        "最近還是會一直循環那幾首，你最近有沒有特別常聽的？",
        "我最近聽歌滿固定的，你最近最常重播哪一首？",
      ];
    }
    return [
      "我最近最常聽《＿＿＿》，你呢？",
      "最近比較常循環＿＿＿，幾乎每天都會放。",
      "我最近歌單都在放＿＿＿，你最近最常聽哪首？",
    ];
  }

  if (/(電影|影集|劇|韓劇|日劇|動漫|動畫|綜藝|節目|追什麼|看什麼)/i.test(text)) {
    const prior = findRecentOwnText(messages, /(電影|影集|劇|韓劇|日劇|動漫|動畫|綜藝|節目|柯南)/i);
    if (prior) {
      return [
        `我最近有在看，${prior.replace(/[。！？!?]+$/g, "")}。你呢？`,
        "最近看的東西滿固定的，你最近有追到什麼好看的嗎？",
        "我最近比較常看這類型，你平常比較愛電影還是影集？",
      ];
    }
    return [
      "我最近在看＿＿＿，你有看過嗎？",
      "最近比較常看＿＿＿這類型，你呢？",
      "我最近有一部看得滿上癮的，叫＿＿＿。你最近在追什麼？",
    ];
  }

  if (/(吃|食物|料理|餐廳|飲料|咖啡|宵夜|晚餐|午餐|早餐|最愛吃)/i.test(text)) {
    return [
      "我最近比較常吃＿＿＿，你呢？",
      "如果要選的話，我應該會選＿＿＿。你最常吃什麼？",
      "最近突然很常想吃＿＿＿，你有沒有什麼固定愛吃的？",
    ];
  }

  if (/(興趣|休假|放假|平常做什麼|平時做什麼|有空|無聊都做|喜歡做)/i.test(text)) {
    const prior = findRecentOwnText(messages, /(遊戲|電影|動漫|拼圖|樂高|追星|演唱會|音樂|k-pop|休假|有空)/i);
    if (prior) {
      return [
        `我平常大概就是${prior.replace(/[。！？!?]+$/g, "")}，有空就會做。你呢？`,
        "我休假通常都做自己喜歡的事，滿宅的哈哈。你休假都怎麼過？",
        "我比較偏室內派，你平常有沒有固定的興趣？",
      ];
    }
    return [
      "我平常比較常＿＿＿，有空就會做。你呢？",
      "休假的話我通常會＿＿＿，算滿固定的。",
      "我比較偏＿＿＿派，你平常最常做什麼？",
    ];
  }

  if (/(工作|上班|下班|今天|忙不忙|累不累|最近忙|做什麼工作)/i.test(text)) {
    return [
      "今天還可以，就是＿＿＿，你今天呢？",
      "最近工作有一點＿＿＿，但還撐得住。你最近忙嗎？",
      "我今天主要都在忙＿＿＿，現在終於比較有空了。",
    ];
  }

  if (/(為什麼|怎麼會|怎麼開始|原因)/i.test(text)) {
    return [
      "主要是因為＿＿＿，後來就慢慢變成習慣了。",
      "一開始是＿＿＿，後來越來越喜歡。你也有過這種情況嗎？",
      "其實沒有什麼特別原因，就是＿＿＿，然後就一路到現在。",
    ];
  }

  if (/(哪個|哪一個|哪一部|哪一首|哪種|最喜歡|最常)/i.test(text)) {
    return [
      "如果要選一個，我應該會選＿＿＿。你呢？",
      "我現在第一個想到的是＿＿＿。",
      "最近的話會選＿＿＿，但我其實也滿常換的。",
    ];
  }

  if (/(有沒有|會不會|喜不喜歡|是不是|嗎[？?]?|嗎$)/.test(text)) {
    return [
      "有耶，我會，尤其是＿＿＿的時候。",
      "算喜歡，我比較偏＿＿＿這種。",
      "有一點，看情況，不過＿＿＿的話我滿可以的。",
    ];
  }

  return [
    "這題我會回答＿＿＿，你呢？",
    "我第一個想到的是＿＿＿。",
    "我覺得應該是＿＿＿，你怎麼想？",
  ];
}

function suggestionsFor(nextMove: NextMove, messages: ChatAssistMessage[]) {
  const contextual = contextualQuestionSuggestions(messages);
  if (contextual) return contextual;

  const sets: Record<NextMove, string[]> = {
    continue_current_topic: [
      "真的喔，那後來呢？",
      "這個我有點好奇，可以再多說一點嗎？",
      "聽起來滿有趣的，你最有感的是哪一部分？",
    ],
    ask_open_question: [
      "那你最近有沒有什麼讓你很期待的事？",
      "如果今天不用忙任何事，你最想做什麼？",
      "最近有沒有哪件小事讓你心情變好？",
    ],
    change_topic: [
      "換個輕鬆的，你最近有在追什麼嗎？",
      "突然想到，你平常休假最常做什麼？",
      "來換一題，你最近最常聽哪首歌？",
    ],
    empathize: [
      "聽起來真的有點累，你現在還好嗎？",
      "感覺這件事讓你滿煩的，如果你想說我可以聽。",
      "那一定不好受，你不用急著整理好再說。",
    ],
    slow_down: [
      "沒關係，我們慢慢聊就好。",
      "如果不方便聊這個，我們可以換個話題。",
      "不用急著回，照你舒服的節奏就好。",
    ],
  };
  return sets[nextMove];
}

function tipFor(state: ConversationState, move: NextMove) {
  if (state === "quiet") return move === "change_topic" ? "目前有點冷場，換一個容易回答的生活話題會比較自然。" : "可以丟一個開放式問題，讓對方比較容易接話。";
  if (state === "tense") return "先接住對方的情緒，比急著給建議更適合。";
  if (state === "awkward") return "先放慢節奏，不用連續追問，留一點空間會比較舒服。";
  return "目前對話還算順，可以沿著對方剛剛提到的內容繼續問。";
}

async function askLaya(messages: ChatAssistMessage[]) {
  const baseUrl = (process.env.LAYA_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) return null;

  const conversation = messages
    .map((item) => `${item.role === "me" ? "我" : "對方"}：${item.text}`)
    .join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LAYA_API_TOKEN
          ? { Authorization: `Bearer ${process.env.LAYA_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        state: { conversation },
        questions: {
          conversation_state: {
            type: "choice",
            instructions: "判斷這段匿名聊天目前最接近哪一種互動狀態。",
            criteria: {
              flowing: "雙方自然接話、內容有延續",
              quiet: "回覆偏短、話題快結束或明顯冷場",
              awkward: "互動有尷尬、追問過多或節奏不自然",
              tense: "出現負面情緒、壓力、衝突或需要被理解",
            },
          },
          next_move: {
            type: "choice",
            instructions: "使用者下一步最適合採取哪一種聊天方式？",
            criteria: {
              continue_current_topic: "沿著目前話題自然延伸",
              ask_open_question: "問一個容易回答的開放式問題",
              change_topic: "換成新的輕鬆話題",
              empathize: "先同理、接住對方的感受",
              slow_down: "降低追問與互動壓力，放慢節奏",
            },
          },
          safety_risk: {
            type: "noul",
            instructions: "這段聊天是否出現詐騙、索財、驗證碼、投資或其他需要提高警覺的風險訊號？",
          },
          contact_readiness: {
            type: "noul",
            instructions: "雙方目前的互動是否已穩定到適合提示『保留匿名聯絡』，而不會顯得太突兀？",
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      answers?: Record<string, LayaAnswer>;
    };
    const answers = payload.answers ?? {};

    const state = answers.conversation_state?.choice;
    const move = answers.next_move?.choice;

    if (!["flowing", "quiet", "awkward", "tense"].includes(state ?? "")) return null;
    if (!["continue_current_topic", "ask_open_question", "change_topic", "empathize", "slow_down"].includes(move ?? "")) return null;

    return {
      conversationState: state as ConversationState,
      nextMove: move as NextMove,
      riskProbability: Math.max(0, Math.min(1, Number(answers.safety_risk?.noul ?? 0))),
      contactReadiness: Math.max(0, Math.min(1, Number(answers.contact_readiness?.noul ?? 0))),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return json(401, { ok: false, message: "登入狀態已失效。" });

  const body = await request.json().catch(() => null);
  const messages = sanitizeMessages(body?.messages);
  if (messages.length === 0) {
    return json(400, { ok: false, message: "目前沒有可分析的文字訊息。" });
  }

  const laya = await askLaya(messages);
  const decision = laya ?? getFallback(messages);

  return json(200, {
    ok: true,
    result: {
      engine: laya ? "laya" : "fallback",
      ...decision,
      suggestions: suggestionsFor(decision.nextMove, messages),
      tip: tipFor(decision.conversationState, decision.nextMove),
    },
  });
}

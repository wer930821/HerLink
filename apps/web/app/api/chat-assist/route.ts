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

type IcebreakerContext = {
  prompt: string;
  category: string | null;
} | null;

function cleanQuotedChoice(text: string) {
  const match = text.match(/(?:選|是|喜歡|最常聽|最常看|最近在看|最近在聽)\s*[「『"']?([^，。！？!?、]{1,30})[」』"']?/i);
  return match?.[1]?.trim() || null;
}

function contextualQuestionSuggestions(messages: ChatAssistMessage[], icebreaker: IcebreakerContext) {
  const lastPartner = [...messages].reverse().find((message) => message.role === "partner");
  if (!lastPartner) return null;

  const text = lastPartner.text.trim();
  const prompt = icebreaker?.prompt?.trim() ?? "";
  const combinedContext = `${prompt}\n${text}`;
  const partnerChoice = cleanQuotedChoice(text);

  // If the partner answers an icebreaker and asks "你呢？", don't fabricate the user's own answer.
  // Instead, offer natural follow-ups that keep the same topic moving.
  if (/你呢[？?]?$/.test(text) && prompt) {
    if (/(歌|音樂|歌手|專輯|最常聽)/i.test(combinedContext)) {
      const subject = partnerChoice ? partnerChoice.replace(/^(我應該會|我會|會)/, "").trim() : null;
      return subject
        ? [
            `${subject}喔，你最喜歡這首哪一段？`,
            `原來你會選${subject}，這首你是最近才開始常聽嗎？`,
            `${subject}滿有記憶點的，你平常也比較常聽這類型的歌嗎？`,
          ]
        : [
            "你這首是最近才開始常聽的嗎？",
            "你最喜歡這首哪一段？",
            "你平常也比較常聽這類型的歌嗎？",
          ];
    }

    if (/(電影|影集|劇|動漫|動畫|綜藝|節目|最常看)/i.test(combinedContext)) {
      return partnerChoice
        ? [
            `${partnerChoice}喔，你最喜歡它哪一部分？`,
            `原來你會選${partnerChoice}，你是最近才看的嗎？`,
            "你平常也比較常看這種類型嗎？",
          ]
        : [
            "你最喜歡它哪一部分？",
            "你是最近才開始看的嗎？",
            "你平常也比較常看這種類型嗎？",
          ];
    }

    if (/(吃|食物|料理|飲料|咖啡|宵夜|晚餐|午餐|早餐)/i.test(combinedContext)) {
      return partnerChoice
        ? [
            `${partnerChoice}喔，你是一直都很喜歡嗎？`,
            `原來你會選${partnerChoice}，你通常都去哪裡吃？`,
            "如果只能再選一個第二名，你會選什麼？",
          ]
        : [
            "你是一直都很喜歡這個嗎？",
            "你通常都去哪裡吃？",
            "如果再選一個第二名，你會選什麼？",
          ];
    }

    return [
      "原來你會這樣選，怎麼會想到這個？",
      "這個答案滿有趣的，你是一直都這樣想嗎？",
      "如果再多選一個，你第二個會選什麼？",
    ];
  }

  const isQuestion =
    /[？?]$/.test(text) ||
    /^(你|妳|那你|那妳|所以你|所以妳|最近|平常|平時|今天|現在|為什麼|怎麼|哪|什麼|有沒有|會不會|喜不喜歡|最)/.test(text);

  if (!isQuestion) return null;

  if (/(歌|音樂|歌手|團|專輯|spotify|播放清單|歌單|循環)/i.test(text)) {
    return [
      "你最近是一直循環這首嗎？",
      "你最喜歡這首哪一段？",
      "除了這首，你最近還有哪首也很常聽？",
    ];
  }

  if (/(電影|影集|劇|韓劇|日劇|動漫|動畫|綜藝|節目|追什麼|看什麼)/i.test(text)) {
    return [
      "你最近還有追別的嗎？",
      "你最喜歡這部哪個部分？",
      "你平常比較偏電影還是影集？",
    ];
  }

  if (/(吃|食物|料理|餐廳|飲料|咖啡|宵夜|晚餐|午餐|早餐|最愛吃)/i.test(text)) {
    return [
      "你是一直都很喜歡這個嗎？",
      "你通常最常去哪裡吃？",
      "如果再選一個第二名，你會選什麼？",
    ];
  }

  if (/(興趣|休假|放假|平常做什麼|平時做什麼|有空|無聊都做|喜歡做)/i.test(text)) {
    return [
      "你平常最常做的是哪一個？",
      "你是一直都有這個興趣嗎？",
      "最近有沒有特別沉迷哪一件事？",
    ];
  }

  if (/(工作|上班|下班|今天|忙不忙|累不累|最近忙|做什麼工作)/i.test(text)) {
    return [
      "你今天也很忙嗎？",
      "最近工作是不是比較累？",
      "你下班之後通常都怎麼放鬆？",
    ];
  }

  if (/(為什麼|怎麼會|怎麼開始|原因)/i.test(text)) {
    return [
      "那你自己呢？你怎麼會開始的？",
      "這個原因滿有趣的，你後來有越來越喜歡嗎？",
      "所以一開始其實是很偶然的嗎？",
    ];
  }

  if (/(哪個|哪一個|哪一部|哪一首|哪種|最喜歡|最常)/i.test(text)) {
    return [
      "你自己第一個想到的是哪個？",
      "如果只能留一個，你還是會選同一個嗎？",
      "你這個答案是一直都沒變嗎？",
    ];
  }

  return [
    "你自己呢？怎麼會想到這個？",
    "這個我有點好奇，可以再多說一點嗎？",
    "那你後來還有發生什麼嗎？",
  ];
}

function suggestionsFor(nextMove: NextMove, messages: ChatAssistMessage[], icebreaker: IcebreakerContext) {
  const contextual = contextualQuestionSuggestions(messages, icebreaker);
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
  const baseUrl = (
    process.env.LAYA_BASE_URL ||
    "https://laya-production-e3f5.up.railway.app"
  ).replace(/\/$/, "");
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
        model: "multilingual",
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
  const icebreaker: IcebreakerContext =
    body?.icebreaker &&
    typeof body.icebreaker === "object" &&
    typeof body.icebreaker.prompt === "string"
      ? {
          prompt: body.icebreaker.prompt.slice(0, 300),
          category:
            typeof body.icebreaker.category === "string"
              ? body.icebreaker.category.slice(0, 80)
              : null,
        }
      : null;
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
      suggestions: suggestionsFor(decision.nextMove, messages, icebreaker),
      tip: tipFor(decision.conversationState, decision.nextMove),
    },
  });
}

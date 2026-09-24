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


function cleanQuotedChoice(text: string) {
  const patterns = [
    /我(?:應該)?會選\s*[「『"']?([^，。！？!?、]{1,30})[」』"']?/i,
    /我選\s*[「『"']?([^，。！？!?、]{1,30})[」』"']?/i,
    /我(?:最)?喜歡\s*[「『"']?([^，。！？!?、]{1,30})[」』"']?/i,
    /我(?:最近)?最常(?:聽|看|吃)\s*[「『"']?([^，。！？!?、]{1,30})[」』"']?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function uniqueReplies(items: string[]) {
  return [...new Set(items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 10);
}

function buildReplyCandidates(messages: ChatAssistMessage[], nextMove: NextMove) {
  const lastPartner = [...messages].reverse().find((item) => item.role === "partner");
  const previousMine = [...messages].reverse().find((item) => item.role === "me");
  const lastText = lastPartner?.text.trim() ?? "";
  const myText = previousMine?.text.trim() ?? "";
  const chosen = cleanQuotedChoice(myText);
  const candidates: string[] = [];

  if (lastText) {
    if (/(怎麼會想到|為什麼會選|為什麼選|怎麼想到)/.test(lastText)) {
      if (chosen) {
        candidates.push(
          `我也說不上來，看到這題第一個就想到${chosen}了哈哈。`,
          `可能是${chosen}給我的印象比較深，所以很自然就選它了。`,
          `就是第一個想到${chosen}，沒有想太多就選了。你呢？`,
          `我覺得${chosen}滿有記憶點的，所以當下就先想到它。`
        );
      } else {
        candidates.push(
          "我也說不上來，就是看到這題第一個想到這個哈哈。",
          "可能是它給我的印象比較深，所以很自然就選了。",
          "當下第一個浮出來的就是這個，沒有想太多。",
          "就直覺想到這個，你呢？"
        );
      }
    }

    if (/你呢[？?]?$/.test(lastText)) {
      candidates.push(
        "我跟你有點不一樣，我會先看當下的感覺再選。",
        "我還真的會猶豫一下，不過第一直覺通常滿準的。",
        "我可能會先選第一個想到的，不太會想太久。"
      );
    }

    if (/(為什麼|怎麼會|原因)/.test(lastText)) {
      candidates.push(
        "其實比較像直覺，當下第一個想到的就是它。",
        "我自己也覺得有點突然，但就是很自然想到這個。",
        "可能是印象比較深，所以不用想太久就選了。"
      );
    }

    if (/(最近|平常|平時).*(聽|歌|音樂)/.test(lastText)) {
      candidates.push(
        "最近我比較常重複聽同幾首，你會一直單曲循環嗎？",
        "我最近聽歌滿看心情的，你通常都什麼時候最常聽？",
        "我會先聽自己熟的歌比較多，你最近有哪首一直循環？"
      );
    }

    if (/(電影|影集|韓劇|日劇|動漫|動畫|綜藝|節目)/.test(lastText)) {
      candidates.push(
        "我最近比較看得下去節奏快一點的，你呢？",
        "我通常會先看題材再決定要不要追，你比較吃哪一種類型？",
        "如果第一集有吸引到我，我就很容易一路看下去。"
      );
    }

    if (/(工作|上班|下班|忙|累)/.test(lastText)) {
      candidates.push(
        "最近確實有點忙，不過下班後就想放空一下。",
        "忙的時候真的很容易整個人沒電，你下班都怎麼休息？",
        "有時候累到只想什麼都不做，你也會這樣嗎？"
      );
    }

    if (/(難過|不舒服|煩|壓力|失眠|哭|心情不好)/.test(lastText)) {
      candidates.push(
        "聽起來真的滿累的，你現在有好一點嗎？",
        "如果你想講，我可以先聽你說，不用急著整理好。",
        "這樣撐著應該很不好受，你現在最卡的是哪一部分？"
      );
    }

    if (/[？?]$/.test(lastText)) {
      candidates.push(
        "這題我會先照第一直覺回答，你自己呢？",
        "我第一個想到的是前面聊到的那個，你會怎麼選？",
        "我覺得這題滿看當下感覺的，你的答案會一直都一樣嗎？"
      );
    } else {
      candidates.push(
        "原來是這樣，那後來呢？",
        "這個我有點好奇，你可以再多說一點嗎？",
        "聽起來滿有意思的，你自己最有感的是哪一段？"
      );
    }
  }

  const moveCandidates: Record<NextMove, string[]> = {
    continue_current_topic: [
      "那你後來還有繼續聊這個嗎？",
      "這個細節我有點好奇，後來怎麼發展？",
    ],
    ask_open_question: [
      "那你自己會怎麼選？",
      "你會比較在意哪一個部分？",
    ],
    change_topic: [
      "換個輕鬆的，你最近有在追什麼嗎？",
      "突然想到，你平常休假最常做什麼？",
    ],
    empathize: [
      "聽起來真的不太輕鬆，你現在還好嗎？",
      "如果你想說，我可以先聽你講。",
    ],
    slow_down: [
      "沒關係，我們慢慢聊就好。",
      "如果不想聊這個，我們也可以換個話題。",
    ],
  };

  return uniqueReplies([...candidates, ...moveCandidates[nextMove]]);
}

function fallbackSuggestions(messages: ChatAssistMessage[], nextMove: NextMove) {
  const candidates = buildReplyCandidates(messages, nextMove);
  return candidates.slice(0, 3);
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

  const fallbackDecision = getFallback(messages);
  const replyCandidates = buildReplyCandidates(messages, fallbackDecision.nextMove);
  if (replyCandidates.length < 3) return null;

  const replyCriteria = Object.fromEntries(
    replyCandidates.map((reply, index) => [`reply_${index + 1}`, reply])
  );

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
          reply_candidate: {
            type: "choice",
            instructions: "根據最近聊天內容與對方最後一句，挑出最自然、最貼題、最適合直接傳送的回覆。不要只看語氣，要優先回答對方正在問的內容。",
            criteria: replyCriteria,
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

    const ranking = answers.reply_candidate?.probabilities;
    if (!ranking) return null;

    const rankedSuggestions = Object.entries(ranking)
      .filter(([key, score]) => key in replyCriteria && Number.isFinite(score))
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => replyCriteria[key])
      .filter((reply, index, all) => all.indexOf(reply) === index)
      .slice(0, 3);

    if (rankedSuggestions.length < 3) return null;

    return {
      conversationState: state as ConversationState,
      nextMove: move as NextMove,
      riskProbability: Math.max(0, Math.min(1, Number(answers.safety_risk?.noul ?? 0))),
      contactReadiness: Math.max(0, Math.min(1, Number(answers.contact_readiness?.noul ?? 0))),
      suggestions: rankedSuggestions,
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
      suggestions: laya?.suggestions ?? fallbackSuggestions(messages, decision.nextMove),
      tip: tipFor(decision.conversationState, decision.nextMove),
    },
  });
}

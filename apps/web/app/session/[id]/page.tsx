"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  blockRandomUser,
  isAnonymousProfileReady,
  leaveRandomSession,
  loadMyProfile,
  loadAdminRecoveryRequests,
  loadMyRandomSession,
  loadRandomMessages,
  nextRandomMatch,
  reportRandomUser,
  sendRandomMessage,
  supabase,
  RANDOM_REPORT_CATEGORIES,
  type RandomChatMessageRealtimeRow,
  type RandomChatMessageRow,
  type RandomSessionRow,
  type RandomReportCategory,
  type WebProfile,
} from "../../../lib/supabase";

type Props = {
  params: { id: string };
};

const EXTERNAL_URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;
const THOUSAND_MILESTONE = 1000;
const THOUSAND_EGG_STORAGE_PREFIX = "herlink:thousand-egg:";
const EASTER_TEST_USER_ID = process.env.NEXT_PUBLIC_EASTER_EGG_TEST_USER_ID?.trim() ?? "";

const REPORT_CATEGORY_LABELS: Record<RandomReportCategory, string> = {
  spam: "垃圾訊息 / 廣告",
  scam: "詐騙",
  money_request: "索取金錢",
  investment_scam: "投資詐騙",
  harassment: "騷擾",
  sexual_content: "露骨內容",
  threat: "威脅",
  impersonation: "冒名",
  suspected_minor: "疑似未成年",
  other: "其他",
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function upsertMessage(list: RandomChatMessageRow[], next: RandomChatMessageRow) {
  const map = new Map(list.map((item) => [item.id, item] as const));
  map.set(next.id, next);
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function normalizeExternalUrl(raw: string) {
  const trimmed = raw.trim().replace(/[)\].,!?]+$/, "");
  const candidate = trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function getFriendlyRandomChatError(error: unknown, fallback: string) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";

  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit exceeded")) return "操作太頻繁，請稍後再試。";
  if (normalized.includes("authentication required")) return "請先登入後再試。";
  if (normalized.includes("this session is not available")) return "這段對話目前不可用。";
  if (normalized.includes("message cannot be blank")) return "訊息不能為空。";
  if (normalized.includes("message is too long")) return "訊息太長了，請縮短後再試。";
  if (normalized.includes("unsupported report category")) return "檢舉原因不合法，請重新選擇。";
  if (normalized.includes("report description is too long")) return "檢舉說明太長了，請縮短後再試。";
  if (normalized.includes("your account is not available")) return "目前帳號無法使用此功能。";
  if (normalized.includes("this connection is no longer available")) return "這段關係目前不可用。";
  if (normalized.includes("target user was not found")) return "找不到這位使用者。";
  if (normalized.includes("you cannot block yourself")) return "不能封鎖自己。";
  if (normalized.includes("you cannot unblock yourself")) return "不能解除封鎖自己。";

  return fallback;
}

function renderMessageContent(
  content: string,
  onOpenExternalLink: (url: string) => void
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(EXTERNAL_URL_PATTERN);

  while ((match = pattern.exec(content)) !== null) {
    const [rawUrl] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(content.slice(lastIndex, start));
    }

    const normalizedUrl = normalizeExternalUrl(rawUrl);
    if (normalizedUrl) {
      nodes.push(
        <button
          key={`${start}-${rawUrl}`}
          type="button"
          className="chat-inline-link"
          onClick={() => onOpenExternalLink(normalizedUrl)}
        >
          {rawUrl}
        </button>
      );
    } else {
      nodes.push(rawUrl);
    }

    lastIndex = start + rawUrl.length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

export default function RandomSessionPage({ params }: Props) {
  const router = useRouter();
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const [myProfile, setMyProfile] = useState<WebProfile | null>(null);
  const [session, setSession] = useState<RandomSessionRow | null>(null);
  const [messages, setMessages] = useState<RandomChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<RandomChatMessageRow | null>(null);
  const [isAdminReplyTester, setIsAdminReplyTester] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendBusy, setSendBusy] = useState(false);
  const [nextBusy, setNextBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<RandomReportCategory>("harassment");
  const [reportDescription, setReportDescription] = useState("");
  const [reportBlock, setReportBlock] = useState(true);
  const [thousandEggOpen, setThousandEggOpen] = useState(false);
  const [thousandEggNonce, setThousandEggNonce] = useState(0);
  const thousandEggTimerRef = useRef<number | null>(null);
  const lastKnownMessageCountRef = useRef<number | null>(null);

  const isEasterEggTester = Boolean(EASTER_TEST_USER_ID && myProfile?.id === EASTER_TEST_USER_ID);

  const recordEasterEgg = useCallback(async (sessionId: string, triggerType: "milestone" | "test") => {
    if (!myProfile?.id) return;
    const { error } = await supabase.from("chat_easter_egg_events").insert({
      session_id: sessionId,
      user_id: myProfile.id,
      egg_kind: "thousand_messages",
      trigger_type: triggerType,
    });
    if (error) {
      console.error("Failed to record easter egg event", error);
    }
  }, [myProfile?.id]);

  const playThousandEgg = useCallback(() => {
    if (thousandEggTimerRef.current) window.clearTimeout(thousandEggTimerRef.current);
    setThousandEggNonce((value) => value + 1);
    setThousandEggOpen(true);

    try {
      if ("vibrate" in navigator) navigator.vibrate([70, 55, 130, 65, 220]);
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const context = new AudioContextCtor();
        const now = context.currentTime;
        const notes = [
          { at: 0.02, hz: 196, duration: 0.16, gain: 0.08 },
          { at: 0.18, hz: 392, duration: 0.18, gain: 0.07 },
          { at: 0.42, hz: 784, duration: 0.42, gain: 0.06 },
          { at: 0.72, hz: 1174.66, duration: 0.7, gain: 0.045 },
        ];
        notes.forEach(({ at, hz, duration, gain }) => {
          const oscillator = context.createOscillator();
          const volume = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(hz, now + at);
          volume.gain.setValueAtTime(0.0001, now + at);
          volume.gain.exponentialRampToValueAtTime(gain, now + at + 0.025);
          volume.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
          oscillator.connect(volume);
          volume.connect(context.destination);
          oscillator.start(now + at);
          oscillator.stop(now + at + duration + 0.03);
        });
        window.setTimeout(() => void context.close(), 1800);
      }
    } catch {
      // 視裝置支援狀況靜默略過音效或震動。
    }

    thousandEggTimerRef.current = window.setTimeout(() => {
      setThousandEggOpen(false);
      thousandEggTimerRef.current = null;
    }, 6800);
  }, []);

  const checkThousandMilestone = useCallback(async (sessionId: string, allowTrigger: boolean) => {
    const { count, error } = await supabase
      .from("random_chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    if (error || typeof count !== "number") return;

    const previous = lastKnownMessageCountRef.current;
    lastKnownMessageCountRef.current = count;
    if (!allowTrigger || count < THOUSAND_MILESTONE || (previous !== null && previous >= THOUSAND_MILESTONE)) return;

    const storageKey = `${THOUSAND_EGG_STORAGE_PREFIX}${sessionId}`;
    try {
      if (window.localStorage.getItem(storageKey) === "1") return;
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // localStorage 不可用時仍允許本次播放。
    }
    playThousandEgg();
    void recordEasterEgg(sessionId, "milestone");
  }, [playThousandEgg, recordEasterEgg]);

  const isEnded = session?.status === "ended";
  const partnerName = session?.partner_anonymous_display_name ?? "匿名使用者";
  const partnerVerified = session?.partner_verified ?? false;
  const sessionEndedText =
    session?.ended_by_me ? "你已離開這個聊天室。" : "對方已離開聊天。";

  const messageWarning = useMemo(() => {
    if (messages.some((message) => message.risk_level === "high" || message.risk_level === "critical")) {
      return "這段對話含有可疑內容，請提高警覺，勿透露驗證碼或匯款。";
    }

    if (messages.some((message) => message.risk_level === "medium")) {
      return "這段對話包含外部連結或可疑內容，點開前請先確認安全性。";
    }

    return null;
  }, [messages]);

  const closeSafetyMenus = () => {
    setSafetyMenuOpen(false);
    setReportOpen(false);
    setBlockConfirmOpen(false);
  };

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const authSession = data.session;

        if (!authSession) {
          router.replace("/");
          return;
        }

        const [profileResult, sessionResult, adminProbe] = await Promise.all([
          loadMyProfile(authSession.user.id),
          loadMyRandomSession(params.id),
          loadAdminRecoveryRequests(),
        ]);
        setIsAdminReplyTester(!adminProbe.error);

        if (!mounted) return;

        const nextProfile = profileResult.data ?? null;
        setMyProfile(nextProfile);
        if (!nextProfile) {
          router.replace("/onboarding");
          return;
        }

        if (!isAnonymousProfileReady(nextProfile)) {
          router.replace("/onboarding");
          return;
        }

        const nextSession = sessionResult.data ?? null;
        if (!nextSession) {
          router.replace("/");
          return;
        }

        setSession(nextSession);

        const messagesResult = await loadRandomMessages(nextSession.id, 200);
        if (!mounted) return;

        if (messagesResult.error) {
          setNotice("訊息暫時無法載入，請稍後再試。");
        } else {
          const nextMessages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
          seenMessageIdsRef.current = new Set(nextMessages.map((item) => item.id));
          setMessages(nextMessages);
          void checkThousandMilestone(nextSession.id, false);
        }

        if (nextSession.status === "ended") {
          setNotice(
            nextSession.ended_reason === "next"
              ? "對方剛剛切換到下一位。"
              : nextSession.ended_reason === "blocked"
                ? "這段對話已被封鎖。"
                : "對方已離開聊天。"
          );
        }
      } catch {
        if (mounted) {
          router.replace("/");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [checkThousandMilestone, params.id, router]);

  useEffect(() => {
    if (!session?.id || !myProfile?.id) return;

    let disposed = false;
    const channel = supabase
      .channel(`random-chat-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "random_chat_messages",
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          if (disposed) return;
          const nextMessage = payload.new as RandomChatMessageRealtimeRow;
          if (seenMessageIdsRef.current.has(nextMessage.id)) return;
          seenMessageIdsRef.current.add(nextMessage.id);
          setMessages((current) =>
            upsertMessage(current, {
              id: nextMessage.id,
              session_id: nextMessage.session_id,
              content: nextMessage.content,
              created_at: nextMessage.created_at,
              is_mine: nextMessage.sender_id === myProfile.id,
              risk_level: nextMessage.risk_level ?? "low",
              risk_types: nextMessage.risk_types ?? [],
            })
          );
          void checkThousandMilestone(session.id, true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "random_chat_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          if (disposed) return;
          const nextSession = payload.new as RandomSessionRow;
          setSession(nextSession);
          if (nextSession.status === "ended") {
            setNotice(
              nextSession.ended_reason === "next"
                ? "對方剛剛切換到下一位。"
                : nextSession.ended_reason === "blocked"
                  ? "這段對話已被封鎖。"
                  : "對方已離開聊天。"
            );
          }
        }
      )
      .subscribe((status) => {
        if (disposed || status !== "SUBSCRIBED") return;
        void syncMissedState();
      });

    const activeSessionId = session.id;

    async function syncMissedState() {
      const [messagesResult, sessionResult] = await Promise.all([
        loadRandomMessages(activeSessionId, 200),
        loadMyRandomSession(activeSessionId),
      ]);
      if (disposed) return;

      const missedMessages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
      if (!messagesResult.error && missedMessages.length > 0) {
        for (const item of missedMessages) {
          seenMessageIdsRef.current.add(item.id);
        }
        setMessages((current) =>
          missedMessages.reduce((next, item) => upsertMessage(next, item), current)
        );
      }
      if (!sessionResult.error && sessionResult.data) {
        setSession(sessionResult.data);
      }
    }

    const syncWhenReachable = () => {
      if (!disposed) void syncMissedState();
    };
    const handleVisibility = () => {
      if (!disposed && document.visibilityState === "visible") {
        void syncMissedState();
      }
    };

    window.addEventListener("online", syncWhenReachable);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      window.removeEventListener("online", syncWhenReachable);
      document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, [checkThousandMilestone, myProfile?.id, session?.id]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, session?.status]);

  const sendMessage = async () => {
    const plainContent = draft.trim();
    const content = replyTarget && isAdminReplyTester
      ? `↩ 回覆「${replyTarget.content.replace(/\s+/g, " ").slice(0, 80)}${replyTarget.content.length > 80 ? "…" : ""}」\n${plainContent}`
      : plainContent;
    if (!content || !session || sendBusy || isEnded) {
      return;
    }

    setSendBusy(true);
    setNotice(null);
    try {
      const { data, error } = await sendRandomMessage(session.id, content);
      if (error) {
        throw error;
      }

      const nextMessage = Array.isArray(data) ? data[0] : data;
      if (nextMessage) {
        seenMessageIdsRef.current.add(nextMessage.id);
        setMessages((current) => upsertMessage(current, nextMessage));
        if (nextMessage.risk_level && nextMessage.risk_level !== "low") {
          setNotice("這則訊息含有可疑內容，請提高警覺。");
        }
      }
      setDraft("");
      setReplyTarget(null);
      void checkThousandMilestone(session.id, true);
    } catch (error) {
      setNotice(getFriendlyRandomChatError(error, "訊息傳送失敗，請稍後再試。"));
    } finally {
      setSendBusy(false);
    }
  };

  const leave = async () => {
    if (!session || leaveBusy) return;
    setLeaveBusy(true);
    try {
      await leaveRandomSession(session.id);
      router.replace("/");
    } catch {
      setNotice("目前無法離開聊天室，請稍後再試。");
    } finally {
      setLeaveBusy(false);
    }
  };

  const goNext = async () => {
    if (!session || nextBusy) return;
    setNextBusy(true);
    setNotice(null);
    try {
      const { data, error } = await nextRandomMatch(session.id);
      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (result?.status === "matched" && result.session_id) {
        router.replace(`/session/${result.session_id}`);
        return;
      }

      router.replace("/waiting");
    } catch {
      setNotice("目前無法切換到下一位，請稍後再試。");
    } finally {
      setNextBusy(false);
    }
  };

  const confirmBlock = async () => {
    if (!session || blockBusy) return;
    setBlockBusy(true);
    setNotice(null);
    try {
      const { error } = await blockRandomUser(session.id);
      if (error) {
        throw error;
      }

      setNotice("已封鎖對方。");
      closeSafetyMenus();
      router.replace("/");
    } catch {
      setNotice("目前無法封鎖這位使用者，請稍後再試。");
    } finally {
      setBlockBusy(false);
    }
  };

  const submitReport = async () => {
    if (!session || reportBusy) return;
    const cleanedDescription = reportDescription.trim();
    if (cleanedDescription.length > 500) {
      setNotice("檢舉說明請控制在 500 字以內。");
      return;
    }

    setReportBusy(true);
    setNotice(null);
    try {
      const { data, error } = await reportRandomUser(
        session.id,
        reportCategory,
        cleanedDescription.length > 0 ? cleanedDescription : null,
        reportBlock
      );
      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (reportBlock && result?.blocked) {
        closeSafetyMenus();
        setNotice("已送出檢舉，並已封鎖對方。");
        router.replace("/");
        return;
      }

      closeSafetyMenus();
      setReportDescription("");
      setReportBlock(true);
      setNotice("已送出檢舉。");
    } catch {
      setNotice("目前無法送出檢舉，請稍後再試。");
    } finally {
      setReportBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      if (thousandEggTimerRef.current) window.clearTimeout(thousandEggTimerRef.current);
    };
  }, []);

  const openExternalLink = (url: string) => {
    setPendingExternalUrl(url);
  };

  const submitExternalLink = () => {
    if (!pendingExternalUrl) {
      return;
    }

    window.open(pendingExternalUrl, "_blank", "noopener,noreferrer");
    setPendingExternalUrl(null);
  };

  const renderedMessages = messages.map((message) => {
    const riskLabel =
      message.risk_level && message.risk_level !== "low"
        ? message.risk_level === "high" || message.risk_level === "critical"
          ? "高風險"
          : "注意"
        : null;

    return (
      <article key={message.id} className={`chat-message ${message.is_mine ? "mine" : "theirs"}`}>
        {isAdminReplyTester ? (
          <button
            type="button"
            aria-label="回覆這則訊息"
            title="回覆這則訊息"
            onClick={() => setReplyTarget(message)}
            style={{ alignSelf: "center", border: 0, background: "transparent", cursor: "pointer", padding: "8px", opacity: 0.72, fontSize: "0.85rem" }}
          >
            ↩ 回覆
          </button>
        ) : null}
        <div className={`chat-bubble ${message.risk_level !== "low" ? "risky" : ""}`}>
          {riskLabel ? <div className="chat-risk-badge">{riskLabel}</div> : null}
          <div className="chat-message-content">{renderMessageContent(message.content, openExternalLink)}</div>
          <div className="chat-meta">{formatTime(message.created_at)}</div>
        </div>
      </article>
    );
  });

  if (loading) {
    return (
      <main className="hero">
        <h1 className="hero-title">正在載入匿名會話…</h1>
        <p className="hero-copy">請稍候，HerLink 正在確認會話狀態。</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="hero">
        <h1 className="hero-title">會話已結束</h1>
        <p className="hero-copy">你可以回到首頁重新開始隨機配對。</p>
        <button className="button" onClick={() => router.replace("/")}>回到首頁</button>
      </main>
    );
  }

  return (
    <main className="chat-page">
      <section className="chat-shell">
        <header className="chat-header">
          <button className="ghost" onClick={() => router.replace("/")}>返回首頁</button>
          <div className="chat-header-main">
            <div className="stack" style={{ gap: 4 }}>
              <div className="title" style={{ fontSize: "1.15rem" }}>{partnerName}</div>
              <div className="row chat-header-badges">
                <span className="status-badge">{isEnded ? "已結束" : "配對中"}</span>
                {partnerVerified ? (
                  <span className="status-badge success">已驗證</span>
                ) : (
                  <span className="status-badge">未驗證</span>
                )}
              </div>
            </div>
          </div>
          <button className="ghost" onClick={leave} disabled={leaveBusy}>
            離開
          </button>
        </header>

        <div className="chat-actions">
          <button className="button secondary" onClick={goNext} disabled={nextBusy}>
            {nextBusy ? "切換中…" : "下一位"}
          </button>
          <button className="button secondary" onClick={() => setSafetyMenuOpen(true)}>
            安全
          </button>
          <button className="button secondary" onClick={leave} disabled={leaveBusy}>
            {leaveBusy ? "離開中…" : "離開聊天室"}
          </button>
          {isEasterEggTester ? (
            <button className="button secondary thousand-test-button" type="button" onClick={() => {
              playThousandEgg();
              if (session?.id) void recordEasterEgg(session.id, "test");
            }}>
              測試 1000 則彩蛋
            </button>
          ) : null}
        </div>

        {notice ? <div className="notice">{notice}</div> : null}
        {messageWarning ? <div className="notice safety-notice">{messageWarning}</div> : null}

        <div className="chat-messages" ref={messageListRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="title">目前還沒有訊息</div>
              <div className="muted">先傳第一句，讓這段匿名對話開始吧。</div>
            </div>
          ) : (
            renderedMessages
          )}
        </div>

        {isAdminReplyTester && replyTarget ? (
          <div className="notice" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <strong>正在回覆</strong>
              <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {replyTarget.content}
              </div>
            </div>
            <button type="button" className="ghost" onClick={() => setReplyTarget(null)} aria-label="取消回覆">×</button>
          </div>
        ) : null}

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            className="textarea chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            rows={3}
            placeholder={isEnded ? "聊天室已結束，無法再傳送訊息。" : "輸入訊息…"}
            disabled={sendBusy || isEnded}
          />
          <div className="chat-composer-row">
            <div className="muted small">{isEnded ? sessionEndedText : "按 Enter 送出，按 Shift+Enter 換行。"}</div>
            <button className="button" type="submit" disabled={sendBusy || isEnded || draft.trim().length === 0}>
              {sendBusy ? "送出中…" : "送出"}
            </button>
          </div>
        </form>
      </section>

      {thousandEggOpen ? (
        <div key={thousandEggNonce} className="thousand-egg" aria-live="polite" aria-label="1000 則訊息達成">
          <div className="thousand-egg-dim" />
          <div className="thousand-egg-flash" />
          <div className="thousand-egg-rays" />
          <div className="thousand-egg-ring ring-one" />
          <div className="thousand-egg-ring ring-two" />
          <div className="thousand-egg-fireworks" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <i key={index} style={{ "--i": index } as CSSProperties & Record<"--i", number>} />)}
          </div>
          <div className="thousand-egg-particles" aria-hidden="true">
            {Array.from({ length: 54 }, (_, index) => (
              <i key={index} style={{ "--i": index, "--x": `${(index * 47) % 100}%`, "--delay": `${(index % 12) * 0.045}s` } as CSSProperties & Record<"--i" | "--x" | "--delay", string | number>} />
            ))}
          </div>
          <div className="thousand-egg-stage">
            <div className="thousand-egg-kicker">HERLINK CHAT MILESTONE</div>
            <div className="thousand-egg-number" data-text="1000">1000</div>
            <div className="thousand-egg-copy copy-one">1000 則訊息達成</div>
            <div className="thousand-egg-copy copy-two">你們到底聊了多少啦</div>
            <div className="thousand-egg-copy copy-three">這個聊天室已經有點離譜了</div>
            <div className="thousand-egg-card">
              <span className="thousand-egg-crown">✦</span>
              <strong>LEGENDARY CHAT</strong>
              <small>傳說級聊天室成就解鎖</small>
            </div>
          </div>
        </div>
      ) : null}

      {safetyMenuOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeSafetyMenus}>
          <div className="modal-card safety-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">安全選單</div>
            <p className="hero-copy">你可以封鎖這位使用者或檢舉這段對話。</p>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => {
                  setSafetyMenuOpen(false);
                  setBlockConfirmOpen(true);
                }}
                disabled={blockBusy}
              >
                封鎖
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setSafetyMenuOpen(false);
                  setReportOpen(true);
                  setReportBlock(true);
                }}
                disabled={reportBusy}
              >
                檢舉
              </button>
              <button className="ghost" onClick={closeSafetyMenus}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {blockConfirmOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeSafetyMenus}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">封鎖使用者</div>
            <p className="hero-copy">確定要封鎖這位使用者嗎？封鎖後將無法再繼續這段對話。</p>
            <div className="modal-actions">
              <button className="ghost" onClick={closeSafetyMenus}>
                取消
              </button>
              <button className="button" onClick={() => void confirmBlock()} disabled={blockBusy}>
                {blockBusy ? "處理中…" : "封鎖"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reportOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeSafetyMenus}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">檢舉對話</div>
            <p className="hero-copy">請選擇最接近的原因，HerLink 會依據內容處理。</p>
            <div className="field">
              <label className="label" htmlFor="report-category">
                檢舉原因
              </label>
              <select
                id="report-category"
                className="input"
                value={reportCategory}
                onChange={(event) => setReportCategory(event.target.value as RandomReportCategory)}
              >
                {RANDOM_REPORT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {REPORT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="report-description">
                補充說明
              </label>
              <textarea
                id="report-description"
                className="textarea"
                rows={4}
                maxLength={500}
                value={reportDescription}
                onChange={(event) => setReportDescription(event.target.value)}
                placeholder="可簡短補充讓我們更快理解狀況。"
              />
              <div className="muted mini">{reportDescription.trim().length} / 500</div>
            </div>
            <label className="row" style={{ alignItems: "center" }}>
              <input
                type="checkbox"
                checked={reportBlock}
                onChange={(event) => setReportBlock(event.target.checked)}
              />
              <span>同時封鎖對方</span>
            </label>
            <div className="modal-actions">
              <button className="ghost" onClick={closeSafetyMenus}>
                取消
              </button>
              <button className="button" onClick={() => void submitReport()} disabled={reportBusy}>
                {reportBusy ? "送出中…" : "送出檢舉"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingExternalUrl ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPendingExternalUrl(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">你即將離開 HerLink</div>
            <p className="hero-copy">前往外部網站前，請再次確認網址安全。</p>
            <div className="notice" style={{ wordBreak: "break-all" }}>
              {pendingExternalUrl}
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setPendingExternalUrl(null)}>
                取消
              </button>
              <button className="button" onClick={submitExternalLink}>
                繼續前往
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

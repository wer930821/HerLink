"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  blockRandomUser,
  isAnonymousProfileReady,
  leaveRandomSession,
  loadMyProfile,
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

type RealtimePayload<T> = {
  new: T;
};

const EXTERNAL_URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;
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
  const [loading, setLoading] = useState(true);
  const [sendBusy, setSendBusy] = useState(false);
  const [nextBusy, setNextBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFollowupOpen, setReportFollowupOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<RandomReportCategory>("harassment");
  const [reportDescription, setReportDescription] = useState("");

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
    setReportFollowupOpen(false);
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

        const [profileResult, sessionResult] = await Promise.all([
          loadMyProfile(authSession.user.id),
          loadMyRandomSession(params.id),
        ]);

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
  }, [params.id, router]);

  useEffect(() => {
    if (!session || !myProfile?.id) return;

    const messagesChannel = supabase
      .channel(`random-chat-messages-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "random_chat_messages",
          filter: `session_id=eq.${session.id}`,
        },
        (payload: RealtimePayload<RandomChatMessageRealtimeRow>) => {
          const nextMessage = payload.new as RandomChatMessageRealtimeRow;
          if (seenMessageIdsRef.current.has(nextMessage.id)) {
            return;
          }

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
        }
      )
      .subscribe();

    const sessionChannel = supabase
      .channel(`random-chat-session-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "random_chat_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload: RealtimePayload<RandomSessionRow>) => {
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
      .subscribe();

    return () => {
      void supabase.removeChannel(messagesChannel);
      void supabase.removeChannel(sessionChannel);
    };
  }, [myProfile?.id, session]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, session?.status]);

  const sendMessage = async () => {
    const content = draft.trim();
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
        false
      );
      if (error) {
        throw error;
      }

      setReportOpen(false);
      setReportFollowupOpen(true);
      setReportDescription("");
      setNotice("已送出檢舉。");
    } catch {
      setNotice("目前無法送出檢舉，請稍後再試。");
    } finally {
      setReportBusy(false);
    }
  };

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
    <main className="stack">
      <section className="panel chat-shell">
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

      {reportFollowupOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeSafetyMenus}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">檢舉已送出</div>
            <p className="hero-copy">你可以繼續聊天，也可以封鎖對方並離開這段對話。</p>
            <div className="modal-actions">
              <button className="ghost" onClick={closeSafetyMenus}>
                繼續聊天
              </button>
              <button className="button" onClick={() => void confirmBlock()} disabled={blockBusy}>
                {blockBusy ? "處理中…" : "封鎖並離開"}
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

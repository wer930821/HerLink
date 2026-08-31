"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getShortId,
  isNavigationDebugEnabled,
  readLastNavigationDiagnostic,
  recordNavigationDiagnostic,
  withNavigationDebugParam,
  type NavigationDiagnosticEvent,
} from "../../../lib/navigation-diagnostics";
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
  waitForCurrentSession,
  RANDOM_REPORT_CATEGORIES,
  type RandomChatMessageRealtimeRow,
  type RandomChatMessageRow,
  type RandomSessionRow,
  type RandomReportCategory,
  type WebProfile,
} from "../../../lib/supabase";
import { recordRealtimeDiagnostic } from "../../../lib/realtime-diagnostics";

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

function getRandomChatSendErrorCode(error: unknown, refreshedSession?: RandomSessionRow | null) {
  const message = getRandomChatErrorMessage(error).toLowerCase();

  if (message.includes("authentication required")) return "AUTH_MISSING";
  if (message.includes("rate limit exceeded")) return "RATE_LIMITED";
  if (message.includes("this session is not available")) {
    return refreshedSession?.status === "ended" ? "SESSION_NOT_ACTIVE" : "SESSION_NOT_FOUND";
  }
  if (message.includes("not a participant")) return "NOT_PARTICIPANT";
  if (message.includes("network") || message.includes("failed to fetch") || error instanceof TypeError) return "NETWORK_ERROR";
  if (message.includes("rpc") || message.includes("function") || message.includes("supabase")) return "RPC_ERROR";

  return "UNKNOWN";
}

function getRandomChatErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
}

function getSessionLifecycleNotice(nextSession: RandomSessionRow) {
  if (nextSession.status !== "ended") {
    return null;
  }

  return nextSession.ended_reason === "next"
    ? "對方剛剛切換到下一位。"
    : nextSession.ended_reason === "blocked"
      ? "這段對話已被封鎖。"
      : "對方已離開聊天。";
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
  const pathname = usePathname();
  const sessionRouteIdRef = useRef(params.id);
  const sessionBootstrapRunRef = useRef(0);
  const sessionBootstrapStateRef = useRef<"loading" | "ready" | "ended" | "missing" | "unauthorized">("loading");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const messageSyncInFlightRef = useRef(false);
  const messageSyncQueuedRef = useRef(false);
  const refreshMessagesFromServerRef = useRef<((options?: { forceScroll?: boolean }) => Promise<void>) | null>(null);
  const refreshSessionFromServerRef = useRef<(() => Promise<RandomSessionRow | null>) | null>(null);
  const sessionRefreshGenerationRef = useRef(0);
  const lastSessionFetchErrorRef = useRef(false);
  const typingChannelRef = useRef<any>(null);
  const typingSenderTimerRef = useRef<number | null>(null);
  const typingReceiverTimerRef = useRef<number | null>(null);
  const typingReceiverDeadlineRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const realtimeClientInstanceIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  const stickToBottomRef = useRef(true);
  const pendingScrollToBottomRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
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
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [authState, setAuthState] = useState<NavigationDiagnosticEvent["authState"]>("loading");
  const [sessionState, setSessionState] = useState<NavigationDiagnosticEvent["sessionState"]>("loading");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [lastDiagnostic, setLastDiagnostic] = useState<NavigationDiagnosticEvent | null>(null);

  const isEnded = session?.status === "ended";
  const partnerName = session?.partner_anonymous_display_name ?? "匿名使用者";
  const partnerVerified = session?.partner_verified ?? false;
  const sessionEndedText =
    session?.ended_by_me ? "你已離開這個聊天室。" : "對方已離開聊天。";
  const typingIndicatorText = partnerTyping ? `${partnerName} 正在輸入…` : "\u00a0";

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

  const recordSessionRouteDiagnostic = (
    eventType:
      | "SESSION_ROUTE_MOUNT"
      | "AUTH_WAIT_START"
      | "AUTH_READY"
      | "AUTH_MISSING"
      | "SESSION_FETCH_START"
      | "SESSION_FETCH_RESULT"
      | "SESSION_ACTIVE"
      | "SESSION_ENDED"
      | "REDIRECT_HOME"
      | "REDIRECT_ONBOARDING"
      | "SESSION_ROUTE_UNMOUNT"
      | "STALE_BOOTSTRAP_DISCARDED",
    metadata: Record<string, unknown> = {}
  ) => {
    const nextAuthState =
      typeof metadata.authState === "string" && ["loading", "ready", "missing"].includes(metadata.authState)
        ? (metadata.authState as NavigationDiagnosticEvent["authState"])
        : authState;
    const nextSessionState =
      typeof metadata.sessionState === "string" && ["loading", "active", "ended", "missing"].includes(metadata.sessionState)
        ? (metadata.sessionState as NavigationDiagnosticEvent["sessionState"])
        : sessionState;
    const nextEvent: NavigationDiagnosticEvent = {
      timestamp: new Date().toISOString(),
      pathname,
      event: eventType,
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
      authState: nextAuthState,
      sessionState: nextSessionState,
      routeSessionIdShort: getShortId(params.id),
      serverSessionIdShort: getShortId(typeof metadata.serverSessionId === "string" ? metadata.serverSessionId : session?.id ?? null),
      bootstrapRunId: typeof metadata.bootstrapRunId === "number" ? metadata.bootstrapRunId : sessionBootstrapRunRef.current,
    };

    recordNavigationDiagnostic(nextEvent);
    setLastDiagnostic(nextEvent);
  };

  const goHome = (reason: string, metadata: Record<string, unknown> = {}) => {
    recordSessionRouteDiagnostic("REDIRECT_HOME", { ...metadata, reason });
    router.replace(withNavigationDebugParam("/"));
  };

  const goOnboarding = (reason: string, metadata: Record<string, unknown> = {}) => {
    recordSessionRouteDiagnostic("REDIRECT_ONBOARDING", { ...metadata, reason });
    router.replace(withNavigationDebugParam("/onboarding"));
  };

  const clearSenderTypingTimer = () => {
    if (typingSenderTimerRef.current !== null) {
      window.clearTimeout(typingSenderTimerRef.current);
      typingSenderTimerRef.current = null;
    }
  };

  const clearReceiverTypingTimer = () => {
    if (typingReceiverTimerRef.current !== null) {
      window.clearTimeout(typingReceiverTimerRef.current);
      typingReceiverTimerRef.current = null;
    }
  };

  const sendTypingState = async (typing: boolean) => {
    const channel = typingChannelRef.current;
    if (!channel) {
      return;
    }

    try {
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: { typing },
      });
    } catch {
      // Typing is best-effort only.
    }
  };

  const stopTyping = () => {
    clearSenderTypingTimer();
    if (!typingActiveRef.current) {
      return;
    }

    typingActiveRef.current = false;
    void sendTypingState(false);
  };

  const clearPartnerTyping = () => {
    clearReceiverTypingTimer();
    typingReceiverDeadlineRef.current = null;
    setPartnerTyping(false);
  };

  const recordDiagnostic = (
    eventType:
      | "realtime_subscribe_started"
      | "realtime_subscribed"
      | "realtime_subscribe_error"
      | "realtime_disconnected"
      | "realtime_reconnected"
      | "message_received_realtime"
      | "message_loaded_from_db",
    input: {
      sessionId?: string | null;
      userId?: string | null;
      messageId?: string | null;
      safeErrorCode?: string | null;
      metadata?: Record<string, unknown>;
    } = {}
  ) => {
    const nextSessionId = input.sessionId ?? session?.id ?? null;
    const nextUserId = input.userId ?? myProfile?.id ?? null;
    if (!nextSessionId || !nextUserId) {
      return;
    }

    void recordRealtimeDiagnostic({
      sessionId: nextSessionId,
      eventType,
      clientInstanceId: realtimeClientInstanceIdRef.current,
      messageId: input.messageId ?? null,
      safeErrorCode: input.safeErrorCode ?? null,
      metadata: input.metadata ?? {},
    });
  };

  refreshMessagesFromServerRef.current = async ({ forceScroll = false } = {}) => {
    if (!session?.id || !myProfile?.id) {
      return;
    }

    if (messageSyncInFlightRef.current) {
      messageSyncQueuedRef.current = true;
      return;
    }

    messageSyncInFlightRef.current = true;

    try {
      const result = await loadRandomMessages(session.id, 200);
      if (result.error) {
        return;
      }

      const freshMessages = Array.isArray(result.data) ? result.data : [];
      if (freshMessages.length === 0) {
        return;
      }

      let receivedNewMessage = false;
      setMessages((current) => {
        let next = current;
        for (const item of freshMessages) {
          if (!seenMessageIdsRef.current.has(item.id)) {
            receivedNewMessage = true;
          }
          next = upsertMessage(next, item);
        }

        return next;
      });

      for (const item of freshMessages) {
        seenMessageIdsRef.current.add(item.id);
      }

      if ((forceScroll || receivedNewMessage) && stickToBottomRef.current) {
        pendingScrollToBottomRef.current = true;
      }
    } finally {
      messageSyncInFlightRef.current = false;
      if (messageSyncQueuedRef.current) {
        messageSyncQueuedRef.current = false;
        void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
      }
    }
  };

  refreshSessionFromServerRef.current = async () => {
    const targetSessionId = session?.id ?? sessionRouteIdRef.current;
    if (!targetSessionId) {
      return null;
    }

    const refreshGeneration = ++sessionRefreshGenerationRef.current;
    lastSessionFetchErrorRef.current = false;
    setSessionState("loading");
    recordSessionRouteDiagnostic("SESSION_FETCH_START", {
      sessionState: "loading",
      serverSessionId: targetSessionId,
    });
    const result = await loadMyRandomSession(targetSessionId);
    if (refreshGeneration !== sessionRefreshGenerationRef.current) {
      recordSessionRouteDiagnostic("STALE_BOOTSTRAP_DISCARDED", {
        reason: "STALE_BOOTSTRAP_DISCARDED",
        serverSessionId: targetSessionId,
      });
      return null;
    }

    if (result.error) {
      lastSessionFetchErrorRef.current = true;
      recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
        reason: "TEMPORARY_FETCH_ERROR",
        sessionState: session?.status === "active" ? "active" : "missing",
        serverSessionId: targetSessionId,
      });
      return null;
    }

    const nextSession = result.data ?? null;
    if (!nextSession) {
      recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
        reason: "SESSION_CONFIRMED_MISSING",
        sessionState: "missing",
        serverSessionId: targetSessionId,
      });
      return null;
    }

    if (nextSession.id !== targetSessionId) {
      recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
        reason: "SESSION_ID_MISMATCH",
        sessionState: "missing",
        serverSessionId: nextSession.id,
      });
      return null;
    }

    const previousStatus = session?.status ?? null;
    setSession(nextSession);
    setSessionState(nextSession.status === "active" ? "active" : "ended");
    recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
      reason: null,
      sessionState: nextSession.status === "active" ? "active" : "ended",
      serverSessionId: nextSession.id,
    });

    if (nextSession.status === "ended") {
      recordSessionRouteDiagnostic("SESSION_ENDED", {
        reason: "SESSION_ENDED",
        sessionState: "ended",
        serverSessionId: nextSession.id,
      });
      stopTyping();
      clearPartnerTyping();
      setNotice(getSessionLifecycleNotice(nextSession));
    } else if (previousStatus !== "active") {
      recordSessionRouteDiagnostic("SESSION_ACTIVE", {
        sessionState: "active",
        serverSessionId: nextSession.id,
      });
      setNotice(null);
    }

    return nextSession;
  };

  useEffect(() => {
    sessionRouteIdRef.current = params.id;
  }, [params.id]);

  useEffect(() => {
    setDebugEnabled(isNavigationDebugEnabled());
    setLastDiagnostic(readLastNavigationDiagnostic());
  }, [pathname]);

  useEffect(() => {
    recordSessionRouteDiagnostic("SESSION_ROUTE_MOUNT", {
      authState,
      sessionState,
      serverSessionId: session?.id ?? null,
    });

    return () => {
      recordSessionRouteDiagnostic("SESSION_ROUTE_UNMOUNT", {
        authState,
        sessionState,
        serverSessionId: session?.id ?? null,
      });
    };
  }, [params.id]);

  const isNearBottom = () => {
    const container = messageListRef.current;
    if (!container) {
      return true;
    }

    return container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "auto") => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }

    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({ top, behavior });
    stickToBottomRef.current = true;
  };

  const scheduleScrollMessagesToBottom = (behavior: ScrollBehavior = "auto") => {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollMessagesToBottom(behavior);
    });
  };

  const armPartnerTypingTimeout = () => {
    clearReceiverTypingTimer();
    const deadline = Date.now() + 4500;
    typingReceiverDeadlineRef.current = deadline;
    typingReceiverTimerRef.current = window.setTimeout(() => {
      typingReceiverTimerRef.current = null;
      if (typingReceiverDeadlineRef.current !== deadline) {
        return;
      }

      typingReceiverDeadlineRef.current = null;
      setPartnerTyping(false);
    }, 4500);
  };

  useEffect(() => {
    let mounted = true;
    const bootstrapRunId = ++sessionBootstrapRunRef.current;

    async function bootstrap() {
      sessionBootstrapStateRef.current = "loading";
      setAuthState("loading");
      setSessionState("loading");
      recordSessionRouteDiagnostic("AUTH_WAIT_START", {
        authState: "loading",
        sessionState: "loading",
        bootstrapRunId,
      });
      setLoading(true);
      try {
        const { data } = await waitForCurrentSession(2500, 100);
        const authSession = data.session;

        if (!authSession) {
          sessionBootstrapStateRef.current = "missing";
          setAuthState("missing");
          recordSessionRouteDiagnostic("AUTH_MISSING", {
            reason: "AUTH_CONFIRMED_MISSING",
            authState: "missing",
            bootstrapRunId,
          });
          goHome("AUTH_CONFIRMED_MISSING", { authState: "missing", bootstrapRunId });
          return;
        }

        sessionBootstrapStateRef.current = "ready";
        setAuthState("ready");
        recordSessionRouteDiagnostic("AUTH_READY", {
          authState: "ready",
          bootstrapRunId,
        });

        const [profileResult] = await Promise.all([loadMyProfile(authSession.user.id)]);

        if (!mounted || bootstrapRunId !== sessionBootstrapRunRef.current) {
          recordSessionRouteDiagnostic("STALE_BOOTSTRAP_DISCARDED", {
            reason: "STALE_BOOTSTRAP_DISCARDED",
            bootstrapRunId,
          });
          return;
        }

        const nextProfile = profileResult.data ?? null;
        setMyProfile(nextProfile);
        if (!nextProfile) {
          sessionBootstrapStateRef.current = "unauthorized";
          goOnboarding("PROFILE_NOT_READY", { authState: "ready", bootstrapRunId });
          return;
        }

        if (!isAnonymousProfileReady(nextProfile)) {
          sessionBootstrapStateRef.current = "unauthorized";
          goOnboarding("PROFILE_NOT_READY", { authState: "ready", bootstrapRunId });
          return;
        }

        const nextSession = await (async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const restoredSession = await refreshSessionFromServerRef.current?.();
            if (restoredSession) {
              return restoredSession;
            }

            if (attempt < 2) {
              await new Promise((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)));
            }
          }

          return null;
        })();
        if (!mounted || bootstrapRunId !== sessionBootstrapRunRef.current) {
          recordSessionRouteDiagnostic("STALE_BOOTSTRAP_DISCARDED", {
            reason: "STALE_BOOTSTRAP_DISCARDED",
            bootstrapRunId,
          });
          return;
        }
        if (!nextSession) {
          if (lastSessionFetchErrorRef.current) {
            setNotice("聊天室載入失敗，正在重試。");
            setSessionState("loading");
            return;
          }

          sessionBootstrapStateRef.current = "missing";
          setSessionState("missing");
          recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
            reason: "SESSION_CONFIRMED_MISSING",
            authState: "ready",
            sessionState: "missing",
            bootstrapRunId,
          });
          goHome("SESSION_CONFIRMED_MISSING", { authState: "ready", sessionState: "missing", bootstrapRunId });
          return;
        }

        sessionBootstrapStateRef.current = nextSession.status === "ended" ? "ended" : "ready";
        recordSessionRouteDiagnostic(nextSession.status === "ended" ? "SESSION_ENDED" : "SESSION_ACTIVE", {
          reason: nextSession.status === "ended" ? "SESSION_ENDED" : null,
          authState: "ready",
          sessionState: nextSession.status === "ended" ? "ended" : "active",
          serverSessionId: nextSession.id,
          bootstrapRunId,
        });

        const messagesResult = await loadRandomMessages(nextSession.id, 200);
        if (!mounted || bootstrapRunId !== sessionBootstrapRunRef.current) {
          recordSessionRouteDiagnostic("STALE_BOOTSTRAP_DISCARDED", {
            reason: "STALE_BOOTSTRAP_DISCARDED",
            bootstrapRunId,
          });
          return;
        }

        if (messagesResult.error) {
          setNotice("訊息暫時無法載入，請稍後再試。");
        } else {
          const nextMessages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
          seenMessageIdsRef.current = new Set(nextMessages.map((item) => item.id));
          setMessages(nextMessages);
          recordDiagnostic("message_loaded_from_db", {
            sessionId: nextSession.id,
            userId: authSession.user.id,
            metadata: { message_count: nextMessages.length },
          });
          if (nextMessages.length > 0) {
            pendingScrollToBottomRef.current = true;
          }
        }

      } catch {
        if (mounted && bootstrapRunId === sessionBootstrapRunRef.current) {
          setNotice("聊天室載入失敗，正在重試。");
          recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
            reason: "BOOTSTRAP_EXCEPTION",
            bootstrapRunId,
          });
        }
      } finally {
        if (mounted && bootstrapRunId === sessionBootstrapRunRef.current) {
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
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.visualViewport === "undefined") {
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const updateKeyboardInset = () => {
      const nextInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(nextInset);
    };

    updateKeyboardInset();
    viewport.addEventListener("resize", updateKeyboardInset);
    viewport.addEventListener("scroll", updateKeyboardInset);
    window.addEventListener("orientationchange", updateKeyboardInset);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset);
      viewport.removeEventListener("scroll", updateKeyboardInset);
      window.removeEventListener("orientationchange", updateKeyboardInset);
    };
  }, []);

  useEffect(() => {
    if (!session?.id || !myProfile?.id) {
      return;
    }

    if (!stickToBottomRef.current && !pendingScrollToBottomRef.current) {
      return;
    }

    scheduleScrollMessagesToBottom("auto");
  }, [keyboardInset, myProfile?.id, session?.id]);

  useEffect(() => {
    if (!session?.id || !myProfile?.id) {
      return;
    }

    const syncNow = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
      void refreshSessionFromServerRef.current?.();
    };

    const interval = window.setInterval(syncNow, 15000);
    window.addEventListener("focus", syncNow);
    window.addEventListener("online", syncNow);
    document.addEventListener("visibilitychange", syncNow);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", syncNow);
      window.removeEventListener("online", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [myProfile?.id, session?.id]);

  useEffect(() => {
    if (!session || !myProfile?.id) return;

    let messagesChannelSubscribed = false;
    recordDiagnostic("realtime_subscribe_started", {
      sessionId: session.id,
      userId: myProfile.id,
      metadata: { channel: "messages" },
    });

    const messagesChannel = supabase.channel(`random-chat-messages-${session.id}`);
    messagesChannel
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

          recordDiagnostic("message_received_realtime", {
            sessionId: session.id,
            userId: myProfile.id,
            messageId: nextMessage.id,
            metadata: { channel: "messages" },
          });

          const shouldAutoScroll = stickToBottomRef.current;
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
          if (shouldAutoScroll) {
            pendingScrollToBottomRef.current = true;
          }
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          recordDiagnostic(messagesChannelSubscribed ? "realtime_reconnected" : "realtime_subscribed", {
            sessionId: session.id,
            userId: myProfile.id,
            metadata: { channel: "messages" },
          });
          messagesChannelSubscribed = true;
          void refreshSessionFromServerRef.current?.();
          void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          recordDiagnostic("realtime_subscribe_error", {
            sessionId: session.id,
            userId: myProfile.id,
            safeErrorCode: status,
            metadata: { channel: "messages" },
          });
          return;
        }

        if (status === "CLOSED") {
          recordDiagnostic("realtime_disconnected", {
            sessionId: session.id,
            userId: myProfile.id,
            safeErrorCode: status,
            metadata: { channel: "messages" },
          });
        }
      });

    const typingChannel = supabase.channel(`random-chat-typing-${session.id}`);
    typingChannelRef.current = typingChannel;

    typingChannel
      .on("broadcast", { event: "typing" }, (payload: { payload?: { typing?: unknown } }) => {
        const typing = Boolean(payload?.payload?.typing);

        if (!typing) {
          clearPartnerTyping();
          return;
        }

        setPartnerTyping(true);
        armPartnerTypingTimeout();
      })
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
        () => {
          void refreshSessionFromServerRef.current?.();
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          recordDiagnostic("realtime_subscribed", {
            sessionId: session.id,
            userId: myProfile.id,
            metadata: { channel: "session" },
          });
          void refreshSessionFromServerRef.current?.();
          void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          recordDiagnostic("realtime_subscribe_error", {
            sessionId: session.id,
            userId: myProfile.id,
            safeErrorCode: status,
            metadata: { channel: "session" },
          });
          return;
        }

        if (status === "CLOSED") {
          recordDiagnostic("realtime_disconnected", {
            sessionId: session.id,
            userId: myProfile.id,
            safeErrorCode: status,
            metadata: { channel: "session" },
          });
        }
      });

    return () => {
      recordDiagnostic("realtime_disconnected", {
        sessionId: session.id,
        userId: myProfile.id,
        metadata: { channel: "messages" },
      });
      stopTyping();
      clearPartnerTyping();
      typingChannelRef.current = null;
      void supabase.removeChannel(messagesChannel);
      void supabase.removeChannel(typingChannel);
      void supabase.removeChannel(sessionChannel);
    };
  }, [myProfile?.id, session?.id]);

  useEffect(() => {
    if (isEnded) {
      stopTyping();
      clearPartnerTyping();
    }
  }, [isEnded]);

  useEffect(() => {
    if (!partnerTyping) {
      return;
    }

    const interval = window.setInterval(() => {
      const deadline = typingReceiverDeadlineRef.current;
      if (deadline === null) {
        return;
      }

      if (Date.now() >= deadline) {
        clearPartnerTyping();
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [partnerTyping]);

  useEffect(() => {
    if (!session || !myProfile?.id || isEnded) {
      stopTyping();
      clearPartnerTyping();
      return;
    }

    const hasDraftContent = draft.trim().length > 0;

    if (!hasDraftContent) {
      stopTyping();
      return;
    }

    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      void sendTypingState(true);
    }

    clearSenderTypingTimer();
    typingSenderTimerRef.current = window.setTimeout(() => {
      if (!typingActiveRef.current) {
        return;
      }

      typingActiveRef.current = false;
      void sendTypingState(false);
    }, 2500);

    return () => {
      clearSenderTypingTimer();
    };
  }, [draft, isEnded, myProfile?.id, session?.id]);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (!pendingScrollToBottomRef.current && !stickToBottomRef.current) {
      return;
    }

    const shouldSmooth = pendingScrollToBottomRef.current;
    pendingScrollToBottomRef.current = false;
    scheduleScrollMessagesToBottom(shouldSmooth ? "smooth" : "auto");
  }, [messages.length, session?.id]);

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !session || sendBusy) {
      return;
    }

    setSendBusy(true);
    setNotice(null);
    try {
      const refreshedSession = await refreshSessionFromServerRef.current?.();
      if (!refreshedSession || refreshedSession.status !== "active") {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[herlink] random chat send blocked before RPC", {
            code: getRandomChatSendErrorCode(new Error("This session is not available."), refreshedSession),
            sessionId: session.id,
          });
        }
        setNotice("這段對話目前不可用。");
        return;
      }

      const { data, error } = await sendRandomMessage(refreshedSession.id, content);
      if (error) {
        throw error;
      }

      const nextMessage = Array.isArray(data) ? data[0] : data;
      if (nextMessage) {
        seenMessageIdsRef.current.add(nextMessage.id);
        setMessages((current) => upsertMessage(current, nextMessage));
        pendingScrollToBottomRef.current = true;
        if (nextMessage.risk_level && nextMessage.risk_level !== "low") {
          setNotice("這則訊息含有可疑內容，請提高警覺。");
        }
      }
      stopTyping();
      setDraft("");
    } catch (error) {
      stopTyping();
      clearPartnerTyping();
      const refreshedSession = await refreshSessionFromServerRef.current?.();
      if (process.env.NODE_ENV !== "production") {
        console.warn("[herlink] random chat send failed", {
          code: getRandomChatSendErrorCode(error, refreshedSession),
          sessionId: session.id,
          message: getRandomChatErrorMessage(error),
        });
      }
      if (refreshedSession?.status === "active") {
        await refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
      }
      setNotice(getFriendlyRandomChatError(error, "訊息傳送失敗，請稍後再試。"));
    } finally {
      setSendBusy(false);
    }
  };

  const leave = async () => {
    if (!session || leaveBusy) return;
    setLeaveBusy(true);
    try {
      stopTyping();
      clearPartnerTyping();
      await leaveRandomSession(session.id);
      goHome("USER_LEFT_SESSION", { serverSessionId: session.id });
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
      stopTyping();
      clearPartnerTyping();
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
      stopTyping();
      clearPartnerTyping();
      const { error } = await blockRandomUser(session.id);
      if (error) {
        throw error;
      }

      setNotice("已封鎖對方。");
      closeSafetyMenus();
      goHome("USER_BLOCKED_PARTNER", { serverSessionId: session.id });
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

  const debugPanel = debugEnabled ? (
    <div className="debug-panel">
      <div>path: {pathname}</div>
      <div>auth: {authState}</div>
      <div>session: {sessionState}</div>
      <div>event: {lastDiagnostic?.event ?? "none"}</div>
      <div>reason: {lastDiagnostic?.reason ?? "none"}</div>
      <div>route id: {getShortId(params.id) ?? "none"}</div>
      <div>server id: {getShortId(session?.id ?? null) ?? lastDiagnostic?.serverSessionIdShort ?? "none"}</div>
    </div>
  ) : null;

  if (loading) {
    return (
      <main className="hero">
        <h1 className="hero-title">正在載入匿名會話…</h1>
        <p className="hero-copy">請稍候，HerLink 正在確認會話狀態。</p>
        {notice ? <div className="notice">{notice}</div> : null}
        {debugPanel}
      </main>
    );
  }

  if (!session) {
    return (
      <main className="hero">
        <h1 className="hero-title">會話已結束</h1>
        <p className="hero-copy">你可以回到首頁重新開始隨機配對。</p>
        <button className="button" type="button" onClick={() => goHome("USER_TAPPED_ENDED_HOME")}>回到首頁</button>
        {debugPanel}
      </main>
    );
  }

  return (
    <main className="stack">
      <section className="panel chat-shell">
        <header className="chat-header">
          <button className="ghost" type="button" onClick={() => goHome("USER_TAPPED_HEADER_HOME", { serverSessionId: session.id })}>返回首頁</button>
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
          <button className="ghost" type="button" onClick={leave} disabled={leaveBusy}>
            離開
          </button>
        </header>

        <div className="chat-actions">
          <button className="button secondary" type="button" onClick={goNext} disabled={nextBusy}>
            {nextBusy ? "切換中…" : "下一位"}
          </button>
          <button className="button secondary" onClick={() => setSafetyMenuOpen(true)}>
            安全
          </button>
          <button className="button secondary" type="button" onClick={leave} disabled={leaveBusy}>
            {leaveBusy ? "離開中…" : "離開聊天室"}
          </button>
        </div>

        {notice ? <div className="notice">{notice}</div> : null}
        {messageWarning ? <div className="notice safety-notice">{messageWarning}</div> : null}

        <div
          className="chat-messages"
          ref={messageListRef}
          onScroll={() => {
            stickToBottomRef.current = isNearBottom();
          }}
        >
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="title">目前還沒有訊息</div>
              <div className="muted">先傳第一句，讓這段匿名對話開始吧。</div>
            </div>
          ) : (
            renderedMessages
          )}
          <div ref={messagesEndRef} aria-hidden="true" />
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
            disabled={sendBusy}
          />
          <div className="chat-composer-row">
            <div className="muted small">{isEnded ? sessionEndedText : "按 Enter 送出，按 Shift+Enter 換行。"}</div>
            <button className="button" type="submit" disabled={sendBusy || draft.trim().length === 0}>
              {sendBusy ? "送出中…" : "送出"}
            </button>
          </div>
        </form>

        <div className="chat-typing-indicator" aria-live="polite" aria-atomic="true">
          {typingIndicatorText}
        </div>
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
              <button className="button" type="button" onClick={() => void confirmBlock()} disabled={blockBusy}>
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
      {debugPanel}
    </main>
  );
}

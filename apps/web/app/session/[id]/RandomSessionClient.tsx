"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
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
  buildBrowserHandoffUrl,
  ensureAnonymousBootstrapProfile,
  leaveRandomSession,
  loadMyProfile,
  isCurrentUserAdmin,
  loadMyRandomSession,
  loadAnonymousContactStatus,
  loadRandomMessages,
  getRandomMessageReplyPreview,
  getRandomChatMessageCount,
  nextRandomMatch,
  removeChatMedia,
  reportRandomUser,
  requestAnonymousContact,
  requestRandomSessionRecovery,
  registerAnonymousAbuseIdentity,
  restoreRandomSessionFromInstallation,
  sendImageMessage,
  sendRandomMessage,
  signInAnonymously,
  supabase,
  uploadChatMedia,
  waitForCurrentSession,
  RANDOM_REPORT_CATEGORIES,
  type RandomChatMessageRealtimeRow,
  type RandomChatMessageRow,
  type RandomChatMessageCursor,
  type RandomSessionRow,
  type RandomReportCategory,
  type AnonymousContactStatusRow,
  type WebProfile,
} from "../../../lib/supabase";
import { recordRealtimeDiagnostic } from "../../../lib/realtime-diagnostics";
import { Button, Modal } from "../../../components/ui";
import { SessionSafetyWarning } from "../../../components/session-safety-warning";
import { ChatImage } from "../../../components/chat/ChatImage";
import {
  loadChatImageDimensions,
  prepareChatImage,
  validateChatImageFile,
} from "../../../lib/chat-media";

type RealtimePayload<T> = {
  new: T;
};

type EasterEggKind = "goodnight" | "morning" | "hello" | "hi" | "penguin" | "sync" | "aurora" | "meteor" | "secret" | "hundred" | "twoHundred" | "threeHundred" | "fourHundred" | "tired" | "offwork" | "food" | "curious" | "surprised" | "cute" | "sleepless" | "tomorrow" | "fiveHundred" | "thousand";

type PendingEasterEggEvent = {
  event_id: string;
  egg_kind: EasterEggKind;
  trigger_type: "text" | "milestone";
  triggered_by: string;
  created_at: string;
};

type ChatAssistResult = {
  engine: "laya" | "fallback";
  conversationState: "flowing" | "quiet" | "awkward" | "tense";
  nextMove: "continue_current_topic" | "ask_open_question" | "change_topic" | "empathize" | "slow_down";
  riskProbability: number;
  contactReadiness: number;
  suggestions: string[];
  tip: string;
};

const EXTERNAL_URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;
const REPORT_CATEGORY_LABELS: Record<RandomReportCategory, string> = {
  suspected_male_impersonation: "疑似男性冒充",
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

function withReplyPreviewState(message: RandomChatMessageRow): RandomChatMessageRow {
  if (!message.reply_to_message_id || message.reply_preview_state) return message;
  return { ...message, reply_preview_state: message.reply_message_id ? "loaded" : "not_found" };
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
  if (normalized.includes("unsupported media type")) return "只支援 JPEG / PNG / WebP 圖片。";
  if (normalized.includes("media size is not allowed")) return "圖片大小超過限制（最大 5MB）。";
  if (normalized.includes("media dimensions are not allowed")) return "圖片尺寸不合法。";
  if (normalized.includes("media file was not found")) return "照片上傳驗證失敗，請重新選取。";
  if (normalized.includes("media file does not match")) return "照片上傳驗證失敗，請重新選取。";
  if (normalized.includes("media path is not allowed")) return "照片上傳驗證失敗，請重新選取。";
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

export default function RandomSessionClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id?: string | string[] }>();
  const routeSessionId = typeof params.id === "string" ? params.id : null;
  const sessionRouteIdRef = useRef(routeSessionId);
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
  const typingLastSentAtRef = useRef(0);
  const typingChannelReadyRef = useRef(false);
  const typingReceiverTimerRef = useRef<number | null>(null);
  const typingReceiverDeadlineRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const latestMessageCursorRef = useRef<RandomChatMessageCursor | null>(null);
  const oldestMessageCursorRef = useRef<RandomChatMessageCursor | null>(null);
  const historyLoadingRef = useRef(false);
  const historyExhaustedRef = useRef(false);
  const pendingReplyPreviewRef = useRef<Set<string>>(new Set());
  const easterEggSeenRef = useRef<Set<string>>(new Set());
  const easterEggLastAtRef = useRef<Map<string, number>>(new Map());
  const easterEggPendingSyncRef = useRef(false);
  const historicalThousandCheckedRef = useRef<Set<string>>(new Set());
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
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
  const [sessionMessageCount, setSessionMessageCount] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendBusy, setSendBusy] = useState(false);
  const [nextBusy, setNextBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactState, setContactState] = useState<AnonymousContactStatusRow | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantAllowed, setAssistantAllowed] = useState(false);
  const [milestoneTestAllowed, setMilestoneTestAllowed] = useState(false);
  const [easterEgg, setEasterEgg] = useState<EasterEggKind | null>(null);
  const [easterEggAllowed, setEasterEggAllowed] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantResult, setAssistantResult] = useState<ChatAssistResult | null>(null);
  const [assistantResultForMessageId, setAssistantResultForMessageId] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [nextConfirmOpen, setNextConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [headerMenuPosition, setHeaderMenuPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!headerMenuOpen) {
      setHeaderMenuPosition(null);
      return;
    }
    const updateMenuPosition = () => {
      const rect = headerMoreButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHeaderMenuPosition({
        top: rect.bottom,
        right: Math.max(12, window.innerWidth - rect.right),
      });
    };
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    return () => window.removeEventListener("resize", updateMenuPosition);
  }, [headerMenuOpen]);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFollowupOpen, setReportFollowupOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<RandomReportCategory>("suspected_male_impersonation");
  const [reportDescription, setReportDescription] = useState("");
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{
    file: File;
    previewUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<RandomChatMessageRow | null>(null);
  useEffect(() => {
    if (!previewMessage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewMessage]);
  const [replyTarget, setReplyTarget] = useState<RandomChatMessageRow | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [authState, setAuthState] = useState<NavigationDiagnosticEvent["authState"]>("loading");
  const [sessionState, setSessionState] = useState<NavigationDiagnosticEvent["sessionState"]>("loading");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [lastDiagnostic, setLastDiagnostic] = useState<NavigationDiagnosticEvent | null>(null);

  const isEnded = session?.status === "ended";
  const latestTextMessage = [...messages].reverse().find(
    (message) => message.message_type === "text" && message.content.trim().length > 0
  ) ?? null;
  const partnerName = session?.partner_anonymous_display_name ?? "匿名使用者";
  const myAnonymousName = myProfile?.anonymous_display_name ?? "匿名使用者";
  const partnerVerified = session?.partner_verified ?? false;
  const typingIndicatorText = partnerTyping ? `${partnerName} 正在輸入…` : "\u00a0";

  useEffect(() => {
    let mounted = true;

    if (!session?.id) {
      setContactState(null);
      return () => {
        mounted = false;
      };
    }

    void loadAnonymousContactStatus(session.id)
      .then((result) => {
        if (mounted && !result.error) {
          setContactState(result.data);
        }
      })
      .catch(() => {
        if (mounted) setContactState(null);
      });

    return () => {
      mounted = false;
    };
  }, [session?.id]);

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
      redirectReason: eventType === "REDIRECT_HOME" ? typeof metadata.reason === "string" ? metadata.reason : "UNKNOWN_REDIRECT" : null,
      redirectSource: typeof metadata.redirectSource === "string" ? metadata.redirectSource : null,
      authState: nextAuthState,
      sessionState: nextSessionState,
      routeSessionIdShort: getShortId(routeSessionId),
      serverSessionIdShort: getShortId(typeof metadata.serverSessionId === "string" ? metadata.serverSessionId : session?.id ?? null),
      bootstrapRunId: typeof metadata.bootstrapRunId === "number" ? metadata.bootstrapRunId : sessionBootstrapRunRef.current,
    };

    recordNavigationDiagnostic(nextEvent);
    setLastDiagnostic(nextEvent);
  };

  const goHome = (reason: string, metadata: Record<string, unknown> = {}) => {
    recordSessionRouteDiagnostic("REDIRECT_HOME", { ...metadata, reason, redirectSource: "session/[id].goHome" });
    router.replace(withNavigationDebugParam("/"));
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
    if (!channel || !typingChannelReadyRef.current) {
      return false;
    }

    try {
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: { typing },
      });
      typingLastSentAtRef.current = Date.now();
      return true;
    } catch {
      return false;
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

  const updateMessageCursors = (list: RandomChatMessageRow[]) => {
    if (list.length === 0) {
      return;
    }

    const sorted = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const currentLatest = latestMessageCursorRef.current;
    if (
      !currentLatest ||
      last.created_at > currentLatest.created_at ||
      (last.created_at === currentLatest.created_at && last.id > currentLatest.id)
    ) {
      latestMessageCursorRef.current = { created_at: last.created_at, id: last.id };
    }

    const currentOldest = oldestMessageCursorRef.current;
    if (
      !currentOldest ||
      first.created_at < currentOldest.created_at ||
      (first.created_at === currentOldest.created_at && first.id < currentOldest.id)
    ) {
      oldestMessageCursorRef.current = { created_at: first.created_at, id: first.id };
    }
  };

  const loadOlderMessages = async () => {
    if (!session?.id || historyLoadingRef.current || historyExhaustedRef.current) {
      return;
    }

    const cursor = oldestMessageCursorRef.current;
    if (!cursor) {
      return;
    }

    historyLoadingRef.current = true;
    try {
      const container = messageListRef.current;
      const previousHeight = container?.scrollHeight ?? 0;
      const result = await loadRandomMessages(session.id, 50, { before: cursor });
      if (result.error || !Array.isArray(result.data) || result.data.length === 0) {
        historyExhaustedRef.current = true;
        return;
      }

      const olderMessages = result.data.map(withReplyPreviewState);
      setMessages((current) => {
        const map = new Map(current.map((item) => [item.id, item] as const));
        for (const item of olderMessages) {
          map.set(item.id, item);
        }
        return [...map.values()].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
        );
      });
      updateMessageCursors(olderMessages);

      window.requestAnimationFrame(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - previousHeight;
        }
      });
    } finally {
      historyLoadingRef.current = false;
    }
  };

  const startReply = (message: RandomChatMessageRow) => {
    setReplyTarget(message);
  };

  const clearReply = () => {
    setReplyTarget(null);
  };

  const fetchReplyPreview = async (targetMessageId: string, ownerMessageId: string) => {
    if (!session?.id || pendingReplyPreviewRef.current.has(targetMessageId)) {
      return;
    }

    pendingReplyPreviewRef.current.add(targetMessageId);
    try {
      const { data, error } = await getRandomMessageReplyPreview(session.id, targetMessageId);
      if (error) {
        setMessages((current) =>
          current.map((item) => item.id === ownerMessageId ? { ...item, reply_preview_state: "error" } : item)
        );
        return;
      }

      if (!Array.isArray(data) || !data[0]) {
        setMessages((current) =>
          current.map((item) => item.id === ownerMessageId ? { ...item, reply_preview_state: "not_found" } : item)
        );
        return;
      }

      const preview = data[0];
      setMessages((current) =>
        current.map((item) => {
          if (item.id !== ownerMessageId) {
            return item;
          }
          return {
            ...item,
            reply_message_id: preview.reply_message_id,
            reply_is_mine: preview.reply_is_mine,
            reply_message_type: preview.reply_message_type,
            reply_body: preview.reply_body,
            reply_media_path: preview.reply_media_path,
            reply_preview_state: "loaded",
          };
        })
      );
    } finally {
      pendingReplyPreviewRef.current.delete(targetMessageId);
    }
  };

  const handleReplyQuoteClick = async (message: RandomChatMessageRow) => {
    const targetId = message.reply_to_message_id;
    if (!targetId || message.reply_preview_state === "not_found") {
      setNotice("原訊息已無法查看。");
      return;
    }

    if (message.reply_preview_state === "loading" || message.reply_preview_state === "error") {
      void fetchReplyPreview(targetId, message.id);
      return;
    }

    const scrollToTarget = () => {
      const element = document.getElementById(`chat-msg-${targetId}`);
      if (!element) {
        return false;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("chat-message-highlight");
      window.setTimeout(() => {
        element.classList.remove("chat-message-highlight");
      }, 1600);
      return true;
    };

    if (scrollToTarget()) {
      return;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await loadOlderMessages();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (scrollToTarget()) {
        return;
      }
      if (historyExhaustedRef.current) {
        break;
      }
    }

    setNotice("原訊息尚未載入。請稍後再試。");
  };

  const clearPendingMedia = () => {
    setPendingMedia((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
  };

  const handleMediaInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !session || isEnded) {
      return;
    }

    const validationError = validateChatImageFile(file);
    if (validationError) {
      setNotice(validationError.message);
      return;
    }

    try {
      const dimensions = await loadChatImageDimensions(file);
      setPendingMedia({
        file,
        previewUrl: URL.createObjectURL(file),
        width: dimensions.width,
        height: dimensions.height,
      });
    } catch {
      setNotice("這張圖片無法讀取，請換一張試試。");
    }
  };

  const sendMedia = async () => {
    if (!pendingMedia || !session || !myProfile?.id || mediaUploading || sendBusy) {
      return;
    }

    setMediaUploading(true);
    setNotice(null);
    try {
      const { blob, width, height, extension } = await prepareChatImage(pendingMedia.file);
      const { path, error: uploadError } = await uploadChatMedia(session.id, myProfile.id, blob, extension);
      if (uploadError) {
        throw uploadError;
      }

      const { data, error: messageError } = await sendImageMessage(
        session.id,
        {
          path,
          mime: blob.type,
          size: blob.size,
          width,
          height,
        },
        replyTarget?.id
      );
      if (messageError) {
        await removeChatMedia(path).catch(() => undefined);
        throw messageError;
      }

      const sent = Array.isArray(data) ? data[0] : data;
      if (sent) {
        const enriched = replyTarget && sent.reply_to_message_id
          ? {
              ...sent,
              reply_message_id: replyTarget.id,
              reply_is_mine: replyTarget.is_mine,
              reply_message_type: replyTarget.message_type,
              reply_body: replyTarget.content,
              reply_media_path: replyTarget.media_path,
            }
          : sent;
        seenMessageIdsRef.current.add(enriched.id);
        setMessages((current) => upsertMessage(current, enriched));
        updateMessageCursors([enriched]);
        pendingScrollToBottomRef.current = true;
      }
      stopTyping();
      clearPendingMedia();
      clearReply();
    } catch (error) {
      stopTyping();
      console.error("[herlink] random chat media send failed", {
        sessionId: session.id,
        code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
        message: getRandomChatErrorMessage(error),
        details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
        hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
      });
      setNotice(getFriendlyRandomChatError(error, "照片傳送失敗，請稍後再試。"));
    } finally {
      setMediaUploading(false);
    }
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
      const cursor = latestMessageCursorRef.current;
      const result = cursor
        ? await loadRandomMessages(session.id, 100, { after: cursor })
        : await loadRandomMessages(session.id, 50);
      if (result.error) {
        return;
      }

      const freshMessages = Array.isArray(result.data) ? result.data.map(withReplyPreviewState) : [];
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
      updateMessageCursors(freshMessages);

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

    let nextSession = result.data ?? null;

    // A rotated anonymous identity is no longer allowed to read the old session,
    // so get_my_random_session_view can return an RLS/authorization error instead
    // of an empty row. Try the installation-bound recovery in both cases.
    if (result.error || !nextSession) {
      const recovery = await restoreRandomSessionFromInstallation(targetSessionId);
      if (recovery.data) {
        nextSession = recovery.data;
        lastSessionFetchErrorRef.current = false;
        recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
          reason: "SESSION_RECOVERED_FROM_INSTALLATION",
          sessionState: nextSession.status === "active" ? "active" : "ended",
          serverSessionId: nextSession.id,
        });
      } else {
        if (result.error) {
          lastSessionFetchErrorRef.current = true;
          recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
            reason: "TEMPORARY_FETCH_ERROR",
            sessionState: session?.status === "active" ? "active" : "missing",
            serverSessionId: targetSessionId,
          });
        } else {
          recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
            reason: "SESSION_CONFIRMED_MISSING",
            sessionState: "missing",
            serverSessionId: targetSessionId,
          });
        }
        return null;
      }
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
    sessionRouteIdRef.current = routeSessionId;
  }, [routeSessionId]);

  useEffect(() => {
    setDebugEnabled(isNavigationDebugEnabled());
    setLastDiagnostic(readLastNavigationDiagnostic());
  }, [pathname]);

  useEffect(() => {
    try {
      setAssistantEnabled(window.localStorage.getItem("herlink:chat-assist-enabled") !== "0");
    } catch {
      setAssistantEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!latestTextMessage) {
      setAssistantResult(null);
      setAssistantResultForMessageId(null);
      return;
    }

    if (latestTextMessage.is_mine || assistantResultForMessageId !== latestTextMessage.id) {
      setAssistantResult(null);
      setAssistantResultForMessageId(null);
    }
  }, [latestTextMessage?.id, latestTextMessage?.is_mine]);

  const setChatAssistantEnabled = (enabled: boolean) => {
    setAssistantEnabled(enabled);
    if (!enabled) {
      setAssistantResult(null);
      setAssistantResultForMessageId(null);
      setAssistantError(null);
    }
    try {
      window.localStorage.setItem("herlink:chat-assist-enabled", enabled ? "1" : "0");
    } catch {
      // The feature still works for the current page when localStorage is unavailable.
    }
  };

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
  }, [routeSessionId]);

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

    // One frame is not enough on mobile when images, the keyboard, or the
    // visual viewport changes height after messages render. Re-pin to the
    // real bottom for a few frames so the newest message is always visible.
    let remainingFrames = 4;
    const pinToBottom = () => {
      scrollMessagesToBottom(behavior);
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        scrollRafRef.current = window.requestAnimationFrame(pinToBottom);
      } else {
        scrollRafRef.current = null;
      }
    };
    scrollRafRef.current = window.requestAnimationFrame(pinToBottom);
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
        if (!routeSessionId) {
          setNotice("聊天室路徑載入中，正在重試。");
          return;
        }

        const { data } = await waitForCurrentSession(8000, 150);
        let authSession = data.session;

        if (!authSession) {
          sessionBootstrapStateRef.current = "loading";
          setAuthState("loading");
          setSessionState("loading");
          setNotice("正在重新建立匿名身份並嘗試恢復原本聊天室，請稍候。");
          recordSessionRouteDiagnostic("AUTH_MISSING", {
            reason: "AUTH_CONFIRMED_MISSING",
            authState: "missing",
            bootstrapRunId,
          });

          const anonymousSignIn = await signInAnonymously();
          authSession = anonymousSignIn.data.session;
          if (!authSession) {
            sessionBootstrapStateRef.current = "missing";
            setAuthState("missing");
            setNotice("匿名身份暫時無法重新建立，請稍後再重新載入。");
            return;
          }

          await ensureAnonymousBootstrapProfile(authSession.user.id).catch(() => undefined);
          await registerAnonymousAbuseIdentity().catch(() => undefined);
        }

        sessionBootstrapStateRef.current = "ready";
        setAuthState("ready");
        recordSessionRouteDiagnostic("AUTH_READY", {
          authState: "ready",
          bootstrapRunId,
        });

        const loadedProfileResult = await loadMyProfile(authSession.user.id);
        const profileResult = loadedProfileResult.data || loadedProfileResult.error
          ? loadedProfileResult
          : await ensureAnonymousBootstrapProfile(authSession.user.id);

        if (!mounted || bootstrapRunId !== sessionBootstrapRunRef.current) {
          recordSessionRouteDiagnostic("STALE_BOOTSTRAP_DISCARDED", {
            reason: "STALE_BOOTSTRAP_DISCARDED",
            bootstrapRunId,
          });
          return;
        }

        const nextProfile = profileResult.data ?? null;
        setMyProfile(nextProfile);
        const adminCheck = await isCurrentUserAdmin(authSession.user.id).catch(() => ({ data: false }));
        if (mounted && bootstrapRunId === sessionBootstrapRunRef.current) {
          setAssistantAllowed(Boolean(adminCheck.data));
          setMilestoneTestAllowed(Boolean(adminCheck.data) || authSession.user.id === "ad9536fe-5ea0-4a1d-96d0-dcdecdafa18c");
          setEasterEggAllowed(true);
        }
        if (!nextProfile) {
          sessionBootstrapStateRef.current = "loading";
          setSessionState("loading");
          setNotice("個人資料暫時無法確認，請稍候或重新整理，不會自動離開聊天室。");
          recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
            reason: "PROFILE_TEMPORARILY_UNAVAILABLE",
            authState: "ready",
            sessionState: "loading",
            bootstrapRunId,
          });
          return;
        }

        // Do not rotate the installation binding before restoring this room.
        // The recovery RPC now atomically verifies the previous installation
        // owner, migrates the room to the current auth uid, and only then
        // advances current_user_id. Updating the binding first loses the
        // previous participant identity and makes recovery impossible.
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

          sessionBootstrapStateRef.current = "loading";
          setSessionState("loading");
          setNotice("聊天室暫時無法確認，請稍候或重新整理，不會自動跳回首頁。");
          recordSessionRouteDiagnostic("SESSION_FETCH_RESULT", {
            reason: "SESSION_TEMPORARILY_UNAVAILABLE",
            authState: "ready",
            sessionState: "loading",
            bootstrapRunId,
          });
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

        const messagesResult = await loadRandomMessages(nextSession.id, 50);
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
          const nextMessages = Array.isArray(messagesResult.data)
            ? messagesResult.data.map(withReplyPreviewState)
            : [];
          const previousSeenIds = seenMessageIdsRef.current;
          const newlyReceivedPartnerMessages = nextMessages.filter(
            (item) => !item.is_mine && !previousSeenIds.has(item.id) && item.message_type !== "image"
          );
          seenMessageIdsRef.current = new Set(nextMessages.map((item) => item.id));
          setMessages(nextMessages);
          updateMessageCursors(nextMessages);
          // Text eggs must trigger for the receiver too. Previously they were
          // checked only in sendMessage(), so only the sender could see them.
          // Skip the initial history load to avoid replaying old eggs on entry.
          if (previousSeenIds.size > 0) {
            for (const item of newlyReceivedPartnerMessages) {
              // The sender creates the canonical easter-egg event. The receiver
              // consumes that same event through get_pending_chat_easter_egg_events,
              // avoiding duplicate events and guaranteeing retry after reconnect.
            }
          }
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
  }, [routeSessionId, router]);

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

    let disposed = false;
    let timer: number | null = null;

    const syncNow = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
      void refreshSessionFromServerRef.current?.();
    };

    const scheduleNext = () => {
      if (disposed) return;
      const delay = typingChannelReadyRef.current ? 15_000 : 3_000;
      timer = window.setTimeout(() => {
        syncNow();
        scheduleNext();
      }, delay);
    };

    const syncAndReschedule = () => {
      syncNow();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      scheduleNext();
    };

    scheduleNext();
    window.addEventListener("focus", syncAndReschedule);
    window.addEventListener("online", syncAndReschedule);
    document.addEventListener("visibilitychange", syncAndReschedule);

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("focus", syncAndReschedule);
      window.removeEventListener("online", syncAndReschedule);
      document.removeEventListener("visibilitychange", syncAndReschedule);
    };
  }, [myProfile?.id, session?.id]);

  useEffect(() => {
    if (!session || !myProfile?.id) return;

    let disposed = false;
    let chatChannelSubscribed = false;
    let chatChannel: ReturnType<typeof supabase.channel> | null = null;
    let startingRealtime = false;
    let lastErrorAt = 0;

    const syncRealtimeAuth = async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken) {
        await supabase.realtime.setAuth(accessToken);
      }
    };

    const startRealtime = async () => {
      if (disposed || startingRealtime) return;
      startingRealtime = true;

      // Anonymous users still use authenticated JWTs. Explicitly sync the
      // freshest token before joining so Realtime never reuses a stale token.
      await syncRealtimeAuth().catch(() => undefined);
      if (disposed) {
        startingRealtime = false;
        return;
      }

      // Always tear down any previous channel before creating a replacement.
      // This prevents reconnect races from leaving duplicate channels alive.
      const previousChannel = chatChannel;
      if (previousChannel) {
        chatChannel = null;
        typingChannelRef.current = null;
        await supabase.removeChannel(previousChannel).catch(() => undefined);
      }
      if (disposed) {
        startingRealtime = false;
        return;
      }

      recordDiagnostic("realtime_subscribe_started", {
        sessionId: session.id,
        userId: myProfile.id,
        metadata: { channel: "chat" },
      });

      chatChannel = supabase.channel(`random-chat-${session.id}`);
      typingChannelRef.current = chatChannel;

      chatChannel
        .on("broadcast", { event: "refresh" }, () => {
          void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
          void refreshSessionFromServerRef.current?.();
        })
        .on("broadcast", { event: "typing" }, (payload: { payload?: { typing?: unknown } }) => {
          const typing = Boolean(payload?.payload?.typing);

          if (!typing) {
            clearPartnerTyping();
            return;
          }

          setPartnerTyping(true);
          armPartnerTypingTimeout();
        })
        .subscribe((status: string, channelError?: Error) => {
          if (status === "SUBSCRIBED") {
            startingRealtime = false;
            lastErrorAt = 0;
            typingChannelReadyRef.current = true;
            recordDiagnostic(chatChannelSubscribed ? "realtime_reconnected" : "realtime_subscribed", {
              sessionId: session.id,
              userId: myProfile.id,
              metadata: { channel: "chat" },
            });
            chatChannelSubscribed = true;
            void refreshSessionFromServerRef.current?.();
            void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            typingChannelReadyRef.current = false;
            startingRealtime = false;
            const now = Date.now();
            const safeMessage = channelError?.message?.slice(0, 160) || null;
            // One browser can emit the same Realtime error repeatedly while the
            // Supabase socket is recovering. Persist at most one error per chat
            // session per browser every 10 minutes so the admin counter reflects
            // affected sessions instead of callback retries.
            const diagnosticKey = `herlink:realtime-error:${session.id}`;
            const previousPersistedAt = Number(window.sessionStorage.getItem(diagnosticKey) || "0");
            if (now - previousPersistedAt >= 600_000 && now - lastErrorAt >= 30_000) {
              lastErrorAt = now;
              window.sessionStorage.setItem(diagnosticKey, String(now));
              recordDiagnostic("realtime_subscribe_error", {
                sessionId: session.id,
                userId: myProfile.id,
                safeErrorCode: status,
                metadata: {
                  channel: "chat",
                  error: safeMessage,
                },
              });
            }

            // Immediately fall back to database sync so chat remains current.
            void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
            void refreshSessionFromServerRef.current?.();

            // Supabase Realtime owns socket/channel recovery. Do not call
            // setAuth(), removeChannel(), or subscribe() again from this error
            // callback: doing so can race the built-in reconnect after a brief
            // mobile/browser transport interruption.
            return;
          }

          if (status === "CLOSED") {
            typingChannelReadyRef.current = false;
            startingRealtime = false;
            // removeChannel() during normal navigation/unmount also emits CLOSED.
            // Never persist that intentional lifecycle event as a connection error.
            if (disposed) return;
            void refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
            void refreshSessionFromServerRef.current?.();
          }
        });
    };

    void startRealtime();

    return () => {
      disposed = true;
      if (chatChannel) {
        // Unsubscribe this component's channel only. Supabase owns the shared
        // socket lifecycle and can finish cleanup before a later mount rejoins.
        void chatChannel.unsubscribe();
      }
      stopTyping();
      clearPartnerTyping();
      clearReply();
      typingChannelReadyRef.current = false;
      typingChannelRef.current = null;
    };
  }, [myProfile?.id, session?.id]);

  useEffect(() => {
    if (isEnded) {
      stopTyping();
      clearPartnerTyping();
      clearReply();
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

    const now = Date.now();
    const shouldBroadcastTyping =
      !typingActiveRef.current ||
      now - typingLastSentAtRef.current >= 900;

    typingActiveRef.current = true;
    if (shouldBroadcastTyping) {
      void sendTypingState(true);
    }

    clearSenderTypingTimer();
    typingSenderTimerRef.current = window.setTimeout(() => {
      if (!typingActiveRef.current) {
        return;
      }

      typingActiveRef.current = false;
      void sendTypingState(false);
    }, 3000);

    return () => {
      clearSenderTypingTimer();
    };
  }, [draft, isEnded, myProfile?.id, session?.id]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current || pendingScrollToBottomRef.current) {
        scheduleScrollMessagesToBottom("auto");
      }
    });
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);

    return () => observer.disconnect();
  }, [messages.length, session?.id]);

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

  const triggerEasterEgg = (kind: EasterEggKind, recordEvent = false, forcePlayback = false) => {
    if (!easterEggAllowed && !recordEvent) return;
    const now = Date.now();
    const lastAt = easterEggLastAtRef.current.get(kind) ?? 0;
    if (!forcePlayback && now - lastAt < 90_000 && !recordEvent) return;
    easterEggLastAtRef.current.set(kind, now);
    setEasterEgg(kind);
    if (recordEvent && session?.id) {
      const triggerType = ["hundred", "twoHundred", "threeHundred", "fourHundred", "fiveHundred", "thousand"].includes(kind)
        ? "milestone"
        : "text";
      // The session participant IDs are the auth user IDs. Use the current
      // authenticated user as the event owner instead of the optional profile
      // object so RLS can reliably accept the insert for every chat user.
      void (async () => {
        const authResult = await supabase.auth.getUser();
        const userId = authResult.data.user?.id;
        if (authResult.error || !userId) return;
        const insertResult = await supabase.rpc("record_chat_easter_egg_event", {
          p_session_id: session.id,
          p_egg_kind: kind,
          p_trigger_type: triggerType,
        });
        if (insertResult.error) {
          const diagnostic = {
            at: new Date().toISOString(),
            session: session.id,
            user: userId,
            kind,
            triggerType,
            code: insertResult.error.code ?? "RPC_ERROR",
            message: insertResult.error.message ?? "彩蛋紀錄失敗",
          };
          console.error("[herlink] easter egg event RPC failed", diagnostic);
          try {
            localStorage.setItem("herlink:last-easter-egg-log-error", JSON.stringify(diagnostic));
          } catch {}
          const failureResult = await supabase.rpc("record_chat_easter_egg_failure", {
            p_session_id: session.id,
            p_egg_kind: kind,
            p_trigger_type: triggerType,
            p_error_code: diagnostic.code,
            p_error_message: diagnostic.message,
          });
          if (failureResult.error) {
            console.error("[herlink] easter egg failure diagnostic RPC failed", failureResult.error);
          }
        } else {
          const eventId = typeof insertResult.data === "string" ? insertResult.data : null;
          if (eventId) {
            const clientVersion = "web-v2";
            const dispatchedResult = await supabase.rpc("mark_chat_easter_egg_dispatched", {
              p_event_id: eventId,
              p_client_version: clientVersion,
            });
            if (dispatchedResult.error) {
              console.error("[herlink] easter egg dispatch tracking failed", dispatchedResult.error);
            }

            const deliveryResult = await supabase.rpc("record_chat_easter_egg_delivery", { p_event_id: eventId });
            if (deliveryResult.error) {
              console.error("[herlink] easter egg display tracking failed", deliveryResult.error);
            } else {
              const durationMs = kind === "thousand" ? 5400 : 3200;
              window.setTimeout(() => {
                void supabase.rpc("complete_chat_easter_egg_delivery", {
                  p_event_id: eventId,
                  p_duration_ms: durationMs,
                  p_client_version: clientVersion,
                }).then((result: { error?: unknown }) => {
                  if (result.error) console.error("[herlink] easter egg completion tracking failed", result.error);
                });
              }, durationMs);
            }
          }
          try {
            localStorage.removeItem("herlink:last-easter-egg-log-error");
          } catch {}
        }
      })();
    }
    if (kind === "thousand") {
      try {
        navigator.vibrate?.([35, 45, 55]);
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const audio = new AudioContextClass();
          const start = audio.currentTime;
          [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, start + index * 0.11);
            gain.gain.exponentialRampToValueAtTime(0.055, start + index * 0.11 + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.11 + 0.42);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start(start + index * 0.11);
            oscillator.stop(start + index * 0.11 + 0.44);
          });
          window.setTimeout(() => void audio.close(), 1300);
        }
      } catch {
        // Celebration effects are optional and must never interrupt chat.
      }
    }
    window.setTimeout(() => setEasterEgg((current) => (current === kind ? null : current)), kind === "thousand" ? 5400 : 3200);
  };

  useEffect(() => {
    if (!easterEggAllowed || !session?.id || isEnded || historicalThousandCheckedRef.current.has(session.id)) return;
    historicalThousandCheckedRef.current.add(session.id);

    void getRandomChatMessageCount(session.id)
      .then((result) => {
        const count = Number(result.data);
        if (!result.error && Number.isFinite(count) && count >= 1000) {
          triggerEasterEgg("thousand", true);
        }
      })
      .catch(() => {
        historicalThousandCheckedRef.current.delete(session.id);
      });
  }, [easterEggAllowed, isEnded, session?.id]);

  const maybeTriggerEasterEgg = (content: string) => {
    if (!easterEggAllowed) return;
    const normalized = content.replace(/\\s+/g, "");
    if (/睡不著/.test(normalized)) return triggerEasterEgg("sleepless", true);
    if (/想你|想妳|想念|好想|想你了|想妳了/.test(normalized)) return triggerEasterEgg("aurora", true);
    if (/好累|累死|累爆|累慘/.test(normalized)) return triggerEasterEgg("tired", true);
    if (/下班了|下班啦|終於下班/.test(normalized)) return triggerEasterEgg("offwork", true);
    if (/加油|祝你|祝妳|希望|順利|辛苦了/.test(normalized)) return triggerEasterEgg("meteor", true);
    if (/好可愛|可愛死|太可愛/.test(normalized)) return triggerEasterEgg("cute", true);
    if (/喜歡你|喜歡妳|喜歡|心動|愛你|愛妳/.test(normalized)) return triggerEasterEgg("secret", true);
    if (/早安|早啊|早呀|早上好/.test(normalized)) return triggerEasterEgg("morning", true);
    if (/^(hi|hey|hello)$/i.test(normalized)) return triggerEasterEgg("hi", true);
    if (/安安|嗨嗨|哈囉|哈啰/.test(normalized)) return triggerEasterEgg("hello", true);
    if (/明天見/.test(normalized)) return triggerEasterEgg("tomorrow", true);
    if (/晚安|先睡了|我要睡了/.test(normalized)) return triggerEasterEgg("goodnight", true);
    if (/企鵝/.test(normalized)) return triggerEasterEgg("penguin", true);
    if (/吃飯了嗎|吃飽了嗎|吃飯沒|吃了嗎|吃什麼/.test(normalized)) return triggerEasterEgg("food", true);
    if (/在幹嘛|在幹麻|幹嘛呢|在做什麼/.test(normalized)) return triggerEasterEgg("curious", true);
    if (/真的假的|真的嗎|不會吧|蛤真的/.test(normalized)) return triggerEasterEgg("surprised", true);
    if (/笑死/.test(normalized)) return triggerEasterEgg("sync", true);
    if (/哈{2,}/.test(content)) {
      const partnerAlsoLaughing = [...messages].reverse().find((message) => !message.is_mine && message.message_type !== "image");
      if (partnerAlsoLaughing && /哈{2,}/.test(partnerAlsoLaughing.content || "")) triggerEasterEgg("sync", true);
    }
  };

  useEffect(() => {
    if (!session?.id || !myProfile?.id || !easterEggAllowed || isEnded) return;

    let disposed = false;
    let timer: number | null = null;

    const syncPendingEasterEgg = async () => {
      if (disposed || easterEggPendingSyncRef.current || document.visibilityState !== "visible") return;
      easterEggPendingSyncRef.current = true;
      try {
        const result = await supabase.rpc("get_pending_chat_easter_egg_events", {
          p_session_id: session.id,
          p_limit: 1,
        });
        if (result.error || !Array.isArray(result.data) || !result.data[0]) return;

        const pending = result.data[0] as PendingEasterEggEvent;
        if (easterEggSeenRef.current.has(pending.event_id)) return;
        easterEggSeenRef.current.add(pending.event_id);

        const durationMs = pending.egg_kind === "thousand" ? 5400 : 3200;
        triggerEasterEgg(pending.egg_kind, false, true);

        window.setTimeout(() => {
          if (disposed) return;
          void (async () => {
            const displayed = await supabase.rpc("record_chat_easter_egg_delivery", {
              p_event_id: pending.event_id,
            });
            if (displayed.error) {
              easterEggSeenRef.current.delete(pending.event_id);
              return;
            }
            await supabase.rpc("complete_chat_easter_egg_delivery", {
              p_event_id: pending.event_id,
              p_duration_ms: durationMs,
              p_client_version: "web-v3-reliable-eggs",
            });
            void syncPendingEasterEgg();
          })();
        }, durationMs);
      } finally {
        window.setTimeout(() => {
          easterEggPendingSyncRef.current = false;
        }, 250);
      }
    };

    const onResume = () => void syncPendingEasterEgg();
    void syncPendingEasterEgg();
    timer = window.setInterval(() => void syncPendingEasterEgg(), 2000);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      document.removeEventListener("visibilitychange", onResume);
      easterEggPendingSyncRef.current = false;
    };
  }, [easterEggAllowed, isEnded, myProfile?.id, session?.id]);

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

      const { data, error } = await sendRandomMessage(refreshedSession.id, content, replyTarget?.id);
      if (error) {
        throw error;
      }

      const nextMessage = Array.isArray(data) ? data[0] : data;
      maybeTriggerEasterEgg(content);
      if (easterEggAllowed) {
        const countResult = await getRandomChatMessageCount(refreshedSession.id).catch(() => ({ data: null, error: null }));
        const messageCount = Number(countResult.data);
        if (messageCount === 100) triggerEasterEgg("hundred", true);
        else if (messageCount === 200) triggerEasterEgg("twoHundred", true);
        else if (messageCount === 300) triggerEasterEgg("threeHundred", true);
        else if (messageCount === 400) triggerEasterEgg("fourHundred", true);
        else if (messageCount === 500) triggerEasterEgg("fiveHundred", true);
        else if (messageCount === 1000) triggerEasterEgg("thousand", true);
      }

      if (nextMessage) {
        const enriched = replyTarget && nextMessage.reply_to_message_id
          ? {
              ...nextMessage,
              reply_message_id: replyTarget.id,
              reply_is_mine: replyTarget.is_mine,
              reply_message_type: replyTarget.message_type,
              reply_body: replyTarget.content,
              reply_media_path: replyTarget.media_path,
            }
          : nextMessage;
        seenMessageIdsRef.current.add(enriched.id);
        setMessages((current) => upsertMessage(current, enriched));
        updateMessageCursors([enriched]);
        pendingScrollToBottomRef.current = true;
        if (enriched.risk_level && enriched.risk_level !== "low") {
          setNotice("這則訊息含有可疑內容，請提高警覺。");
        }
      }
      if (typingChannelReadyRef.current && typingChannelRef.current) {
        void typingChannelRef.current.send({
          type: "broadcast",
          event: "refresh",
          payload: { reason: "message" },
        });
      }
      stopTyping();
      setDraft("");
      // Do not programmatically refocus the composer after send on mobile Web.
      // Keeping focus here reopens the virtual keyboard while an easter egg is showing.
      chatInputRef.current?.blur();
      setAssistantResult(null);
      setAssistantResultForMessageId(null);
      setAssistantError(null);
      clearReply();
    } catch (error) {
      stopTyping();
      clearPartnerTyping();
      const refreshedSession = await refreshSessionFromServerRef.current?.();
      console.error("[herlink] random chat send failed", {
        code: getRandomChatSendErrorCode(error, refreshedSession),
        sessionId: session.id,
        message: getRandomChatErrorMessage(error),
        details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
        hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
      });
      if (refreshedSession?.status === "active") {
        await refreshMessagesFromServerRef.current?.({ forceScroll: stickToBottomRef.current });
      }
      setNotice(getFriendlyRandomChatError(error, "訊息傳送失敗，請稍後再試。"));
    } finally {
      setSendBusy(false);
    }
  };

  const leave = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!event.nativeEvent.isTrusted || !session || leaveBusy) return;
    if (!window.confirm(["確定要離開這個聊天室嗎？", "", "離開後會回到首頁，不會自動重新配對。"].join(String.fromCharCode(10)))) return;
    setLeaveBusy(true);
    try {
      stopTyping();
      clearPartnerTyping();
      clearReply();
      await leaveRandomSession(session.id);
      if (typingChannelReadyRef.current && typingChannelRef.current) {
        await typingChannelRef.current.send({
          type: "broadcast",
          event: "refresh",
          payload: { reason: "session-ended" },
        }).catch(() => undefined);
      }
      goHome("USER_LEFT_SESSION", { serverSessionId: session.id });
    } catch {
      setNotice("目前無法離開聊天室，請稍後再試。");
    } finally {
      setLeaveBusy(false);
    }
  };

  const goNext = async () => {
    if (!session || nextBusy) return;
    setNextConfirmOpen(false);
    setNextBusy(true);
    setNotice(null);
    try {
      stopTyping();
      clearPartnerTyping();
      clearReply();
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

  const requestChatAssist = async () => {
    if (!assistantEnabled || assistantBusy || isEnded) return;

    let sourceMessages = messages;
    if (session?.id) {
      const latest = await loadRandomMessages(session.id, 50);
      if (!latest.error && latest.data?.length) {
        sourceMessages = [...latest.data].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
        );
      }
    }

    const textMessages = sourceMessages
      .filter((message) => message.message_type === "text" && message.content.trim().length > 0)
      .slice(-50)
      .map((message) => ({
        role: message.is_mine ? "me" : "partner",
        text: message.content.trim().slice(0, 500),
      }));

    if (textMessages.length === 0) {
      setAssistantError("先聊幾句後，我才能依照目前對話提供建議。");
      setAssistantResult(null);
      return;
    }

    if (textMessages[textMessages.length - 1]?.role !== "partner") {
      setAssistantResult(null);
      setAssistantError("你已經回覆了，等對方下一句再使用聊天助手。");
      return;
    }

    setAssistantBusy(true);
    setAssistantError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error("AUTH_MISSING");
      }

      const response = await fetch("/api/chat-assist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: textMessages,
        }),
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; result?: ChatAssistResult; message?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.result) {
        throw new Error(payload?.message || "CHAT_ASSIST_FAILED");
      }

      const newestPartnerText = [...sourceMessages].reverse().find(
        (message) => message.message_type === "text" && !message.is_mine && message.content.trim().length > 0
      );
      setAssistantResult(payload.result);
      setAssistantResultForMessageId(newestPartnerText?.id ?? null);
    } catch {
      setAssistantError("聊天助手暫時無法分析，請稍後再試。");
    } finally {
      setAssistantBusy(false);
    }
  };

  const handleAnonymousContact = async () => {
    if (!session || contactBusy || contactState?.status === "active") return;
    if (contactState?.my_approved && !contactState.partner_approved) return;

    setContactBusy(true);
    setNotice(null);
    try {
      const result = await requestAnonymousContact(session.id);
      if (result.error) throw result.error;

      setContactState(result.data);
      if (result.data?.status === "active") {
        setNotice("你們已成為匿名聯絡人，之後可以從「匿名聯絡人」再次聊天。");
      } else {
        setNotice("已送出匿名聯絡邀請，等對方也同意後才會保留聯絡。");
      }
    } catch (error) {
      setNotice(getFriendlyRandomChatError(error, "目前無法保留匿名聯絡，請稍後再試。"));
    } finally {
      setContactBusy(false);
    }
  };

  const anonymousContactLabel =
    contactState?.status === "active"
      ? "已保留聯絡"
      : contactState?.partner_approved && !contactState.my_approved
        ? "接受匿名聯絡"
        : contactState?.my_approved
          ? "等待對方同意"
          : "保留匿名聯絡";

  const contactRequestCard =
    contactState?.status !== "active" && contactState?.partner_approved && !contactState.my_approved ? (
      <section className="notice" style={{ margin: "12px 16px" }}>
        <strong>{partnerName} 想和你成為匿名聯絡人</strong>
        <div className="muted small" style={{ marginTop: 6 }}>雙方都同意後，之後可以從「匿名聯絡人」再次找到彼此。</div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button size="sm" type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void handleAnonymousContact(); }} disabled={contactBusy}>
            {contactBusy ? "處理中…" : "同意"}
          </Button>
        </div>
      </section>
    ) : null;

  const copyBrowserHandoffLink = async () => {
    const { data } = await supabase.auth.getSession();
    const authSession = data.session;
    if (!authSession || !session?.id) {
      setNotice("目前無法建立續聊連結，請稍後再試。");
      return;
    }

    const handoffUrl = buildBrowserHandoffUrl(authSession, `/session/${session.id}`);
    if (!handoffUrl) {
      setNotice("目前無法建立續聊連結，請稍後再試。");
      return;
    }

    try {
      await navigator.clipboard.writeText(handoffUrl);
      setNotice("已複製續聊連結。貼到 Chrome、Safari 或其他瀏覽器開啟，就能保留匿名名稱與這段聊天。");
    } catch {
      setNotice("無法自動複製續聊連結，請確認瀏覽器允許剪貼簿權限。");
    }
  };


  const confirmBlock = async () => {
    if (!session || blockBusy) return;
    setBlockBusy(true);
    setNotice(null);
    try {
      stopTyping();
      clearPartnerTyping();
      clearReply();
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
      <article key={message.id} id={`chat-msg-${message.id}`} className={`chat-message ${message.is_mine ? "mine" : "theirs"}`}>
        <div className={`chat-bubble ${message.message_type === "image" ? "image-message" : ""} ${message.risk_level !== "low" ? "risky" : ""}`} role={message.message_type === "image" ? undefined : "button"} tabIndex={message.message_type === "image" ? undefined : 0} aria-label={message.message_type === "image" ? undefined : "回覆這則訊息"} onClick={message.message_type === "image" ? undefined : () => startReply(message)} onKeyDown={message.message_type === "image" ? undefined : (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); startReply(message); } }}>
          {riskLabel ? <div className="chat-risk-badge">{riskLabel}</div> : null}
          {message.reply_to_message_id ? (
            <button
              type="button"
              className="chat-reply-quote"
              onClick={() => void handleReplyQuoteClick(message)}
            >
              <span className="chat-reply-quote-label">
                {message.reply_is_mine === true
                  ? "回覆自己"
                  : message.reply_is_mine === false
                    ? "回覆對方"
                    : "回覆"}
              </span>
              <span className="chat-reply-quote-body">
                {message.reply_preview_state === "loading"
                  ? "載入引用訊息中…"
                  : message.reply_preview_state === "error"
                    ? "引用訊息暫時無法載入"
                    : message.reply_message_type === "image"
                      ? "📷 圖片"
                      : message.reply_preview_state === "not_found"
                        ? "原訊息已無法查看"
                        : message.reply_body || "原訊息"}
              </span>
            </button>
          ) : null}
          {message.message_type === "image" && message.media_path ? (
            <ChatImage
              path={message.media_path}
              alt={message.is_mine ? "你傳送的圖片" : "對方傳送的圖片"}
              onOpen={() => { setHeaderMenuOpen(false); setSafetyMenuOpen(false); setPreviewMessage(message); }}
            />
          ) : (
            <div className="chat-message-content">{renderMessageContent(message.content, openExternalLink)}</div>
          )}
        </div>
        <div className="chat-meta chat-meta-outside">{formatTime(message.created_at)}</div>
      </article>
    );
  });

  const debugPanel = debugEnabled ? (
    <div className="debug-panel">
      <div>path: {pathname}</div>
      <div>auth: {authState}</div>
      <div>session: {sessionState}</div>
      <div>LAST SESSION EVENT: {lastDiagnostic?.event ?? "none"}</div>
      <div>LAST REDIRECT REASON: {lastDiagnostic?.redirectReason ?? lastDiagnostic?.reason ?? "none"}</div>
      <div>REDIRECT SOURCE: {lastDiagnostic?.redirectSource ?? "none"}</div>
      <div>AUTH STATE: {authState}</div>
      <div>SESSION STATE: {sessionState}</div>
      <div>ROUTE SESSION ID: {getShortId(routeSessionId) ?? "loading"}</div>
      <div>SERVER SESSION ID: {getShortId(session?.id ?? null) ?? lastDiagnostic?.serverSessionIdShort ?? "none"}</div>
    </div>
  ) : null;

  if (loading) {
    return (
      <main className="hero">
      <div className="halloween-chat-decor" aria-hidden="true"><span>💀</span><span>🕯️</span><span>⚰️</span><span className="halloween-corner-web">🕸️</span></div>
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
        <h1 className="hero-title">聊天室暫時無法載入</h1>
        <p className="hero-copy">聊天室不一定已結束，HerLink 目前無法確認你的匿名身份或會話狀態。</p>
        {recoveryCode ? (
          <div className="notice">
            恢復碼：<strong>{recoveryCode}</strong><br />
            請把這組恢復碼傳給管理員，核對後即可把原聊天室接回目前這個匿名身份。
          </div>
        ) : null}
        <div className="button-row">
          <button className="button" type="button" onClick={() => window.location.reload()}>重新載入</button>
          <button
            className="button secondary"
            type="button"
            disabled={recoveryBusy || !routeSessionId}
            onClick={async () => {
              if (!routeSessionId) return;
              setRecoveryBusy(true);
              const result = await requestRandomSessionRecovery(routeSessionId);
              if (result.data?.recovery_code) {
                setRecoveryCode(result.data.recovery_code);
                setNotice("已建立一次性恢復碼，30 分鐘內有效。");
              } else {
                setNotice("目前無法建立恢復碼，請稍後再試。");
              }
              setRecoveryBusy(false);
            }}
          >
            {recoveryBusy ? "建立恢復碼中…" : "無法進入？取得恢復碼"}
          </button>
        </div>
        {debugPanel}
      </main>
    );
  }

  return (
    <main className="chat-page">
      <div className="halloween-chat-decor" aria-hidden="true"><span>💀</span><span>🕯️</span><span>⚰️</span><span className="halloween-corner-web">🕸️</span></div>
      <section className="chat-shell">
        <header className="chat-header">
          <button
            className="ghost chat-back"
            type="button"
            aria-label="返回首頁"
            title="返回首頁"
            onClick={() => goHome("USER_TAPPED_HEADER_HOME", { serverSessionId: session.id })}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <div className="chat-header-main">
            <div className="chat-identity">
              <div className="chat-partner-row">
                <div className="title chat-partner-name">{partnerName}</div>
                {partnerVerified ? <span className="chat-verified">✓</span> : null}
              </div>
              <div className="chat-my-name">你：{myAnonymousName}{isEnded ? " · 聊天已結束" : ""}</div>
            </div>
          </div>
          <div className="chat-header-actions">
            {assistantAllowed ? (
              <button
                className="chat-assistant-trigger"
                type="button"
                onClick={() => setAssistantOpen((open) => !open)}
                aria-expanded={assistantOpen}
              >
                <span className="chat-assistant-spark">✦</span>
                <span>聊天助手</span>
              </button>
            ) : null}
            <button
              className="ghost chat-header-next"
              type="button"
              onClick={() => setNextConfirmOpen(true)}
              disabled={nextBusy}
              title="結束目前聊天，立即重新配對下一位"
              aria-label="下一位：結束目前聊天並立即重新配對"
            >
              {nextBusy ? "處理中…" : "下一位"}
            </button>
            <div className="chat-more chat-header-more" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
              <button
                ref={headerMoreButtonRef}
                className="ghost chat-more-summary"
                type="button"
                aria-label="更多聊天室選項"
                title="更多"
                aria-expanded={headerMenuOpen}
                onClick={(event) => { event.stopPropagation(); setHeaderMenuOpen((open) => !open); }}
              >
                •••
              </button>
              {headerMenuOpen && headerMenuPosition && typeof document !== "undefined"
                ? createPortal(
                    <div
                      className="chat-more-menu chat-more-menu-portal"
                      style={{ top: headerMenuPosition.top, right: headerMenuPosition.right }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="chat-menu-message-count" aria-live="polite">目前訊息數：{sessionMessageCount === null ? "讀取中…" : sessionMessageCount.toLocaleString("zh-TW")}</div>
                      <button className="button secondary chat-contact" type="button" onClick={() => { setHeaderMenuOpen(false); void handleAnonymousContact(); }} disabled={contactBusy || contactState?.status === "active" || Boolean(contactState?.my_approved && !contactState.partner_approved)}>
                        {contactBusy ? "處理中…" : anonymousContactLabel}
                      </button>
                      <button className="button secondary" type="button" onClick={() => { setHeaderMenuOpen(false); void copyBrowserHandoffLink(); }}>跨瀏覽器續聊</button>
                      <button className="button secondary chat-safety" type="button" onClick={() => { setHeaderMenuOpen(false); setSafetyMenuOpen(true); }}>安全</button>
                      <button className="button secondary chat-menu-leave" type="button" onClick={(event) => { setHeaderMenuOpen(false); void leave(event); }} disabled={leaveBusy} title="結束聊天並回到首頁，不會自動重新配對">
                        {leaveBusy ? "離開中…" : "離開聊天室"}
                      </button>
                    </div>,
                    document.body
                  )
                : null}
            </div>
          </div>
        </header>

        {(contactRequestCard || notice) ? (
          <div className="chat-status-stack">
            {contactRequestCard}
            {notice ? <div className="notice chat-status-notice">{notice}</div> : null}
          </div>
        ) : null}

        {assistantAllowed && assistantOpen ? (
          <section className="chat-assist-card" aria-live="polite">
            <div className="chat-assist-heading">
              <div>
                <strong>聊天小助手</strong>
                <div className="muted chat-assist-subtitle">只分析最近的文字訊息，不會自動替你送出。</div>
              </div>
              <label className="chat-assist-toggle">
                <input
                  type="checkbox"
                  checked={assistantEnabled}
                  onChange={(event) => setChatAssistantEnabled(event.target.checked)}
                />
                啟用
              </label>
            </div>

            {assistantEnabled ? (
              <>
                <div className="row">
                  <Button size="sm" type="button" onClick={() => void requestChatAssist()} disabled={assistantBusy || isEnded}>
                    {assistantBusy ? "分析中…" : "幫我想怎麼回"}
                  </Button>
                </div>

                {assistantError ? <div className="notice">{assistantError}</div> : null}

                {assistantResult &&
                latestTextMessage &&
                !latestTextMessage.is_mine &&
                assistantResultForMessageId === latestTextMessage.id ? (
                  <div className="chat-assist-result">
                    {assistantResult.riskProbability >= 0.65 ? (
                      <div className="notice warning">這段對話可能有風險，先不要提供金錢、驗證碼或敏感個資。</div>
                    ) : null}
                    <div className="chat-assist-tip">{assistantResult.tip}</div>
                    <div className="chat-assist-suggestions">
                      {assistantResult.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="chat-assist-suggestion"
                          onClick={() => {
                            setDraft(suggestion);
                            setAssistantOpen(false);
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                    {assistantResult.contactReadiness >= 0.72 && contactState?.status !== "active" ? (
                      <div className="muted">你們目前互動看起來較穩定，也可以考慮使用「保留匿名聯絡」。</div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="muted">聊天助手已關閉，訊息不會送去分析。</div>
            )}
          </section>
        ) : null}

        {session ? <SessionSafetyWarning key={session.id} sessionId={session.id} warning={messageWarning}
          highRiskAt={messages.reduce((latest, message) =>
            (message.risk_level === "high" || message.risk_level === "critical") && message.created_at > latest
              ? message.created_at : latest, "")} /> : null}

        {easterEggAllowed && easterEgg ? (
          <div className={`chat-easter-egg chat-easter-egg-${easterEgg}`} aria-hidden="true">
            {easterEgg === "goodnight" ? <><span className="egg-night-glow" /><span className="egg-cloud egg-cloud-one">☁</span><span className="egg-cloud egg-cloud-two">☁</span><span className="egg-moon">☾</span><span className="egg-stars egg-stars-one">✦　·　✧　·　✦</span><span className="egg-stars egg-stars-two">·　✦　·　✧</span><span className="egg-shooting-star">✦</span><span className="egg-goodnight-text">晚安，今晚做個好夢</span></> : easterEgg === "morning" ? <><span className="egg-sunrise" /><span className="egg-sun">☀</span><span className="egg-morning-cloud cloud-a">☁</span><span className="egg-morning-cloud cloud-b">☁</span><span className="egg-morning-birds">⌁　⌁　⌁</span><span className="egg-morning-text">早安，今天也要有好心情</span></> : easterEgg === "hello" ? <><span className="egg-hello-ripple r1" /><span className="egg-hello-ripple r2" /><span className="egg-hello-bubble b1">嗨</span><span className="egg-hello-bubble b2">安</span><span className="egg-hello-bubble b3">✦</span><span className="egg-hello-wave">👋</span><span className="egg-hello-text">叮！收到一聲安安 ✦</span></> : easterEgg === "hi" ? <><span className="egg-hi-orbit orbit-a">✦</span><span className="egg-hi-orbit orbit-b">✧</span><span className="egg-hi-card"><b>Hi!</b><small>訊號接通，開始聊天吧</small></span><span className="egg-hi-pulse" /></> : easterEgg === "penguin" ? <><span className="egg-snow egg-snow-one">✦　·　❄　·　✦</span><span className="egg-snow egg-snow-two">·　❄　·　✦　·</span><span className="egg-penguin">🐧</span><span className="egg-penguin-text">企鵝路過你的聊天室</span></> : easterEgg === "sync" ? <><span className="egg-sync-burst">✦</span><span className="egg-sync">默契 +1<small>你們笑在同一個頻率上</small></span></> : easterEgg === "tired" ? <><span className="egg-text-icon">▱</span><span className="egg-text-card"><b>電量不足</b><small>今天辛苦了，休息一下吧</small></span></> : easterEgg === "offwork" ? <><span className="egg-text-burst">✦　✧　✦</span><span className="egg-text-card"><b>下班啦！</b><small>今日任務完成</small></span></> : easterEgg === "food" ? <><span className="egg-food">🍚</span><span className="egg-text-card"><b>吃飯時間</b><small>先填飽肚子再繼續聊</small></span></> : easterEgg === "curious" ? <><span className="egg-eyes">👀</span><span className="egg-text-card"><b>在幹嘛？</b><small>偷偷探頭看一下</small></span></> : easterEgg === "surprised" ? <><span className="egg-question">?!</span><span className="egg-text-card"><b>真的假的！</b><small>這句需要確認一下</small></span></> : easterEgg === "cute" ? <><span className="egg-hearts">♡　♥　♡</span><span className="egg-text-card"><b>可愛警報</b><small>聊天室可愛值上升</small></span></> : easterEgg === "sleepless" ? <><span className="egg-sheep">☾　🐑　☁</span><span className="egg-text-card"><b>睡不著嗎？</b><small>數一隻羊，再聊一下</small></span></> : easterEgg === "tomorrow" ? <><span className="egg-tomorrow-stars">✦　☾　✧</span><span className="egg-text-card"><b>明天見</b><small>今天的故事先存到這裡</small></span></> : easterEgg === "hundred" ? <><span className="egg-mini-milestone mini-100"><b>100</b><small>不知不覺，已經聊了 100 句</small></span></> : easterEgg === "twoHundred" ? <><span className="egg-mini-sparkles">✦　·　✧　·　✦</span><span className="egg-mini-milestone mini-200"><b>200</b><small>話題好像開始停不下來了</small></span></> : easterEgg === "threeHundred" ? <><span className="egg-mini-orbit">✦</span><span className="egg-mini-milestone mini-300"><b>300</b><small>默契正在偷偷累積中</small></span></> : easterEgg === "fourHundred" ? <><span className="egg-mini-stars">✦ ✧ ✦ ✧ ✦</span><span className="egg-mini-milestone mini-400"><b>400</b><small>這個聊天室有點捨不得關了</small></span></> : easterEgg === "fiveHundred" ? <><span className="egg-500-burst">✦</span><span className="egg-500-ring" /><span className="egg-mini-milestone mini-500"><b>500</b><small>半千達成 · 聊天默契升級</small></span></> : easterEgg === "thousand" ? <><span className="egg-1000-firework f1">✦</span><span className="egg-1000-firework f2">✦</span><span className="egg-1000-firework f3">✧</span><span className="egg-1000-flash" /><span className="egg-1000-rays" /><span className="egg-1000-confetti" aria-hidden="true">{Array.from({ length: 36 }, (_, index) => <i key={index} style={{ "--confetti-index": index } as CSSProperties} />)}</span><span className="egg-1000-particles" aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <i key={index} style={{ "--particle-index": index } as CSSProperties} />)}</span><span className="egg-1000-crown">♛</span><span className="egg-1000-ring ring-outer" /><span className="egg-1000-ring" /><span className="egg-1000-number">1000</span><span className="egg-1000-title">第 1000 句訊息！</span><span className="egg-1000-copy">從陌生人開始，你們已經一起留下 1000 句話</span><span className="egg-1000-badge">✦ 里程碑解鎖 ✦</span><span className="egg-1000-legendary"><b>LEGENDARY CHAT</b><small>傳說級聊天室</small></span></> : easterEgg === "aurora" ? <><span className="egg-aurora egg-aurora-a" /><span className="egg-aurora egg-aurora-b" /><span className="egg-rare-stars">✦　✧　·　✦　·　✧</span><span className="egg-rare-caption">今晚的聊天室，出現了極光</span></> : easterEgg === "meteor" ? <><span className="egg-meteor m1">✦</span><span className="egg-meteor m2">✦</span><span className="egg-meteor m3">✦</span><span className="egg-meteor m4">✦</span><span className="egg-wish">許個願吧<small>這場流星雨只出現幾秒</small></span></> : <><span className="egg-secret-door">✦</span><span className="egg-secret-room"><b>秘密基地已開啟</b><small>只有今晚知道入口在哪裡</small></span><span className="egg-secret-sparkles">· ✦ · ✧ · ✦ ·</span></>}
          </div>
        ) : null}

        <div
          className="chat-messages"
          ref={messageListRef}
          onScroll={() => {
            stickToBottomRef.current = isNearBottom();
            const container = messageListRef.current;
            if (container && container.scrollTop < 80) {
              void loadOlderMessages();
            }
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

        <div className="chat-typing-indicator" aria-live="polite" aria-atomic="true">
          {typingIndicatorText}
        </div>

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          {replyTarget ? (
            <div className="chat-reply-preview">
              <div className="chat-reply-preview-text">
                <div className="chat-reply-preview-label">
                  {replyTarget.is_mine ? "回覆自己" : "回覆對方"}
                </div>
                <div className="chat-reply-preview-body">
                  {replyTarget.message_type === "image" ? "📷 圖片" : replyTarget.content}
                </div>
              </div>
              <button
                type="button"
                className="chat-reply-preview-remove"
                aria-label="取消回覆"
                onClick={clearReply}
              >
                ×
              </button>
            </div>
          ) : null}
          {pendingMedia ? (
            <div className="chat-media-preview" aria-live="polite">
              <img className="chat-media-preview-image" src={pendingMedia.previewUrl} alt="待傳送照片預覽" />
              <div className="chat-media-preview-actions">
                <Button size="sm" type="button" onClick={() => void sendMedia()} disabled={mediaUploading || sendBusy || isEnded}>
                  {mediaUploading ? "上傳中…" : "送出照片"}
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={clearPendingMedia} disabled={mediaUploading}>
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          <div className="chat-composer-main">
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => void handleMediaInputChange(event)}
              disabled={isEnded}
            />
            <button
              type="button"
              className="chat-media-button"
              aria-label="傳送照片"
              title="傳送照片"
              onClick={() => mediaInputRef.current?.click()}
              disabled={isEnded || mediaUploading || sendBusy}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </button>
            <textarea
              ref={chatInputRef}
              className="textarea chat-input"
              aria-label="輸入訊息"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              rows={1}
              placeholder={isEnded ? "聊天室已結束，無法再傳送訊息。" : "輸入訊息…"}
              disabled={sendBusy}
            />
            <button className="button chat-send" type="submit" disabled={sendBusy || mediaUploading || draft.trim().length === 0}>
              {sendBusy ? "送出中…" : "送出"}
            </button>
          </div>
        </form>
      </section>

      <Modal
        open={safetyMenuOpen}
        title="安全選單"
        className="safety-modal"
        onClose={closeSafetyMenus}
        actions={
          <>
            <Button variant="secondary" type="button" onClick={() => { setSafetyMenuOpen(false); setBlockConfirmOpen(true); }} disabled={blockBusy}>
              封鎖
            </Button>
            <Button variant="secondary" type="button" onClick={() => { setSafetyMenuOpen(false); setReportOpen(true); }} disabled={reportBusy}>
              檢舉
            </Button>
            <Button variant="ghost" type="button" onClick={closeSafetyMenus}>
              取消
            </Button>
          </>
        }
      >
        <p className="hero-copy">你可以封鎖這位使用者或檢舉這段對話。</p>
      </Modal>

      <Modal
        open={blockConfirmOpen}
        title="封鎖使用者"
        tone="danger"
        onClose={closeSafetyMenus}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={closeSafetyMenus}>
              取消
            </Button>
            <Button type="button" onClick={() => void confirmBlock()} disabled={blockBusy}>
              {blockBusy ? "處理中…" : "封鎖"}
            </Button>
          </>
        }
      >
        <p className="hero-copy">確定要封鎖這位使用者嗎？封鎖後將無法再繼續這段對話。</p>
      </Modal>

      <Modal
        open={reportOpen}
        title="檢舉對話"
        onClose={closeSafetyMenus}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={closeSafetyMenus}>
              取消
            </Button>
            <Button type="button" onClick={() => void submitReport()} disabled={reportBusy}>
              {reportBusy ? "送出中…" : "送出檢舉"}
            </Button>
          </>
        }
      >
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
      </Modal>

      <Modal
        open={reportFollowupOpen}
        title="檢舉已送出"
        onClose={closeSafetyMenus}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={closeSafetyMenus}>
              繼續聊天
            </Button>
            <Button type="button" onClick={() => void confirmBlock()} disabled={blockBusy}>
              {blockBusy ? "處理中…" : "封鎖並離開"}
            </Button>
          </>
        }
      >
        <p className="hero-copy">你可以繼續聊天，也可以封鎖對方並離開這段對話。</p>
      </Modal>

      <Modal
        open={Boolean(pendingExternalUrl)}
        title="你即將離開 HerLink"
        onClose={() => setPendingExternalUrl(null)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setPendingExternalUrl(null)}>
              取消
            </Button>
            <Button type="button" onClick={submitExternalLink}>
              繼續前往
            </Button>
          </>
        }
      >
        <p className="hero-copy">前往外部網站前，請再次確認網址安全。</p>
        <div className="notice" style={{ wordBreak: "break-all" }}>
          {pendingExternalUrl}
        </div>
      </Modal>

      <Modal
        open={nextConfirmOpen}
        title="切換到下一位？"
        onClose={() => setNextConfirmOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setNextConfirmOpen(false)}>取消</Button>
            <Button type="button" onClick={() => void goNext()} disabled={nextBusy}>
              {nextBusy ? "處理中…" : "確定下一位"}
            </Button>
          </>
        }
      >
        <p>目前這個聊天室會立即結束，送出後無法復原。</p>
      </Modal>

      {previewMessage?.media_path && typeof document !== "undefined"
        ? createPortal(
            <div
              className="chat-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="圖片預覽"
              onClick={() => setPreviewMessage(null)}
            >
              <button
                type="button"
                className="chat-image-lightbox-close"
                aria-label="關閉圖片預覽"
                onClick={() => setPreviewMessage(null)}
              >
                ×
              </button>
              <div className="chat-image-lightbox-content" onClick={(event) => event.stopPropagation()}>
                <ChatImage path={previewMessage.media_path} alt="聊天室圖片" large />
              </div>
            </div>,
            document.body
          )
        : null}
      {debugPanel}
    </main>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { RealtimeChannel } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { RandomChatImage } from "../../components/RandomChatImage";
import { RandomReportModal } from "../../components/RandomReportModal";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { useAuth } from "../../context/auth";
import { getAnonymousAvatarOption } from "../../lib/anonymous";
import {
  prepareRandomChatImage,
  RandomChatImageError,
} from "../../lib/random-chat-media";
import {
  advanceRandomIcebreaker,
  blockRandomUser,
  getRandomIcebreaker,
  getRandomSession,
  leaveRandomSession,
  listRandomMessages,
  listRandomMessagesAfter,
  nextRandomMatch,
  RandomMessage,
  RandomReportCategory,
  RandomSession,
  removeRandomChatImage,
  reportRandomUser,
  sendRandomImageMessage,
  sendRandomText,
  uploadRandomChatImage,
} from "../../lib/random-chat";
import { supabase } from "../../lib/supabase";
import { colors, radii, spacing, typography } from "../../theme";

type Icebreaker = {
  prompt: string;
  category: string;
  turn: number;
};

type PendingImage = {
  uri: string;
  width: number;
  height: number;
  bytes: Uint8Array;
  size: number;
  mime: "image/jpeg";
};

const MAX_DRAFT_LENGTH = 2000;
const TYPING_SEND_TIMEOUT_MS = 1800;
const TYPING_RECEIVE_TIMEOUT_MS = 3200;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function mergeMessages(current: RandomMessage[], incoming: RandomMessage[]) {
  const map = new Map(current.map((item) => [item.id, item] as const));
  for (const message of incoming) {
    map.set(message.id, message);
  }
  return [...map.values()].sort((a, b) => {
    if (a.created_at === b.created_at) {
      return a.id.localeCompare(b.id);
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

function messageText(message: RandomMessage) {
  if (message.message_type === "image") {
    return "照片";
  }
  return message.content || "";
}

function replyQuote(message: RandomMessage) {
  if (!message.reply_to_message_id) {
    return null;
  }
  if (!message.reply_message_id) {
    return "原訊息已無法查看";
  }
  const owner = message.reply_is_mine ? "我" : "對方";
  const body =
    message.reply_message_type === "image"
      ? "照片"
      : (message.reply_body || "").slice(0, 60);
  return `${owner}：${body}`;
}

function friendlyError(error: unknown, fallback: string) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("rate limit exceeded") || normalized.includes("too many attempts")) {
    return "操作太頻繁，請稍後再試。";
  }
  if (normalized.includes("this session is not available")) {
    return "這段對話目前不可用。";
  }
  if (normalized.includes("reply target is not available")) {
    return "REPLY_MISSING";
  }
  if (normalized.includes("message cannot be blank")) {
    return "訊息不能為空。";
  }
  if (normalized.includes("message is too long")) {
    return "訊息太長了，請縮短後再試。";
  }
  if (normalized.includes("unsupported media type")) {
    return "只支援 JPEG / PNG / WebP 圖片。";
  }
  if (normalized.includes("media size is not allowed")) {
    return "圖片大小超過限制（最大 5MB）。";
  }
  if (
    normalized.includes("media file was not found") ||
    normalized.includes("media file does not match")
  ) {
    return "照片上傳驗證失敗，請重新選取。";
  }
  if (normalized.includes("media path is not allowed")) {
    return "照片上傳路徑不合法。";
  }
  if (normalized.includes("unsupported report category")) {
    return "檢舉原因不合法，請重新選擇。";
  }
  if (normalized.includes("report description is too long")) {
    return "檢舉說明太長了，請縮短後再試。";
  }
  if (normalized.includes("your account is not available")) {
    return "目前帳號無法使用此功能。";
  }
  return fallback;
}

export default function RandomSessionScreen() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = useMemo(
    () => (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId),
    [params.sessionId]
  );
  const { user } = useAuth();
  const router = useRouter();

  const [session, setSession] = useState<RandomSession | null>(null);
  const [messages, setMessages] = useState<RandomMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [icebreaker, setIcebreaker] = useState<Icebreaker | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [replyTarget, setReplyTarget] = useState<RandomMessage | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const listRef = useRef<FlatList<RandomMessage> | null>(null);
  const latestCursorRef = useRef<{ created_at: string; id: string } | null>(null);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const typingSenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingReceiverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingReceiverDeadlineRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const replyFallbackRef = useRef(false);

  const isEnded = session?.status === "ended";
  const isActive = session?.status === "active";
  const partnerName = session?.partner_anonymous_display_name || "匿名對象";
  const partnerVerified = session?.partner_verified ?? false;
  const avatarOption = getAnonymousAvatarOption(session?.partner_anonymous_avatar);

  const goWaiting = useCallback(
    (auto = false) => {
      router.replace({ pathname: "/random", params: auto ? { auto: "1" } : {} } as never);
    },
    [router]
  );

  const refreshSession = useCallback(async () => {
    if (!sessionId) {
      return null;
    }
    const next = await getRandomSession(sessionId);
    setSession(next);
    return next;
  }, [sessionId]);

  const updateCursor = useCallback((list: RandomMessage[]) => {
    if (list.length === 0) {
      return;
    }
    const sorted = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
    const last = sorted[sorted.length - 1];
    const current = latestCursorRef.current;
    if (
      !current ||
      last.created_at > current.created_at ||
      (last.created_at === current.created_at && last.id > current.id)
    ) {
      latestCursorRef.current = { created_at: last.created_at, id: last.id };
    }
  }, []);

  const syncMessagesAfterCursor = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }
    syncInFlightRef.current = true;
    try {
      const cursor = latestCursorRef.current;
      const incoming = cursor
        ? await listRandomMessagesAfter(sessionId, cursor.created_at, cursor.id, 100)
        : await listRandomMessages(sessionId, 100);
      if (incoming.length > 0) {
        setMessages((current) => mergeMessages(current, incoming));
        updateCursor(incoming);
      }
    } catch {
      // Realtime is best-effort; the next INSERT or a manual reload retries it.
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        void syncMessagesAfterCursor();
      }
    }
  }, [sessionId, updateCursor]);

  const loadAll = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [next, initialMessages, ice] = await Promise.all([
        getRandomSession(sessionId),
        listRandomMessages(sessionId, 100),
        getRandomIcebreaker(sessionId),
      ]);
      if (!next) {
        setLoadError("找不到這段聊天。");
        return;
      }
      setSession(next);
      setMessages(initialMessages);
      updateCursor(initialMessages);
      setIcebreaker(ice);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "無法載入這段聊天。");
    } finally {
      setLoading(false);
    }
  }, [sessionId, updateCursor]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (session?.status === "active" && session.id) {
      void getRandomIcebreaker(session.id)
        .then(setIcebreaker)
        .catch(() => undefined);
    }
  }, [session?.id, session?.status]);

  const clearTypingSenderTimer = useCallback(() => {
    if (typingSenderTimerRef.current) {
      clearTimeout(typingSenderTimerRef.current);
      typingSenderTimerRef.current = null;
    }
  }, []);

  const clearTypingReceiverTimer = useCallback(() => {
    if (typingReceiverTimerRef.current) {
      clearTimeout(typingReceiverTimerRef.current);
      typingReceiverTimerRef.current = null;
    }
  }, []);

  const sendTypingState = useCallback(async (typing: boolean) => {
    const channel = channelRef.current;
    if (!channel) {
      return;
    }
    try {
      await channel.send({ type: "broadcast", event: "typing", payload: { typing } });
    } catch {
      // Typing is best-effort; it never writes to the database.
    }
  }, []);

  const stopTyping = useCallback(() => {
    clearTypingSenderTimer();
    if (!typingActiveRef.current) {
      return;
    }
    typingActiveRef.current = false;
    void sendTypingState(false);
  }, [clearTypingSenderTimer, sendTypingState]);

  const handleDraftChange = useCallback(
    (text: string) => {
      setDraft(text);
      if (!isActive) {
        return;
      }
      if (!typingActiveRef.current) {
        typingActiveRef.current = true;
        void sendTypingState(true);
      }
      clearTypingSenderTimer();
      typingSenderTimerRef.current = setTimeout(() => {
        typingSenderTimerRef.current = null;
        if (typingActiveRef.current) {
          typingActiveRef.current = false;
          void sendTypingState(false);
        }
      }, TYPING_SEND_TIMEOUT_MS);
    },
    [clearTypingSenderTimer, isActive, sendTypingState]
  );

  const clearPartnerTyping = useCallback(() => {
    clearTypingReceiverTimer();
    typingReceiverDeadlineRef.current = null;
    setPartnerTyping(false);
  }, [clearTypingReceiverTimer]);

  const armPartnerTypingTimeout = useCallback(() => {
    clearTypingReceiverTimer();
    const deadline = Date.now() + TYPING_RECEIVE_TIMEOUT_MS;
    typingReceiverDeadlineRef.current = deadline;
    typingReceiverTimerRef.current = setTimeout(() => {
      typingReceiverTimerRef.current = null;
      if (typingReceiverDeadlineRef.current === deadline) {
        typingReceiverDeadlineRef.current = null;
        setPartnerTyping(false);
      }
    }, TYPING_RECEIVE_TIMEOUT_MS);
  }, [clearTypingReceiverTimer]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`random-chat-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "random_chat_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        () => void syncMessagesAfterCursor()
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "random_chat_sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => void refreshSession().catch(() => undefined)
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const typing = Boolean(
          (payload as { payload?: { typing?: unknown } } | undefined)?.payload?.typing
        );
        if (!typing) {
          clearPartnerTyping();
          return;
        }
        setPartnerTyping(true);
        armPartnerTypingTimeout();
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      clearTypingSenderTimer();
      clearTypingReceiverTimer();
    };
  }, [
    armPartnerTypingTimeout,
    clearPartnerTyping,
    clearTypingReceiverTimer,
    clearTypingSenderTimer,
    refreshSession,
    sessionId,
    syncMessagesAfterCursor,
  ]);

  const startReply = useCallback((message: RandomMessage) => {
    setReplyTarget(message);
    setNotice(null);
  }, []);

  const clearReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const appendSentMessage = useCallback(
    (message: RandomMessage | null | undefined) => {
      if (!message) {
        return;
      }
      setMessages((current) => mergeMessages(current, [message]));
      updateCursor([message]);
      scrollToBottom();
    },
    [scrollToBottom, updateCursor]
  );

  const sendText = useCallback(
    async (contentOverride?: string) => {
      if (!sessionId || !isActive || sending || mediaUploading || pendingImage) {
        return;
      }
      const content = (contentOverride ?? draft).trim();
      if (!content || content.length > MAX_DRAFT_LENGTH) {
        if (content.length > MAX_DRAFT_LENGTH) {
          setNotice("訊息太長了，請縮短後再試。");
        }
        return;
      }

      const attempt = async (replyId: string | null): Promise<boolean> => {
        try {
          const sent = await sendRandomText(sessionId, content, replyId);
          appendSentMessage(sent);
          setDraft("");
          setReplyTarget(null);
          return true;
        } catch (error) {
          const friendly = friendlyError(error, "訊息傳送失敗，請稍後再試。");
          if (friendly === "REPLY_MISSING" && replyId) {
            setReplyTarget(null);
            setNotice("原訊息已不存在，已改為直接送出。");
            return attempt(null);
          }
          setNotice(friendly);
          return false;
        }
      };

      setSending(true);
      stopTyping();
      try {
        const replyId = replyFallbackRef.current ? null : (replyTarget?.id ?? null);
        replyFallbackRef.current = false;
        await attempt(replyId);
      } finally {
        setSending(false);
      }
    },
    [
      appendSentMessage,
      draft,
      isActive,
      mediaUploading,
      pendingImage,
      replyTarget?.id,
      sending,
      sessionId,
      stopTyping,
    ]
  );

  const pickImage = useCallback(async () => {
    if (!isActive || mediaUploading) {
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("需要相簿權限", "請允許存取相簿後再傳送照片。");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      if (typeof asset.fileSize === "number" && asset.fileSize > MAX_IMAGE_BYTES) {
        setNotice("圖片超過 5MB 限制，請選擇較小的圖片。");
        return;
      }
      const prepared = await prepareRandomChatImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      });
      setPendingImage({
        uri: prepared.uri,
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.bytes,
        size: prepared.size,
        mime: prepared.mime,
      });
      setNotice(null);
    } catch (error) {
      if (error instanceof RandomChatImageError) {
        setNotice(error.message);
      } else {
        setNotice("照片無法讀取，請稍後再試。");
      }
    }
  }, [isActive, mediaUploading]);

  const sendImage = useCallback(async () => {
    if (!sessionId || !user?.id || !isActive || !pendingImage || mediaUploading || sending) {
      return;
    }
    const image = pendingImage;

    const attempt = async (replyId: string | null): Promise<boolean> => {
      let path: string | null = null;
      try {
        path = await uploadRandomChatImage(sessionId, user.id, image.bytes, "jpg");
        const sent = await sendRandomImageMessage(
          sessionId,
          {
            path,
            mime: image.mime,
            size: image.size,
            width: image.width,
            height: image.height,
          },
          replyId
        );
        appendSentMessage(sent);
        setPendingImage(null);
        setReplyTarget(null);
        return true;
      } catch (error) {
        if (path) {
          await removeRandomChatImage(path).catch(() => undefined);
        }
        const friendly = friendlyError(error, "照片傳送失敗，請稍後再試。");
        if (friendly === "REPLY_MISSING" && replyId) {
          setReplyTarget(null);
          setNotice("原訊息已不存在，已改為直接傳送照片。");
          return attempt(null);
        }
        setNotice(friendly);
        return false;
      }
    };

    setMediaUploading(true);
    stopTyping();
    try {
      const replyId = replyFallbackRef.current ? null : (replyTarget?.id ?? null);
      replyFallbackRef.current = false;
      await attempt(replyId);
    } finally {
      setMediaUploading(false);
    }
  }, [
    appendSentMessage,
    isActive,
    mediaUploading,
    pendingImage,
    replyTarget?.id,
    sending,
    sessionId,
    stopTyping,
    user?.id,
  ]);

  const leaveChat = useCallback(() => {
    if (!sessionId) {
      return;
    }
    Alert.alert("離開聊天室", "離開後就無法再繼續這段對話。", [
      { text: "先不要", style: "cancel" },
      {
        text: "離開",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusyAction("leave");
            try {
              stopTyping();
              clearPartnerTyping();
              await leaveRandomSession(sessionId);
              goWaiting(false);
            } catch (error) {
              setNotice(friendlyError(error, "目前無法離開聊天室，請稍後再試。"));
            } finally {
              setBusyAction(null);
              setMenuOpen(false);
            }
          })(),
      },
    ]);
  }, [clearPartnerTyping, goWaiting, sessionId, stopTyping]);

  const goNext = useCallback(() => {
    if (!sessionId) {
      return;
    }
    Alert.alert("換下一位", "會先結束目前對話，再開始尋找新的聊天對象。", [
      { text: "先不要", style: "cancel" },
      {
        text: "換下一位",
        onPress: () =>
          void (async () => {
            setBusyAction("next");
            try {
              stopTyping();
              clearPartnerTyping();
              setReplyTarget(null);
              const result = await nextRandomMatch(sessionId);
              if (result?.status === "matched" && result.session_id) {
                router.replace({
                  pathname: "/random-session/[sessionId]",
                  params: { sessionId: result.session_id },
                } as never);
              } else {
                goWaiting(true);
              }
            } catch (error) {
              setNotice(friendlyError(error, "目前無法切換到下一位，請稍後再試。"));
            } finally {
              setBusyAction(null);
              setMenuOpen(false);
            }
          })(),
      },
    ]);
  }, [clearPartnerTyping, goWaiting, router, sessionId, stopTyping]);

  const doBlock = useCallback(() => {
    if (!sessionId) {
      return;
    }
    Alert.alert("封鎖對象", "封鎖後無法再與對方配對或繼續對話，對方不會收到通知。", [
      { text: "先不要", style: "cancel" },
      {
        text: "確認封鎖",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusyAction("block");
            try {
              stopTyping();
              clearPartnerTyping();
              await blockRandomUser(sessionId);
              setMenuOpen(false);
              Alert.alert("已封鎖", "已封鎖對方並結束這段對話。");
              goWaiting(false);
            } catch (error) {
              setNotice(friendlyError(error, "目前無法封鎖這位使用者，請稍後再試。"));
            } finally {
              setBusyAction(null);
            }
          })(),
      },
    ]);
  }, [clearPartnerTyping, goWaiting, sessionId, stopTyping]);

  const submitReport = useCallback(
    async (payload: { category: RandomReportCategory; description: string }) => {
      if (!sessionId) {
        return;
      }
      try {
        await reportRandomUser(
          sessionId,
          payload.category,
          payload.description.trim().length > 0 ? payload.description.trim() : null,
          false
        );
        setReportOpen(false);
        setMenuOpen(false);
        Alert.alert("檢舉已送出", "安全流程已收到檢舉，對方不會知道是誰送出的。", [
          { text: "繼續聊天" },
          {
            text: "封鎖並離開",
            style: "destructive",
            onPress: () => {
              if (!sessionId) {
                return;
              }
              setBusyAction("block");
              void (async () => {
                try {
                  stopTyping();
                  await blockRandomUser(sessionId);
                  goWaiting(false);
                } catch (error) {
                  setNotice(friendlyError(error, "封鎖失敗，檢舉已送出。"));
                } finally {
                  setBusyAction(null);
                }
              })();
            },
          },
        ]);
      } catch (error) {
        setNotice(friendlyError(error, "目前無法送出檢舉，請稍後再試。"));
      }
    },
    [goWaiting, sessionId, stopTyping]
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      goWaiting(false);
    }
  }, [goWaiting, router]);

  const handleReplyQuotePress = useCallback(
    (message: RandomMessage) => {
      const targetId = message.reply_to_message_id;
      if (!targetId || !message.reply_message_id) {
        setNotice("原訊息已無法查看。");
        return;
      }
      const index = messages.findIndex((item) => item.id === targetId);
      if (index < 0) {
        setNotice("原訊息尚未載入。");
        return;
      }
      try {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      } catch {
        scrollToBottom();
      }
    },
    [messages, scrollToBottom]
  );

  const endedBannerText = useMemo(() => {
    if (!isEnded || !session) {
      return null;
    }
    if (session.ended_reason === "blocked") {
      return "這段對話已被封鎖。";
    }
    if (session.ended_reason === "next") {
      return session.ended_by_me ? "你已切換到下一位。" : "對方已切換到下一位。";
    }
    return session.ended_by_me ? "你已離開聊天室。" : "對方已離開聊天。";
  }, [isEnded, session]);

  const highRisk = useMemo(
    () =>
      messages.some(
        (message) => message.risk_level === "high" || message.risk_level === "critical"
      ),
    [messages]
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.statusText}>開啟聊天中...</Text>
      </View>
    );
  }

  if (loadError || !session) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError || "找不到這段聊天。"}</Text>
        <Pressable style={styles.primaryButton} onPress={() => goWaiting(false)}>
          <Text style={styles.primaryButtonText}>回到配對</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={8} style={styles.headerBack}>
          <Text style={styles.headerActionText}>返回</Text>
        </Pressable>
        <View style={styles.avatarCircle}>
          <Ionicons name={avatarOption.icon as never} size={20} color={avatarOption.fg} />
        </View>
        <View style={styles.headerIdentity}>
          <View style={styles.headerNameRow}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {partnerName}
            </Text>
            {partnerVerified ? <VerifiedBadge verified /> : null}
          </View>
          <Text style={styles.headerMeta}>
            {isActive ? "匿名即時聊天" : "聊天已結束"}
          </Text>
        </View>
        <Pressable
          style={[styles.headerAction, busyAction === "next" && styles.disabled]}
          disabled={busyAction === "next"}
          onPress={goNext}
          hitSlop={8}
        >
          <Text style={styles.headerActionText}>
            {busyAction === "next" ? "處理中..." : "下一位"}
          </Text>
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.menuButton}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </Pressable>
      </View>

      {endedBannerText ? (
        <View style={styles.endedBanner}>
          <Text style={styles.endedBannerText}>{endedBannerText}</Text>
        </View>
      ) : null}
      {highRisk ? (
        <View style={styles.warningBanner}>
          <Text style={styles.warningBannerText}>
            這段對話含有高風險內容，請勿透露驗證碼、密碼或進行匯款。
          </Text>
        </View>
      ) : null}
      {notice ? (
        <View style={styles.noticeBanner}>
          <Text style={styles.noticeBannerText}>{notice}</Text>
          <Pressable onPress={() => setNotice(null)} hitSlop={10}>
            <Text style={styles.noticeClose}>關閉</Text>
          </Pressable>
        </View>
      ) : null}

      {icebreaker && isActive ? (
        <View style={styles.icebreaker}>
          <Text style={styles.icebreakerPrompt}>{icebreaker.prompt}</Text>
          <Pressable
            onPress={() =>
              void advanceRandomIcebreaker(session.id)
                .then(setIcebreaker)
                .catch(() => setNotice("目前無法換題，請稍後再試。"))
            }
            hitSlop={8}
          >
            <Text style={styles.icebreakerAction}>換一題</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(item) => item.id}
        onScrollToIndexFailed={() => scrollToBottom()}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>還沒有訊息。</Text>
            <Text style={styles.emptyBody}>
              {icebreaker?.prompt
                ? `可以先從「${icebreaker.prompt}」開始。`
                : "從一句自然的問候開始就很好。"}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const quote = replyQuote(item);
          const isMine = item.is_mine;
          return (
            <View style={[styles.messageRow, isMine ? styles.mineRow : styles.otherRow]}>
              {!isMine ? (
                <Pressable onLongPress={() => startReply(item)} style={styles.replyInlineButton}>
                  <Ionicons name="return-down-back" size={16} color={colors.textSoft} />
                </Pressable>
              ) : null}
              <Pressable
                onLongPress={() => startReply(item)}
                delayLongPress={350}
                style={[styles.bubble, isMine ? styles.mineBubble : styles.otherBubble]}
              >
                {quote ? (
                  <Pressable
                    style={[styles.quote, isMine ? styles.mineQuote : styles.otherQuote]}
                    onPress={() => handleReplyQuotePress(item)}
                  >
                    <Text
                      numberOfLines={2}
                      style={[styles.quoteText, isMine ? styles.mineQuoteText : styles.otherQuoteText]}
                    >
                      {quote}
                    </Text>
                  </Pressable>
                ) : null}
                {item.message_type === "image" && item.media_path ? (
                  <RandomChatImage path={item.media_path} />
                ) : (
                  <Text style={[styles.messageText, isMine ? styles.mineText : styles.otherText]}>
                    {messageText(item)}
                  </Text>
                )}
                <Text style={[styles.timeText, isMine ? styles.mineTime : styles.otherTime]}>
                  {new Date(item.created_at).toLocaleTimeString("zh-TW", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
              {isMine ? (
                <Pressable onLongPress={() => startReply(item)} style={styles.replyInlineButton}>
                  <Ionicons name="return-up-forward" size={16} color={colors.textSoft} />
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />

      <View style={styles.typingBar}>
        <Text style={styles.typingText}>
          {partnerTyping ? `${partnerName} 正在輸入…` : " "}
        </Text>
      </View>

      {replyTarget ? (
        <View style={styles.replyBar}>
          <View style={styles.replyBarBody}>
            <Text style={styles.replyBarLabel}>回覆 {replyTarget.is_mine ? "自己" : partnerName}</Text>
            <Text numberOfLines={2} style={styles.replyBarText}>
              {replyTarget.message_type === "image" ? "照片" : replyTarget.content || ""}
            </Text>
          </View>
          <Pressable onPress={clearReply} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.textSoft} />
          </Pressable>
        </View>
      ) : null}

      {pendingImage ? (
        <View style={styles.pendingImageBar}>
          <Image
            source={{ uri: pendingImage.uri }}
            style={styles.pendingImagePreview}
            resizeMode="cover"
          />
          <Pressable
            style={[styles.primaryButtonSmall, (mediaUploading || sending) && styles.disabled]}
            disabled={mediaUploading || sending}
            onPress={() => void sendImage()}
          >
            <Text style={styles.primaryButtonSmallText}>
              {mediaUploading ? "上傳中..." : "傳送照片"}
            </Text>
          </Pressable>
          <Pressable onPress={() => setPendingImage(null)} disabled={mediaUploading} hitSlop={10}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          onPress={() => void pickImage()}
          disabled={!isActive || mediaUploading || sending}
          style={styles.photoButton}
          hitSlop={6}
        >
          <Ionicons
            name="image-outline"
            size={24}
            color={isActive ? colors.text : colors.textSoft}
          />
        </Pressable>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleDraftChange}
          editable={isActive && !sending}
          placeholder={isActive ? "輸入訊息…" : "聊天已結束"}
          placeholderTextColor={colors.textSoft}
          multiline
          maxLength={MAX_DRAFT_LENGTH}
        />
        <Pressable
          style={[
            styles.sendButton,
            (!isActive || sending || !draft.trim() || mediaUploading || pendingImage) &&
              styles.disabled,
          ]}
          disabled={!isActive || sending || !draft.trim() || mediaUploading || Boolean(pendingImage)}
          onPress={() => void sendText()}
        >
          <Text style={styles.sendButtonText}>{sending ? "送出中" : "送出"}</Text>
        </Pressable>
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>聊天室選單</Text>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                goNext();
              }}
              disabled={busyAction !== null}
            >
              <Ionicons name="arrow-forward-circle-outline" size={20} color={colors.text} />
              <Text style={styles.menuItemText}>下一位</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                leaveChat();
              }}
              disabled={busyAction !== null}
            >
              <Ionicons name="exit-outline" size={20} color={colors.warning} />
              <Text style={[styles.menuItemText, { color: colors.warning }]}>離開聊天室</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                doBlock();
              }}
              disabled={busyAction !== null}
            >
              <Ionicons name="ban-outline" size={20} color={colors.error} />
              <Text style={[styles.menuItemText, { color: colors.error }]}>封鎖對方</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
              disabled={busyAction !== null}
            >
              <Ionicons name="flag-outline" size={20} color={colors.error} />
              <Text style={[styles.menuItemText, { color: colors.error }]}>檢舉</Text>
            </Pressable>
            <Pressable style={[styles.menuItem, styles.menuCancel]} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuCancelText}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <RandomReportModal
        visible={reportOpen}
        partnerName={partnerName}
        submitting={busyAction === "report"}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  statusText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    ...typography.body,
  },
  errorText: {
    color: colors.error,
    textAlign: "center",
    ...typography.body,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerBack: {
    paddingVertical: spacing.xs,
  },
  headerAction: {
    paddingVertical: spacing.xs,
  },
  headerActionText: {
    color: colors.primary,
    ...typography.bodyStrong,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  headerIdentity: {
    flex: 1,
    gap: 2,
  },
  headerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerTitle: {
    flexShrink: 1,
    color: colors.text,
    ...typography.bodyStrong,
  },
  headerMeta: {
    color: colors.textSoft,
    ...typography.caption,
  },
  menuButton: {
    padding: spacing.xs,
  },
  disabled: {
    opacity: 0.5,
  },
  endedBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  endedBannerText: {
    color: colors.warning,
    ...typography.caption,
  },
  warningBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  warningBannerText: {
    color: colors.error,
    ...typography.caption,
  },
  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeBannerText: {
    flex: 1,
    color: colors.info,
    ...typography.caption,
  },
  noticeClose: {
    marginLeft: spacing.md,
    color: colors.info,
    ...typography.caption,
    fontWeight: "700",
  },
  icebreaker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  icebreakerPrompt: {
    flex: 1,
    color: colors.textMuted,
    ...typography.caption,
  },
  icebreakerAction: {
    color: colors.primary,
    ...typography.caption,
    fontWeight: "700",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  emptyWrap: {
    alignItems: "center",
    marginTop: 48,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  emptyBody: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    textAlign: "center",
    ...typography.body,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  mineRow: {
    justifyContent: "flex-end",
  },
  otherRow: {
    justifyContent: "flex-start",
  },
  replyInlineButton: {
    padding: spacing.xs,
  },
  bubble: {
    maxWidth: "84%",
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  mineBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 8,
  },
  otherBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 8,
  },
  quote: {
    marginBottom: spacing.sm,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderLeftWidth: 3,
  },
  mineQuote: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderLeftColor: "#FFD9C4",
  },
  otherQuote: {
    backgroundColor: colors.backgroundMuted,
    borderLeftColor: colors.primary,
  },
  quoteText: {
    ...typography.caption,
  },
  mineQuoteText: {
    color: "#F8DCCC",
  },
  otherQuoteText: {
    color: colors.textMuted,
  },
  messageText: {
    ...typography.body,
  },
  mineText: {
    color: colors.primaryText,
  },
  otherText: {
    color: colors.text,
  },
  timeText: {
    marginTop: spacing.xs,
    alignSelf: "flex-end",
    ...typography.meta,
  },
  mineTime: {
    color: "#F8DCCC",
  },
  otherTime: {
    color: colors.textSoft,
  },
  typingBar: {
    height: 22,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  typingText: {
    color: colors.textSoft,
    ...typography.caption,
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  replyBarBody: {
    flex: 1,
  },
  replyBarLabel: {
    color: colors.primary,
    ...typography.meta,
    fontWeight: "700",
  },
  replyBarText: {
    marginTop: 2,
    color: colors.textMuted,
    ...typography.caption,
  },
  pendingImageBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pendingImagePreview: {
    width: 52,
    height: 52,
    borderRadius: radii.sm,
    backgroundColor: colors.backgroundMuted,
  },
  primaryButtonSmall: {
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryButtonSmallText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  cancelText: {
    color: colors.textSoft,
    ...typography.bodyStrong,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  photoButton: {
    paddingBottom: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  sendButton: {
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sendButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  primaryButton: {
    marginTop: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  menuCard: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  menuTitle: {
    color: colors.textSoft,
    textAlign: "center",
    ...typography.eyebrow,
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    marginTop: spacing.sm,
  },
  menuItemText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  menuCancel: {
    backgroundColor: colors.surfaceStrong,
    justifyContent: "center",
  },
  menuCancelText: {
    color: colors.textMuted,
    textAlign: "center",
    ...typography.bodyStrong,
  },
});

import { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ReportModal } from "../../components/ReportModal";
import { ScreenState } from "../../components/ScreenState";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { useAuth } from "../../context/auth";
import { fetchPublicPrimaryPhotoMap } from "../../lib/media";
import {
  fetchVisiblePublicProfile,
  getErrorMessage,
  getOtherUserId,
  sendChatMessage,
} from "../../lib/social";
import { Match, Message, PublicProfile, ReportCategory, supabase } from "../../lib/supabase";
import { colors } from "../../theme/colors";
import { radii, spacing, typography } from "../../theme";

interface FailedDraft {
  id: string;
  content: string;
  createdAt: string;
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const next = new Map(current.map((item) => [item.id, item]));
  for (const message of incoming) {
    next.set(message.id, message);
  }
  return [...next.values()].sort((left, right) => {
    if (left.created_at === right.created_at) {
      return left.id.localeCompare(right.id);
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

function formatTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatRoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const { user, loading: authLoading } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unmatching, setUnmatching] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [safetyWarning, setSafetyWarning] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState<FailedDraft | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const matchId = useMemo(() => {
    const value = params.matchId;
    return Array.isArray(value) ? value[0] : value;
  }, [params.matchId]);

  const currentUserId = user?.id;

  const markRead = useCallback(async () => {
    if (!matchId) {
      return;
    }

    try {
      await supabase.rpc("mark_match_messages_read", { p_match_id: matchId });
    } catch (markFailure) {
      console.error("Failed to mark messages read", markFailure);
    }
  }, [matchId]);

  const loadConversation = useCallback(async () => {
    if (!matchId || !currentUserId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: matchData, error: matchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .single();

      if (matchError) {
        throw matchError;
      }

      setMatch(matchData);

      const otherUserId = getOtherUserId(matchData, currentUserId);
      const [profileData, photoMap, messageResult] = await Promise.all([
        fetchVisiblePublicProfile(otherUserId),
        fetchPublicPrimaryPhotoMap([otherUserId]),
        supabase.from("messages").select("*").eq("match_id", matchId).order("created_at", { ascending: true }),
      ]);

      setProfile(profileData);
      setPhotoUrl(photoMap.get(otherUserId)?.signedUrl ?? null);

      if (messageResult.error) {
        throw messageResult.error;
      }

      setMessages((messageResult.data ?? []) as Message[]);
      await markRead();
    } catch (loadFailure) {
      console.error(loadFailure);
      setError(getErrorMessage(loadFailure, "無法開啟這段聊天。"));
    } finally {
      setLoading(false);
    }
  }, [currentUserId, markRead, matchId]);

  useEffect(() => {
    if (authLoading || !matchId || !currentUserId) {
      return;
    }

    void loadConversation();
  }, [authLoading, currentUserId, loadConversation, matchId]);

  useEffect(() => {
    if (!matchId || !currentUserId) {
      return;
    }

    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`chat-room:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((current) => mergeMessages(current, [incoming]));
          if (incoming.sender_id !== currentUserId) {
            void markRead();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => {
          const updated = payload.new as Match;
          setMatch(updated);
          if (updated.status !== "active") {
            Alert.alert("這段連線已變更", "這段聊天目前不可再互動。");
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [currentUserId, markRead, matchId]);

  const isActive = match?.status === "active";

  const handleSend = async (content = input) => {
    const trimmed = content.trim();
    if (!matchId || !trimmed || trimmed.length > 800 || !isActive) {
      return;
    }

    setSending(true);

    try {
      const result = await sendChatMessage(matchId, trimmed);
      setMessages((current) =>
        mergeMessages(current, [
          {
            id: result.id,
            match_id: result.match_id,
            sender_id: result.sender_id,
            type: result.type,
            content: result.content,
            created_at: result.created_at,
            read_at: result.read_at,
          },
        ])
      );
      setInput("");
      setFailedDraft(null);
      setSafetyWarning(result.safety_warning ?? null);
      if (result.safety_warning) {
        Alert.alert("安全提醒", result.safety_warning);
      }
    } catch (sendFailure) {
      console.error(sendFailure);
      setFailedDraft({
        id: `failed-${Date.now()}`,
        content: trimmed,
        createdAt: new Date().toISOString(),
      });
      Alert.alert("送出失敗", getErrorMessage(sendFailure, "這則訊息沒有送出去。"));
    } finally {
      setSending(false);
    }
  };

  const handleUnmatch = () => {
    if (!matchId) {
      return;
    }

    Alert.alert("取消配對", "取消後你們將不能再傳送新訊息。", [
      { text: "先不要", style: "cancel" },
      {
        text: "確認取消",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setUnmatching(true);
            try {
              const { data, error: rpcError } = await supabase.rpc("unmatch_user", {
                p_match_id: matchId,
              });

              if (rpcError) {
                throw rpcError;
              }

              if (!data) {
                throw new Error("取消配對沒有成功。");
              }

              Alert.alert("已取消配對", "這段對話已經關閉。");
              router.replace("/(tabs)/chat");
            } catch (unmatchFailure) {
              console.error(unmatchFailure);
              Alert.alert("操作失敗", getErrorMessage(unmatchFailure, "取消配對時發生錯誤。"));
            } finally {
              setUnmatching(false);
            }
          })(),
      },
    ]);
  };

  const handleBlock = async () => {
    if (!profile) {
      return;
    }

    setBlocking(true);

    try {
      const { error: rpcError } = await supabase.rpc("block_user", {
        target_user_id: profile.id,
      });

      if (rpcError) {
        throw rpcError;
      }

      Alert.alert("已封鎖", "妳們之後將不再互相可見，也不能再互動。");
      router.replace("/(tabs)/chat");
    } catch (blockFailure) {
      console.error(blockFailure);
      Alert.alert("操作失敗", getErrorMessage(blockFailure, "封鎖這位對象時發生錯誤。"));
    } finally {
      setBlocking(false);
    }
  };

  const handleReportSubmit = async ({
    category,
    description,
  }: {
    category: ReportCategory;
    description: string;
  }) => {
    if (!profile) {
      return;
    }

    setReporting(true);

    try {
      const { error: rpcError } = await supabase.rpc("report_user", {
        target_user_id: profile.id,
        p_category: category,
        p_description: description,
      });

      if (rpcError) {
        throw rpcError;
      }

      setReportVisible(false);
      Alert.alert("檢舉已送出", "安全流程已收到妳的檢舉，對方不會知道是誰送出的。");
    } catch (reportFailure) {
      console.error(reportFailure);
      Alert.alert("送出失敗", getErrorMessage(reportFailure, "檢舉送出時發生錯誤。"));
    } finally {
      setReporting(false);
    }
  };

  if (loading || authLoading) {
    return <ScreenState loading title="開啟聊天中..." body="我們正在同步訊息與已讀狀態。" />;
  }

  if (error || !match || !matchId) {
    return (
      <ScreenState
        title="這段聊天目前無法開啟"
        body={error || "找不到這段聊天。"}
        actionLabel="回到聊天列表"
        onAction={() => router.replace("/(tabs)/chat")}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable accessibilityLabel="返回聊天列表" onPress={() => router.back()}>
            <Text style={styles.headerAction}>返回</Text>
          </Pressable>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.headerAvatarImage} resizeMode="cover" />
          ) : (
            <View style={styles.headerAvatarFallback}>
              <Text style={styles.headerAvatarText}>{(profile?.display_name?.slice(0, 1) || "她").toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.headerBody}>
            <Text style={styles.headerTitle}>{profile?.display_name || "配對對象"}</Text>
            <View style={styles.headerMetaRow}>
              <VerifiedBadge verified={profile?.verified ?? false} />
              <Text style={styles.headerSubtitle}>{isActive ? "active match" : "這段連線目前不可再互動。"}</Text>
            </View>
          </View>
          <Pressable onPress={handleUnmatch} disabled={!isActive || unmatching}>
            <Text style={[styles.headerAction, (!isActive || unmatching) && styles.disabledText]}>
              {unmatching ? "處理中..." : "取消配對"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.topActions}>
          <Pressable style={styles.topActionButton} onPress={() => void handleBlock()} disabled={blocking}>
            <Text style={styles.topActionButtonText}>{blocking ? "封鎖中..." : "封鎖"}</Text>
          </Pressable>
          <Pressable style={styles.topActionButton} onPress={() => setReportVisible(true)} disabled={reporting}>
            <Text style={styles.topActionButtonText}>{reporting ? "送出中..." : "檢舉"}</Text>
          </Pressable>
        </View>

        {safetyWarning ? (
          <View style={styles.warningBanner}>
            <Text style={styles.warningBannerText}>{safetyWarning}</Text>
          </View>
        ) : null}

        {failedDraft ? (
          <View style={styles.failedBanner}>
            <View style={styles.failedBannerBody}>
              <Text style={styles.failedBannerTitle}>上一則訊息送出失敗</Text>
              <Text style={styles.failedBannerCopy} numberOfLines={2}>
                {failedDraft.content}
              </Text>
            </View>
            <Pressable onPress={() => void handleSend(failedDraft.content)}>
              <Text style={styles.failedBannerAction}>重送</Text>
            </Pressable>
          </View>
        ) : null}

        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Text style={styles.emptyMessagesTitle}>這裡還沒有訊息。</Text>
              <Text style={styles.emptyMessagesBody}>從一句自然的問候開始就很好。</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMine = item.sender_id === currentUserId;
            return (
              <View style={[styles.messageRow, isMine ? styles.mineRow : styles.otherRow]}>
                <View style={[styles.messageBubble, isMine ? styles.mineBubble : styles.otherBubble]}>
                  <Text style={[styles.messageText, isMine ? styles.mineText : styles.otherText]}>
                    {item.content}
                  </Text>
                  <Text style={[styles.messageMeta, isMine ? styles.mineMeta : styles.otherMeta]}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder={isActive ? "寫點什麼給她..." : "這段連線目前不可用"}
            value={input}
            onChangeText={setInput}
            editable={isActive && !sending}
            multiline
            maxLength={800}
          />
          <Pressable
            style={[styles.sendButton, (!isActive || sending || !input.trim()) && styles.disabledButton]}
            onPress={() => void handleSend()}
            disabled={!isActive || sending || !input.trim()}
          >
            <Text style={styles.sendButtonText}>{sending ? "送出中" : "送出"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ReportModal
        visible={reportVisible}
        targetName={profile?.display_name || "這位對象"}
        submitting={reporting}
        onClose={() => setReportVisible(false)}
        onSubmit={handleReportSubmit}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerAction: {
    color: colors.primary,
    ...typography.bodyStrong,
  },
  disabledText: {
    color: colors.textSoft,
  },
  headerAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
  },
  headerAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  headerBody: {
    flex: 1,
    gap: spacing.xs,
  },
  headerTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  headerMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  headerSubtitle: {
    color: colors.textSoft,
    ...typography.caption,
  },
  topActions: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  topActionButton: {
    flex: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  topActionButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  warningBanner: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: "#F0D0A6",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  warningBannerText: {
    color: colors.warning,
    ...typography.body,
  },
  failedBanner: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: "#E7B8B3",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  failedBannerBody: {
    flex: 1,
  },
  failedBannerTitle: {
    color: colors.error,
    ...typography.bodyStrong,
  },
  failedBannerCopy: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    ...typography.caption,
  },
  failedBannerAction: {
    color: colors.error,
    ...typography.bodyStrong,
  },
  messageList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  emptyMessages: {
    marginTop: 60,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyMessagesTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  emptyMessagesBody: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    textAlign: "center",
    ...typography.body,
  },
  messageRow: {
    flexDirection: "row",
  },
  mineRow: {
    justifyContent: "flex-end",
  },
  otherRow: {
    justifyContent: "flex-start",
  },
  messageBubble: {
    maxWidth: "80%",
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
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
  messageText: {
    ...typography.body,
  },
  mineText: {
    color: colors.primaryText,
  },
  otherText: {
    color: colors.text,
  },
  messageMeta: {
    marginTop: spacing.sm,
    ...typography.caption,
  },
  mineMeta: {
    color: "#F8DCCC",
  },
  otherMeta: {
    color: colors.textSoft,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 48,
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
  disabledButton: {
    opacity: 0.55,
  },
});

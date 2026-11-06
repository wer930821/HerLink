import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../theme";
import { getAnonymousAvatarOption } from "../lib/anonymous";
import {
  blockRandomUser,
  listMyActiveRandomSessions,
  listMyRecentRandomSessions,
  type RandomSession,
} from "../lib/random-chat";

function friendlyError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  if (message.includes("not available") || message.includes("not found")) {
    return "找不到這段對話，可能已經被刪除了。";
  }
  return "目前無法封鎖這位使用者，請稍後再試。";
}

export default function ChatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<RandomSession[]>([]);
  const [recentSessions, setRecentSessions] = useState<RandomSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [blockingId, setBlockingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listMyActiveRandomSessions()
        .then((rows) => {
          if (alive) {
            setSessions(rows);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
      // 最近已結束的聊天室：migration 還沒執行時 RPC 不存在會報錯，
      // 吞掉就好，當成沒有，不影響進行中的列表。
      void listMyRecentRandomSessions()
        .then((rows) => {
          if (alive) setRecentSessions(rows);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  const doBlockRecent = useCallback((item: RandomSession) => {
    const name = item.partner_anonymous_display_name || "對方";
    Alert.alert("封鎖對象", `封鎖「${name}」後，之後不會再配對到對方，對方不會收到通知。`, [
      { text: "先不要", style: "cancel" },
      {
        text: "確認封鎖",
        style: "destructive",
        onPress: () => {
          setBlockingId(item.id);
          void blockRandomUser(item.id)
            .then(() => {
              setRecentSessions((rows) => rows.filter((row) => row.id !== item.id));
              Alert.alert("已封鎖", `已封鎖「${name}」，之後不會再配對到對方。`, [{ text: "好" }]);
            })
            .catch((error) => {
              Alert.alert("封鎖失敗", friendlyError(error), [{ text: "好" }]);
            })
            .finally(() => setBlockingId(null));
        },
      },
    ]);
  }, []);

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
      data={sessions}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        loaded ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>目前沒有進行中的聊天室。</Text>
            <Text style={styles.emptyHint}>回到首頁開始匿名配對，聊起來之後就會出現在這裡。</Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>載入中…</Text>
          </View>
        )
      }
      renderItem={({ item }) => {
        const avatar = getAnonymousAvatarOption(item.partner_anonymous_avatar);
        // migration 還沒執行時 unread_count / last_message_preview 是 undefined，
        // 就當成沒有未讀、只顯示舊的進行中日期，不要因為欄位不存在就壞掉。
        const unread = Math.max(0, Number(item.unread_count ?? 0));
        const preview = item.last_message_preview
          ? item.last_message_is_mine
            ? `我：${item.last_message_preview}`
            : item.last_message_preview
          : null;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`和 ${item.partner_anonymous_display_name} 的聊天室${unread > 0 ? `，${unread} 則未讀` : ""}`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() =>
              router.push({
                pathname: "/random-session/[sessionId]",
                params: { sessionId: item.id },
              } as never)
            }
          >
            <View style={[styles.avatar, { backgroundColor: avatar.bg }]}>
              <Ionicons name={avatar.icon as never} size={22} color={avatar.fg} />
            </View>
            <View style={styles.rowBody}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.partner_anonymous_display_name}
                  {item.partner_verified ? " ✓" : ""}
                </Text>
                {unread > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unread > 99 ? "99+" : String(unread)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.meta, unread > 0 && styles.metaUnread]} numberOfLines={1}>
                {preview ?? `進行中 · ${new Date(item.created_at).toLocaleDateString("zh-TW")}`}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      }}
      ListFooterComponent={
        recentSessions.length > 0 ? (
          <View style={styles.recentSection}>
            <Text style={styles.recentTitle}>最近結束的聊天室</Text>
            <Text style={styles.recentHint}>離開後也可以在這裡封鎖對方，之後就不會再配對到。</Text>
            {recentSessions.map((item) => {
              const avatar = getAnonymousAvatarOption(item.partner_anonymous_avatar);
              const ended = item.ended_at ? new Date(item.ended_at).toLocaleDateString("zh-TW") : null;
              return (
                <View key={item.id} style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: avatar.bg }]}>
                    <Ionicons name={avatar.icon as never} size={22} color={avatar.fg} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.partner_anonymous_display_name}
                      {item.partner_verified ? " ✓" : ""}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {ended ? `已結束 · ${ended}` : "已結束"}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`封鎖 ${item.partner_anonymous_display_name}`}
                    style={[styles.blockButton, blockingId === item.id && styles.blockButtonDisabled]}
                    onPress={() => doBlockRecent(item)}
                    disabled={blockingId !== null}
                  >
                    <Text style={styles.blockButtonText}>
                      {blockingId === item.id ? "處理中…" : "封鎖"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSecondary,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    color: colors.text,
    ...typography.bodyStrong,
    flexShrink: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  unreadBadgeText: {
    color: colors.primaryText,
    fontSize: 12,
    fontWeight: "700",
  },
  meta: {
    marginTop: 2,
    color: colors.textMuted,
    ...typography.caption,
  },
  metaUnread: {
    color: colors.text,
    fontWeight: "600",
  },
  chevron: {
    color: colors.textSoft,
    fontSize: 24,
  },
  empty: {
    alignItems: "center",
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  recentSection: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  recentTitle: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  recentHint: {
    color: colors.textMuted,
    ...typography.caption,
  },
  blockButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  blockButtonDisabled: {
    opacity: 0.5,
  },
  blockButtonText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  emptyHint: {
    color: colors.textMuted,
    ...typography.body,
    textAlign: "center",
  },
});

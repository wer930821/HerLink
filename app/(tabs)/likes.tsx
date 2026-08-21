import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenState } from "../../components/ScreenState";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { useAuth } from "../../context/auth";
import {
  fetchActiveMatches,
  fetchSentLikes,
  formatDateTime,
  getErrorMessage,
  MatchListItem,
  SentLikeListItem,
} from "../../lib/social";
import { colors } from "../../theme/colors";
import { radii, shadows, spacing, typography } from "../../theme";

function Avatar({
  name,
  photoUrl,
  accent = false,
}: {
  name: string | null | undefined;
  photoUrl: string | null;
  accent?: boolean;
}) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={styles.avatarImage} resizeMode="cover" />;
  }

  return (
    <View style={accent ? styles.avatarAccent : styles.avatar}>
      <Text style={styles.avatarText}>{(name?.slice(0, 1) || "她").toUpperCase()}</Text>
    </View>
  );
}

export default function LikesScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [sentLikes, setSentLikes] = useState<SentLikeListItem[]>([]);
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (showRefreshing = false) => {
      if (!user?.id) {
        return;
      }

      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const [likesResult, matchesResult] = await Promise.all([
          fetchSentLikes(user.id),
          fetchActiveMatches(user.id),
        ]);

        setSentLikes(likesResult);
        setMatches(matchesResult);
      } catch (loadFailure) {
        console.error(loadFailure);
        setError(getErrorMessage(loadFailure, "無法載入喜歡與配對資料。"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    if (authLoading || !user?.id) {
      return;
    }

    void loadData();
  }, [authLoading, loadData, user?.id]);

  if (loading || authLoading) {
    return <ScreenState loading title="整理互動中..." body="我們只會顯示仍然安全可見的想認識與配對。" />;
  }

  if (error) {
    return (
      <ScreenState
        title="互動總覽暫時無法載入"
        body={error}
        actionLabel="重新載入"
        onAction={() => void loadData(true)}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
    >
      <Text style={styles.eyebrow}>互動總覽</Text>
      <Text style={styles.title}>保留妳主動送出的心意，也把真正互相選中的人放到前面。</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>我想認識的</Text>
        <Text style={styles.sectionSubtitle}>先保留妳主動送出的想認識，不直接曝光所有喜歡妳的人。</Text>
        {sentLikes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>妳還沒有送出想認識。</Text>
            <Text style={styles.emptyBody}>去探索頁看看，也許會遇到想深入聊聊的人。</Text>
          </View>
        ) : (
          sentLikes.map(({ like, profile, primaryPhotoUrl }) => (
            <View key={like.id} style={styles.card}>
              <Avatar name={profile?.display_name} photoUrl={primaryPhotoUrl} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{profile?.display_name || "目前不可見的對象"}</Text>
                <Text style={styles.cardMeta}>送出時間：{formatDateTime(like.created_at)}</Text>
                <Text style={styles.cardCopy}>
                  {profile?.bio || "這位對象目前沒有公開自我介紹，或已不再出現在探索列表中。"}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>配對成功</Text>
        <Text style={styles.sectionSubtitle}>只有互相想認識的人，才會出現在這裡並開啟聊天。</Text>
        {matches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>目前還沒有新的配對。</Text>
            <Text style={styles.emptyBody}>繼續探索，等到互相選中時，聊天入口就會出現在這裡。</Text>
          </View>
        ) : (
          matches.map(({ match, profile, latestMessage, primaryPhotoUrl, unreadCount }) => (
            <View key={match.id} style={styles.matchCard}>
              <Avatar name={profile?.display_name} photoUrl={primaryPhotoUrl} accent />
              <View style={styles.cardBody}>
                <View style={styles.matchHeader}>
                  <Text style={styles.cardTitle}>{profile?.display_name || "配對對象"}</Text>
                  <VerifiedBadge verified={profile?.verified ?? false} />
                </View>
                <Text style={styles.cardMeta}>配對時間：{formatDateTime(match.matched_at)}</Text>
                <Text style={styles.cardCopy}>
                  {latestMessage?.content || "還沒有訊息，現在可以開始第一句問候。"}
                </Text>
              </View>
              <View style={styles.sideActions}>
                {unreadCount > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                  </View>
                ) : null}
                <Pressable
                  style={styles.chatButton}
                  onPress={() =>
                    router.push({
                      pathname: "/chat/[matchId]",
                      params: { matchId: match.id },
                    })
                  }
                >
                  <Text style={styles.chatButtonText}>聊天</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    color: colors.primary,
    ...typography.eyebrow,
  },
  title: {
    marginTop: spacing.sm,
    color: colors.text,
    ...typography.title,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    color: colors.text,
    ...typography.sectionTitle,
  },
  sectionSubtitle: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    ...typography.body,
  },
  emptyCard: {
    marginTop: spacing.lg,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  emptyBody: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    ...typography.body,
  },
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    gap: spacing.md,
    ...shadows.card,
  },
  matchCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    ...shadows.card,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarAccent: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceMuted,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  matchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  cardTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  cardMeta: {
    color: colors.textSoft,
    ...typography.caption,
  },
  cardCopy: {
    color: colors.textMuted,
    ...typography.body,
  },
  sideActions: {
    gap: spacing.sm,
    alignItems: "center",
  },
  chatButton: {
    minHeight: 42,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  chatButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  unreadBadge: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primary,
  },
  unreadBadgeText: {
    color: colors.primaryText,
    ...typography.meta,
  },
});

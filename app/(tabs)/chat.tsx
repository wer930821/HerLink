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
import { fetchActiveMatches, formatDateTime, getErrorMessage, MatchListItem } from "../../lib/social";
import { colors } from "../../theme/colors";
import { radii, shadows, spacing, typography } from "../../theme";

function Avatar({ name, photoUrl }: { name: string | null | undefined; photoUrl: string | null }) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={styles.avatarImage} resizeMode="cover" />;
  }

  return (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarText}>{(name?.slice(0, 1) || "她").toUpperCase()}</Text>
    </View>
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMatches = useCallback(
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
        const list = await fetchActiveMatches(user.id);
        setMatches(list);
      } catch (loadFailure) {
        console.error(loadFailure);
        setError(getErrorMessage(loadFailure, "無法載入聊天列表。"));
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

    void loadMatches();
  }, [authLoading, loadMatches, user?.id]);

  if (loading || authLoading) {
    return <ScreenState loading title="整理聊天列表中..." body="只會顯示仍然 active 的配對與訊息。" />;
  }

  if (error) {
    return (
      <ScreenState
        title="聊天列表暫時無法載入"
        body={error}
        actionLabel="重新載入"
        onAction={() => void loadMatches(true)}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadMatches(true)} />}
    >
      <Text style={styles.eyebrow}>Chat</Text>
      <Text style={styles.title}>把互相想認識的人，留在真正可以延續對話的地方。</Text>

      {matches.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>目前還沒有 active conversation。</Text>
          <Text style={styles.emptyBody}>先去探索頁看看，等到互相想認識時，聊天就會出現在這裡。</Text>
        </View>
      ) : (
        matches.map(({ match, profile, latestMessage, unreadCount, primaryPhotoUrl }) => (
          <Pressable
            key={match.id}
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: "/chat/[matchId]",
                params: { matchId: match.id },
              })
            }
          >
            <Avatar name={profile?.display_name} photoUrl={primaryPhotoUrl} />

            <View style={styles.cardBody}>
              <View style={styles.headerRow}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={styles.name}>
                    {profile?.display_name || "配對對象"}
                  </Text>
                  <VerifiedBadge verified={profile?.verified ?? false} />
                </View>
                <Text style={styles.time}>{formatDateTime(latestMessage?.created_at || match.matched_at)}</Text>
              </View>

              <Text numberOfLines={2} style={styles.preview}>
                {latestMessage?.content || "還沒有訊息，妳可以先打個招呼。"}
              </Text>
            </View>

            {unreadCount > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        ))
      )}
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
  emptyCard: {
    marginTop: spacing.xl,
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
    alignItems: "center",
    gap: spacing.md,
    ...shadows.card,
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surfaceMuted,
  },
  avatarFallback: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  cardBody: {
    flex: 1,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  nameRow: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    ...typography.cardTitle,
  },
  time: {
    color: colors.textSoft,
    textAlign: "right",
    ...typography.caption,
  },
  preview: {
    color: colors.textMuted,
    ...typography.body,
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

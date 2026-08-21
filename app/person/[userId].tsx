import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { PhotoCarousel } from "../../components/PhotoCarousel";
import { ScreenState } from "../../components/ScreenState";
import { TagChip } from "../../components/TagChip";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { useAuth } from "../../context/auth";
import { fetchPublicPhotoGroups } from "../../lib/media";
import { fetchVisiblePublicProfile, getErrorMessage } from "../../lib/social";
import { Match, PublicProfile, supabase } from "../../lib/supabase";
import { colors } from "../../theme/colors";
import { radii, shadows, spacing, typography } from "../../theme";

type ConnectionState =
  | { kind: "none" }
  | { kind: "liked" }
  | { kind: "matched"; match: Match };

export default function PublicProfileDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [photos, setPhotos] = useState<Array<{ id: string; signedUrl: string }>>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>({ kind: "none" });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;

  const loadProfile = useCallback(async () => {
    if (!user?.id || !userId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [visibleProfile, photoGroups, likeResult, matchResult] = await Promise.all([
        fetchVisiblePublicProfile(userId),
        fetchPublicPhotoGroups([userId]),
        supabase
          .from("likes")
          .select("id")
          .eq("from_user_id", user.id)
          .eq("to_user_id", userId)
          .maybeSingle(),
        supabase
          .from("matches")
          .select("*")
          .eq("status", "active")
          .or(`and(user_1_id.eq.${user.id},user_2_id.eq.${userId}),and(user_1_id.eq.${userId},user_2_id.eq.${user.id})`)
          .maybeSingle(),
      ]);

      if (!visibleProfile) {
        throw new Error("這位對象目前不可見。");
      }

      if (likeResult.error) {
        throw likeResult.error;
      }

      if (matchResult.error) {
        throw matchResult.error;
      }

      setProfile(visibleProfile);
      setPhotos(
        (photoGroups.get(userId) ?? []).map((photo) => ({
          id: photo.photoId,
          signedUrl: photo.signedUrl,
        }))
      );

      if (matchResult.data) {
        setConnectionState({ kind: "matched", match: matchResult.data });
      } else if (likeResult.data) {
        setConnectionState({ kind: "liked" });
      } else {
        setConnectionState({ kind: "none" });
      }
    } catch (loadFailure) {
      console.error(loadFailure);
      setError(getErrorMessage(loadFailure, "目前無法打開這份公開資料。"));
    } finally {
      setLoading(false);
    }
  }, [user?.id, userId]);

  useEffect(() => {
    if (authLoading || !user?.id || !userId) {
      return;
    }

    void loadProfile();
  }, [authLoading, loadProfile, user?.id, userId]);

  const handleLike = async () => {
    if (!profile || acting) {
      return;
    }

    setActing(true);

    try {
      const { data, error: rpcError } = await supabase.rpc("like_user", {
        target_user_id: profile.id,
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0];
      if (result?.matched && result.match_id) {
        router.replace({
          pathname: "/chat/[matchId]",
          params: { matchId: result.match_id },
        });
        return;
      }

      setConnectionState({ kind: "liked" });
      Alert.alert("已送出想認識", "如果對方也想認識妳，就會直接開啟聊天。");
    } catch (likeFailure) {
      console.error(likeFailure);
      Alert.alert("操作失敗", getErrorMessage(likeFailure, "這次沒有成功送出想認識。"));
    } finally {
      setActing(false);
    }
  };

  if (loading || authLoading) {
    return <ScreenState loading title="整理公開資料中..." body="只會顯示目前安全可見的資訊與已通過審核的照片。" />;
  }

  if (error || !profile) {
    return (
      <ScreenState
        title="這份資料目前無法查看"
        body={error || "這位對象可能已不可見。"}
        actionLabel="返回探索"
        onAction={() => router.replace("/(tabs)")}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backText}>返回</Text>
          </Pressable>
          <VerifiedBadge verified={profile.verified} />
        </View>

        <PhotoCarousel
          photos={photos}
          index={photoIndex}
          onChange={setPhotoIndex}
          accessibilityLabel={`${profile.display_name || "公開資料"} 的公開照片`}
          height={420}
        />

        <View style={styles.card}>
          <Text style={styles.name}>
            {profile.display_name || "公開資料"}
            {profile.age ? `，${profile.age}` : ""}
          </Text>
          {profile.city ? <Text style={styles.meta}>{profile.city}</Text> : null}
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          {profile.orientation ? <Text style={styles.meta}>性向：{profile.orientation}</Text> : null}
          {profile.identity_label ? <Text style={styles.meta}>身份標籤：{profile.identity_label}</Text> : null}

          {profile.relationship_goals?.length ? (
            <>
              <Text style={styles.sectionTitle}>交友目的</Text>
              <View style={styles.chipRow}>
                {profile.relationship_goals.map((goal) => (
                  <TagChip key={goal} label={goal} />
                ))}
              </View>
            </>
          ) : null}

          {profile.interests?.length ? (
            <>
              <Text style={styles.sectionTitle}>興趣</Text>
              <View style={styles.chipRow}>
                {profile.interests.map((interest) => (
                  <TagChip key={interest} label={interest} />
                ))}
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={[styles.secondaryButton, styles.actionButton]} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>略過</Text>
          </Pressable>

          {connectionState.kind === "matched" ? (
            <Pressable
              style={[styles.primaryButton, styles.actionButton]}
              onPress={() =>
                router.replace({
                  pathname: "/chat/[matchId]",
                  params: { matchId: connectionState.match.id },
                })
              }
            >
              <Text style={styles.primaryButtonText}>開始聊天</Text>
            </Pressable>
          ) : connectionState.kind === "liked" ? (
            <View style={[styles.disabledButton, styles.actionButton]}>
              <Text style={styles.disabledButtonText}>已送出想認識</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.primaryButton, styles.actionButton, acting && styles.actionDisabled]}
              disabled={acting}
              onPress={() => void handleLike()}
            >
              <Text style={styles.primaryButtonText}>{acting ? "處理中..." : "想認識"}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backText: {
    color: colors.primary,
    ...typography.bodyStrong,
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadows.card,
  },
  name: {
    color: colors.text,
    ...typography.title,
  },
  meta: {
    color: colors.textMuted,
    ...typography.body,
  },
  bio: {
    color: colors.text,
    ...typography.body,
  },
  sectionTitle: {
    marginTop: spacing.sm,
    color: colors.text,
    ...typography.bodyStrong,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  disabledButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabledButtonText: {
    color: colors.textSoft,
    ...typography.bodyStrong,
  },
  actionDisabled: {
    opacity: 0.6,
  },
});

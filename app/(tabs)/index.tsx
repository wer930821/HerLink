import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ReportModal } from "../../components/ReportModal";
import { PhotoCarousel } from "../../components/PhotoCarousel";
import { ScreenState } from "../../components/ScreenState";
import { TagChip } from "../../components/TagChip";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { useAuth } from "../../context/auth";
import { fetchOwnProfilePhotos } from "../../lib/media";
import {
  DiscoverCursor,
  DiscoverFilters,
  DiscoverProfileCard,
  fetchDiscoverProfilesPage,
  getErrorMessage,
} from "../../lib/social";
import {
  interestOptions,
  normalizeMultiValueInput,
  relationshipGoalOptions,
} from "../../lib/profile-options";
import { ReportCategory, supabase } from "../../lib/supabase";
import { colors } from "../../theme/colors";
import { radii, shadows, spacing, typography } from "../../theme";

const FILTER_STORAGE_KEY = "herlink.phase6.discoverFilters";

const defaultFilters: DiscoverFilters = {
  minAge: null,
  maxAge: null,
  cities: [],
  relationshipGoals: [],
  interests: [],
  verifiedOnly: false,
  identityLabels: [],
};

function parseNumberInput(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function buildHeadline(card: DiscoverProfileCard) {
  if (card.profile.display_name && card.profile.age) {
    return `${card.profile.display_name}，${card.profile.age}`;
  }

  return card.profile.display_name || "探索對象";
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [cards, setCards] = useState<DiscoverProfileCard[]>([]);
  const [cursor, setCursor] = useState<DiscoverCursor | null>(null);
  const [filters, setFilters] = useState<DiscoverFilters>(defaultFilters);
  const [filterDraft, setFilterDraft] = useState<DiscoverFilters>(defaultFilters);
  const [cityInput, setCityInput] = useState("");
  const [identityInput, setIdentityInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [photoIndexes, setPhotoIndexes] = useState<Record<string, number>>({});
  const [matchVisible, setMatchVisible] = useState(false);
  const [matchedCard, setMatchedCard] = useState<DiscoverProfileCard | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [acting, setActing] = useState(false);
  const [myPrimaryPhotoUrl, setMyPrimaryPhotoUrl] = useState<string | null>(null);

  const currentCard = cards[0] ?? null;

  const loadMyPrimaryPhoto = useCallback(async () => {
    try {
      const photos = await fetchOwnProfilePhotos();
      setMyPrimaryPhotoUrl(
        photos.find((entry) => entry.photo.is_primary)?.signedUrl ?? photos[0]?.signedUrl ?? null
      );
    } catch (photoError) {
      console.error("Failed to load own primary photo", photoError);
    }
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" | "more", nextFilters = filters) => {
      if (!user?.id) {
        return;
      }

      if (mode === "initial") {
        setLoading(true);
      } else if (mode === "refresh") {
        setRefreshing(true);
      } else {
        setLoadingMore(true);
      }

      setError(null);

      try {
        const result = await fetchDiscoverProfilesPage(nextFilters, mode === "more" ? cursor : null);
        setCursor(result.nextCursor);
        setHasMore(result.items.length === 12);
        setCards((current) => (mode === "more" ? [...current, ...result.items] : result.items));
      } catch (loadFailure) {
        console.error(loadFailure);
        setError(getErrorMessage(loadFailure, "目前無法載入探索對象。"));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [cursor, filters, user?.id]
  );

  useEffect(() => {
    AsyncStorage.getItem(FILTER_STORAGE_KEY)
      .then((stored) => {
        if (!stored) {
          return;
        }

        const parsed = JSON.parse(stored) as DiscoverFilters;
        setFilters(parsed);
        setFilterDraft(parsed);
        setCityInput(parsed.cities.join(", "));
        setIdentityInput(parsed.identityLabels.join(", "));
      })
      .catch((storageError) => {
        console.error("Failed to restore discover filters", storageError);
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (authLoading || !hydrated || !user?.id) {
      return;
    }

    void Promise.all([loadPage("initial", filters), loadMyPrimaryPhoto()]);
  }, [authLoading, filters, hydrated, loadMyPrimaryPhoto, loadPage, user?.id]);

  useEffect(() => {
    if (!currentCard || cards.length > 2 || !hasMore || loadingMore) {
      return;
    }

    void loadPage("more");
  }, [cards.length, currentCard, hasMore, loadPage, loadingMore]);

  const applyFilters = async () => {
    const normalized: DiscoverFilters = {
      ...filterDraft,
      cities: normalizeMultiValueInput(cityInput),
      identityLabels: normalizeMultiValueInput(identityInput),
    };

    if (normalized.minAge && normalized.maxAge && normalized.minAge > normalized.maxAge) {
      Alert.alert("篩選設定", "年齡下限不能大於上限。");
      return;
    }

    setCursor(null);
    setHasMore(true);
    setFilters(normalized);
    await AsyncStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(normalized));
    await loadPage("refresh", normalized);
  };

  const skipCurrent = () => {
    setCards((current) => current.slice(1));
  };

  const handleLike = async () => {
    if (!currentCard || acting) {
      return;
    }

    setActing(true);

    try {
      const { data, error: rpcError } = await supabase.rpc("like_user", {
        target_user_id: currentCard.profile.id,
      });

      if (rpcError) {
        throw rpcError;
      }

      const result = data?.[0];
      if (result?.matched) {
        setMatchedCard(currentCard);
        setMatchId(result.match_id ?? null);
        setMatchVisible(true);
      } else {
        Alert.alert("已送出想認識", "如果對方也想認識妳，就會直接開啟配對。");
      }

      skipCurrent();
    } catch (likeFailure) {
      console.error(likeFailure);
      Alert.alert("操作失敗", getErrorMessage(likeFailure, "這次沒有成功送出想認識。"));
    } finally {
      setActing(false);
    }
  };

  const handleBlock = () => {
    if (!currentCard || acting) {
      return;
    }

    Alert.alert("封鎖這位對象？", "封鎖後妳們不會再互相出現在探索或聊天中。", [
      { text: "取消", style: "cancel" },
      {
        text: "確認封鎖",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setActing(true);
            try {
              const { error: rpcError } = await supabase.rpc("block_user", {
                target_user_id: currentCard.profile.id,
              });
              if (rpcError) {
                throw rpcError;
              }
              skipCurrent();
            } catch (blockFailure) {
              console.error(blockFailure);
              Alert.alert("操作失敗", getErrorMessage(blockFailure, "封鎖時發生錯誤。"));
            } finally {
              setActing(false);
            }
          })(),
      },
    ]);
  };

  const handleReportSubmit = async ({
    category,
    description,
  }: {
    category: ReportCategory;
    description: string;
  }) => {
    if (!currentCard) {
      return;
    }

    setReporting(true);

    try {
      const { error: rpcError } = await supabase.rpc("report_user", {
        target_user_id: currentCard.profile.id,
        p_category: category,
        p_description: description,
      });

      if (rpcError) {
        throw rpcError;
      }

      setReportVisible(false);
      Alert.alert("檢舉已送出", "安全流程已收到妳的檢舉。");
    } catch (reportFailure) {
      console.error(reportFailure);
      Alert.alert("送出失敗", getErrorMessage(reportFailure, "檢舉送出時發生錯誤。"));
    } finally {
      setReporting(false);
    }
  };

  const currentPhotoIndex = currentCard ? photoIndexes[currentCard.profile.id] ?? 0 : 0;

  const activeFilterCount = useMemo(() => {
    return [
      Boolean(filters.minAge || filters.maxAge),
      filters.cities.length > 0,
      filters.relationshipGoals.length > 0,
      filters.interests.length > 0,
      filters.verifiedOnly,
      filters.identityLabels.length > 0,
    ].filter(Boolean).length;
  }, [filters]);

  if (loading || authLoading || !hydrated) {
    return <ScreenState loading title="整理探索對象中..." body="我們正在整理符合條件的公開資料。" />;
  }

  if (error) {
    return (
      <ScreenState
        title="探索頁暫時無法使用"
        body={error}
        actionLabel="重新載入"
        onAction={() => void loadPage("refresh")}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPage("refresh")} />}
    >
      <Text style={styles.eyebrow}>Discover</Text>
      <Text style={styles.title}>先看得見真實自介，再決定要不要往前一步。</Text>

      <View style={styles.filterCard}>
        <View style={styles.filterHeader}>
          <Text style={styles.filterTitle}>探索篩選</Text>
          <Text style={styles.filterMeta}>
            {activeFilterCount > 0 ? `已啟用 ${activeFilterCount} 項` : "目前使用預設條件"}
          </Text>
        </View>

        <View style={styles.row}>
          <TextInput
            accessibilityLabel="最小年齡"
            style={[styles.input, styles.halfInput]}
            placeholder="最小年齡"
            keyboardType="number-pad"
            value={filterDraft.minAge ? String(filterDraft.minAge) : ""}
            onChangeText={(value) =>
              setFilterDraft((current) => ({ ...current, minAge: parseNumberInput(value) }))
            }
          />
          <TextInput
            accessibilityLabel="最大年齡"
            style={[styles.input, styles.halfInput]}
            placeholder="最大年齡"
            keyboardType="number-pad"
            value={filterDraft.maxAge ? String(filterDraft.maxAge) : ""}
            onChangeText={(value) =>
              setFilterDraft((current) => ({ ...current, maxAge: parseNumberInput(value) }))
            }
          />
        </View>

        <TextInput
          accessibilityLabel="地區篩選"
          style={styles.input}
          placeholder="地區，例如：台北, 新北"
          value={cityInput}
          onChangeText={setCityInput}
        />

        <TextInput
          accessibilityLabel="身份標籤篩選"
          style={styles.input}
          placeholder="身份標籤，可留空"
          value={identityInput}
          onChangeText={setIdentityInput}
        />

        <Text style={styles.sectionLabel}>交友目的</Text>
        <View style={styles.chipRow}>
          {relationshipGoalOptions.map((goal) => (
            <TagChip
              key={goal}
              label={goal}
              selected={filterDraft.relationshipGoals.includes(goal)}
              onPress={() =>
                setFilterDraft((current) => ({
                  ...current,
                  relationshipGoals: toggleValue(current.relationshipGoals, goal),
                }))
              }
            />
          ))}
        </View>

        <Text style={styles.sectionLabel}>興趣</Text>
        <View style={styles.chipRow}>
          {interestOptions.map((interest) => (
            <TagChip
              key={interest}
              label={interest}
              selected={filterDraft.interests.includes(interest)}
              onPress={() =>
                setFilterDraft((current) => ({
                  ...current,
                  interests: toggleValue(current.interests, interest),
                }))
              }
            />
          ))}
        </View>

        <View style={styles.switchRow}>
          <View>
            <Text style={styles.sectionLabel}>只看已驗證</Text>
            <Text style={styles.switchHint}>優先聚焦在已完成真人驗證的帳號。</Text>
          </View>
          <Switch
            accessibilityLabel="只看已驗證"
            value={filterDraft.verifiedOnly}
            onValueChange={(value) =>
              setFilterDraft((current) => ({ ...current, verifiedOnly: value }))
            }
            trackColor={{ false: "#DDCEC2", true: "#E6A48A" }}
            thumbColor={filterDraft.verifiedOnly ? colors.primary : "#fff"}
          />
        </View>

        <View style={styles.row}>
          <Pressable
            accessibilityLabel="清除探索篩選"
            style={[styles.secondaryButton, styles.halfButton]}
            onPress={() => {
              setFilterDraft(defaultFilters);
              setFilters(defaultFilters);
              setCityInput("");
              setIdentityInput("");
              setCursor(null);
              setHasMore(true);
              void AsyncStorage.removeItem(FILTER_STORAGE_KEY);
              void loadPage("refresh", defaultFilters);
            }}
          >
            <Text style={styles.secondaryButtonText}>清除篩選</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="套用探索篩選"
            style={[styles.primaryButton, styles.halfButton]}
            onPress={() => void applyFilters()}
          >
            <Text style={styles.primaryButtonText}>套用</Text>
          </Pressable>
        </View>
      </View>

      {!currentCard ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>目前沒有更多符合條件的人。</Text>
          <Text style={styles.emptyBody}>妳可以調整篩選條件，或稍後再回來看看新的公開檔案。</Text>
        </View>
      ) : (
        <View style={styles.profileCard}>
          <Pressable
            accessibilityLabel={`查看 ${currentCard.profile.display_name || "這位對象"} 的完整資料`}
            onPress={() =>
              router.push(`/person/${currentCard.profile.id}` as never)
            }
          >
            <PhotoCarousel
              photos={currentCard.photos.map((photo) => ({
                id: photo.photoId,
                signedUrl: photo.signedUrl,
              }))}
              index={currentPhotoIndex}
              onChange={(nextIndex) =>
                setPhotoIndexes((current) => ({
                  ...current,
                  [currentCard.profile.id]: nextIndex,
                }))
              }
              accessibilityLabel={`${currentCard.profile.display_name || "探索對象"} 的公開照片`}
            />
          </Pressable>

          <View style={styles.profileBody}>
            <View style={styles.headlineRow}>
              <Text style={styles.headline}>{buildHeadline(currentCard)}</Text>
              <VerifiedBadge verified={currentCard.profile.verified} />
            </View>

            {currentCard.profile.city ? <Text style={styles.metaLine}>{currentCard.profile.city}</Text> : null}
            {currentCard.profile.bio ? <Text style={styles.bio}>{currentCard.profile.bio}</Text> : null}
            {currentCard.profile.orientation ? (
              <Text style={styles.metaLine}>性向：{currentCard.profile.orientation}</Text>
            ) : null}
            {currentCard.profile.identity_label ? (
              <Text style={styles.metaLine}>身份標籤：{currentCard.profile.identity_label}</Text>
            ) : null}

            {currentCard.profile.relationship_goals?.length ? (
              <>
                <Text style={styles.sectionLabel}>交友目的</Text>
                <View style={styles.chipRow}>
                  {currentCard.profile.relationship_goals.map((goal) => (
                    <TagChip key={goal} label={goal} />
                  ))}
                </View>
              </>
            ) : null}

            {currentCard.profile.interests?.length ? (
              <>
                <Text style={styles.sectionLabel}>興趣</Text>
                <View style={styles.chipRow}>
                  {currentCard.profile.interests.map((interest) => (
                    <TagChip key={interest} label={interest} />
                  ))}
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.actionRow}>
            <Pressable
              accessibilityLabel="略過這位對象"
              style={[styles.secondaryButton, styles.actionButton]}
              onPress={skipCurrent}
            >
              <Text style={styles.secondaryButtonText}>略過</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="想認識這位對象"
              style={[styles.primaryButton, styles.actionButton, acting && styles.disabledButton]}
              disabled={acting}
              onPress={() => void handleLike()}
            >
              <Text style={styles.primaryButtonText}>{acting ? "處理中..." : "想認識"}</Text>
            </Pressable>
          </View>

          <View style={styles.safetyRow}>
            <Pressable accessibilityLabel="檢舉這位對象" onPress={() => setReportVisible(true)}>
              <Text style={styles.safetyAction}>檢舉</Text>
            </Pressable>
            <Pressable accessibilityLabel="封鎖這位對象" onPress={handleBlock}>
              <Text style={styles.safetyAction}>封鎖</Text>
            </Pressable>
          </View>
        </View>
      )}

      {loadingMore ? (
        <View style={styles.loadingMore}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingMoreText}>正在預載更多對象...</Text>
        </View>
      ) : null}

      <Modal visible={matchVisible} transparent animationType="fade" onRequestClose={() => setMatchVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>Match</Text>
            <Text style={styles.modalTitle}>妳們互相想認識</Text>
            <Text style={styles.modalBody}>現在可以開始聊天，也可以先繼續探索更多人。</Text>
            <View style={styles.matchPhotosRow}>
              <View style={styles.matchPhotoPlaceholder}>
                <PhotoCarousel
                  photos={myPrimaryPhotoUrl ? [{ id: "me", signedUrl: myPrimaryPhotoUrl }] : []}
                  index={0}
                  onChange={() => undefined}
                  accessibilityLabel="我的主照片"
                  height={180}
                />
              </View>
              <View style={styles.matchPhotoPlaceholder}>
                <PhotoCarousel
                  photos={(matchedCard?.photos ?? []).map((photo) => ({
                    id: photo.photoId,
                    signedUrl: photo.signedUrl,
                  }))}
                  index={0}
                  onChange={() => undefined}
                  accessibilityLabel={`${matchedCard?.profile.display_name || "配對對象"} 的主照片`}
                  height={180}
                />
              </View>
            </View>
            <View style={styles.row}>
              <Pressable
                style={[styles.secondaryButton, styles.halfButton]}
                onPress={() => {
                  setMatchVisible(false);
                  setMatchedCard(null);
                  setMatchId(null);
                }}
              >
                <Text style={styles.secondaryButtonText}>繼續探索</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, styles.halfButton]}
                onPress={() => {
                  if (!matchId) {
                    return;
                  }
                  setMatchVisible(false);
                  router.push({ pathname: "/chat/[matchId]", params: { matchId } });
                }}
              >
                <Text style={styles.primaryButtonText}>開始聊天</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ReportModal
        visible={reportVisible}
        targetName={currentCard?.profile.display_name || "這位對象"}
        submitting={reporting}
        onClose={() => setReportVisible(false)}
        onSubmit={handleReportSubmit}
      />
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
  filterCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.card,
  },
  filterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  filterTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  filterMeta: {
    color: colors.textSoft,
    textAlign: "right",
    ...typography.caption,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  halfInput: {
    flex: 1,
  },
  sectionLabel: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  switchHint: {
    marginTop: spacing.xs,
    color: colors.textSoft,
    maxWidth: 220,
    ...typography.caption,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  halfButton: {
    flex: 1,
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
  profileCard: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.lg,
    ...shadows.card,
  },
  profileBody: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  headlineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  headline: {
    flex: 1,
    color: colors.text,
    ...typography.sectionTitle,
  },
  metaLine: {
    color: colors.textMuted,
    ...typography.body,
  },
  bio: {
    color: colors.text,
    ...typography.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  safetyRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xl,
  },
  safetyAction: {
    color: colors.error,
    ...typography.bodyStrong,
  },
  loadingMore: {
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingMoreText: {
    color: colors.textSoft,
    ...typography.caption,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.overlay,
  },
  modalCard: {
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  modalEyebrow: {
    color: colors.primary,
    ...typography.eyebrow,
  },
  modalTitle: {
    color: colors.text,
    ...typography.sectionTitle,
  },
  modalBody: {
    color: colors.textMuted,
    ...typography.body,
  },
  matchPhotosRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  matchPhotoPlaceholder: {
    flex: 1,
  },
  disabledButton: {
    opacity: 0.6,
  },
});

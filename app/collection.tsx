import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radii, spacing, typography } from "../theme";
import {
  claimCollectionReward,
  collectionLevelTitle,
  isSpecialEggRarity,
  loadCollectionGameState,
  COLLECTION_ACHIEVEMENTS,
  COLLECTION_MISSIONS,
  EGG_CATALOG,
  EMPTY_COLLECTION_STATE,
  MAX_COLLECTION_LEVEL,
  type CollectionGameState,
  type CollectionReward,
} from "../lib/collection";
import { EggReplayOverlay, type EggReplayInfo } from "../components/EggReplayOverlay";

type Tab = "collection" | "missions" | "achievements";

const RARITY_COLORS: Record<string, string> = {
  普通: colors.textMuted,
  稀有: colors.info,
  史詩: colors.accent,
  傳說: colors.warning,
  神話: colors.error,
};

export default function CollectionScreen() {
  const [tab, setTab] = useState<Tab>("collection");
  const [state, setState] = useState<CollectionGameState>(EMPTY_COLLECTION_STATE);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [preview, setPreview] = useState<EggReplayInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setState(await loadCollectionGameState());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = async (key: string) => {
    setClaiming(key);
    const claimed = await claimCollectionReward(key);
    if (claimed) await load();
    setClaiming(null);
  };

  const level = Math.min(state.level, MAX_COLLECTION_LEVEL);
  const progressRatio = state.next_level_xp > 0 ? Math.min(1, state.level_xp / state.next_level_xp) : 0;

  const rewardCard = (r: CollectionReward) => {
    const progress = Math.min(Number(state[r.metric] ?? 0), r.target);
    const done = progress >= r.target;
    const claimed = state.claimed.includes(r.key);
    return (
      <View key={r.key} style={[styles.rewardCard, r.eternal && styles.rewardEternal]}>
        {r.icon ? <Text style={styles.rewardIcon}>{r.icon}</Text> : null}
        <View style={styles.rewardMain}>
          <Text style={styles.rewardName}>{r.name}</Text>
          <Text style={styles.mutedSmall}>{r.desc}</Text>
          <Text style={styles.mutedSmall}>
            {progress.toLocaleString()} / {r.target.toLocaleString()} · +{r.xp} XP
          </Text>
        </View>
        {claimed ? (
          <Text style={styles.claimedText}>已領取</Text>
        ) : done ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`領取 ${r.name}`}
            style={styles.claimButton}
            disabled={claiming === r.key}
            onPress={() => void claim(r.key)}
          >
            <Text style={styles.claimButtonText}>{claiming === r.key ? "領取中…" : "領取"}</Text>
          </Pressable>
        ) : (
          <Text style={styles.progressText}>{Math.round((progress / r.target) * 100)}%</Text>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>♛</Text>
        <View style={styles.heroMain}>
          <Text style={styles.mutedSmall}>
            {collectionLevelTitle(level)} · LEVEL {level}
          </Text>
          <Text style={styles.heroTitle}>
            Lv.{level} · {state.xp.toLocaleString()} XP
          </Text>
          <Text style={styles.mutedSmall}>
            {loading
              ? "正在計算進度…"
              : state.level >= MAX_COLLECTION_LEVEL
                ? "已達最高等級 · 永恆"
                : `距離下一級還有 ${Math.max(0, state.next_level_xp - state.level_xp)} XP`}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progressRatio * 100)}%` }]} />
          </View>
        </View>
      </View>

      <View style={styles.explainCard}>
        <Text style={styles.explainTitle}>等級是什麼？</Text>
        <Text style={styles.mutedSmall}>聊天、解鎖彩蛋、完成任務會累積 XP；等級只代表收藏進度，不影響配對。</Text>
      </View>
      <View style={styles.explainCard}>
        <Text style={styles.explainTitle}>圖鑑怎麼解鎖？</Text>
        <Text style={styles.mutedSmall}>自然聊天觸發關鍵字或訊息里程碑後會解鎖；特殊彩蛋可從圖鑑回放。</Text>
      </View>
      <View style={styles.explainCard}>
        <Text style={styles.explainTitle}>任務怎麼算？</Text>
        <Text style={styles.mutedSmall}>進度依實際聊天紀錄計算；重複刷同一句不會重複計分，完成後可領 XP。</Text>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["collection", "圖鑑"],
            ["missions", "任務"],
            ["achievements", "成就"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={[styles.tab, tab === id && styles.tabActive]}
            onPress={() => setTab(id)}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : null}

      {tab === "collection" ? (
        <View style={styles.grid}>
          {EGG_CATALOG.map(([name, rarity, kind]) => {
            const unlocked = state.egg_kinds.includes(kind);
            const special = isSpecialEggRarity(rarity);
            return (
              <View key={kind} style={styles.eggCard}>
                <Text style={[styles.eggMark, { color: RARITY_COLORS[rarity] ?? colors.textMuted }]}>
                  {unlocked ? "✦" : "?"}
                </Text>
                <Text style={styles.eggName}>{unlocked ? name : "尚未解鎖"}</Text>
                <Text style={[styles.mutedSmall, { color: RARITY_COLORS[rarity] ?? colors.textSoft }]}>
                  {rarity}
                  {unlocked ? " · 已收集" : ""}
                </Text>
                {unlocked && special ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`播放 ${name}`}
                    style={styles.playButton}
                    onPress={() => setPreview({ kind, name, rarity })}
                  >
                    <Text style={styles.playButtonText}>▶ 播放</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {tab === "missions" ? (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.listTitle}>今日與長期任務</Text>
          {COLLECTION_MISSIONS.map(rewardCard)}
          <Text style={styles.mutedSmall}>進度由實際聊天和彩蛋紀錄計算；測試按鈕不計進度。完成後需手動領取 XP。</Text>
        </View>
      ) : null}

      {tab === "achievements" ? (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.listTitle}>聊天室成就</Text>
          {COLLECTION_ACHIEVEMENTS.map(rewardCard)}
        </View>
      ) : null}

      <EggReplayOverlay egg={preview} onClose={() => setPreview(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  hero: {
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  heroIcon: {
    fontSize: 34,
    color: colors.warning,
  },
  heroMain: {
    flex: 1,
    gap: spacing.xs,
  },
  heroTitle: {
    color: colors.text,
    ...typography.sectionTitle,
  },
  progressTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSecondary,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
  },
  explainCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  explainTitle: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  mutedSmall: {
    color: colors.textSoft,
    ...typography.caption,
  },
  tabs: {
    flexDirection: "row",
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  tabTextActive: {
    color: colors.primaryText,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  eggCard: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  eggMark: {
    fontSize: 22,
  },
  eggName: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  playButton: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  playButtonText: {
    color: colors.text,
    ...typography.caption,
  },
  listTitle: {
    color: colors.text,
    ...typography.cardTitle,
    marginBottom: spacing.xs,
  },
  rewardCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rewardEternal: {
    borderColor: colors.warning,
  },
  rewardIcon: {
    fontSize: 20,
    color: colors.warning,
  },
  rewardMain: {
    flex: 1,
    gap: spacing.xs,
  },
  rewardName: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  claimedText: {
    color: colors.success,
    ...typography.bodyStrong,
  },
  progressText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  claimButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  claimButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  replayBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  replayMark: {
    fontSize: 64,
    color: colors.warning,
  },
  replayName: {
    color: colors.text,
    ...typography.title,
    textAlign: "center",
  },
  replayClose: {
    position: "absolute",
    top: 48,
    right: 24,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  replayCloseText: {
    color: colors.text,
    fontSize: 30,
  },
});

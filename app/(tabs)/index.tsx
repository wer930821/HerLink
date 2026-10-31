import { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../context/auth";
import { LonelyStarBackground } from "../../components/LonelyStarBackground";
import {
  getMyRandomChatUnreadCount,
  listMyActiveRandomSessions,
  type RandomSession,
} from "../../lib/random-chat";
import {
  loadMyAnonymousName,
  rotateMyAnonymousName,
  setMyAnonymousName,
  ANONYMOUS_NAME_MAX_LENGTH,
} from "../../lib/anonymous-identity";
import {
  buildBrowserHandoffUrl,
  getOnlineUserCount,
  getPublicWaitingCount,
  touchOnlineActivity,
} from "../../lib/presence";
import {
  createPermanentRecoveryCode,
  getPermanentRecoveryCodeStatus,
  rotatePermanentRecoveryCode,
  type PermanentCodeStatus,
} from "../../lib/recovery";

export default function AnonymousHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();

  const [activeSessions, setActiveSessions] = useState<RandomSession[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [myName, setMyName] = useState<string | null>(null);
  const [renameNotice, setRenameNotice] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<PermanentCodeStatus | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const refreshPresence = useCallback(async () => {
    try {
      await touchOnlineActivity();
      const [online, waiting] = await Promise.all([
        getOnlineUserCount(),
        getPublicWaitingCount(),
      ]);
      if (online !== null) setOnlineCount(online);
      if (waiting !== null) setWaitingCount(waiting);
    } catch {
      // Presence is decorative; failures stay silent like the web home.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listMyActiveRandomSessions()
        .then((rows) => {
          if (alive) setActiveSessions(rows);
        })
        .catch(() => {
          if (alive) setActiveSessions([]);
        });
      void getMyRandomChatUnreadCount()
        .then((count) => {
          if (alive) setChatUnread(count);
        })
        .catch(() => {
          if (alive) setChatUnread(0);
        });
      void loadMyAnonymousName()
        .then((name) => {
          if (alive) setMyName(name);
        })
        .catch(() => undefined);
      void refreshPresence();
      const interval = setInterval(() => {
        void refreshPresence();
      }, 60_000);
      return () => {
        alive = false;
        clearInterval(interval);
      };
    }, [refreshPresence])
  );

  const resumeSession = activeSessions[0] ?? null;
  const isCrownIdentity = myName === "孤星企鵝";

  const openRename = () => {
    setRenameDraft(myName ?? "");
    setRenameError(null);
    setRenameOpen(true);
  };

  const applyRenameResult = (result: { ok: boolean; name?: string; message?: string }) => {
    if (result.ok && result.name) {
      setMyName(result.name);
      setRenameNotice(`已更換匿名名稱：${result.name}`);
      setRenameOpen(false);
    } else {
      setRenameError(result.message ?? "更換失敗，請稍後再試");
    }
  };

  const saveRename = async () => {
    setRenameBusy(true);
    setRenameError(null);
    try {
      applyRenameResult(await setMyAnonymousName(renameDraft));
    } finally {
      setRenameBusy(false);
    }
  };

  const randomRename = async () => {
    setRenameBusy(true);
    setRenameError(null);
    try {
      applyRenameResult(await rotateMyAnonymousName());
    } finally {
      setRenameBusy(false);
    }
  };

  const openRecovery = async () => {
    setRecoveryOpen(true);
    setRecoveryCode(null);
    setRecoveryError(null);
    setRecoveryStatus(null);
    try {
      setRecoveryStatus(await getPermanentRecoveryCodeStatus());
    } catch {
      setRecoveryError("讀取恢復碼狀態失敗，請稍後再試。");
    }
  };

  const runRecoveryAction = async (action: "create" | "rotate") => {
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      const result =
        action === "create"
          ? await createPermanentRecoveryCode()
          : await rotatePermanentRecoveryCode();
      setRecoveryCode(result.recoveryCode);
      setRecoveryStatus({
        hasRecoveryCode: true,
        hint: result.hint,
        createdAt: result.createdAt ?? null,
      });
    } catch {
      setRecoveryError("建立恢復碼失敗，請稍後再試。");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const shareBrowserHandoff = async () => {
    if (!session) return;
    const nextPath = resumeSession ? `/session/${resumeSession.id}` : "/";
    const url = buildBrowserHandoffUrl(session, nextPath);
    await Clipboard.setStringAsync(url);
    Alert.alert(
      "已複製續聊連結",
      "請貼到 Chrome、Safari 或其他瀏覽器開啟，會保留匿名名稱與目前聊天。"
    );
  };

  return (
    <View style={styles.root}>
      <LonelyStarBackground />

      {isCrownIdentity ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="彩蛋圖鑑與任務"
          style={[styles.crownFloat, { top: insets.top + 8 }]}
          onPress={() => router.push("/collection" as never)}
        >
          <Text style={styles.crownText}>♛</Text>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 56 }]}>
        <Text style={styles.eyebrow}>HerLink</Text>
        <Text style={styles.title}>匿名聊天</Text>
        <Text style={styles.copy}>
          不公開個人檔案，不做交友滑卡，只保留匿名隨機配對與聊天室。
        </Text>

        <View style={styles.identityCard}>
          <View style={styles.identityBody}>
            <Text style={styles.identityLabel}>你的匿名名稱</Text>
            <Text style={styles.identityName}>{myName ?? "匿名使用者"}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="更換匿名名稱"
            style={styles.renameButton}
            onPress={openRename}
          >
            <Text style={styles.renameButtonText}>更換</Text>
          </Pressable>
        </View>
        {renameNotice ? <Text style={styles.notice}>{renameNotice}</Text> : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeSessions.length > 0 ? "配對新的人" : "開始匿名配對"}
            onPress={() => router.push("/random" as never)}
          >
            <LinearGradient
              colors={["#FF7A18", "#FF9D2E"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                {activeSessions.length > 0 ? "配對新的人" : "開始匿名配對"}
              </Text>
            </LinearGradient>
          </Pressable>

          {activeSessions.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="我的聊天"
              style={styles.secondaryButton}
              onPress={() => router.push("/chats" as never)}
            >
              <Text style={styles.secondaryButtonText}>我的聊天</Text>
              {chatUnread > 0 ? (
                <View style={styles.badgeInline}>
                  <Text style={styles.badgeText}>{chatUnread > 99 ? "99+" : chatUnread}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="永久恢復碼"
            style={styles.secondaryButton}
            onPress={() => void openRecovery()}
          >
            <Text style={styles.secondaryButtonText}>永久恢復碼</Text>
          </Pressable>
        </View>

        <View style={styles.presenceRow}>
          <View style={styles.presenceItem}>
            <View style={[styles.presenceDot, styles.presenceDotOnline]} />
            <Text style={styles.presenceText}>
              正在出沒 <Text style={styles.presenceStrong}>{onlineCount ?? "…"}</Text> 人
            </Text>
          </View>
          <View style={styles.presenceItem}>
            <View style={[styles.presenceDot, styles.presenceDotWaiting]} />
            <Text style={styles.presenceText}>
              等人來聊 <Text style={styles.presenceStrong}>{waitingCount ?? "…"}</Text> 人
            </Text>
          </View>
        </View>

      </ScrollView>

      <Modal
        visible={renameOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!renameBusy) setRenameOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>更換匿名名稱</Text>
            <TextInput
              style={styles.input}
              value={renameDraft}
              onChangeText={setRenameDraft}
              maxLength={ANONYMOUS_NAME_MAX_LENGTH}
              placeholder="輸入新的匿名名稱"
              placeholderTextColor={colors.textSoft}
              editable={!renameBusy}
            />
            <Text style={styles.modalHint}>2–12 個字，不能和別人重複。</Text>
            {renameError ? <Text style={styles.errorText}>{renameError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                style={styles.modalSecondary}
                disabled={renameBusy}
                onPress={() => void randomRename()}
              >
                <Text style={styles.modalSecondaryText}>隨機換一個</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.modalGhost}
                disabled={renameBusy}
                onPress={() => setRenameOpen(false)}
              >
                <Text style={styles.modalGhostText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.modalPrimary}
                disabled={renameBusy}
                onPress={() => void saveRename()}
              >
                <Text style={styles.modalPrimaryText}>{renameBusy ? "處理中…" : "儲存"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={recoveryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!recoveryBusy) setRecoveryOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>永久恢復碼</Text>
            <Text style={styles.modalBody}>
              永久恢復碼是你的備用鑰匙。換手機、換瀏覽器或清除資料後，可用它接回原本的匿名身分、聊天室與聯絡人。
            </Text>
            {recoveryError ? <Text style={styles.errorText}>{recoveryError}</Text> : null}
            {recoveryCode ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>請立即保存新的恢復碼</Text>
                <Text style={styles.codeText}>{recoveryCode}</Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.modalSecondary}
                  onPress={() => void Clipboard.setStringAsync(recoveryCode)}
                >
                  <Text style={styles.modalSecondaryText}>複製恢復碼</Text>
                </Pressable>
              </View>
            ) : recoveryStatus === null && !recoveryError ? (
              <Text style={styles.modalBody}>載入中…</Text>
            ) : recoveryStatus?.hasRecoveryCode ? (
              <>
                <Text style={styles.modalBody}>
                  目前已有永久恢復碼（提示：{recoveryStatus.hint ?? "••••••"}
                  ）。如遺失，請重新產生新碼；新碼建立後，舊碼會失效。
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.modalSecondary}
                  disabled={recoveryBusy}
                  onPress={() => void runRecoveryAction("rotate")}
                >
                  <Text style={styles.modalSecondaryText}>
                    {recoveryBusy ? "處理中…" : "更換恢復碼"}
                  </Text>
                </Pressable>
              </>
            ) : recoveryStatus ? (
              <>
                <Text style={styles.modalBody}>目前尚未設定永久恢復碼。</Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.modalSecondary}
                  disabled={recoveryBusy}
                  onPress={() => void runRecoveryAction("create")}
                >
                  <Text style={styles.modalSecondaryText}>
                    {recoveryBusy ? "處理中…" : "建立永久恢復碼"}
                  </Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.modalGhost}
              disabled={recoveryBusy}
              onPress={() => setRecoveryOpen(false)}
            >
              <Text style={styles.modalGhostText}>關閉</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: 120,
  },
  crownFloat: {
    position: "absolute",
    left: spacing.lg,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,184,89,0.55)",
    backgroundColor: colors.surfaceElevated,
  },
  crownText: {
    color: "#FFC44D",
    fontSize: 18,
  },
  badgeInline: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
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
  copy: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  identityCard: {
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,128,35,0.26)",
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  identityBody: {
    flex: 1,
  },
  identityLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  identityName: {
    marginTop: 3,
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  renameButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  renameButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
    fontSize: 14,
  },
  notice: {
    marginTop: spacing.sm,
    color: colors.success,
    ...typography.body,
  },
  actions: {
    marginTop: 24,
    gap: 12,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: "#1A0C04",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  presenceRow: {
    marginTop: 22,
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  presenceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  presenceDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  presenceDotOnline: {
    backgroundColor: "#4ADE80",
  },
  presenceDotWaiting: {
    backgroundColor: "#FF9D2E",
  },
  presenceText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  presenceStrong: {
    color: colors.text,
    fontWeight: "800",
  },
  footerRow: {
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  supportRow: {
    marginTop: 16,
    alignItems: "center",
  },
  supportLink: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryLinks: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  footerLink: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  footerSeparator: {
    color: colors.textSoft,
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.text,
    ...typography.sectionTitle,
  },
  modalBody: {
    color: colors.textMuted,
    ...typography.body,
    lineHeight: 22,
  },
  modalHint: {
    color: colors.textSoft,
    ...typography.caption,
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  errorText: {
    color: colors.error,
    ...typography.body,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  modalPrimary: {
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  modalPrimaryText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  modalSecondary: {
    alignSelf: "flex-start",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalSecondaryText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  modalGhost: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  modalGhostText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  codeBox: {
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.successSurface,
    padding: spacing.md,
  },
  codeLabel: {
    color: colors.success,
    ...typography.bodyStrong,
  },
  codeText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 2,
  },
});

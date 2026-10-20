import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../context/auth";
import { validateAnonymousDisplayName } from "../lib/anonymous";
import { listMyActiveRandomSessions } from "../lib/random-chat";
import {
  claimPermanentRecovery,
  createPermanentRecoveryCode,
  ensureAnonymousPrincipal,
  getPermanentRecoveryCodeStatus,
  loadMyEffectiveProfile,
  normalizeRecoveryCode,
  previewPermanentRecovery,
  requestRandomIdentityRecovery,
  rotatePermanentRecoveryCode,
  type PermanentCodeStatus,
} from "../lib/recovery";

type RecoveryView = "menu" | "claim" | "admin" | "mycode";

function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.primaryButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.secondaryButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function CodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <View style={styles.codeCard}>
      <Text selectable style={styles.codeText}>
        {code}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="複製恢復碼" style={styles.copyButton} onPress={() => void copy()}>
        <Text style={styles.copyButtonText}>{copied ? "已複製" : "複製"}</Text>
      </Pressable>
    </View>
  );
}

function ClaimView({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureAnonymousPrincipal();
      const result = await previewPermanentRecovery(code);
      setDisplayName(result.displayName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "找不到這組恢復碼。");
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureAnonymousPrincipal();
      const result = await claimPermanentRecovery(code);
      if (!result.identityId) {
        throw new Error("恢復成功，但伺服器沒有回傳原匿名身分，請重新整理後再試。");
      }
      const effective = await loadMyEffectiveProfile();
      if (!effective || effective.id !== result.identityId) {
        throw new Error("已接回原匿名身分，但 App 尚未同步完成，請關閉 App 重新打開後再試。");
      }
      const sessions = await listMyActiveRandomSessions().catch(() => []);
      setRecoveredSessionId(sessions[0]?.id ?? null);
      setDisplayName(result.displayName);
      setNewCode(result.newRecoveryCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "目前無法接回匿名身分。");
    } finally {
      setBusy(false);
    }
  };

  if (newCode) {
    return (
      <View>
        <View style={[styles.notice, styles.noticeSuccess]}>
          <Text style={styles.noticeTitle}>已接回原本匿名身分</Text>
          <Text style={styles.noticeText}>新的永久恢復碼</Text>
          <CodeCard code={newCode} />
          <Text style={styles.noticeText}>請保存這組新碼；舊恢復碼已失效。</Text>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <PrimaryButton
          label={recoveredSessionId ? "我已保存，回到聊天室" : "我已保存，查看聊天室"}
          onPress={() => {
            if (recoveredSessionId) {
              router.replace({
                pathname: "/random-session/[sessionId]",
                params: { sessionId: recoveredSessionId },
              } as never);
            } else {
              router.replace("/(tabs)" as never);
            }
          }}
        />
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.notice, styles.noticeWarning]}>
        <Text style={styles.noticeText}>接回成功後，舊裝置會立即失效，並自動產生新的永久恢復碼。</Text>
      </View>
      <Text style={styles.label}>8 碼恢復碼</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(value) => {
          setCode(normalizeRecoveryCode(value));
          setDisplayName(null);
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        editable={!busy}
        placeholder="例如 R9T6Z4TV"
        placeholderTextColor={colors.textSoft}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {displayName ? (
        <View style={[styles.notice, styles.noticeInfo]}>
          <Text style={styles.noticeTitle}>找到匿名身分</Text>
          <Text style={styles.foundName}>{displayName}</Text>
          <Text style={styles.noticeText}>確認這是你原本的匿名名稱後再接回。</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <SecondaryButton label="返回" onPress={onBack} disabled={busy} />
        </View>
        <View style={styles.rowItem}>
          {displayName ? (
            <PrimaryButton label="確認接回" onPress={() => void claim()} busy={busy} disabled={busy} />
          ) : (
            <PrimaryButton
              label="確認恢復碼"
              onPress={() => void preview()}
              busy={busy}
              disabled={busy || code.length !== 8}
            />
          )}
        </View>
      </View>
    </View>
  );
}

function AdminAssistView({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const submit = async () => {
    const nameError = validateAnonymousDisplayName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureAnonymousPrincipal();
      const row = await requestRandomIdentityRecovery(name);
      setIssuedCode(row.recovery_code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "目前無法建立恢復碼。");
    } finally {
      setBusy(false);
    }
  };

  if (issuedCode) {
    return (
      <View>
        <View style={[styles.notice, styles.noticeSuccess]}>
          <Text style={styles.noticeTitle}>恢復碼已建立</Text>
          <CodeCard code={issuedCode} />
          <Text style={styles.noticeText}>請把這組 8 碼傳給管理員，管理員確認後會幫你接回原本的身分與聊天室。</Text>
        </View>
        <SecondaryButton label="返回" onPress={onBack} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.copy}>輸入原本使用的匿名名稱，取得 8 碼恢復碼後傳給管理員協助恢復。</Text>
      <Text style={styles.label}>原本的匿名名稱</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        autoCorrect={false}
        editable={!busy}
        placeholder="例如 阿風"
        placeholderTextColor={colors.textSoft}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <SecondaryButton label="返回" onPress={onBack} disabled={busy} />
        </View>
        <View style={styles.rowItem}>
          <PrimaryButton label="取得恢復碼" onPress={() => void submit()} busy={busy} disabled={busy || !name.trim()} />
        </View>
      </View>
    </View>
  );
}

function MyCodeView({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PermanentCodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freshCode, setFreshCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await getPermanentRecoveryCodeStatus();
        if (alive) setStatus(result);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "目前無法讀取恢復碼狀態。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = async (action: "create" | "rotate") => {
    setBusy(true);
    setError(null);
    try {
      const result = action === "create" ? await createPermanentRecoveryCode() : await rotatePermanentRecoveryCode();
      setFreshCode(result.recoveryCode);
      setStatus({ hasRecoveryCode: true, hint: result.hint, createdAt: result.createdAt ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "目前無法處理永久恢復碼。");
    } finally {
      setBusy(false);
    }
  };

  const confirmRotate = () => {
    Alert.alert("產生新恢復碼？", "新碼產生後，舊的永久恢復碼會立即失效。", [
      { text: "取消", style: "cancel" },
      { text: "產生新碼", style: "destructive", onPress: () => void run("rotate") },
    ]);
  };

  if (!user) {
    return (
      <View>
        <Text style={styles.copy}>請先在首頁以匿名身分開始使用，再回來管理你的永久恢復碼。</Text>
        <SecondaryButton label="返回" onPress={onBack} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.copy}>
        永久恢復碼是換手機、重裝 App 或清除資料時，自己接回原本匿名身分的鑰匙。先建立一組並保存好，就不用每次都等站長協助。
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : freshCode ? (
        <View style={[styles.notice, styles.noticeSuccess]}>
          <Text style={styles.noticeTitle}>你的永久恢復碼</Text>
          <CodeCard code={freshCode} />
          <Text style={styles.noticeText}>這組碼請自己保存好，不要傳給不認識的人。</Text>
        </View>
      ) : status?.hasRecoveryCode ? (
        <View style={[styles.notice, styles.noticeInfo]}>
          <Text style={styles.noticeTitle}>你已經有永久恢復碼</Text>
          <Text style={styles.noticeText}>
            {status.hint ? `提示：${status.hint}` : "為了安全，這裡不會顯示完整號碼。"}
            {status.createdAt ? `\n建立時間：${new Date(status.createdAt).toLocaleDateString("zh-TW")}` : ""}
          </Text>
        </View>
      ) : (
        <View style={[styles.notice, styles.noticeWarning]}>
          <Text style={styles.noticeText}>你還沒有永久恢復碼。</Text>
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!loading ? (
        status?.hasRecoveryCode ? (
          <PrimaryButton label="產生新碼（舊碼失效）" onPress={confirmRotate} busy={busy} disabled={busy} />
        ) : (
          <PrimaryButton label="建立我的恢復碼" onPress={() => void run("create")} busy={busy} disabled={busy} />
        )
      ) : null}
      <View style={{ marginTop: spacing.md }}>
        <SecondaryButton label="返回" onPress={onBack} disabled={busy} />
      </View>
    </View>
  );
}

export default function RecoveryScreen() {
  const [view, setView] = useState<RecoveryView>("menu");
  const back = () => setView("menu");

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>找回原本聊天室</Text>
      {view === "menu" ? (
        <View>
          <Text style={styles.copy}>忘記匿名名稱也沒關係。若你有之前保存的恢復碼，可使用恢復碼找回；沒有恢復碼則可請站長協助。</Text>
          <PrimaryButton label="我有恢復碼" onPress={() => setView("claim")} />
          <View style={{ marginTop: spacing.md }}>
            <SecondaryButton label="我沒有恢復碼／需要站長協助" onPress={() => setView("admin")} />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <SecondaryButton label="我的永久恢復碼" onPress={() => setView("mycode")} />
          </View>
        </View>
      ) : view === "claim" ? (
        <ClaimView onBack={back} />
      ) : view === "admin" ? (
        <AdminAssistView onBack={back} />
      ) : (
        <MyCodeView onBack={back} />
      )}
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
  title: {
    color: colors.text,
    ...typography.sectionTitle,
    marginBottom: spacing.md,
  },
  copy: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.textMuted,
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 18,
    letterSpacing: 2,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  rowItem: {
    flex: 1,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  disabled: {
    opacity: 0.55,
  },
  notice: {
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  noticeWarning: {
    backgroundColor: colors.warningSurface,
  },
  noticeSuccess: {
    backgroundColor: colors.successSurface,
  },
  noticeInfo: {
    backgroundColor: colors.infoSurface,
  },
  noticeTitle: {
    color: colors.text,
    ...typography.bodyStrong,
    marginBottom: spacing.sm,
  },
  noticeText: {
    color: colors.textMuted,
    ...typography.body,
    marginTop: spacing.sm,
  },
  foundName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  errorText: {
    color: colors.error,
    ...typography.body,
    marginBottom: spacing.md,
  },
  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    flexWrap: "wrap",
  },
  codeText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 2,
  },
  copyButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  copyButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
});

import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../context/auth";
import { supabase } from "../lib/supabase";
import {
  getFriendlyAuthErrorMessage,
  resolveActiveAnonymousIdentityId,
  signUpOrBindAccount,
} from "../lib/account";

type SignupMode = "new" | "bind";

export default function AccountSignupScreen() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [mode, setMode] = useState<SignupMode>("new");
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        if (!data.session) {
          setMode("new");
          return;
        }
        const identityId = await resolveActiveAnonymousIdentityId();
        if (alive) setMode(identityId ? "bind" : "new");
      } catch {
        if (alive) setMode("new");
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await signUpOrBindAccount(email, password);
      if (result.mode === "bind") {
        setMessage(
          "申請完成。原本的匿名名稱、聊天室、訊息紀錄與聯絡人都會保留。若收到驗證信，請完成信箱驗證後再跨瀏覽器登入。"
        );
      } else {
        setMessage(
          result.hasSession
            ? "帳號建立完成，現在已登入。"
            : "帳號建立完成。若收到驗證信，請先完成信箱驗證後再登入。"
        );
      }
      setDone(true);
      void refreshProfile().catch(() => undefined);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw && /[^\x00-\x7F]/.test(raw)
          ? raw
          : getFriendlyAuthErrorMessage(err, raw || "申請失敗，請稍後再試。")
      );
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.centerRoot}>
        <Text style={styles.muted}>正在確認帳號狀態…</Text>
      </View>
    );
  }

  const description =
    mode === "bind"
      ? "為目前的匿名身分建立登入方式。綁定後會保留原本的匿名名稱、聊天室、訊息紀錄與聯絡人。"
      : "建立 HerLink 帳號後即可登入使用；之後建立的匿名聊天資料會跟著這個帳號。";

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoid} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>HERLINK ACCOUNT</Text>
      <Text style={styles.title}>申請帳號</Text>
      <Text style={styles.description}>{description}</Text>

      <Text style={styles.label}>電子郵件</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        placeholder="輸入電子郵件"
        placeholderTextColor={colors.textSoft}
        editable={!loading && !done}
      />

      <Text style={styles.label}>密碼</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        placeholder="設定登入密碼"
        placeholderTextColor={colors.textSoft}
        editable={!loading && !done}
      />
      <Text style={styles.hint}>至少 8 個字元</Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {message ? (
        <View style={styles.successBox}>
          <Text style={styles.successText}>{message}</Text>
        </View>
      ) : null}

      {done ? (
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => router.back()}
        >
          <Text style={styles.primaryButtonText}>返回</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          style={[
            styles.primaryButton,
            (loading || !email.trim() || password.length < 8) && styles.buttonDisabled,
          ]}
          disabled={loading || !email.trim() || password.length < 8}
          onPress={() => void onSubmit()}
        >
          <Text style={styles.primaryButtonText}>
            {loading ? "申請中…" : mode === "bind" ? "申請並綁定" : "申請帳號"}
          </Text>
        </Pressable>
      )}

      <View style={styles.footerRow}>
        <Text style={styles.muted}>已經有帳號？</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/account-login" as never)}
        >
          <Text style={styles.link}>登入帳號</Text>
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  eyebrow: {
    color: "#9FB3FF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  description: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 27,
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.text,
    ...typography.bodyStrong,
    marginTop: spacing.md,
  },
  input: {
    minHeight: 54,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: 17,
  },
  hint: {
    color: colors.textSoft,
    ...typography.caption,
  },
  errorBox: {
    borderRadius: radii.md,
    backgroundColor: colors.errorSurface,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    color: colors.error,
    ...typography.body,
  },
  successBox: {
    borderRadius: radii.md,
    backgroundColor: colors.successSurface,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  successText: {
    color: colors.success,
    ...typography.body,
    lineHeight: 22,
  },
  primaryButton: {
    marginTop: spacing.lg,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.primaryText,
    fontSize: 16,
    fontWeight: "800",
  },
  footerRow: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  muted: {
    color: colors.textMuted,
    ...typography.body,
  },
  link: {
    color: colors.text,
    ...typography.bodyStrong,
  },
});

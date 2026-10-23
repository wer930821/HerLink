import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../theme";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView";
import {
  getFriendlyAuthErrorMessage,
  sendPasswordReset,
} from "../lib/account";

export default function AccountForgotScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw && /[^\x00-\x7F]/.test(raw)
          ? raw
          : getFriendlyAuthErrorMessage(err, raw || "寄送失敗，請稍後再試。")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardFormScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>HERLINK ACCOUNT</Text>
      <Text style={styles.title}>忘記密碼</Text>
      <Text style={styles.description}>
        輸入註冊時的電子郵件，我們會寄一封重設密碼的信。點信中的連結在網頁完成重設後，再回 App 用新密碼登入。
      </Text>

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
        editable={!loading && !sent}
      />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {sent ? (
        <View style={styles.successBox}>
          <Text style={styles.successText}>重設信已寄出，請到 Email 查收並完成重設。</Text>
        </View>
      ) : null}

      {sent ? (
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
            (loading || !email.trim()) && styles.buttonDisabled,
          ]}
          disabled={loading || !email.trim()}
          onPress={() => void onSubmit()}
        >
          <Text style={styles.primaryButtonText}>{loading ? "寄送中…" : "寄送重設信"}</Text>
        </Pressable>
      )}
    </KeyboardFormScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
});

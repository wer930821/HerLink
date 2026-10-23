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
import { useAuth } from "../context/auth";
import {
  getFriendlyAuthErrorMessage,
  signInExistingAccount,
} from "../lib/account";

export default function AccountLoginScreen() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInExistingAccount(email, password);
      void refreshProfile().catch(() => undefined);
      router.replace("/(tabs)" as never);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw && /[^\x00-\x7F]/.test(raw)
          ? raw
          : getFriendlyAuthErrorMessage(err, raw || "登入失敗，請稍後再試。")
      );
      setLoading(false);
    }
  };

  return (
    <KeyboardFormScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>HERLINK ACCOUNT</Text>
      <Text style={styles.title}>登入帳號</Text>
      <Text style={styles.description}>
        登入後會接回這個帳號原本的匿名身分、聊天室與聯絡人。若目前正在使用匿名身分，登入既有帳號時會安全綁定並保留目前聊天室資料。
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
        editable={!loading}
      />

      <Text style={styles.label}>密碼</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        placeholder="輸入登入密碼"
        placeholderTextColor={colors.textSoft}
        editable={!loading}
      />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        style={[
          styles.primaryButton,
          (loading || !email.trim() || !password) && styles.buttonDisabled,
        ]}
        disabled={loading || !email.trim() || !password}
        onPress={() => void onSubmit()}
      >
        <Text style={styles.primaryButtonText}>{loading ? "登入中…" : "登入帳號"}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={styles.linkRow}
        disabled={loading}
        onPress={() => router.push("/account-forgot" as never)}
      >
        <Text style={styles.link}>忘記密碼？</Text>
      </Pressable>
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
  linkRow: {
    marginTop: spacing.lg,
    alignItems: "center",
  },
  link: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
});

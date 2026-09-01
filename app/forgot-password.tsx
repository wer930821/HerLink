import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BrandLogo } from "../components/BrandLogo";
import { getAuthCallbackUrl, supabase, withSupabaseTimeout } from "../lib/supabase";
import { colors } from "../theme/colors";
import { radii, spacing, typography } from "../theme";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) {
      Alert.alert("需要 Email", "請輸入帳號 Email。");
      return;
    }

    setLoading(true);
    try {
      const { error } = await withSupabaseTimeout(
        supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getAuthCallbackUrl(),
        }),
        "寄送重設密碼信"
      );

      if (error) {
        Alert.alert("無法處理", "目前無法送出重設密碼郵件，請稍後再試。");
        return;
      }

      Alert.alert("已送出", "如果這個 Email 可用，妳會收到重設密碼信。");
    } catch {
      Alert.alert("無法處理", "目前無法送出重設密碼郵件，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.container}>
      <View style={styles.brandHeader}>
        <BrandLogo size={64} variant="iconWithName" />
      </View>
      <View style={styles.card}>
      <Text style={styles.title}>忘記密碼</Text>
      <Text style={styles.body}>輸入妳的 Email，如果帳號存在，HerLink 會寄出重設密碼信。</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          loading && styles.buttonDisabled,
          pressed && !loading && styles.primaryButtonPressed,
        ]}
        onPress={() => void handleSubmit()}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>{loading ? "寄送中..." : "寄送重設密碼信"}</Text>
      </Pressable>
      </View>
    </View>
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboard: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.background,
  },
  container: {
    gap: spacing.lg,
  },
  brandHeader: {
    alignItems: "center",
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    textAlign: "center",
    ...typography.title,
  },
  body: {
    color: colors.textMuted,
    textAlign: "center",
    ...typography.body,
  },
  input: {
    minHeight: 52,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceStrong,
    color: colors.text,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
});

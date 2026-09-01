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
import { useRouter } from "expo-router";
import { BrandLogo } from "../components/BrandLogo";
import { supabase, withSupabaseTimeout } from "../lib/supabase";
import { colors } from "../theme/colors";
import { radii, spacing, typography } from "../theme";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (password.length < 8) {
      Alert.alert("密碼太短", "請至少輸入 8 碼密碼。");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("密碼不一致", "兩次輸入的密碼不一致。");
      return;
    }

    setLoading(true);
    try {
      const { error } = await withSupabaseTimeout(
        supabase.auth.updateUser({ password }),
        "更新密碼"
      );

      if (error) {
        Alert.alert("重設失敗", "目前無法更新密碼，請重新開啟信件中的連結再試一次。");
        return;
      }

      Alert.alert("已更新", "密碼已更新，現在可以用新密碼登入。");
      router.replace("/login");
    } catch {
      Alert.alert("重設失敗", "目前無法更新密碼，請重新開啟信件中的連結再試一次。");
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
      <Text style={styles.title}>重設密碼</Text>
      <Text style={styles.body}>請輸入新密碼。Beta 期間建議使用長度足夠且不重複的密碼。</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="新密碼"
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        placeholder="再次輸入新密碼"
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
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
        <Text style={styles.primaryButtonText}>{loading ? "更新中..." : "更新密碼"}</Text>
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

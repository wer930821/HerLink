import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../context/auth";
import { colors, radii, spacing, typography } from "../theme";

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const { signInAnonymously } = useAuth();

  async function continueAnonymously() {
    setLoading(true);
    try {
      await signInAnonymously();
    } catch (error) {
      Alert.alert("暫時無法開始", error instanceof Error ? error.message : "匿名登入失敗，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>HerLink</Text>
      <Text style={styles.title}>匿名聊天</Text>
      <Text style={styles.copy}>不用建立交友檔案，不公開真實資料，直接用匿名身份開始。</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="匿名開始"
        style={[styles.button, loading && styles.disabled]}
        disabled={loading}
        onPress={() => void continueAnonymously()}
      >
        {loading ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>匿名開始</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
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
  button: {
    marginTop: spacing.xxl,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  disabled: {
    opacity: 0.6,
  },
});

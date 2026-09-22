import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../../theme";

export default function AnonymousHomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>HerLink</Text>
      <Text style={styles.title}>匿名聊天</Text>
      <Text style={styles.copy}>不公開個人檔案，不做交友滑卡，只保留匿名隨機配對與聊天室。</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="開始匿名配對"
        style={styles.button}
        onPress={() => router.push("/random" as never)}
      >
        <Text style={styles.buttonText}>開始匿名配對</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
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
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  buttonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
});

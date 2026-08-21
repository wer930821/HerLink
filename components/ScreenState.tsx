import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { radii, spacing, typography } from "../theme";

interface ScreenStateProps {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}

export function ScreenState({ title, body, actionLabel, onAction, loading = false }: ScreenStateProps) {
  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={onAction}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  title: {
    marginTop: spacing.lg,
    color: colors.text,
    textAlign: "center",
    ...typography.cardTitle,
  },
  body: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    textAlign: "center",
    ...typography.body,
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  buttonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
});

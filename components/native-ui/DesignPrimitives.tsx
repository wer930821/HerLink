import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View, type PressableProps, type ReactNode } from "react";
import { colors, radii, shadows, spacing, typography } from "../../theme";

export function NativeCard({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function NativeSectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function NativePrimaryButton({ children, icon, style, ...props }: PressableProps & { children: ReactNode; icon?: keyof typeof Ionicons.glyphMap; style?: object }) {
  return (
    <Pressable {...props} style={({ pressed }) => [styles.primary, pressed && styles.pressed, props.disabled && styles.disabled, style]}>
      {icon ? <Ionicons name={icon} size={20} color={colors.primaryText} /> : null}
      <Text style={styles.primaryText}>{children}</Text>
    </Pressable>
  );
}

export function NativeSecondaryButton({ children, icon, style, ...props }: PressableProps & { children: ReactNode; icon?: keyof typeof Ionicons.glyphMap; style?: object }) {
  return (
    <Pressable {...props} style={({ pressed }) => [styles.secondary, pressed && styles.pressed, props.disabled && styles.disabled, style]}>
      {icon ? <Ionicons name={icon} size={20} color={colors.text} /> : null}
      <Text style={styles.secondaryText}>{children}</Text>
    </Pressable>
  );
}

export function NativeStatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
  return (
    <View style={[styles.pill, tone === "success" && styles.successPill, tone === "warning" && styles.warningPill]}>
      <View style={[styles.dot, tone === "success" ? styles.successDot : tone === "warning" ? styles.warningDot : styles.neutralDot]} />
      <Text style={styles.pillText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, ...shadows.card },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: spacing.md },
  eyebrow: { color: colors.accent, ...typography.eyebrow },
  sectionTitle: { color: colors.text, marginTop: spacing.xs, ...typography.sectionTitle },
  primary: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  secondary: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  primaryText: { color: colors.primaryText, ...typography.bodyStrong },
  secondaryText: { color: colors.text, ...typography.bodyStrong },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceSecondary },
  successPill: { backgroundColor: colors.successSurface },
  warningPill: { backgroundColor: colors.warningSurface },
  dot: { width: 8, height: 8, borderRadius: 4 },
  neutralDot: { backgroundColor: colors.textSoft },
  successDot: { backgroundColor: colors.success },
  warningDot: { backgroundColor: colors.warning },
  pillText: { color: colors.textMuted, ...typography.caption },
});

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing, typography, radii, shadows } from "../theme";

interface PolicySection {
  title: string;
  body: string;
}

interface PolicyScreenProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  notice: string;
  sections: PolicySection[];
}

export function PolicyScreen({ eyebrow, title, subtitle, notice, sections }: PolicyScreenProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.noticeCard}>
        <Text style={styles.noticeText}>{notice}</Text>
      </View>

      {sections.map((section) => (
        <View key={section.title} style={styles.card}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          <Text style={styles.cardBody}>{section.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  eyebrow: {
    color: colors.primary,
    ...typography.eyebrow,
  },
  title: {
    color: colors.text,
    ...typography.title,
  },
  subtitle: {
    color: colors.textMuted,
    ...typography.body,
  },
  noticeCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  noticeText: {
    color: colors.warning,
    ...typography.bodyStrong,
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  cardBody: {
    color: colors.textMuted,
    ...typography.body,
  },
});

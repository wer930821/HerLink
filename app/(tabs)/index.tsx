import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../../theme";
import { listMyActiveRandomSessions, type RandomSession } from "../../lib/random-chat";

export default function AnonymousHomeScreen() {
  const router = useRouter();
  const [activeSessions, setActiveSessions] = useState<RandomSession[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listMyActiveRandomSessions()
        .then((rows) => {
          if (alive) setActiveSessions(rows);
        })
        .catch(() => {
          if (alive) setActiveSessions([]);
        });
      return () => {
        alive = false;
      };
    }, [])
  );

  const resumeSession = activeSessions[0] ?? null;

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>HerLink</Text>
      <Text style={styles.title}>匿名聊天</Text>
      <Text style={styles.copy}>不公開個人檔案，不做交友滑卡，只保留匿名隨機配對與聊天室。</Text>

      {resumeSession ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="繼續聊天"
          style={styles.resumeButton}
          onPress={() =>
            router.push({
              pathname: "/random-session/[sessionId]",
              params: { sessionId: resumeSession.id },
            } as never)
          }
        >
          <Text style={styles.buttonText}>繼續和 {resumeSession.partner_anonymous_display_name} 聊天</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="開始匿名配對"
        style={styles.button}
        onPress={() => router.push("/random" as never)}
      >
        <Text style={styles.buttonText}>開始匿名配對</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="匿名聯絡人"
        style={styles.secondaryButton}
        onPress={() => router.push("/contacts" as never)}
      >
        <Text style={styles.secondaryButtonText}>匿名聯絡人</Text>
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
  resumeButton: {
    marginTop: spacing.xxl,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  button: {
    marginTop: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  buttonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButton: {
    marginTop: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
});

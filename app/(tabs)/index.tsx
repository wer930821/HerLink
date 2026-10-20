import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../../theme";
import { listMyActiveRandomSessions, type RandomSession } from "../../lib/random-chat";
import { isUnreadThread, listMyMailThreads } from "../../lib/station-mail";

export default function AnonymousHomeScreen() {
  const router = useRouter();
  const [activeSessions, setActiveSessions] = useState<RandomSession[]>([]);
  const [unreadMail, setUnreadMail] = useState(0);

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
      void listMyMailThreads()
        .then((rows) => {
          if (alive) setUnreadMail(rows.filter(isUnreadThread).length);
        })
        .catch(() => {
          if (alive) setUnreadMail(0);
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="站長信箱"
        style={styles.secondaryButton}
        onPress={() => router.push("/mailbox" as never)}
      >
        <Text style={styles.secondaryButtonText}>站長信箱{unreadMail > 0 ? `（${unreadMail}）` : ""}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="彩蛋圖鑑"
        style={styles.secondaryButton}
        onPress={() => router.push("/collection" as never)}
      >
        <Text style={styles.secondaryButtonText}>彩蛋圖鑑</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="找回原本聊天室"
        style={styles.secondaryButton}
        onPress={() => router.push("/recovery" as never)}
      >
        <Text style={styles.secondaryButtonText}>找回原本聊天室</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="支持 HerLink"
        style={styles.secondaryButton}
        onPress={() => router.push("/support" as never)}
      >
        <Text style={styles.secondaryButtonText}>支持 HerLink</Text>
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

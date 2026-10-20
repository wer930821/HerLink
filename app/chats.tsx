import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from "expo-router";
import { colors, radii, spacing, typography } from "../theme";
import { getAnonymousAvatarOption } from "../lib/anonymous";
import { listMyActiveRandomSessions, type RandomSession } from "../lib/random-chat";

export default function ChatsScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<RandomSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listMyActiveRandomSessions()
        .then((rows) => {
          if (alive) {
            setSessions(rows);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
      return () => {
        alive = false;
      };
    }, [])
  );

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={sessions}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        loaded ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>目前沒有進行中的聊天室。</Text>
            <Text style={styles.emptyHint}>回到首頁開始匿名配對，聊起來之後就會出現在這裡。</Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>載入中…</Text>
          </View>
        )
      }
      renderItem={({ item }) => {
        const avatar = getAnonymousAvatarOption(item.partner_anonymous_avatar);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`和 ${item.partner_anonymous_display_name} 的聊天室`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() =>
              router.push({
                pathname: "/random-session/[sessionId]",
                params: { sessionId: item.id },
              } as never)
            }
          >
            <View style={[styles.avatar, { backgroundColor: avatar.bg }]}>
              <Ionicons name={avatar.icon as never} size={22} color={avatar.fg} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.name} numberOfLines={1}>
                {item.partner_anonymous_display_name}
                {item.partner_verified ? " ✓" : ""}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                進行中 · {new Date(item.created_at).toLocaleDateString("zh-TW")}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSecondary,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
  },
  name: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  meta: {
    marginTop: 2,
    color: colors.textMuted,
    ...typography.caption,
  },
  chevron: {
    color: colors.textSoft,
    fontSize: 24,
  },
  empty: {
    alignItems: "center",
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  emptyHint: {
    color: colors.textMuted,
    ...typography.body,
    textAlign: "center",
  },
});

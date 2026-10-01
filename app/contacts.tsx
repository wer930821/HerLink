import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  AnonymousContact,
  listMyAnonymousContacts,
  removeAnonymousContact,
  requestAnonymousContact,
  startAnonymousContactSession,
} from "../lib/random-chat";
import { colors, radii, spacing, typography } from "../theme";

function friendlyError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  if (message.includes("already have an active anonymous chat")) {
    return "你目前已有進行中的匿名聊天室。";
  }
  if (message.includes("currently in another chat")) {
    return "對方目前正在其他匿名聊天室中。";
  }
  if (message.includes("not active")) {
    return "這位匿名聯絡人目前不可用。";
  }
  return "目前無法完成操作，請稍後再試。";
}

export default function AnonymousContactsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AnonymousContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listMyAnonymousContacts());
    } catch (error) {
      Alert.alert("載入失敗", friendlyError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (item: AnonymousContact) => {
    if (!item.source_session_id) return;
    setBusyId(item.contact_id);
    try {
      await requestAnonymousContact(item.source_session_id);
      await load();
    } catch (error) {
      Alert.alert("無法接受", friendlyError(error));
    } finally {
      setBusyId(null);
    }
  };

  const startChat = async (item: AnonymousContact) => {
    setBusyId(item.contact_id);
    try {
      const result = await startAnonymousContactSession(item.contact_id);
      if (!result?.session_id) throw new Error("Missing session");
      router.push({
        pathname: "/random-session/[sessionId]",
        params: { sessionId: result.session_id },
      } as never);
    } catch (error) {
      Alert.alert("無法開始聊天", friendlyError(error));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (item: AnonymousContact) => {
    Alert.alert("移除匿名聯絡人", `確定要移除「${item.partner_anonymous_display_name}」嗎？`, [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusyId(item.contact_id);
            try {
              await removeAnonymousContact(item.contact_id);
              setItems((current) => current.filter((entry) => entry.contact_id !== item.contact_id));
            } catch (error) {
              Alert.alert("移除失敗", friendlyError(error));
            } finally {
              setBusyId(null);
            }
          })(),
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.eyebrow}>HerLink</Text>
      <Text style={styles.title}>匿名聯絡人</Text>
      <Text style={styles.copy}>只有雙方都同意才會保留聯絡。</Text>

      <Pressable style={styles.secondaryButton} onPress={() => void load()} disabled={loading}>
        <Text style={styles.secondaryButtonText}>{loading ? "載入中…" : "重新整理"}</Text>
      </Pressable>

      {!loading && items.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>目前沒有匿名聯絡人</Text>
          <Text style={styles.copy}>聊天室中雙方都按「保留匿名聯絡」後，就會出現在這裡。</Text>
        </View>
      ) : null}

      {items.map((item) => {
        const busy = busyId === item.contact_id;
        const incoming = item.status === "pending" && item.partner_approved && !item.my_approved;
        const outgoing = item.status === "pending" && item.my_approved && !item.partner_approved;

        return (
          <View key={item.contact_id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.partner_anonymous_display_name}</Text>
            <Text style={styles.status}>
              {item.status === "active"
                ? "已互相保留"
                : incoming
                  ? "等待你同意"
                  : outgoing
                    ? "等待對方同意"
                    : "待確認"}
            </Text>

            <View style={styles.row}>
              {item.status === "active" ? (
                <Pressable style={styles.primaryButton} onPress={() => void startChat(item)} disabled={busy}>
                  <Text style={styles.primaryButtonText}>{busy ? "處理中…" : "開始聊天"}</Text>
                </Pressable>
              ) : incoming && item.source_session_id ? (
                <Pressable style={styles.primaryButton} onPress={() => void accept(item)} disabled={busy}>
                  <Text style={styles.primaryButtonText}>{busy ? "處理中…" : "接受匿名聯絡"}</Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.dangerButton} onPress={() => remove(item)} disabled={busy}>
                <Text style={styles.dangerButtonText}>移除</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
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
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  status: {
    marginTop: spacing.sm,
    color: colors.textMuted,
  },
  row: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButton: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  dangerButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  dangerButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
});

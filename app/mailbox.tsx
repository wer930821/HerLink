import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography } from "../theme";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView";
import { useAuth } from "../context/auth";
import { supabase } from "../lib/supabase";
import { prepareRandomChatImage, type PreparedRandomChatImage } from "../lib/random-chat-media";
import {
  attachMailPhoto,
  createMailPhotoUrl,
  isUnreadThread,
  listMailMessages,
  listMyMailThreads,
  markMailThreadRead,
  removeMailPhoto,
  replyStationMail,
  sendStationMail,
  threadStatusLabel,
  uploadMailPhoto,
  MAIL_CATEGORIES,
  type StationMailMessage,
  type StationMailThread,
} from "../lib/station-mail";

function MailPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void createMailPhotoUrl(path).then((signed) => {
      if (active) setUrl(signed);
    });
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <Text style={styles.mutedSmall}>照片載入中…</Text>;
  return <Image source={{ uri: url }} style={styles.attachment} resizeMode="contain" />;
}

function PhotoPicker({
  photo,
  onPick,
  onClear,
}: {
  photo: PreparedRandomChatImage | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <View>
      <Text style={styles.label}>
        照片附件 <Text style={styles.mutedSmall}>選填 · 最大 5MB</Text>
      </Text>
      {photo ? (
        <View>
          <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
          <Pressable accessibilityRole="button" accessibilityLabel="移除照片" style={styles.secondaryButton} onPress={onClear}>
            <Text style={styles.secondaryButtonText}>移除照片</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="選擇照片" style={styles.secondaryButton} onPress={onPick}>
          <Text style={styles.secondaryButtonText}>＋ 選擇照片</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function MailboxScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<"compose" | "inbox">("compose");
  const [threads, setThreads] = useState<StationMailThread[]>([]);
  const [selected, setSelected] = useState<StationMailThread | null>(null);
  const [messages, setMessages] = useState<StationMailMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [photo, setPhoto] = useState<PreparedRandomChatImage | null>(null);
  const [replyPhoto, setReplyPhoto] = useState<PreparedRandomChatImage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef<StationMailThread | null>(null);
  selectedRef.current = selected;

  const load = useCallback(async () => {
    try {
      setThreads(await listMyMailThreads());
    } catch {
      // Keep the current list on transient failures, like web.
    }
  }, []);

  const open = useCallback(async (t: StationMailThread) => {
    setSelected(t);
    setMessages(await listMailMessages(t.id).catch(() => []));
    await markMailThreadRead(t.id).catch(() => undefined);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("user-mailbox-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "station_mail_threads" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "station_mail_messages" }, (payload: { new?: { thread_id?: string } }) => {
        void load();
        const current = selectedRef.current;
        if (current && payload.new?.thread_id === current.id) {
          void (async () => {
            setMessages(await listMailMessages(current.id).catch(() => []));
            await markMailThreadRead(current.id).catch(() => undefined);
          })();
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const pickPhoto = async (setter: (p: PreparedRandomChatImage | null) => void) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
      selectionLimit: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    try {
      const prepared = await prepareRandomChatImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      });
      setter(prepared);
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "照片無法使用，請換一張。");
    }
  };

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      setNotice("請填寫主旨與內容。");
      return;
    }
    if (!user) {
      setNotice("請先建立匿名身分。");
      return;
    }
    setBusy(true);
    setNotice(null);
    let uploadedPath: string | null = null;
    try {
      if (photo) {
        uploadedPath = await uploadMailPhoto(user.id, photo.bytes);
      }
      const threadId = await sendStationMail(subject, category, body);
      if (uploadedPath && photo) {
        await attachMailPhoto(threadId, { path: uploadedPath, mime: photo.mime, size: photo.size });
      }
      setSubject("");
      setBody("");
      setPhoto(null);
      setNotice("已寄到站長信箱。");
      await load();
      const created = (await listMyMailThreads()).find((t) => t.id === threadId);
      if (created) void open(created);
    } catch {
      if (uploadedPath) void removeMailPhoto(uploadedPath);
      setNotice("寄送失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!selected || (!reply.trim() && !replyPhoto)) return;
    if (!user) {
      setNotice("請先建立匿名身分。");
      return;
    }
    setBusy(true);
    setNotice(null);
    let uploadedPath: string | null = null;
    try {
      if (replyPhoto) {
        uploadedPath = await uploadMailPhoto(user.id, replyPhoto.bytes);
      }
      await replyStationMail(
        selected.id,
        reply,
        uploadedPath && replyPhoto ? { path: uploadedPath, mime: replyPhoto.mime, size: replyPhoto.size } : null
      );
      setReply("");
      setReplyPhoto(null);
      void open(selected);
    } catch {
      if (uploadedPath) void removeMailPhoto(uploadedPath);
      setNotice("回覆失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  const unreadCount = threads.filter(isUnreadThread).length;

  if (selected) {
    return (
      <KeyboardFormScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回我的信件" style={styles.secondaryButton} onPress={() => setSelected(null)}>
          <Text style={styles.secondaryButtonText}>返回我的信件</Text>
        </Pressable>
        <Text style={styles.threadTitle}>{selected.subject}</Text>
        <View style={{ gap: spacing.md }}>
          {messages.map((m) => (
            <View key={m.id} style={[styles.messageCard, m.sender_role === "admin" ? styles.messageAdmin : styles.messageUser]}>
              <Text style={styles.messageSender}>{m.sender_role === "admin" ? "站長" : "我"}</Text>
              <Text style={styles.messageBody}>{m.body}</Text>
              {m.attachment_path ? <MailPhoto path={m.attachment_path} /> : null}
              <Text style={styles.mutedSmall}>{new Date(m.created_at).toLocaleString("zh-TW")}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.label}>回覆</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={reply}
          onChangeText={setReply}
          maxLength={2000}
          multiline
        />
        <PhotoPicker photo={replyPhoto} onPick={() => void pickPhoto(setReplyPhoto)} onClear={() => setReplyPhoto(null)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="送出回覆"
          style={[styles.primaryButton, (busy || (!reply.trim() && !replyPhoto)) && styles.disabled]}
          disabled={busy || (!reply.trim() && !replyPhoto)}
          onPress={() => void sendReply()}
        >
          {busy ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.primaryButtonText}>送出回覆</Text>}
        </Pressable>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </KeyboardFormScrollView>
    );
  }

  return (
    <KeyboardFormScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}>
      <Text style={styles.intro}>有問題、建議或想告訴站長的事，都可以從這裡寄出。</Text>
      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="寫信給站長"
          style={[styles.tab, view === "compose" && styles.tabActive]}
          onPress={() => setView("compose")}
        >
          <Text style={[styles.tabText, view === "compose" && styles.tabTextActive]}>寫信給站長</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="我的信件"
          style={[styles.tab, view === "inbox" && styles.tabActive]}
          onPress={() => setView("inbox")}
        >
          <Text style={[styles.tabText, view === "inbox" && styles.tabTextActive]}>
            我的信件{unreadCount > 0 ? `（${unreadCount}）` : ""}
          </Text>
        </Pressable>
      </View>

      {view === "compose" ? (
        <View>
          <Text style={styles.label}>信件分類</Text>
          <View style={styles.categoryRow}>
            {MAIL_CATEGORIES.map((c) => (
              <Pressable
                key={c.key}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                style={[styles.categoryChip, category === c.key && styles.categoryChipActive]}
                onPress={() => setCategory(c.key)}
              >
                <Text style={[styles.categoryText, category === c.key && styles.categoryTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>主旨</Text>
          <TextInput style={styles.input} value={subject} onChangeText={setSubject} maxLength={80} />
          <Text style={styles.label}>內容</Text>
          <TextInput style={[styles.input, styles.textarea]} value={body} onChangeText={setBody} maxLength={2000} multiline />
          <PhotoPicker photo={photo} onPick={() => void pickPhoto(setPhoto)} onClear={() => setPhoto(null)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="寄給站長"
            style={[styles.primaryButton, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void send()}
          >
            {busy ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.primaryButtonText}>寄給站長</Text>}
          </Pressable>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {threads.length === 0 ? (
            <Text style={styles.copy}>目前還沒有信件。</Text>
          ) : (
            threads.map((t) => (
              <Pressable key={t.id} accessibilityRole="button" style={styles.threadCard} onPress={() => void open(t)}>
                <Text style={styles.threadSubject}>{t.subject}</Text>
                <Text style={styles.mutedSmall}>
                  {threadStatusLabel(t.status)} · {new Date(t.updated_at).toLocaleString("zh-TW")}
                  {isUnreadThread(t) ? " · 未讀" : ""}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </KeyboardFormScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  intro: {
    color: colors.textMuted,
    ...typography.body,
    marginBottom: spacing.lg,
  },
  copy: {
    color: colors.textMuted,
    ...typography.body,
  },
  tabs: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  tabTextActive: {
    color: colors.primaryText,
  },
  label: {
    color: colors.textMuted,
    ...typography.caption,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  textarea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  categoryRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  categoryTextActive: {
    color: colors.primaryText,
  },
  primaryButton: {
    marginTop: spacing.xl,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  disabled: {
    opacity: 0.55,
  },
  notice: {
    color: colors.info,
    ...typography.body,
    marginTop: spacing.md,
  },
  mutedSmall: {
    color: colors.textSoft,
    ...typography.caption,
  },
  threadCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  threadSubject: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  threadTitle: {
    color: colors.text,
    ...typography.sectionTitle,
    marginVertical: spacing.lg,
  },
  messageCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    gap: spacing.sm,
  },
  messageUser: {
    backgroundColor: colors.surface,
  },
  messageAdmin: {
    backgroundColor: colors.warningSurface,
  },
  messageSender: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  messageBody: {
    color: colors.text,
    ...typography.body,
  },
  attachment: {
    width: "100%",
    height: 320,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
  },
  preview: {
    width: "100%",
    height: 200,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
});

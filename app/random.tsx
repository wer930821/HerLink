import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { findOrJoinRandomMatch, leaveRandomQueue } from "../lib/random-chat";
import { colors, radii, spacing, typography } from "../theme";

export default function RandomMatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ auto?: string | string[] }>();
  const autoJoin = useMemo(
    () => (Array.isArray(params.auto) ? params.auto[0] === "1" : params.auto === "1"),
    [params.auto]
  );
  const [waiting, setWaiting] = useState(false);
  const [joining, setJoining] = useState(false);
  const joinBusyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const join = async () => {
    if (joinBusyRef.current) {
      return;
    }
    joinBusyRef.current = true;
    setJoining(true);
    try {
      const result = await findOrJoinRandomMatch();
      if (!mountedRef.current) {
        return;
      }
      if (result?.status === "matched" && result.session_id) {
        router.replace({
          pathname: "/random-session/[sessionId]",
          params: { sessionId: result.session_id },
        } as never);
        return;
      }
      setWaiting(true);
    } catch (error) {
      if (mountedRef.current) {
        setWaiting(false);
        Alert.alert("目前無法配對", error instanceof Error ? error.message : "請稍後再試。");
      }
    } finally {
      joinBusyRef.current = false;
      if (mountedRef.current) {
        setJoining(false);
      }
    }
  };

  useEffect(() => {
    if (autoJoin) {
      setWaiting(true);
      void join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!waiting) {
      return;
    }
    const timer = setInterval(() => void join(), 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const stopWaiting = async () => {
    joinBusyRef.current = true;
    try {
      await leaveRandomQueue();
      if (mountedRef.current) {
        setWaiting(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert("目前無法停止", error instanceof Error ? error.message : "請稍後再試。");
      }
    } finally {
      joinBusyRef.current = false;
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{waiting ? "正在尋找聊天對象…" : "匿名即時聊天"}</Text>
      <Text style={styles.copy}>
        {waiting
          ? "找到對象會自動進入聊天室。停止後不會保留在佇列中。"
          : "配對後可以隨時離開、封鎖或檢舉。"}
      </Text>
      <Pressable
        style={[styles.button, (joining || waiting) && styles.buttonWaiting]}
        disabled={joining}
        onPress={() => void (waiting ? stopWaiting() : join())}
      >
        <Text style={styles.buttonText}>
          {joining ? "處理中…" : waiting ? "停止等待" : "開始配對"}
        </Text>
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
  title: {
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
  buttonWaiting: {
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
});

import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { createRandomChatImageUrl } from "../lib/random-chat";
import { colors } from "../theme/colors";

type RandomChatImageProps = {
  path: string;
  style?: {
    width?: number;
    height?: number;
    borderRadius?: number;
  };
};

const SIGNED_URL_EXPIRY_SECONDS = 300;
const RE_SIGN_INTERVAL_MS = 240_000;

/**
 * Renders one private chat-media image. URLs are signed on the authenticated
 * client, and re-signed before expiry so long conversations keep rendering.
 * There is never a public bucket or publicly reachable object URL.
 */
export function RandomChatImage({ path, style }: RandomChatImageProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const sign = async () => {
      try {
        const signedUrl = await createRandomChatImageUrl(path, SIGNED_URL_EXPIRY_SECONDS);
        if (mountedRef.current && !cancelled) {
          setFailed(false);
          setUri(signedUrl);
        }
      } catch {
        if (mountedRef.current && !cancelled) {
          setFailed(true);
        }
      }
    };

    void sign();
    timerRef.current = setInterval(() => {
      void sign();
    }, RE_SIGN_INTERVAL_MS);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [path]);

  const retry = () => {
    setFailed(false);
    setUri(null);
    void (async () => {
      try {
        const signedUrl = await createRandomChatImageUrl(path, SIGNED_URL_EXPIRY_SECONDS);
        if (mountedRef.current) {
          setUri(signedUrl);
        }
      } catch {
        if (mountedRef.current) {
          setFailed(true);
        }
      }
    })();
  };

  return (
    <View style={[styles.frame, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : failed ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>圖片無法載入</Text>
          <Pressable onPress={retry} hitSlop={10}>
            <Text style={styles.retryText}>重試</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>載入中…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 220,
    height: 240,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.backgroundMuted,
  },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  stateText: {
    color: colors.textSoft,
    fontSize: 13,
  },
  retryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
});

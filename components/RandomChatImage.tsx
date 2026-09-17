import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { createRandomChatImageUrl } from "../lib/random-chat";
import { getCachedSignedUrl, invalidateCachedSignedUrl } from "../lib/signed-url-cache";
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
const SIGNED_URL_TTL_MS = SIGNED_URL_EXPIRY_SECONDS * 1000;
const SIGNED_URL_REFRESH_THRESHOLD_MS = 60_000;
const MAX_IMAGE_LOAD_RETRIES = 1;

/**
 * Renders one private chat-media image. URLs are signed on the authenticated
 * client when an image needs a URL, with an expiry-aware shared cache.
 * There is never a public bucket or publicly reachable object URL.
 */
export function RandomChatImage({ path, style }: RandomChatImageProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retryCountRef = useRef(0);
  const requestGenerationRef = useRef(0);

  const resolveUrl = useCallback(() => {
    return getCachedSignedUrl(
      path,
      async () => {
        const signedUrl = await createRandomChatImageUrl(path, SIGNED_URL_EXPIRY_SECONDS);
        if (!signedUrl) {
          throw new Error("Unable to sign chat media URL");
        }
        return signedUrl;
      },
      {
        ttlMs: SIGNED_URL_TTL_MS,
        refreshThresholdMs: SIGNED_URL_REFRESH_THRESHOLD_MS,
      }
    );
  }, [path]);

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current;
    retryCountRef.current = 0;
    void resolveUrl()
      .then((signedUrl) => {
        if (requestGenerationRef.current === requestGeneration) {
          setUri((current) => (current === signedUrl ? current : signedUrl));
          setFailed(false);
        }
      })
      .catch(() => {
        if (requestGenerationRef.current === requestGeneration) setFailed(true);
      });

    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
    };
  }, [resolveUrl]);

  const retryOnce = () => {
    if (retryCountRef.current >= MAX_IMAGE_LOAD_RETRIES) {
      setFailed(true);
      return;
    }

    retryCountRef.current += 1;
    invalidateCachedSignedUrl(path);
    const requestGeneration = requestGenerationRef.current;
    void resolveUrl()
      .then((signedUrl) => {
        if (requestGenerationRef.current === requestGeneration) {
          setUri((current) => (current === signedUrl ? current : signedUrl));
          setFailed(false);
        }
      })
      .catch(() => {
        if (requestGenerationRef.current === requestGeneration) setFailed(true);
      });
  };

  return (
    <View style={[styles.frame, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onError={retryOnce}
        />
      ) : failed ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>圖片無法載入</Text>
          <Pressable onPress={retryOnce} hitSlop={10}>
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

import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { createRandomChatImageUrl } from "../lib/random-chat";
import { getCachedSignedUrl, invalidateCachedSignedUrl } from "../lib/signed-url-cache";
import { colors } from "../theme/colors";

type RandomChatImageProps = {
  path: string;
  // 訊息存的原始寬高（media_width / media_height），用來讓框照照片比例長，
  // 而不是固定 220x240 再用 contain 留出左右黑邊。沒有尺寸時沿用舊的固定框。
  width?: number | null;
  height?: number | null;
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
 * Resolves a private chat-media path to a signed URL. URLs are signed on the
 * authenticated client when an image needs a URL, with an expiry-aware
 * shared cache. There is never a public bucket or publicly reachable object
 * URL. Shared by the thumbnail and the full-screen viewer.
 */
export function useRandomChatImageUrl(path: string | null) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retryCountRef = useRef(0);
  const requestGenerationRef = useRef(0);

  const resolveUrl = useCallback(() => {
    if (!path) {
      return Promise.reject(new Error("No image path"));
    }
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
    if (!path) {
      setUri(null);
      setFailed(false);
      return;
    }
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
  }, [path, resolveUrl]);

  const retry = useCallback(() => {
    if (!path) return;
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
  }, [path, resolveUrl]);

  return { uri, failed, retry };
}

export function RandomChatImage({ path, width, height, style }: RandomChatImageProps) {
  const { uri, failed, retry } = useRandomChatImageUrl(path);

  // 照片框照原始比例長：寬最多 220、高最多 320，超出就等比縮小，
  // 這樣直向照片不會被壓進 220x240 的固定框、左右留出深色邊。
  // 框底色改透明，就算舊訊息沒有尺寸、contain 留了空位，也不會再
  // 出現一圈跟聊天室背景不同的框。
  const aspect =
    width && height && width > 0 && height > 0 ? width / height : null;
  const frameStyle = aspect
    ? (() => {
        let w = 220;
        let h = w / aspect;
        if (h > 320) {
          h = 320;
          w = h * aspect;
        }
        return { width: w, height: h };
      })()
    : null;

  return (
    <View style={[styles.frame, frameStyle, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onError={retry}
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
    backgroundColor: "transparent",
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

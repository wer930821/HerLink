import { useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRandomChatImageUrl } from "./RandomChatImage";

const ZOOM_SCALE = 2.5;

/**
 * Full-screen viewer for one chat image: tap to close, double-tap to zoom
 * in/out, drag to pan while zoomed. Close also via the X button or the
 * Android back button (onRequestClose).
 */
export function ChatImageViewer({
  path,
  onClose,
}: {
  path: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { uri, failed, retry } = useRandomChatImageUrl(path);
  const [zoomed, setZoomed] = useState(false);
  const lastTapRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hScrollRef = useRef<ScrollView | null>(null);
  const vScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    setZoomed(false);
    lastTapRef.current = 0;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [path]);

  useEffect(() => {
    if (!zoomed) return;
    const timer = setTimeout(() => {
      hScrollRef.current?.scrollTo({
        x: (width * ZOOM_SCALE - width) / 2,
        animated: false,
      });
      vScrollRef.current?.scrollTo({
        y: (height * ZOOM_SCALE - height) / 2,
        animated: false,
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [zoomed, width, height]);

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setZoomed((current) => !current);
      return;
    }
    lastTapRef.current = now;
    if (!zoomed) {
      closeTimerRef.current = setTimeout(onClose, 280);
    }
  };

  return (
    <Modal
      visible={path !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.fill} onPress={handleTap}>
          {uri ? (
            zoomed ? (
              <ScrollView
                ref={hScrollRef}
                horizontal
                bounces={false}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ width: width * ZOOM_SCALE, height }}
              >
                <ScrollView
                  ref={vScrollRef}
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  style={{ width: width * ZOOM_SCALE, height }}
                  contentContainerStyle={{
                    width: width * ZOOM_SCALE,
                    height: height * ZOOM_SCALE,
                  }}
                >
                  <Image
                    source={{ uri }}
                    style={{ width: width * ZOOM_SCALE, height: height * ZOOM_SCALE }}
                    resizeMode="contain"
                  />
                </ScrollView>
              </ScrollView>
            ) : (
              <Image
                source={{ uri }}
                style={{ width, height }}
                resizeMode="contain"
              />
            )
          ) : (
            <View style={styles.stateWrap}>
              <Text style={styles.stateText}>
                {failed ? "圖片無法載入" : "載入中…"}
              </Text>
              {failed ? (
                <Pressable onPress={retry} hitSlop={10}>
                  <Text style={styles.retryText}>重試</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="關閉圖片"
          style={[styles.closeButton, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={12}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000000",
  },
  fill: {
    flex: 1,
  },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  stateText: {
    color: "#CCCCCC",
    fontSize: 14,
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});

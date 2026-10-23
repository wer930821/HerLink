import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Dimensions,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  UIManager,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../theme";

type KeyboardFormScrollViewProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

// Form container that keeps the focused input visible above the keyboard.
// Earlier attempts failed on Android: KeyboardAvoidingView computes a zero
// keyboard height when the window already resizes, and the legacy
// scrollResponder keyboard API does nothing on the new architecture.
// So this component measures the focused input in window coordinates
// itself and scrolls with ScrollView.scrollTo, and while the keyboard is
// up it adds keyboard-height bottom padding (Android) so there is always
// enough scroll range to bring the field into view.
export function KeyboardFormScrollView({
  children,
  style,
  contentContainerStyle,
}: KeyboardFormScrollViewProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const focusedTargetRef = useRef<number | null>(null);
  const scrollOffsetRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollFocusedIntoView = () => {
    const kb = keyboardHeightRef.current;
    const target = focusedTargetRef.current;
    if (!kb || target == null) return;
    const node = findNodeHandle(target);
    if (node == null) return;
    UIManager.measure(node, (_x, _y, _w, h, _px, py) => {
      const inputBottom = py + h;
      const limit = Dimensions.get("window").height - kb - 24;
      const delta = inputBottom - limit;
      if (delta > 0) {
        scrollRef.current?.scrollTo({
          y: scrollOffsetRef.current + delta,
          animated: true,
        });
      }
    });
  };

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardHeightRef.current = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(keyboardHeightRef.current);
      // wait a tick so the added bottom padding is laid out before scrolling
      setTimeout(scrollFocusedIntoView, 60);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.avoid}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={style}
        contentContainerStyle={[
          contentContainerStyle,
          Platform.OS === "android" && keyboardHeight
            ? { paddingBottom: keyboardHeight }
            : null,
        ]}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        onFocus={(e) => {
          if (typeof e.target === "number") {
            focusedTargetRef.current = e.target;
          }
          setTimeout(scrollFocusedIntoView, 60);
        }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  avoid: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

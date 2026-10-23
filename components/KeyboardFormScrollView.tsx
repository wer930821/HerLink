import { useEffect, useRef, type ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../theme";

type KeyboardFormScrollViewProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

// Form container that keeps the focused input visible above the keyboard:
// iOS shrinks via KeyboardAvoidingView padding; on Android the window
// already resizes, so we scroll the focused input into view instead
// (a plain ScrollView never auto-scrolls to the focused field).
export function KeyboardFormScrollView({
  children,
  style,
  contentContainerStyle,
}: KeyboardFormScrollViewProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const focusedNodeRef = useRef<number | null>(null);

  const scrollFocusedIntoView = () => {
    const node = focusedNodeRef.current;
    if (node == null) return;
    const responder = (scrollRef.current as any)?.getScrollResponder?.();
    responder?.scrollResponderScrollNativeHandleToKeyboard?.(node, 88, true);
  };

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", scrollFocusedIntoView);
    return () => sub.remove();
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.avoid}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={style}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        onFocus={(event) => {
          if (typeof event.target === "number") {
            focusedNodeRef.current = event.target;
          }
          scrollFocusedIntoView();
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

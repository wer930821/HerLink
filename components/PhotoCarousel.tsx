import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { radii, spacing, typography } from "../theme";

export interface CarouselPhoto {
  id: string;
  signedUrl: string;
}

interface PhotoCarouselProps {
  photos: CarouselPhoto[];
  index: number;
  onChange: (nextIndex: number) => void;
  accessibilityLabel: string;
  height?: number;
}

export function PhotoCarousel({
  photos,
  index,
  onChange,
  accessibilityLabel,
  height = 360,
}: PhotoCarouselProps) {
  const safeIndex = photos.length === 0 ? 0 : Math.min(index, photos.length - 1);
  const active = photos[safeIndex] ?? null;

  return (
    <View style={[styles.frame, { height }]}>
      {active ? (
        <Image
          accessibilityLabel={accessibilityLabel}
          source={{ uri: active.signedUrl }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View accessibilityLabel={`${accessibilityLabel}，目前沒有照片`} style={styles.placeholder}>
          <Text style={styles.placeholderText}>目前沒有公開照片</Text>
        </View>
      )}

      {photos.length > 1 ? (
        <>
          <Pressable
            accessibilityLabel="上一張照片"
            style={[styles.arrow, styles.leftArrow]}
            onPress={() => onChange((safeIndex - 1 + photos.length) % photos.length)}
          >
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="下一張照片"
            style={[styles.arrow, styles.rightArrow]}
            onPress={() => onChange((safeIndex + 1) % photos.length)}
          >
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {safeIndex + 1}/{photos.length}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceMuted,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  placeholderText: {
    color: colors.textMuted,
    textAlign: "center",
    ...typography.body,
  },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: "rgba(30, 21, 18, 0.34)",
    alignItems: "center",
    justifyContent: "center",
  },
  leftArrow: {
    left: spacing.md,
  },
  rightArrow: {
    right: spacing.md,
  },
  arrowText: {
    color: colors.primaryText,
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 28,
  },
  counter: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: "rgba(30, 21, 18, 0.5)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  counterText: {
    color: colors.primaryText,
    ...typography.meta,
  },
});

import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { radii, spacing, typography } from "../theme";

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return (
    <View
      accessibilityLabel={verified ? "已驗證" : "未驗證"}
      style={[styles.badge, verified ? styles.verified : styles.unverified]}
    >
      <Text style={[styles.text, verified ? styles.verifiedText : styles.unverifiedText]}>
        {verified ? "已驗證" : "未驗證"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: "flex-start",
    borderWidth: 1,
  },
  verified: {
    backgroundColor: colors.infoSurface,
    borderColor: "#BCD3E5",
  },
  unverified: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  text: {
    ...typography.meta,
  },
  verifiedText: {
    color: colors.verified,
  },
  unverifiedText: {
    color: colors.textSoft,
  },
});

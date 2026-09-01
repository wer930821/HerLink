import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

const BRAND_SYMBOL = require("../assets/images/brand-symbol.png");

interface BrandLogoProps {
  size?: number;
  variant?: "icon" | "iconWithName" | "dark";
}

export function BrandLogo({ size = 32, variant = "icon" }: BrandLogoProps) {
  if (variant === "icon" || variant === "dark") {
    return <Image source={BRAND_SYMBOL} style={{ width: size, height: size }} resizeMode="contain" />;
  }

  return (
    <View style={styles.stack}>
      <Image source={BRAND_SYMBOL} style={{ width: size, height: size }} resizeMode="contain" />
      <Text style={[styles.wordmark, { fontSize: Math.max(22, Math.round(size * 0.34)) }]}>HerLink</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: "center",
    gap: 10,
  },
  wordmark: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});

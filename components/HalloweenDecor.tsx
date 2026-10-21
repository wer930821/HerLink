import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

/**
 * Seasonal Halloween accents, ported from the web home/chat decor
 * (.halloween-home-decor in apps/web/app/globals.css): floating ghost and
 * bat, a pumpkin, a cobweb corner, and warm/cool radial glows. Purely
 * decorative; never intercepts touches.
 */
export function HalloweenDecor({ topOffset = 12 }: { topOffset?: number }) {
  const ghost = useRef(new Animated.Value(0)).current;
  const bat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (value: Animated.Value, duration: number) => {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: duration / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: duration / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return animation;
    };
    const ghostAnimation = makeLoop(ghost, 5000);
    const batAnimation = makeLoop(bat, 7000);
    return () => {
      ghostAnimation.stop();
      batAnimation.stop();
    };
  }, [ghost, bat]);

  const ghostStyle = {
    transform: [
      { translateY: ghost.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }) },
      { rotate: ghost.interpolate({ inputRange: [0, 1], outputRange: ["-4deg", "4deg"] }) },
    ],
  };
  const batStyle = {
    transform: [
      { translateX: bat.interpolate({ inputRange: [0, 1], outputRange: [0, 9] }) },
      { translateY: bat.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
      { rotate: bat.interpolate({ inputRange: [0, 1], outputRange: ["-8deg", "8deg"] }) },
    ],
  };

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={[styles.bannerWrap, { top: topOffset }]}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>HAPPY HALLOWEEN</Text>
        </View>
      </View>
      <View style={styles.orangeGlow} />
      <View style={styles.purpleGlow} />
      <Text style={styles.cobweb}>🕸️</Text>
      <Text style={styles.pumpkin}>🎃</Text>
      <Animated.Text style={[styles.ghost, ghostStyle]}>👻</Animated.Text>
      <Animated.Text style={[styles.bat, batStyle]}>🦇</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  bannerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2,
  },
  banner: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,150,50,0.45)",
    backgroundColor: "rgba(24,12,6,0.55)",
    paddingVertical: 6,
    paddingHorizontal: 18,
  },
  bannerText: {
    color: "#FFB35C",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  orangeGlow: {
    position: "absolute",
    top: -60,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(255,122,24,0.10)",
  },
  purpleGlow: {
    position: "absolute",
    bottom: 90,
    left: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(116,72,180,0.10)",
  },
  cobweb: {
    position: "absolute",
    top: -14,
    right: -10,
    fontSize: 96,
    opacity: 0.55,
  },
  pumpkin: {
    position: "absolute",
    top: "11%",
    right: "7%",
    fontSize: 44,
    opacity: 0.72,
    transform: [{ rotate: "9deg" }],
  },
  ghost: {
    position: "absolute",
    top: "30%",
    left: "3%",
    fontSize: 36,
    opacity: 0.72,
  },
  bat: {
    position: "absolute",
    top: "6%",
    left: "15%",
    fontSize: 20,
    opacity: 0.72,
  },
});

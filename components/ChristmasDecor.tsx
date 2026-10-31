import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

/**
 * Seasonal Christmas accents, ported from the web Christmas decor
 * (.christmas-home-decor / .christmas-chat-decor in apps/web/app/globals.css):
 * a MERRY CHRISTMAS banner, Christmas tree, Santa, snowflakes, snowman,
 * gift and bell, with cool blue/white glows. Purely decorative; never
 * intercepts touches. Shown to everyone (not gated).
 */
export function ChristmasDecor({ topOffset = 12 }: { topOffset?: number }) {
  const snowman = useRef(new Animated.Value(0)).current;
  const tree = useRef(new Animated.Value(0)).current;
  const bell = useRef(new Animated.Value(0)).current;

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
    const snowmanAnimation = makeLoop(snowman, 5200);
    const treeAnimation = makeLoop(tree, 6800);
    const bellAnimation = makeLoop(bell, 3600);
    return () => {
      snowmanAnimation.stop();
      treeAnimation.stop();
      bellAnimation.stop();
    };
  }, [snowman, tree, bell]);

  const snowmanStyle = {
    transform: [
      { translateY: snowman.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
      { rotate: snowman.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", "3deg"] }) },
    ],
  };
  const treeStyle = {
    transform: [
      { rotate: tree.interpolate({ inputRange: [0, 1], outputRange: ["-2deg", "2deg"] }) },
    ],
  };
  const bellStyle = {
    transform: [
      { rotate: bell.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "10deg"] }) },
    ],
  };

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={[styles.bannerWrap, { top: topOffset }]}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>MERRY CHRISTMAS</Text>
        </View>
      </View>
      <View style={styles.blueGlow} />
      <View style={styles.whiteGlow} />
      <Text style={styles.snowflakeA}>❄️</Text>
      <Text style={styles.snowflakeB}>❄️</Text>
      <Text style={styles.snowflakeC}>❄️</Text>
      <Animated.Text style={[styles.tree, treeStyle]}>🎄</Animated.Text>
      <Text style={styles.santa}>🎅</Text>
      <Animated.Text style={[styles.snowman, snowmanStyle]}>⛄</Animated.Text>
      <Text style={styles.gift}>🎁</Text>
      <Animated.Text style={[styles.bell, bellStyle]}>🔔</Animated.Text>
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
    borderColor: "rgba(140,180,255,0.45)",
    backgroundColor: "rgba(10,16,32,0.55)",
    paddingVertical: 6,
    paddingHorizontal: 18,
  },
  bannerText: {
    color: "#BFD4FF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  blueGlow: {
    position: "absolute",
    top: -60,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(120,160,255,0.10)",
  },
  whiteGlow: {
    position: "absolute",
    bottom: 90,
    left: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(220,235,255,0.08)",
  },
  snowflakeA: {
    position: "absolute",
    top: "4%",
    left: "8%",
    fontSize: 22,
    opacity: 0.7,
  },
  snowflakeB: {
    position: "absolute",
    top: "18%",
    right: "12%",
    fontSize: 16,
    opacity: 0.6,
  },
  snowflakeC: {
    position: "absolute",
    top: "34%",
    left: "20%",
    fontSize: 14,
    opacity: 0.5,
  },
  tree: {
    position: "absolute",
    top: "10%",
    right: "6%",
    fontSize: 46,
    opacity: 0.85,
  },
  santa: {
    position: "absolute",
    top: "26%",
    left: "4%",
    fontSize: 30,
    opacity: 0.75,
  },
  snowman: {
    position: "absolute",
    top: "42%",
    right: "10%",
    fontSize: 34,
    opacity: 0.8,
  },
  gift: {
    position: "absolute",
    bottom: "18%",
    left: "8%",
    fontSize: 28,
    opacity: 0.7,
  },
  bell: {
    position: "absolute",
    top: "8%",
    left: "42%",
    fontSize: 24,
    opacity: 0.75,
  },
});

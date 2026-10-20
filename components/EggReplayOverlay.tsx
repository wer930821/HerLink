import { useEffect, useMemo, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

// Native approximation of the web collection replay scene
// (apps/web/app/globals.css .egg-unique-*): a tinted full-screen scene with a
// glowing core glyph, two expanding/rotating rings and drifting particles.
// Per-kind colors come from the web scene table; kinds without an explicit
// web color use a rarity-family fallback. Motion parameters vary by a stable
// per-kind seed, mirroring the web's per-kind generated keyframes.

export type EggReplayInfo = { kind: string; name: string; rarity: string };

const KIND_COLORS: Record<string, string> = {
  missyou: "#ff8bb8",
  coincidence: "#8de5ff",
  meet_again: "#c9a5ff",
  secret_word: "#d6a56d",
  moon: "#e6e9ff",
  stars: "#fff1a8",
  destiny: "#ff668e",
  telepathy: "#8ef1ff",
  no_goodbye: "#d6c8ff",
  sixHundred: "#d6a4ff",
  sevenHundred: "#fff0a4",
  eightHundred: "#91eaff",
  nineHundred: "#ffc978",
  fifteenHundred: "#a5c7ff",
  twoThousand: "#9ffff4",
  threeThousand: "#b68cff",
  fiveThousand: "#ffd37a",
  tenThousand: "#fff0a0",
  streak7: "#ffb0df",
  threeam: "#7fdcff",
  balanced100: "#ffe09a",
  daily200: "#ff9b6d",
  meet10: "#d9b5ff",
  eternal_bond: "#ffd879",
  // Kinds without an explicit web scene color: rarity-family approximations.
  meteor: "#ffe9a8",
  secret: "#d6a56d",
  fourHundred: "#ffc978",
  fiveHundred: "#ffd37a",
  thousand: "#fff1a8",
};

const RARITY_FALLBACK: Record<string, string> = {
  史詩: "#E89C8B",
  傳說: "#E0B56A",
  神話: "#E56B72",
};

function seedFromKind(kind: string) {
  let hash = 0;
  for (let i = 0; i < kind.length; i += 1) {
    hash = (hash * 31 + kind.charCodeAt(i)) % 9973;
  }
  return hash;
}

const PARTICLE_OFFSETS: [number, number][] = [
  [64, -120],
  [-96, -64],
  [120, 48],
  [-128, 88],
  [24, 140],
];

export function EggReplayOverlay({
  egg,
  onClose,
}: {
  egg: EggReplayInfo | null;
  onClose: () => void;
}) {
  const scene = useRef(new Animated.Value(0)).current;
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  const color = useMemo(() => {
    if (!egg) return colors.warning;
    return KIND_COLORS[egg.kind] ?? RARITY_FALLBACK[egg.rarity] ?? colors.warning;
  }, [egg]);

  const seed = useMemo(() => (egg ? seedFromKind(egg.kind) : 0), [egg]);
  const ringDuration = 3000 + (seed % 5) * 300;
  const driftDirection = seed % 2 === 0 ? 1 : -1;

  useEffect(() => {
    if (!egg) return;
    scene.setValue(0);
    ringA.setValue(0);
    ringB.setValue(0);
    drift.setValue(0);
    const animations = Animated.parallel([
      Animated.timing(scene, { toValue: 1, duration: 4400, useNativeDriver: true }),
      Animated.timing(ringA, { toValue: 1, duration: ringDuration, useNativeDriver: true }),
      Animated.timing(ringB, { toValue: 1, duration: 4000, useNativeDriver: true }),
      Animated.timing(drift, { toValue: 1, duration: 3800, useNativeDriver: true }),
    ]);
    animations.start();
    const timer = setTimeout(onClose, 4800);
    return () => {
      animations.stop();
      clearTimeout(timer);
    };
  }, [egg, scene, ringA, ringB, drift, ringDuration, onClose]);

  const sceneOpacity = scene.interpolate({
    inputRange: [0, 0.12, 0.82, 1],
    outputRange: [0, 1, 1, 0],
  });
  const coreScale = scene.interpolate({
    inputRange: [0, 0.28, 0.75, 1],
    outputRange: [0.25, 1, 1, 1.2],
  });
  const coreRotate = scene.interpolate({
    inputRange: [0, 0.28, 1],
    outputRange: ["-20deg", "0deg", "0deg"],
  });
  const coreOpacity = scene.interpolate({
    inputRange: [0, 0.28, 0.75, 1],
    outputRange: [0, 1, 1, 0],
  });
  const titleOpacity = scene.interpolate({
    inputRange: [0, 0.3, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });
  const ringAScale = ringA.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.8] });
  const ringAOpacity = ringA.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.8, 0],
  });
  const ringBRotate = ringB.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const particleOpacity = drift.interpolate({
    inputRange: [0, 0.3, 0.7, 1],
    outputRange: [0, 0.85, 0.85, 0],
  });
  const particleY = drift.interpolate({ inputRange: [0, 1], outputRange: [16, -20] });

  return (
    <Modal visible={egg !== null} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View style={[styles.scene, { opacity: sceneOpacity, backgroundColor: `${color}14` }]}>
          <Animated.View
            style={[
              styles.ringA,
              {
                borderColor: color,
                opacity: ringAOpacity,
                transform: [{ scale: ringAScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.ringB,
              {
                borderColor: color,
                transform: [{ rotate: ringBRotate }],
              },
            ]}
          />
          {PARTICLE_OFFSETS.map(([x, y], index) => (
            <Animated.View
              key={index}
              style={[
                styles.particle,
                {
                  backgroundColor: color,
                  opacity: particleOpacity,
                  marginLeft: x * driftDirection - 4,
                  marginTop: y - 4,
                  transform: [{ translateY: particleY }],
                },
              ]}
            />
          ))}
          <Animated.Text
            style={[
              styles.core,
              {
                color,
                textShadowColor: color,
                opacity: coreOpacity,
                transform: [{ scale: coreScale }, { rotate: coreRotate }],
              },
            ]}
          >
            ✦
          </Animated.Text>
          <Animated.Text style={[styles.name, { opacity: titleOpacity }]}>{egg?.name}</Animated.Text>
          <Animated.Text style={[styles.rarity, { opacity: titleOpacity }]}>
            {egg?.rarity}彩蛋
          </Animated.Text>
        </Animated.View>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉" style={styles.close} onPress={onClose}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(3,3,10,0.94)",
  },
  scene: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  ringA: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
  },
  ringB: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 1,
    borderStyle: "dashed",
    opacity: 0.55,
  },
  particle: {
    position: "absolute",
    left: "50%",
    top: "46%",
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  core: {
    fontSize: 76,
    lineHeight: 84,
    textShadowRadius: 28,
    textShadowOffset: { width: 0, height: 0 },
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: spacing.xl,
    textShadowColor: "#000",
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 4 },
  },
  rarity: {
    color: colors.textMuted,
    ...typography.caption,
    marginTop: spacing.sm,
  },
  close: {
    position: "absolute",
    top: 48,
    right: 24,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: colors.text,
    fontSize: 30,
  },
});

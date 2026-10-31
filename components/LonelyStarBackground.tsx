import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

/**
 * 孤星夜空：聊天室背景特效，所有人都看得到。
 * 深藍夜空上滿天星星（靜態小星＋閃爍星），右上有一顆特別亮、
 * 帶光暈、會呼吸的「孤星」，偶爾劃過一顆流星。
 * 純裝飾：pointerEvents="none"，不擋訊息、不吃點擊。
 * 效能：靜態星只用普通 View；動畫只用 opacity／scale／translate
 *（全部走 native driver），動畫數量控制在十幾個以內。
 */

const STAR_COLORS = ["#bcd9ff", "#dceeff", "#ffffff", "#9fc2ff", "#cfe4ff"];

type StarSpec = {
  left: number;
  top: number;
  size: number;
  color: string;
  opacity: number;
};

function makeStars(count: number, w: number, h: number): StarSpec[] {
  const stars: StarSpec[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      left: Math.random() * w,
      top: Math.random() * h,
      size: 1.5 + Math.random() * 2,
      color: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
      opacity: 0.25 + Math.random() * 0.45,
    });
  }
  return stars;
}

function TwinkleStar({ spec, index }: { spec: StarSpec; index: number }) {
  const opacity = useRef(new Animated.Value(spec.opacity)).current;

  useEffect(() => {
    const duration = 1400 + (index % 5) * 400;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.2,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: spec.opacity,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: spec.left,
        top: spec.top,
        width: spec.size,
        height: spec.size,
        borderRadius: spec.size / 2,
        backgroundColor: spec.color,
        opacity,
      }}
    />
  );
}

function LonelyStar({ x, y }: { x: number; y: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });

  return (
    <View style={{ position: "absolute", left: x - 28, top: y - 28 }} pointerEvents="none">
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: "rgba(159, 194, 255, 0.10)",
          opacity: haloOpacity,
          transform: [{ scale: haloScale }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 10,
          top: 10,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: "rgba(159, 194, 255, 0.16)",
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 18,
          top: 18,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: "rgba(220, 238, 255, 0.30)",
        }}
      />
      {/* 星芒 */}
      <View
        style={{
          position: "absolute",
          left: 27,
          top: 14,
          width: 2,
          height: 28,
          borderRadius: 1,
          backgroundColor: "rgba(220, 238, 255, 0.85)",
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 14,
          top: 27,
          width: 28,
          height: 2,
          borderRadius: 1,
          backgroundColor: "rgba(220, 238, 255, 0.85)",
        }}
      />
      {/* 星核 */}
      <View
        style={{
          position: "absolute",
          left: 25.5,
          top: 25.5,
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: "#ffffff",
        }}
      />
    </View>
  );
}

function ShootingStar({ width, height }: { width: number; height: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      timer = setTimeout(
        () => {
          if (stopped) return;
          setVisible(true);
          progress.setValue(0);
          Animated.timing(progress, {
            toValue: 1,
            duration: 1100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }).start(() => {
            setVisible(false);
            schedule();
          });
        },
        9000 + Math.random() * 7000
      );
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [width * 0.72, -width * 0.28],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height * 0.06, height * 0.34],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.15, 0.85, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        opacity,
        transform: [{ translateX }, { translateY }, { rotate: "-18deg" }],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View
          style={{
            width: 64,
            height: 2,
            borderRadius: 1,
            backgroundColor: "rgba(190, 214, 255, 0.5)",
            marginRight: -1,
          }}
        />
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: "#ffffff",
          }}
        />
      </View>
    </Animated.View>
  );
}

export function LonelyStarBackground() {
  const { width, height } = useMemo(() => Dimensions.get("window"), []);

  const staticStars = useMemo(() => makeStars(60, width, height), [width, height]);
  const twinkleStars = useMemo(() => makeStars(12, width, height), [width, height]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {staticStars.map((s, i) => (
        <View
          key={`s-${i}`}
          style={{
            position: "absolute",
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            borderRadius: s.size / 2,
            backgroundColor: s.color,
            opacity: s.opacity,
          }}
        />
      ))}
      {twinkleStars.map((s, i) => (
        <TwinkleStar key={`t-${i}`} spec={s} index={i} />
      ))}
      <LonelyStar x={width * 0.82} y={height * 0.13} />
      <ShootingStar width={width} height={height} />
    </View>
  );
}

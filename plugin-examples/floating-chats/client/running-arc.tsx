import { Animated, Easing, View } from "react-native";
import { useEffect, useMemo, useRef } from "react";

/** Arco de 90° que gira para indicar um agente em execução. */
export function RunningArc({
  size,
  color,
  reducedMotion,
}: {
  size: number;
  color: string;
  trackColor: string;
  reducedMotion: boolean;
}) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;
    rotation.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 360,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, rotation]);

  const styles = useMemo(() => {
    const borderWidth = Math.max(2, Math.round(size * 0.055));
    const ring = {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth,
    };
    return {
      frame: {
        width: size,
        height: size,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      track: { ...ring, borderColor: color, opacity: 0.2 },
      arc: {
        ...ring,
        position: "absolute" as const,
        borderColor: "transparent",
        borderTopColor: color,
        borderRightColor: color,
      },
    };
  }, [size, color]);

  const rotate = useMemo(
    () => ({
      transform: [
        {
          rotate: rotation.interpolate({
            inputRange: [0, 360],
            outputRange: ["0deg", "360deg"],
          }),
        },
      ],
    }),
    [rotation],
  );

  return (
    <View style={styles.frame}>
      <View style={styles.track} />
      <Animated.View style={[styles.arc, rotate]} />
    </View>
  );
}

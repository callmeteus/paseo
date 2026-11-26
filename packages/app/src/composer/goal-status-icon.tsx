import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Target } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedTarget = withUnistyles(Target);
const accentBrightMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

/** Theme-aware goal marker with a quiet pulse while the goal is active. */
export function GoalStatusIcon({ active }: { active: boolean }) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(scale);
      scale.value = 1;
      return;
    }
    scale.value = withRepeat(
      withTiming(1.08, {
        duration: 900,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [active, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.icon, animatedStyle]} testID="composer-goal-icon">
      <ThemedTarget size={ICON_SIZE.sm} uniProps={accentBrightMapping} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: ICON_SIZE.sm,
    height: ICON_SIZE.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});

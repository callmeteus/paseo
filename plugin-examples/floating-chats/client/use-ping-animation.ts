import { AccessibilityInfo, Animated, Easing } from "react-native";
import { useEffect, useRef, useState } from "react";

const SCALE_DOWN_MS = 60;
const SCALE_UP_MS = 80;
const SETTLE_MS = 300;
const RIPPLE_MS = 600;

export interface PingAnimation {
  scale: Animated.Value;
  rippleScale: Animated.Value;
  rippleOpacity: Animated.Value;
  reducedMotion: boolean;
}

/**
 * Cria e dispara a animação de ping quando o valor de atividade aumenta.
 *
 * @param activity Marca de atividade do agente.
 * @param enabled Liga ou desliga a animação.
 * @returns Valores animados para a bolinha e a gota.
 */
export function usePingAnimation(activity: string, enabled: boolean): PingAnimation {
  const scale = useRef(new Animated.Value(1)).current;
  const rippleScale = useRef(new Animated.Value(0.6)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  const previous = useRef<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReducedMotion(value);
      return undefined;
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const last = previous.current;
    previous.current = activity;
    if (last === null || last === activity) return;
    if (!enabled || reducedMotion) return;

    scale.setValue(0.9);
    rippleScale.setValue(0.6);
    rippleOpacity.setValue(0.55);

    const squeeze = Animated.timing(scale, {
      toValue: 0.9,
      duration: SCALE_DOWN_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    const overshoot = Animated.timing(scale, {
      toValue: 1.1,
      duration: SCALE_UP_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    const settle = Animated.timing(scale, {
      toValue: 1,
      duration: SETTLE_MS,
      easing: Easing.bezier(0.3, 0, 0.2, 1),
      useNativeDriver: true,
    });
    const ripple = Animated.timing(rippleScale, {
      toValue: 1.8,
      duration: RIPPLE_MS,
      easing: Easing.bezier(0.2, 0.8, 0.3, 1),
      useNativeDriver: true,
    });
    const fade = Animated.timing(rippleOpacity, {
      toValue: 0,
      duration: RIPPLE_MS,
      easing: Easing.bezier(0.2, 0.8, 0.3, 1),
      useNativeDriver: true,
    });

    Animated.parallel([Animated.sequence([squeeze, overshoot, settle]), ripple, fade]).start();
  }, [activity, enabled, reducedMotion, scale, rippleScale, rippleOpacity]);

  return { scale, rippleScale, rippleOpacity, reducedMotion };
}

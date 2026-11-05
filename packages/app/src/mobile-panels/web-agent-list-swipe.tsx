import { useEffect, useRef, type ReactNode } from "react";
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { isWeb } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import { nextWebSwipePhase, shouldCompleteWebSwipe, type WebSwipePhase } from "./web-swipe-intent";

/** Horizontal scrollers that are already offset keep owning the drag. */
function isInsideScrolledHorizontal(target: EventTarget | null): boolean {
  let element: Element | null = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollLeft > 0) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * Web-only swipe surface for the left panel.
 *
 * Gesture Handler on the web only sees a pan once the browser yields the touch, which the
 * shell's `touchAction: "auto"` prevents. This reads pointer events directly so a finger can
 * open the drawer from anywhere in the chat. Native keeps the Gesture Handler path untouched.
 */
export function WebAgentListSwipeSurface({
  enabled,
  children,
  style,
  testID,
}: {
  enabled: boolean;
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const ref = useRef<View>(null);
  const { width: windowWidth } = useWindowDimensions();
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);
  const active = isWeb && enabled;

  useEffect(() => {
    if (!active) {
      return () => {};
    }
    const raw: unknown = ref.current;
    if (!(raw instanceof HTMLElement)) {
      return () => {};
    }
    const node = raw;

    let phase: WebSwipePhase = "idle";
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lastX = 0;
    let lastTime = 0;

    const reset = () => {
      phase = "idle";
      pointerId = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      // The mouse keeps the edge-gated Gesture Handler path so text selection is intact.
      if (event.pointerType !== "touch") return;
      if (usePanelStore.getState().mobilePanel.target !== "agent") return;
      if (isInsideScrolledHorizontal(event.target)) return;
      phase = "tracking";
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = event.timeStamp;
      lastX = event.clientX;
      lastTime = event.timeStamp;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId || phase === "cancelled") return;
      phase = nextWebSwipePhase({
        phase,
        deltaX: event.clientX - startX,
        deltaY: event.clientY - startY,
        blocked: false,
      });
      lastX = event.clientX;
      lastTime = event.timeStamp;
      if (phase === "cancelled") {
        reset();
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const elapsed = Math.max(1, lastTime - startTime);
      const velocityX = ((lastX - startX) / elapsed) * 1000;
      const shouldOpen =
        phase === "active" &&
        shouldCompleteWebSwipe({
          deltaX: lastX - startX,
          velocityX,
          windowWidth,
        });
      reset();
      if (shouldOpen) {
        showMobileAgentList();
      }
    };

    node.addEventListener("pointerdown", handlePointerDown, { passive: true });
    node.addEventListener("pointermove", handlePointerMove, { passive: true });
    node.addEventListener("pointerup", handlePointerUp, { passive: true });
    node.addEventListener("pointercancel", reset, { passive: true });
    return () => {
      node.removeEventListener("pointerdown", handlePointerDown);
      node.removeEventListener("pointermove", handlePointerMove);
      node.removeEventListener("pointerup", handlePointerUp);
      node.removeEventListener("pointercancel", reset);
    };
  }, [active, showMobileAgentList, windowWidth]);

  return (
    <View ref={ref} collapsable={false} style={style} testID={testID}>
      {children}
    </View>
  );
}

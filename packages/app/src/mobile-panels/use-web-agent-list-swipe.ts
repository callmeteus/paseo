import { useEffect, useRef } from "react";
import { View, useWindowDimensions } from "react-native";

import { isWeb } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import { nextWebSwipePhase, shouldCompleteWebSwipe, type WebSwipePhase } from "./web-swipe-intent";

/** A horizontally scrollable ancestor that is already offset keeps owning the drag. */
function isInsideScrolledHorizontal(target: EventTarget | null): boolean {
  let element: Element | null = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollLeft > 0 && element.scrollWidth > element.clientWidth) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * Web-only swipe surface for the left panel, driven by pointer events.
 *
 * Gesture Handler on the web only receives a pan once the browser yields the touch, and the
 * shell keeps `touchAction: "auto"` so horizontal scrollers inside the chat keep working. The
 * result is that no panel gesture responds to a finger. Reading pointer events directly is
 * independent of that negotiation. Native never runs this and keeps the Gesture Handler path.
 *
 * The returned ref must be attached to a plain `View`; do not make it the direct child of a
 * `GestureDetector`, which owns that child's own ref.
 */
export function useWebAgentListSwipe(enabled: boolean) {
  const ref = useRef<View>(null);
  const { width: windowWidth } = useWindowDimensions();
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);
  const active = isWeb && enabled;

  useEffect(() => {
    if (!active) {
      return () => {};
    }

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
      // The mouse keeps the edge-gated Gesture Handler path so text selection stays intact.
      if (event.pointerType !== "touch") return;
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
      if (pointerId === null || event.pointerId !== pointerId || phase === "cancelled") {
        return;
      }
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
        shouldCompleteWebSwipe({ deltaX: lastX - startX, velocityX, windowWidth });
      reset();
      if (shouldOpen) {
        showMobileAgentList();
      }
    };

    // Listen on the window: nothing in the tree can swallow the events, and the shell's own
    // node may not be the one the browser targets on a re-render.
    window.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    window.addEventListener("pointerup", handlePointerUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", reset, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", reset, { capture: true });
    };
  }, [active, showMobileAgentList, windowWidth]);

  return ref;
}

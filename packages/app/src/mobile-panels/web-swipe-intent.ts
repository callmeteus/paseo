/**
 * Web touch swipe state machine for opening the left panel.
 *
 * RNGH drives the panel gestures on native, but on the web it only receives a pan when the
 * browser gives up the touch, which depends on the wrapper's `touchAction`. The root shell
 * keeps `auto` so horizontal scrollers inside the chat keep working, so the drawer swipe is
 * handled here with plain pointer events instead.
 */

export type WebSwipePhase = "idle" | "tracking" | "active" | "cancelled";

/** Horizontal travel before the swipe claims the gesture. */
const ACTIVATION_DISTANCE = 12;
/** Vertical travel that means the reader is scrolling the transcript instead. */
const VERTICAL_TOLERANCE = 10;

export function nextWebSwipePhase(input: {
  phase: WebSwipePhase;
  deltaX: number;
  deltaY: number;
  blocked: boolean;
}): WebSwipePhase {
  if (input.phase === "cancelled" || input.phase === "idle") {
    return input.phase;
  }
  if (input.blocked) {
    return "cancelled";
  }
  const absX = Math.abs(input.deltaX);
  const absY = Math.abs(input.deltaY);
  if (absY > VERTICAL_TOLERANCE && absY >= absX) {
    return "cancelled";
  }
  // Leftward travel belongs to the explorer gesture, not this one.
  if (input.deltaX <= -VERTICAL_TOLERANCE) {
    return "cancelled";
  }
  if (input.deltaX >= ACTIVATION_DISTANCE && absX > absY) {
    return "active";
  }
  return "tracking";
}

export function shouldCompleteWebSwipe(input: {
  deltaX: number;
  velocityX: number;
  windowWidth: number;
}): boolean {
  return input.deltaX > input.windowWidth / 4 || input.velocityX > 400;
}

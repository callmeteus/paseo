import { Platform } from "react-native";

import type { OverlayBridge } from "./bridge";

declare const window: { paseoDesktop?: { overlay?: OverlayBridge } } | undefined;

/**
 * Obtém a ponte do overlay quando o plugin roda dentro do Electron.
 *
 * @returns A ponte IPC, ou null fora da web.
 */
export function getOverlayBridge(): OverlayBridge | null {
  if (Platform.OS !== "web") return null;
  if (!window) return null;
  return window.paseoDesktop?.overlay ?? null;
}

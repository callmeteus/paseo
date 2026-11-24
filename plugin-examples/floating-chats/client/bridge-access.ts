import { Platform } from "react-native";

import { getOverlayBridge as getNativeBridge } from "./native";
import { getOverlayBridge as getWebBridge } from "./web";
import type { OverlayBridge } from "./bridge";

/**
 * Obtém a ponte do overlay na plataforma atual.
 *
 * @returns A ponte IPC, ou null quando não há Electron.
 */
export function getOverlayBridge(): OverlayBridge | null {
  return Platform.OS === "web" ? getWebBridge() : getNativeBridge();
}

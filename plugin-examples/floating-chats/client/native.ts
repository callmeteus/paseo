import type { OverlayBridge } from "./bridge";

/**
 * Retorna a ponte do overlay em plataformas nativas, onde o overlay não existe.
 *
 * @returns Sempre null.
 */
export function getOverlayBridge(): OverlayBridge | null {
  return null;
}

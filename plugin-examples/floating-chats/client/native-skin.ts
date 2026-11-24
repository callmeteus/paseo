import { useEffect, useState } from "react";

import { getOverlayBridge } from "./bridge-access";
import type { OverlayAppearance } from "./bridge";

/** Tokens visuais de uma pele nativa. */
export interface NativeSkin {
  fontFamily: string;
  fontSize: number;
  cardRadius: number;
  controlRadius: number;
  controlHeight: number;
  textColor: string;
  mutedColor: string;
  surfaceColor: string;
  borderColor: string;
  accentColor: string;
  primaryFirst: boolean;
  closeOnLeft: boolean;
  unreadColor: string;
}

const NEUTRAL: NativeSkin = {
  fontFamily: "System",
  fontSize: 13,
  cardRadius: 12,
  controlRadius: 6,
  controlHeight: 30,
  textColor: "#F5F5F5",
  mutedColor: "#9CA3AF",
  surfaceColor: "#1F2023",
  borderColor: "#3A3D42",
  accentColor: "#0A84FF",
  primaryFirst: false,
  closeOnLeft: false,
  unreadColor: "#F12E2F",
};

const MAC: NativeSkin = {
  ...NEUTRAL,
  fontFamily: "System",
  fontSize: 13,
  cardRadius: 16,
  controlRadius: 6,
  controlHeight: 30,
  borderColor: "#3A3D42",
  primaryFirst: false,
  closeOnLeft: true,
  unreadColor: "#FF3B30",
};

const WINDOWS: NativeSkin = {
  ...NEUTRAL,
  fontFamily: "Segoe UI Variable",
  fontSize: 14,
  cardRadius: 8,
  controlRadius: 4,
  controlHeight: 32,
  surfaceColor: "#202020",
  borderColor: "#3B3B3B",
  primaryFirst: true,
  closeOnLeft: false,
};

const LINUX: NativeSkin = {
  ...NEUTRAL,
  fontFamily: "Noto Sans",
  fontSize: 13,
  cardRadius: 6,
  controlRadius: 4,
  controlHeight: 30,
  surfaceColor: "#2A2E32",
  borderColor: "#45494E",
  accentColor: "#3DAEE9",
  primaryFirst: true,
  closeOnLeft: false,
};

/**
 * Escolhe a pele a partir da aparência nativa.
 *
 * @param appearance Aparência lida do sistema.
 * @returns Tokens da pele correspondente.
 */
export function skinFor(appearance: OverlayAppearance | null): NativeSkin {
  if (!appearance) return NEUTRAL;
  if (appearance.platform === "darwin") return { ...MAC, accentColor: appearance.accentColor };
  if (appearance.platform === "win32") return { ...WINDOWS, accentColor: appearance.accentColor };
  if (appearance.platform === "linux") {
    return {
      ...LINUX,
      accentColor:
        appearance.accentColor && appearance.accentColor !== "#3DAEE9"
          ? appearance.accentColor
          : LINUX.accentColor,
    };
  }
  return NEUTRAL;
}

/**
 * Observa a aparência nativa edevolve a pele atual.
 *
 * @returns A pele nativa atual.
 */
export function useNativeSkin(): NativeSkin {
  const [appearance, setAppearance] = useState<OverlayAppearance | null>(null);

  useEffect(() => {
    const bridge = getOverlayBridge();
    if (!bridge?.getAppearance) return;
    let active = true;
    void bridge.getAppearance().then((value) => {
      if (active) setAppearance(value);
      return undefined;
    });
    const unsubscribe = bridge.onAppearanceChanged?.((value) => {
      if (active) setAppearance(value);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return skinFor(appearance);
}

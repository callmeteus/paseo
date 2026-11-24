import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

import { nativeTheme, systemPreferences } from "electron";

/** Material nativo aplicável à janela do popover. */
export type OverlayMaterial = "vibrancy" | "acrylic" | "none";

/** Aparência do sistema necessária para desenhar as peles do overlay. */
export interface OverlayAppearance {
  platform: NodeJS.Platform;
  material: OverlayMaterial;
  accentColor: string;
  prefersReducedMotion: boolean;
}

const DEFAULT_ACCENT = "#3DAEE9";
const FALLBACK_ACCENT = "#0A84FF";

function normalizeHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const cleaned = value.trim().replace(/^#/, "");
  if (cleaned.length === 6 && /^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  if (cleaned.length === 8 && /^[0-9a-fA-F]{8}$/.test(cleaned)) {
    return `#${cleaned.slice(2).toUpperCase()}`;
  }
  return fallback;
}

function readMacAccent(): string {
  try {
    return normalizeHex(systemPreferences.getAccentColor(), FALLBACK_ACCENT);
  } catch {
    return FALLBACK_ACCENT;
  }
}

function readWindowsAccent(): string {
  try {
    const output = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\DWM", "/v", "AccentColor"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    const match = output.match(/0x([0-9a-fA-F]{8})/);
    if (!match) return FALLBACK_ACCENT;
    const value = match[1];
    const red = value.slice(6, 8);
    const green = value.slice(4, 6);
    const blue = value.slice(2, 4);
    return normalizeHex(`#${red}${green}${blue}`, FALLBACK_ACCENT);
  } catch {
    return FALLBACK_ACCENT;
  }
}

function readLinuxAccent(): string {
  try {
    const contents = readFileSync(path.join(homedir(), ".config", "kdeglobals"), "utf8");
    const match = contents.match(/^AccentColor=([^\s#]+)/m);
    if (!match) return DEFAULT_ACCENT;
    const raw = match[1];
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
    return normalizeHex(hex, DEFAULT_ACCENT);
  } catch {
    return DEFAULT_ACCENT;
  }
}

function resolveAccentColor(currentPlatform: NodeJS.Platform): string {
  if (currentPlatform === "darwin") return readMacAccent();
  if (currentPlatform === "win32") return readWindowsAccent();
  return readLinuxAccent();
}

function resolveMaterial(currentPlatform: NodeJS.Platform): OverlayMaterial {
  if (currentPlatform === "darwin") return "vibrancy";
  if (currentPlatform === "win32") return "acrylic";
  return "none";
}

function readReducedMotion(): boolean {
  const fromNativeTheme = nativeTheme as typeof nativeTheme & {
    prefersReducedMotion?: boolean;
  };
  if (typeof fromNativeTheme.prefersReducedMotion === "boolean") {
    return fromNativeTheme.prefersReducedMotion;
  }
  try {
    const withReducedMotion = systemPreferences as typeof systemPreferences & {
      isReducedMotionEnabled?: () => boolean;
    };
    return withReducedMotion.isReducedMotionEnabled?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Lê a aparência atual do sistema para as peles do overlay.
 *
 * @returns Plataforma, material, cor de destaque e preferência de movimento.
 */
export function getOverlayAppearance(): OverlayAppearance {
  const currentPlatform = platform();
  return {
    platform: currentPlatform,
    material: resolveMaterial(currentPlatform),
    accentColor: resolveAccentColor(currentPlatform),
    prefersReducedMotion: readReducedMotion(),
  };
}

/**
 * Observa mudanças de tema e de cor de destaque do sistema.
 *
 * @param onChange Chamada com a nova aparência.
 * @returns Função que remove os observadores.
 */
export function watchOverlayAppearance(onChange: () => void): () => void {
  const onThemeUpdated = () => onChange();
  const onAccentChanged = () => onChange();

  nativeTheme.on("updated", onThemeUpdated);
  systemPreferences.on("accent-color-changed", onAccentChanged);

  return () => {
    nativeTheme.off("updated", onThemeUpdated);
    systemPreferences.off("accent-color-changed", onAccentChanged);
  };
}

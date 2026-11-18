import { useEffect, useMemo, useState } from "react";
import { getDesktopHost } from "@/desktop/host";
import { sanitizeFontFamily } from "@/hooks/use-settings";
import { isWeb } from "@/constants/platform";
import {
  resolveInstalledFace,
  suggestionsForInstalledFaces,
  type FontSuggestion,
  type InstalledFace,
} from "@/appearance/font-families";

interface LocalFont {
  family: string;
}

interface MeasuredWidths {
  wide: number;
  narrow: number;
}

const EMPTY_FACES: readonly InstalledFace[] = [];

let cachedFaces: Promise<readonly InstalledFace[]> | null = null;

export function loadInstalledFonts(): Promise<readonly InstalledFace[]> {
  if (!isWeb) return Promise.resolve(EMPTY_FACES);
  cachedFaces ??= readInstalledFonts();
  return cachedFaces;
}

export function useInstalledFontSuggestions(): {
  ui: readonly FontSuggestion[];
  mono: readonly FontSuggestion[];
} {
  const [faces, setFaces] = useState<readonly InstalledFace[]>(EMPTY_FACES);
  useEffect(() => {
    if (!isWeb) return;
    let cancelled = false;
    void (async () => {
      const loaded = await loadInstalledFonts();
      if (cancelled) return;
      setFaces(
        loaded.map((face) =>
          resolveInstalledFace(
            face,
            face.monospace === null ? measureFamilyWidths(face.family) : null,
          ),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => ({
      ui: suggestionsForInstalledFaces(faces, "ui"),
      mono: suggestionsForInstalledFaces(faces, "mono"),
    }),
    [faces],
  );
}

export function parseInstalledFaces(value: unknown): InstalledFace[] {
  if (typeof value !== "object" || value === null || !("faces" in value)) return [];
  const { faces } = value;
  if (!Array.isArray(faces)) return [];
  const parsed: InstalledFace[] = [];
  for (const entry of faces) {
    const face = parseInstalledFace(entry);
    if (face) parsed.push(face);
  }
  return parsed;
}

async function readInstalledFonts(): Promise<readonly InstalledFace[]> {
  const fromDesktop = await readDesktopInstalledFonts();
  if (fromDesktop) return fromDesktop;
  return readGrantedLocalFonts();
}

async function readDesktopInstalledFonts(): Promise<readonly InstalledFace[] | null> {
  const invoke = getDesktopHost()?.invoke;
  if (typeof invoke !== "function") return null;
  try {
    return parseInstalledFaces(await invoke("list_installed_fonts"));
  } catch {
    // The desktop build may be older than this client, or fontconfig can be missing.
    // The picker still offers Allo and a typed family.
    return [];
  }
}

async function readGrantedLocalFonts(): Promise<readonly InstalledFace[]> {
  if (typeof window === "undefined") return [];
  const query = readQueryLocalFonts(window);
  const permissions = window.navigator?.permissions;
  if (!query || !permissions?.query) return [];
  try {
    const status = await permissions.query({ name: "local-fonts" as PermissionName });
    if (status.state !== "granted") return [];
    return facesFromLocalFonts(await query());
  } catch {
    // Browsers without Local Font Access reject the permission name.
    return [];
  }
}

function readQueryLocalFonts(target: Window): (() => Promise<LocalFont[]>) | null {
  const candidate = (target as Window & { queryLocalFonts?: () => Promise<LocalFont[]> })
    .queryLocalFonts;
  return typeof candidate === "function" ? () => candidate.call(target) : null;
}

function facesFromLocalFonts(fonts: readonly LocalFont[]): InstalledFace[] {
  const families = new Set<string>();
  for (const font of fonts) {
    const family = usableFamily(font.family);
    if (family) families.add(family);
  }
  return [...families]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((family) => ({ family, monospace: null }));
}

function parseInstalledFace(value: unknown): InstalledFace | null {
  if (typeof value !== "object" || value === null || !("family" in value)) return null;
  if (typeof value.family !== "string") return null;
  const family = usableFamily(value.family);
  if (!family) return null;
  const monospace =
    "monospace" in value && typeof value.monospace === "boolean" ? value.monospace : null;
  return { family, monospace };
}

function usableFamily(value: string): string | null {
  const sanitized = sanitizeFontFamily(value);
  if (sanitized === null || sanitized.length === 0) return null;
  return sanitized;
}

function measureFamilyWidths(family: string): MeasuredWidths | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const quoted = family.includes(" ") ? `'${family.replaceAll("'", "\\'")}'` : family;
  context.font = `72px ${quoted}`;
  return {
    wide: context.measureText("WWW").width,
    narrow: context.measureText("iii").width,
  };
}

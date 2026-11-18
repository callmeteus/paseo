import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LIST_TIMEOUT_MS = 8_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_FAMILY_LENGTH = 200;

const MAC_FONT_LIST = [
  "import AppKit",
  "NSFontManager.shared.availableFontFamilies.forEach { print($0) }",
].join("\n");

const WINDOWS_FONT_LIST = [
  "Add-Type -AssemblyName System.Drawing",
  "[System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name }",
].join("; ");

export interface InstalledFace {
  family: string;
  /** Null when the platform list does not say whether the face is monospace. */
  monospace: boolean | null;
}

export interface ExecFileResult {
  stdout: string;
}

export type ExecFileText = (file: string, args: readonly string[]) => Promise<ExecFileResult>;

/**
 * `%{family}` is the typographic family followed by style-specific names
 * (`Ubuntu, Ubuntu Light`). The style names are the same face again.
 */
export function parseFontconfigFamilies(stdout: string): InstalledFace[] {
  const byFamily = new Map<string, { mono: boolean; proportional: boolean }>();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const tab = line.indexOf("\t");
    const familyField = tab === -1 ? line : line.slice(0, tab);
    const spacing = tab === -1 ? "" : line.slice(tab + 1).trim();
    const family = primaryFamily(familyField);
    if (!family) continue;
    const current = byFamily.get(family) ?? { mono: false, proportional: false };
    if (spacing === "100" || spacing === "110") current.mono = true;
    else current.proportional = true;
    byFamily.set(family, current);
  }
  return [...byFamily.entries()]
    .map(([family, flags]) => ({
      family,
      monospace: classifySpacing(flags),
    }))
    .sort(compareFamilies);
}

export function parseFontNameList(stdout: string): InstalledFace[] {
  const families = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const family = primaryFamily(line);
    if (family) families.add(family);
  }
  return [...families]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((family) => ({ family, monospace: null }));
}

export async function listInstalledFonts(input: {
  platform: NodeJS.Platform;
  execFile: ExecFileText;
}): Promise<InstalledFace[]> {
  if (input.platform === "linux") {
    const { stdout } = await input.execFile("fc-list", ["-f", "%{family}\t%{spacing}\n"]);
    return parseFontconfigFamilies(stdout);
  }
  if (input.platform === "darwin") {
    return listDarwinFonts(input.execFile);
  }
  if (input.platform === "win32") {
    const { stdout } = await input.execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WINDOWS_FONT_LIST,
    ]);
    return parseFontNameList(stdout);
  }
  return [];
}

export function execFileText(file: string, args: readonly string[]): Promise<ExecFileResult> {
  return execFileAsync(file, [...args], {
    encoding: "utf-8",
    timeout: LIST_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  });
}

function classifySpacing(flags: { mono: boolean; proportional: boolean }): boolean | null {
  if (flags.mono && !flags.proportional) return true;
  if (flags.proportional && !flags.mono) return false;
  return null;
}

async function listDarwinFonts(exec: ExecFileText): Promise<InstalledFace[]> {
  try {
    const { stdout } = await exec("fc-list", ["-f", "%{family}\t%{spacing}\n"]);
    const parsed = parseFontconfigFamilies(stdout);
    if (parsed.length > 0) return parsed;
  } catch (error) {
    if (!isMissingCommand(error)) throw error;
  }
  const { stdout } = await exec("swift", ["-e", MAC_FONT_LIST]);
  return parseFontNameList(stdout);
}

function isMissingCommand(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function primaryFamily(field: string): string | null {
  const family = field.split(",")[0]?.trim() ?? "";
  if (family.length === 0 || family.length > MAX_FAMILY_LENGTH) return null;
  if (/[;{}<>()[\]/*]/.test(family)) return null;
  if ([...family].some((char) => char.charCodeAt(0) <= 0x1f)) return null;
  return family;
}

function compareFamilies(left: InstalledFace, right: InstalledFace): number {
  return left.family.localeCompare(right.family, undefined, { sensitivity: "base" });
}

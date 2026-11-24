import { BrowserWindow } from "electron";

import type { OverlayPreset } from "./overlay-window.js";
import type { OverlayAppearance } from "./overlay-appearance.js";

/** Tipo de conteúdo exibido no popover. */
export type OverlayPopoverKind = "tooltip" | "message" | "awaitingInput";

/** Tamanho desejado do popover em pixels lógicos. */
export interface OverlayPopoverSize {
  width: number;
  height: number;
}

/** Entrada para calcular a posição do popover. */
export interface ResolvePopoverBoundsInput {
  workArea: Electron.Rectangle;
  anchor: Electron.Rectangle;
  size: OverlayPopoverSize;
  preset: OverlayPreset;
}

/** Entrada para criar a janela do popover. */
export interface CreatePopoverWindowInput {
  preloadPath: string;
  additionalArguments?: string[];
  appearance: OverlayAppearance;
  backgroundColor: string;
}

const GAP = 10;
const MAX_POPOVER_WIDTH = 420;
const MAX_POPOVER_HEIGHT = 520;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Calcula os limites do popover ancorado na bolinha.
 *
 * @param input Work area, retângulo da bolinha, tamanho e preset da tira.
 * @returns Retângulo limitado à work area.
 */
export function resolvePopoverBounds(input: ResolvePopoverBoundsInput): Electron.Rectangle {
  const { workArea, anchor, preset } = input;
  const width = Math.min(
    Math.max(1, Math.round(input.size.width)),
    MAX_POPOVER_WIDTH,
    workArea.width,
  );
  const height = Math.min(
    Math.max(1, Math.round(input.size.height)),
    MAX_POPOVER_HEIGHT,
    workArea.height,
  );

  const opensRight = preset === "top-left" || preset === "bottom-left";
  let x = opensRight ? anchor.x + anchor.width + GAP : anchor.x - width - GAP;
  let y = anchor.y + Math.round((anchor.height - height) / 2);

  if (preset === "top-center") {
    x = anchor.x + Math.round((anchor.width - width) / 2);
    y = anchor.y + anchor.height + GAP;
  }

  if (preset === "bottom-center") {
    x = anchor.x + Math.round((anchor.width - width) / 2);
    y = anchor.y - height - GAP;
  }

  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

/**
 * Cria a janela reutilizável do popover com material nativo.
 *
 * @param input Preload, argumentos e aparência do sistema.
 * @returns A janela criada, ainda oculta.
 */
export function createPopoverWindow(input: CreatePopoverWindowInput): BrowserWindow {
  const nativeOptions: Electron.BrowserWindowConstructorOptions = {};

  if (input.appearance.platform === "darwin") {
    nativeOptions.vibrancy = "hud";
    nativeOptions.visualEffectState = "active";
    nativeOptions.roundedCorners = true;
    nativeOptions.transparent = true;
  } else if (input.appearance.platform === "win32") {
    nativeOptions.backgroundMaterial = "acrylic";
  }

  const win = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    frame: false,
    backgroundColor: input.backgroundColor,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    fullscreenable: false,
    focusable: false,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      ...(input.additionalArguments ? { additionalArguments: input.additionalArguments } : {}),
    },
    ...nativeOptions,
  });

  if (input.appearance.platform === "darwin") {
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true);
  }

  return win;
}

/**
 * Reposiciona o popover ancorado na bolinha.
 *
 * @param win Janela do popover.
 * @param input Work area, âncora, tamanho e preset.
 */
export function placePopoverWindow(win: BrowserWindow, input: ResolvePopoverBoundsInput): void {
  if (win.isDestroyed()) return;
  win.setBounds(resolvePopoverBounds(input));
}

/**
 * Mostra o popover sem roubar o foco.
 *
 * @param win Janela do popover.
 * @param focusable Se verdadeiro, a janela aceita teclado para responder perguntas.
 */
export function showPopoverWindow(win: BrowserWindow, focusable: boolean): void {
  if (win.isDestroyed()) return;
  win.setFocusable(focusable);
  if (!win.isVisible()) win.showInactive();
}

/**
 * Fecha o popover.
 *
 * @param win Janela do popover.
 */
export function closePopoverWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.hide();
}

/**
 * Destrói a janela do popover com segurança.
 *
 * @param win Janela do popover.
 */
export function destroyPopoverWindow(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.destroy();
}

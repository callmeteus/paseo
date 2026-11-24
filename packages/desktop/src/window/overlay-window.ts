import { BrowserWindow, screen } from "electron";

/** Posições possíveis da tira de chats flutuantes. */
export const OVERLAY_PRESETS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
] as const;

/** Posição da tira na área útil do display. */
export type OverlayPreset = (typeof OVERLAY_PRESETS)[number];

/** Modo de renderização da screen do plugin dentro da janela overlay. */
export type OverlayMode = "strip" | "popover";

/** Tamanho da tira em pixels lógicos. */
export interface OverlaySize {
  width: number;
  height: number;
}

/** Parâmetros de posicionamento da tira na work area. */
export interface OverlayPositionInput {
  workArea: Electron.Rectangle;
  preset: OverlayPreset;
  margin: number;
  cornerOffset: number;
  size: OverlaySize;
}

/** Entrada para criar a janela da tira. */
export interface CreateOverlayWindowInput {
  preloadPath: string;
  backgroundColor: string;
  additionalArguments?: string[];
  iconPath?: string;
}

/** Entrada para carregar a screen do plugin na janela. */
export interface LoadOverlayRouteInput {
  devServerUrl: string;
  isPackaged: boolean;
  serverId: string;
  pluginId: string;
  surfaceId: string;
  mode: OverlayMode;
  /** Query params extras, such as the popover kind and agent id. */
  extra?: string;
}

const MAX_MARGIN = 320;
const MAX_CORNER_OFFSET = 600;

/**
 * Valida um preset vindo de IPC ou de configuração persistida.
 *
 * @param value Valor bruto a validar.
 * @returns O preset normalizado, ou null quando inválido.
 */
export function readOverlayPreset(value: unknown): OverlayPreset | null {
  return typeof value === "string" && isOverlayPreset(value) ? value : null;
}

/**
 * Verifica se um valor é um preset conhecido.
 *
 * @param value Valor a verificar.
 * @returns Verdadeiro quando o valor é um preset válido.
 */
export function isOverlayPreset(value: string): value is OverlayPreset {
  return OVERLAY_PRESETS.some((preset) => preset === value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function readFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Calcula os limites da tira dentro da área útil do display.
 *
 * @param input Work area, preset, margens e tamanho da tira.
 * @returns Retângulo já limitado à work area.
 */
export function resolveOverlayBounds(input: OverlayPositionInput): Electron.Rectangle {
  //#region Normalização
  const { workArea, preset } = input;
  const margin = clamp(readFinite(input.margin, 0), 0, MAX_MARGIN);
  const cornerOffset = clamp(readFinite(input.cornerOffset, 0), 0, MAX_CORNER_OFFSET);
  const width = Math.max(1, Math.round(readFinite(input.size.width, 64)));
  const height = Math.max(1, Math.round(readFinite(input.size.height, 64)));
  //#endregion

  //#region Eixo horizontal
  let x = workArea.x + margin;
  if (preset === "top-right" || preset === "bottom-right") {
    x = workArea.x + workArea.width - margin - width;
  } else if (preset === "top-center" || preset === "bottom-center") {
    x = workArea.x + Math.round((workArea.width - width) / 2);
  }
  //#endregion

  //#region Eixo vertical
  let y = workArea.y + margin;
  if (preset === "bottom-left" || preset === "bottom-right") {
    y = workArea.y + workArea.height - margin - cornerOffset - height;
  } else if (preset === "bottom-center") {
    y = workArea.y + workArea.height - margin - height;
  } else if (preset === "top-left" || preset === "top-right") {
    y += cornerOffset;
  }
  //#endregion

  //#region Limitação à work area
  const boundedWidth = Math.min(width, workArea.width);
  const boundedHeight = Math.min(height, workArea.height);
  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - boundedWidth),
    y: clamp(y, workArea.y, workArea.y + workArea.height - boundedHeight),
    width: boundedWidth,
    height: boundedHeight,
  };
  //#endregion
}

/**
 * Cria a janela transparente da tira de chats.
 *
 * @param input Caminho do preload, cor de fundo e argumentos adicionais.
 * @returns A janela criada, ainda oculta.
 */
export function createOverlayWindow(input: CreateOverlayWindowInput): BrowserWindow {
  //#region Opções da janela
  const win = new BrowserWindow({
    width: 64,
    height: 64,
    minWidth: 48,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      ...(input.additionalArguments ? { additionalArguments: input.additionalArguments } : {}),
    },
    ...(input.iconPath ? { icon: input.iconPath } : {}),
  });
  //#endregion

  //#region Ajustes por plataforma
  if (process.platform === "darwin") {
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true);
  }
  //#endregion

  return win;
}

/**
 * Posiciona a janela da tira usando a work area do display primário.
 *
 * @param win Janela da tira.
 * @param input Preset, margens e tamanho atual da tira.
 */
export function positionOverlayWindow(
  win: BrowserWindow,
  input: Omit<OverlayPositionInput, "workArea">,
): void {
  if (win.isDestroyed()) return;
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = resolveOverlayBounds({ ...input, workArea });
  win.setBounds(bounds);
}

/**
 * Redimensiona a tira e a reposiciona para manter o mesmo canto.
 *
 * @param win Janela da tira.
 * @param input Novo tamanho e parâmetros de posicionamento.
 */
export function resizeOverlayWindow(
  win: BrowserWindow,
  input: Omit<OverlayPositionInput, "workArea">,
): void {
  positionOverlayWindow(win, input);
}

/**
 * Monta a URL da screen do plugin na janela da tira ou do popover.
 *
 * @param input Identificadores da screen, modo e query params extras.
 * @returns A URL final carregada pela janela.
 */
export function buildOverlayUrl(
  input: Omit<LoadOverlayRouteInput, "extra"> & { extra?: string },
): string {
  const route = `/h/${encodeURIComponent(input.serverId)}/plugin/${encodeURIComponent(
    input.pluginId,
  )}/sidebar/${encodeURIComponent(input.surfaceId)}?overlay=${input.mode}${input.extra ?? ""}`;
  return input.isPackaged
    ? `paseo://app${route}`
    : new URL(route, `${input.devServerUrl}/`).toString();
}

/**
 * Carrega a screen do plugin na janela da tira ou do popover.
 *
 * @param win Janela de destino.
 * @param input Identificadores da screen e modo de renderização.
 * @returns Promise resolvida quando a navegação termina.
 */
export async function loadOverlayRoute(
  win: BrowserWindow,
  input: LoadOverlayRouteInput,
): Promise<void> {
  await win.loadURL(buildOverlayUrl(input));
}

/**
 * Mostra a tira sem roubar o foco do aplicativo ativo.
 *
 * @param win Janela da tira.
 */
export function showOverlayWindow(win: BrowserWindow): void {
  if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
}

/**
 * Esconde a tira.
 *
 * @param win Janela da tira.
 */
export function hideOverlayWindow(win: BrowserWindow): void {
  if (!win.isDestroyed() && win.isVisible()) win.hide();
}

/**
 * Alterna a visibilidade da tira.
 *
 * @param win Janela da tira.
 * @returns Verdadeiro quando a tira ficou visível.
 */
export function toggleOverlayWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  if (win.isVisible()) {
    win.hide();
    return false;
  }
  win.showInactive();
  return true;
}

/**
 * Destrói a janela da tira com segurança.
 *
 * @param win Janela da tira.
 */
export function destroyOverlayWindow(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.destroy();
}

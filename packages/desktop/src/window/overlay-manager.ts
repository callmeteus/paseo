import { BrowserWindow, ipcMain, screen } from "electron";

import { type DesktopSettingsStore, type OverlaySettings } from "../settings/desktop-settings.js";
import { getOverlayAppearance, watchOverlayAppearance } from "./overlay-appearance.js";
import {
  type CreatePopoverWindowInput,
  type OverlayPopoverKind,
  type OverlayPopoverSize,
  closePopoverWindow,
  createPopoverWindow,
  destroyPopoverWindow,
  placePopoverWindow,
  showPopoverWindow,
} from "./overlay-popover-window.js";
import {
  type OverlayMode,
  type OverlayPreset,
  createOverlayWindow,
  destroyOverlayWindow,
  hideOverlayWindow,
  loadOverlayRoute,
  positionOverlayWindow,
  readOverlayPreset,
  resizeOverlayWindow,
  showOverlayWindow,
} from "./overlay-window.js";

/** Dependências injetadas pelo processo principal. */
export interface OverlayManagerDeps {
  settings: DesktopSettingsStore;
  preloadPath: string;
  additionalArguments: string[];
  backgroundColor: string;
  devServerUrl: string;
  isPackaged: boolean;
  pluginId: string;
  surfaceId: string;
  openAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
  openNewChat: () => Promise<void>;
}

/** Entrada validada para abrir o popover. */
interface OpenPopoverInput {
  kind: OverlayPopoverKind;
  agentId: string;
  anchor: Electron.Rectangle;
  size: OverlayPopoverSize;
}

const DEFAULT_STRIP_SIZE = { width: 72, height: 320 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositive(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.round(value);
}

function readRectangle(value: unknown): Electron.Rectangle | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function readSize(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null;
  const { width, height } = value;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function readPopoverKind(value: unknown): OverlayPopoverKind | null {
  if (value === "tooltip" || value === "message" || value === "awaitingInput") {
    return value;
  }
  return null;
}

function readOpenPopoverInput(value: unknown): OpenPopoverInput | null {
  if (!isRecord(value)) return null;
  const kind = readPopoverKind(value.kind);
  const agentId = typeof value.agentId === "string" ? value.agentId.trim() : "";
  const anchor = readRectangle(value.anchor);
  const sizeRecord = isRecord(value.size) ? value.size : null;
  if (!kind || !agentId || !anchor || !sizeRecord) return null;
  return {
    kind,
    agentId,
    anchor,
    size: {
      width: readPositive(sizeRecord.width, 320),
      height: readPositive(sizeRecord.height, 200),
    },
  };
}

/**
 * Cria o gerenciador das janelas do overlay e registra os handlers IPC.
 *
 * @param input Dependências do processo principal.
 * @returns Gerenciador com método `dispose` para encerrar observadores e janelas.
 */
export function createOverlayManager(input: OverlayManagerDeps) {
  let strip: BrowserWindow | null = null;
  let popover: BrowserWindow | null = null;
  let stripSize = { ...DEFAULT_STRIP_SIZE };
  let currentPreset: OverlayPreset = "top-right";
  let popoverInput: OpenPopoverInput | null = null;

  const appearance = getOverlayAppearance();

  async function config(): Promise<OverlaySettings> {
    return input.settings.get().then((settings) => settings.overlay);
  }

  async function route(serverId: string, mode: OverlayMode, extra = ""): Promise<string> {
    const base = `/h/${encodeURIComponent(serverId)}/plugin/${encodeURIComponent(
      input.pluginId,
    )}/sidebar/${encodeURIComponent(input.surfaceId)}?overlay=${mode}`;
    return input.isPackaged ? `paseo://app${base}${extra}` : `${input.devServerUrl}${base}${extra}`;
  }

  async function ensureStrip(): Promise<BrowserWindow> {
    if (strip && !strip.isDestroyed()) return strip;
    const settings = await config();
    currentPreset = settings.position;
    const win = createOverlayWindow({
      preloadPath: input.preloadPath,
      backgroundColor: input.backgroundColor,
      additionalArguments: input.additionalArguments,
    });
    strip = win;
    win.on("closed", () => {
      if (strip === win) strip = null;
    });
    const serverId = settings.serverId ?? "local";
    await loadOverlayRoute(win, {
      devServerUrl: input.devServerUrl,
      isPackaged: input.isPackaged,
      serverId,
      pluginId: input.pluginId,
      surfaceId: input.surfaceId,
      mode: "strip",
    });
    positionOverlayWindow(win, {
      preset: currentPreset,
      margin: settings.margin,
      cornerOffset: settings.cornerOffset,
      size: stripSize,
    });
    return win;
  }

  function closePopover(): void {
    if (popover) {
      closePopoverWindow(popover);
    }
    popoverInput = null;
  }

  function placePopover(): void {
    if (!popover || !popoverInput || !strip || strip.isDestroyed()) return;
    const stripBounds = strip.getBounds();
    const anchor: Electron.Rectangle = {
      x: stripBounds.x + popoverInput.anchor.x,
      y: stripBounds.y + popoverInput.anchor.y,
      width: popoverInput.anchor.width,
      height: popoverInput.anchor.height,
    };
    placePopoverWindow(popover, {
      workArea: screen.getPrimaryDisplay().workArea,
      anchor,
      size: popoverInput.size,
      preset: currentPreset,
    });
  }

  async function ensurePopover(next: OpenPopoverInput): Promise<BrowserWindow> {
    const needsNewWindow = !popover || popover.isDestroyed();
    if (needsNewWindow) {
      const popoverInputForWindow: CreatePopoverWindowInput = {
        preloadPath: input.preloadPath,
        additionalArguments: input.additionalArguments,
        appearance,
        backgroundColor: input.backgroundColor,
      };
      popover = createPopoverWindow(popoverInputForWindow);
      popover.on("closed", () => {
        popover = null;
      });
    }
    popoverInput = next;
    placePopover();
    const activePopover = popover;
    if (!activePopover || activePopover.isDestroyed()) {
      throw new Error("Falha ao criar a janela do popover");
    }
    const settings = await config();
    const serverId = settings.serverId ?? "local";
    const extra = `&kind=${encodeURIComponent(next.kind)}&agentId=${encodeURIComponent(next.agentId)}`;
    const target = await route(serverId, "popover", extra);
    if (activePopover.webContents.getURL() !== target) {
      await loadOverlayRoute(activePopover, {
        devServerUrl: input.devServerUrl,
        isPackaged: input.isPackaged,
        serverId,
        pluginId: input.pluginId,
        surfaceId: input.surfaceId,
        mode: "popover",
      });
    }
    showPopoverWindow(activePopover, next.kind === "awaitingInput");
    return activePopover;
  }

  async function applyPosition(settings: OverlaySettings): Promise<void> {
    currentPreset = settings.position;
    if (strip && !strip.isDestroyed()) {
      positionOverlayWindow(strip, {
        preset: settings.position,
        margin: settings.margin,
        cornerOffset: settings.cornerOffset,
        size: stripSize,
      });
    }
    closePopover();
  }

  function registerHandlers(): void {
    ipcMain.handle("paseo:overlay:show", async () => {
      const win = await ensureStrip();
      showOverlayWindow(win);
    });

    ipcMain.handle("paseo:overlay:hide", () => {
      closePopover();
      if (strip) hideOverlayWindow(strip);
    });

    ipcMain.handle("paseo:overlay:toggle", async () => {
      if (strip && strip.isVisible()) {
        closePopover();
        hideOverlayWindow(strip);
        return false;
      }
      const win = await ensureStrip();
      showOverlayWindow(win);
      return true;
    });

    ipcMain.handle("paseo:overlay:getConfig", async () => config());

    ipcMain.handle("paseo:overlay:setConfig", async (_event, patch: unknown) => {
      const next = await input.settings.patch({ overlay: patch });
      await applyPosition(next.overlay);
      return next.overlay;
    });

    ipcMain.handle("paseo:overlay:setPosition", async (_event, value: unknown) => {
      const preset = readOverlayPreset(value);
      if (!preset) return config();
      const next = await input.settings.patch({ overlay: { position: preset } });
      await applyPosition(next.overlay);
      return next.overlay;
    });

    ipcMain.handle("paseo:overlay:resizeStrip", async (_event, value: unknown) => {
      const size = readSize(value);
      if (!size) return;
      stripSize = { width: size.width, height: size.height };
      if (strip) {
        const settings = await config();
        resizeOverlayWindow(strip, {
          preset: currentPreset,
          margin: settings.margin,
          cornerOffset: settings.cornerOffset,
          size: stripSize,
        });
      }
    });

    ipcMain.handle("paseo:overlay:openPopover", async (_event, value: unknown) => {
      const parsed = readOpenPopoverInput(value);
      if (!parsed) return;
      await ensurePopover(parsed);
    });

    ipcMain.handle("paseo:overlay:resizePopover", (_event, value: unknown) => {
      const size = readSize(value);
      if (!size || !popoverInput) return;
      popoverInput = {
        ...popoverInput,
        size: { width: size.width, height: size.height },
      };
      placePopover();
    });

    ipcMain.handle("paseo:overlay:closePopover", () => closePopover());

    ipcMain.handle("paseo:overlay:openAgent", async (_event, value: unknown) => {
      if (!isRecord(value)) return;
      const agentId = typeof value.agentId === "string" ? value.agentId.trim() : "";
      const serverId = typeof value.serverId === "string" ? value.serverId.trim() : "";
      if (!agentId || !serverId) return;
      closePopover();
      await input.openAgent({ serverId, agentId });
    });

    ipcMain.handle("paseo:overlay:openNewChat", async () => {
      closePopover();
      await input.openNewChat();
    });

    ipcMain.handle("paseo:overlay:getAppearance", () => getOverlayAppearance());
  }

  //#region Lifecycle
  registerHandlers();
  const stopWatching = watchOverlayAppearance(() => {
    for (const win of [strip, popover]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send("paseo:overlay:appearanceChanged", getOverlayAppearance());
      }
    }
  });

  return {
    async show(): Promise<void> {
      showOverlayWindow(await ensureStrip());
    },
    hide(): void {
      closePopover();
      if (strip) hideOverlayWindow(strip);
    },
    dispose(): void {
      stopWatching();
      closePopover();
      if (popover) destroyPopoverWindow(popover);
      if (strip) destroyOverlayWindow(strip);
      popover = null;
      strip = null;
    },
  };
  //#endregion
}

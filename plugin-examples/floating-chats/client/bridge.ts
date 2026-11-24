/** Configuração persistida do overlay. */
export interface OverlayConfig {
  enabled: boolean;
  position:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center";
  margin: number;
  cornerOffset: number;
  animations: boolean;
  messagePreviews: boolean;
  stickyAwaitingInput: boolean;
  serverId: string | null;
  hiddenAgentIds: string[];
}

/** Aparência nativa usada pelas peles do popover. */
export interface OverlayAppearance {
  platform: string;
  material: "vibrancy" | "acrylic" | "none";
  accentColor: string;
  prefersReducedMotion: boolean;
}

/** Retângulo usado para ancorar o popover. */
export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ponte IPC do overlay exposta pelo preload do Electron. */
export interface OverlayBridge {
  show(): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<boolean>;
  getConfig(): Promise<OverlayConfig>;
  setConfig(patch: Partial<OverlayConfig>): Promise<OverlayConfig>;
  setPosition(preset: OverlayConfig["position"]): Promise<OverlayConfig>;
  resizeStrip(size: { width: number; height: number }): Promise<void>;
  openPopover(input: {
    kind: "tooltip" | "message" | "awaitingInput";
    agentId: string;
    anchor: OverlayRect;
    size: { width: number; height: number };
  }): Promise<void>;
  resizePopover(size: { width: number; height: number }): Promise<void>;
  closePopover(): Promise<void>;
  openAgent(input: { serverId: string; agentId: string }): Promise<void>;
  openNewChat(): Promise<void>;
  getAppearance(): Promise<OverlayAppearance>;
  onAppearanceChanged(handler: (appearance: OverlayAppearance) => void): () => void;
}

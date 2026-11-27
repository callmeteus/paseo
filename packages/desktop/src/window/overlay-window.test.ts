import { describe, expect, it } from "vitest";

import {
  OVERLAY_PRESETS,
  buildOverlayUrl,
  isOverlayPreset,
  readOverlayPreset,
  resolveOverlayBounds,
} from "./overlay-window";

const WORK_AREA: Electron.Rectangle = {
  x: 100,
  y: 50,
  width: 1800,
  height: 1000,
};

const SIZE = { width: 64, height: 480 };

function boundsFor(preset: (typeof OVERLAY_PRESETS)[number], cornerOffset = 72) {
  return resolveOverlayBounds({
    workArea: WORK_AREA,
    preset,
    margin: 24,
    cornerOffset,
    size: SIZE,
  });
}

describe("overlay window presets", () => {
  it("has the six positions from the design", () => {
    expect([...OVERLAY_PRESETS]).toEqual([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "top-center",
      "bottom-center",
    ]);
  });

  it("validates presets coming from config and IPC", () => {
    expect(readOverlayPreset("top-right")).toBe("top-right");
    expect(readOverlayPreset("middle-left")).toBeNull();
    expect(readOverlayPreset(42)).toBeNull();
    expect(isOverlayPreset("bottom-center")).toBe(true);
    expect(isOverlayPreset("nope")).toBe(false);
  });
});

describe("buildOverlayUrl", () => {
  const base = {
    devServerUrl: "http://localhost:19006",
    isPackaged: false,
    serverId: "srv_123",
    pluginId: "floating-chats",
    surfaceId: "overlay",
  };

  it("includes the popover kind and agent id with the param prefix", () => {
    const url = buildOverlayUrl({
      ...base,
      mode: "popover",
      extra: "&param.kind=tooltip&param.agentId=agent_42",
    });
    expect(url).toContain("?overlay=popover&param.kind=tooltip&param.agentId=agent_42");
  });

  it("keeps the strip url free of popover params", () => {
    const url = buildOverlayUrl({ ...base, mode: "strip" });
    expect(url).toContain("?overlay=strip");
    expect(url).not.toContain("kind=");
    expect(url).not.toContain("agentId=");
  });

  it("uses the paseo scheme when packaged", () => {
    const url = buildOverlayUrl({
      ...base,
      isPackaged: true,
      mode: "popover",
      extra: "&param.kind=message&param.agentId=agent_9",
    });
    expect(url).toBe(
      "paseo://app/h/srv_123/plugin/floating-chats/sidebar/overlay?overlay=popover&param.kind=message&param.agentId=agent_9",
    );
  });
});

describe("resolveOverlayBounds", () => {
  it("applies margin and corner offset in the top corners", () => {
    const topLeft = boundsFor("top-left");
    expect(topLeft.x).toBe(124);
    expect(topLeft.y).toBe(146);

    const topRight = boundsFor("top-right");
    expect(topRight.x).toBe(100 + 1800 - 24 - SIZE.width);
    expect(topRight.y).toBe(146);
  });

  it("applies margin and corner offset in the bottom corners", () => {
    const bottomLeft = boundsFor("bottom-left");
    expect(bottomLeft.x).toBe(124);
    expect(bottomLeft.y).toBe(50 + 1000 - 24 - 72 - SIZE.height);

    const bottomRight = boundsFor("bottom-right");
    expect(bottomRight.x).toBe(100 + 1800 - 24 - SIZE.width);
    expect(bottomRight.y).toBe(50 + 1000 - 24 - 72 - SIZE.height);
  });

  it("centers horizontally and ignores corner offset in the middle presets", () => {
    const withOffset = boundsFor("top-center", 72);
    const withoutOffset = boundsFor("top-center", 0);
    expect(withOffset.x).toBe(100 + Math.round((1800 - SIZE.width) / 2));
    expect(withOffset.y).toBe(74);
    expect(withoutOffset.y).toBe(74);
    expect(boundsFor("bottom-center").y).toBe(50 + 1000 - 24 - SIZE.height);
  });

  it("clamps oversized strips inside the work area", () => {
    const bounds = resolveOverlayBounds({
      workArea: WORK_AREA,
      preset: "top-right",
      margin: 24,
      cornerOffset: 72,
      size: { width: 4000, height: 4000 },
    });
    expect(bounds.x).toBe(WORK_AREA.x);
    expect(bounds.y).toBe(WORK_AREA.y);
    expect(bounds.width).toBe(WORK_AREA.width);
    expect(bounds.height).toBe(WORK_AREA.height);
  });

  it("clamps negative and non-finite margins", () => {
    const bounds = resolveOverlayBounds({
      workArea: WORK_AREA,
      preset: "top-left",
      margin: Number.NaN,
      cornerOffset: -20,
      size: SIZE,
    });
    expect(bounds.x).toBe(100);
    expect(bounds.y).toBe(50);
  });
});

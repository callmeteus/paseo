import { describe, expect, it } from "vitest";
import { DESKTOP_WINDOW_CONTROLS_HEIGHT } from "@/constants/layout";
import {
  desktopWindowControlsHeight,
  getDesktopWindowControlsPresentation,
} from "./window-chrome-presentation";

describe("getDesktopWindowControlsPresentation", () => {
  it("covers the header rule under minimize, maximize and close", () => {
    for (const mode of ["custom-linux", "custom-windows"] as const) {
      const presentation = getDesktopWindowControlsPresentation(mode);
      expect(presentation.controlHeight).toBe(DESKTOP_WINDOW_CONTROLS_HEIGHT);
      expect(presentation.railHeight).toBe(DESKTOP_WINDOW_CONTROLS_HEIGHT);
    }
  });

  it("leaves the host tab rail rule visible under the window controls", () => {
    expect(
      desktopWindowControlsHeight({
        controlHeight: DESKTOP_WINDOW_CONTROLS_HEIGHT,
        hostTabsRailVisible: true,
      }),
    ).toBe(DESKTOP_WINDOW_CONTROLS_HEIGHT - 1);
    expect(
      desktopWindowControlsHeight({
        controlHeight: DESKTOP_WINDOW_CONTROLS_HEIGHT,
        hostTabsRailVisible: false,
      }),
    ).toBe(DESKTOP_WINDOW_CONTROLS_HEIGHT);
  });
});

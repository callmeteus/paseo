import { describe, expect, it } from "vitest";
import { DESKTOP_WINDOW_CONTROLS_HEIGHT } from "@/constants/layout";
import { getDesktopWindowControlsPresentation } from "./window-chrome-presentation";

describe("getDesktopWindowControlsPresentation", () => {
  it("covers the header rule under minimize, maximize and close", () => {
    for (const mode of ["custom-linux", "custom-windows"] as const) {
      const presentation = getDesktopWindowControlsPresentation(mode);
      expect(presentation.controlHeight).toBe(DESKTOP_WINDOW_CONTROLS_HEIGHT);
      expect(presentation.railHeight).toBe(DESKTOP_WINDOW_CONTROLS_HEIGHT);
    }
  });
});

import { describe, expect, it } from "vitest";
import { formatContextPercentage } from "./context-window-meter.utils";

describe("context window meter formatting", () => {
  it.skipIf(Intl.NumberFormat.supportedLocalesOf(["fr"]).length === 0)(
    "localizes percentages without hiding context overflow",
    () => {
      expect(formatContextPercentage(125, "en")).toBe("125%");
      expect(formatContextPercentage(42, "fr")).toBe("42\u00a0%");
    },
  );
});

import { describe, expect, it } from "vitest";
import { nextFrozenPreview, type FrozenPreview } from "./frozen-preview";

describe("nextFrozenPreview", () => {
  const first: FrozenPreview = { text: "# Plano" };

  it("captures the text when the preview opens", () => {
    expect(nextFrozenPreview(null, { active: true, text: "# Plano" })).toEqual(first);
  });

  it("keeps the captured text when the file changes on disk", () => {
    expect(nextFrozenPreview(first, { active: true, text: "# Plano novo" })).toBe(first);
  });

  it("forgets the text once the preview is left, so reopening re-reads it", () => {
    expect(nextFrozenPreview(first, { active: false, text: "# Plano novo" })).toBeNull();
    expect(nextFrozenPreview(null, { active: true, text: "atual" })).toEqual({ text: "atual" });
  });

  it("waits for the first read", () => {
    expect(nextFrozenPreview(null, { active: true, text: undefined })).toBeNull();
  });
});

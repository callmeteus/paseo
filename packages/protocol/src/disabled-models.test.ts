import { describe, expect, it } from "vitest";
import { omitDisabledModels, retainDisabledModelIds } from "./disabled-models.js";

describe("omitDisabledModels", () => {
  it("returns only the models that are still enabled and leaves the source catalogue alone", () => {
    const models = [
      { id: "A", isSelectable: true },
      { id: "B", isSelectable: true },
    ];

    expect(omitDisabledModels(models, ["A"]).map((model) => model.id)).toEqual(["B"]);
    expect(models.map((model) => model.id)).toEqual(["A", "B"]);
    expect(models[0]?.isSelectable).toBe(true);
  });
});

describe("retainDisabledModelIds", () => {
  it("keeps an id the refreshed catalogue still lists and one it no longer lists", () => {
    expect(retainDisabledModelIds(["A", "C"], ["A", "B"])).toEqual(["A", "C"]);
  });
});

import { describe, expect, it } from "vitest";
import { parseInstalledFaces } from "./installed-fonts";

describe("parseInstalledFaces", () => {
  it("keeps usable families and drops a payload that is not a face list", () => {
    expect(
      parseInstalledFaces({
        faces: [
          { family: "Ubuntu", monospace: false },
          { family: "Ubuntu Mono", monospace: true },
          { family: "Bad;Name", monospace: false },
          { family: "", monospace: false },
          { name: "Nope" },
        ],
      }),
    ).toEqual([
      { family: "Ubuntu", monospace: false },
      { family: "Ubuntu Mono", monospace: true },
    ]);
    expect(parseInstalledFaces(null)).toEqual([]);
    expect(parseInstalledFaces({ faces: "Ubuntu" })).toEqual([]);
  });
});

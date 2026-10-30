import { describe, expect, it } from "vitest";
import { suppressCommandCodeBackgroundNotice } from "./commandcode-acp-agent.js";

describe("Command Code ACP notices", () => {
  it("drops a background taste learning failure", () => {
    expect(
      suppressCommandCodeBackgroundNotice(
        "\ntaste learning failed: POST /alpha/generate → 400 error: You have insufficient credits to make this request.\n",
      ),
    ).toBeNull();
  });

  it("keeps ordinary assistant text", () => {
    expect(suppressCommandCodeBackgroundNotice("Implemented the retry loop.")).toBe(
      "Implemented the retry loop.",
    );
    expect(suppressCommandCodeBackgroundNotice("\nTaste: spacing looks right.\n")).toBe(
      "\nTaste: spacing looks right.\n",
    );
  });

  it("matches a notice split from surrounding whitespace", () => {
    expect(
      suppressCommandCodeBackgroundNotice("  taste learning failed: network error  "),
    ).toBeNull();
  });
});

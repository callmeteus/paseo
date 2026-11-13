import { describe, expect, it } from "vitest";
import { providerDisplayName } from "@/utils/provider-display-name";

describe("providerDisplayName", () => {
  it("keeps the brand spelling for opencode", () => {
    expect(providerDisplayName("opencode")).toBe("OpenCode");
  });

  it("splits slugs into words", () => {
    expect(providerDisplayName("github-copilot")).toBe("Github Copilot");
  });

  it("capitalizes a single word", () => {
    expect(providerDisplayName("codex")).toBe("Codex");
  });
});

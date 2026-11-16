import { describe, expect, it } from "vitest";
import { isOpencodeGoModel, resolveProviderErrorCopy } from "./provider-error-copy";

describe("resolveProviderErrorCopy", () => {
  it("uses OpenCode plan copy for usage limits on non-Go models", () => {
    const copy = resolveProviderErrorCopy({
      provider: "opencode",
      kind: "usage_limit",
      message: "Free usage limit reached. Subscribe to OpenCode Go to keep going.",
      modelId: "anthropic/claude-sonnet",
    });
    expect(copy.title).toBe("agentStream.providerError.providers.opencode.usageLimit.title");
    expect(copy.description).toBe(
      "agentStream.providerError.providers.opencode.usageLimit.description",
    );
  });

  it("uses OpenCode Go copy when the active model is on OpenCode Go", () => {
    const copy = resolveProviderErrorCopy({
      provider: "opencode",
      kind: "usage_limit",
      message: "You've reached your usage limit",
      modelId: "opencode-go/deepseek-v4.1-flash",
    });
    expect(copy.title).toBe("agentStream.providerError.providers.opencode.goUsageLimit.title");
  });
});

describe("isOpencodeGoModel", () => {
  it("detects OpenCode Go model ids", () => {
    expect(isOpencodeGoModel("opencode-go/deepseek-v4")).toBe(true);
    expect(isOpencodeGoModel("provider/opencode-go/model")).toBe(true);
    expect(isOpencodeGoModel("anthropic/claude")).toBe(false);
  });
});

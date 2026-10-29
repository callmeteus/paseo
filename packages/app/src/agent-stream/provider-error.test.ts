import { describe, expect, it } from "vitest";
import { classifyProviderError, isSystemErrorText, systemErrorMessage } from "./provider-error";

describe("provider error classification", () => {
  it("detects usage limits across providers", () => {
    expect(
      classifyProviderError(
        "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.",
      ),
    ).toBe("usage_limit");
    expect(classifyProviderError("402 payment required")).toBe("usage_limit");
  });

  it("detects authentication and model failures", () => {
    expect(classifyProviderError("401 Unauthorized: invalid API key")).toBe("auth");
    expect(classifyProviderError("Model gpt-5 is not available")).toBe("model_unavailable");
  });

  it("detects provider crashes before usage limits", () => {
    expect(classifyProviderError("OpenCode helper server exited (4294967295)")).toBe("crash");
  });

  it("falls back to unknown for unrecognized text", () => {
    expect(classifyProviderError("Something odd happened")).toBe("unknown");
  });

  it("recognizes the system error prefix and strips it", () => {
    expect(isSystemErrorText("[System Error] Provider failed")).toBe(true);
    expect(isSystemErrorText("Provider failed")).toBe(false);
    expect(systemErrorMessage("[System Error] Provider failed")).toBe("Provider failed");
  });
});

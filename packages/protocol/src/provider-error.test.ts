import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  isBackgroundProviderNotice,
  isSystemErrorText,
  looksLikeProviderFailureText,
  readProviderErrorText,
  stripBackgroundProviderNotice,
  systemErrorMessage,
} from "./provider-error";

const GENERATE_CREDITS_ERROR =
  "POST /alpha/generate → 400 error: You have insufficient credits to make this request. Please purchase more credits to continue using the service.";

describe("provider error classification", () => {
  it("detects usage limits across providers", () => {
    expect(
      classifyProviderError(
        "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.",
      ),
    ).toBe("usage_limit");
    expect(classifyProviderError("402 payment required")).toBe("usage_limit");
  });

  it("separates an empty balance from a rolling usage window", () => {
    expect(
      classifyProviderError(
        "taste learning failed: POST /alpha/generate → 400 error: You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
      ),
    ).toBe("credits_exhausted");
    expect(classifyProviderError("Out of credits")).toBe("credits_exhausted");
    expect(classifyProviderError("You've reached your 5-hour usage limit")).toBe("usage_limit");
    expect(classifyProviderError("quota exhausted")).toBe("usage_limit");
  });

  it("treats Cursor's resource_exhausted status as capacity, not a plan limit", () => {
    expect(classifyProviderError("Error: RetriableError: [resource_exhausted] Error")).toBe(
      "capacity",
    );
    expect(classifyProviderError("RetriableError: [resource exhausted] Error")).toBe("capacity");
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

  it("classifies Cursor's authenticate wording as auth", () => {
    expect(classifyProviderError("Failed to authenticate: OAuth session expired")).toBe("auth");
  });
});

describe("unprefixed provider failures", () => {
  it("detects the failure a CLI prints as assistant text", () => {
    const text = "Failed to authenticate: OAuth session expired and could not be refreshed";

    expect(looksLikeProviderFailureText(text)).toBe(true);
    expect(readProviderErrorText(text)).toBe(text);
  });

  it("keeps a model explaining authentication in prose as normal text", () => {
    expect(
      looksLikeProviderFailureText(
        "The authentication flow failed in the test because the token was stale.",
      ),
    ).toBe(false);
  });

  it("ignores a failure sentence the classifier cannot name", () => {
    expect(looksLikeProviderFailureText("Failed to build the project")).toBe(false);
  });

  it("ignores a long or structured message", () => {
    expect(
      looksLikeProviderFailureText(
        "Could not reach the API. It returned 401 Unauthorized, so I checked the token, rotated it, retried the request and confirmed the endpoint responds again.",
      ),
    ).toBe(false);
    expect(looksLikeProviderFailureText("Error: 401\n\n```\nfetch failed\n```")).toBe(false);
  });

  it("prefers the system error prefix when both apply", () => {
    expect(readProviderErrorText("[System Error] Failed to authenticate")).toBe(
      "Failed to authenticate",
    );
  });
});

describe("background provider notices", () => {
  it("recognizes a taste-learning line and a generate credits failure", () => {
    expect(
      isBackgroundProviderNotice(
        "taste learning failed: POST /alpha/generate → 400 error: You have insufficient credits to make this request.",
      ),
    ).toBe(true);
    expect(isBackgroundProviderNotice("taste learning failed: network error")).toBe(true);
    expect(isBackgroundProviderNotice(GENERATE_CREDITS_ERROR)).toBe(true);
    expect(
      isBackgroundProviderNotice(
        `[System Error] ${GENERATE_CREDITS_ERROR}\n\ncode: -32603\n\n${GENERATE_CREDITS_ERROR} | code=-32603 | data={"status":400}`,
      ),
    ).toBe(true);
  });

  it("leaves an ordinary credits discussion alone", () => {
    expect(isBackgroundProviderNotice("Out of credits")).toBe(false);
    expect(
      isBackgroundProviderNotice(
        "The POST /alpha/generate call is unrelated to the user's credit balance.",
      ),
    ).toBe(false);
  });

  it("strips a notice from the end of an answer and drops a notice-only chunk", () => {
    expect(
      stripBackgroundProviderNotice(`Feito.\n\n${GENERATE_CREDITS_ERROR}\n\ncode: -32603`),
    ).toBe("Feito.");
    expect(stripBackgroundProviderNotice(`\n${GENERATE_CREDITS_ERROR}\n`)).toBeNull();
    expect(stripBackgroundProviderNotice("Implemented the retry loop.")).toBe(
      "Implemented the retry loop.",
    );
  });
});

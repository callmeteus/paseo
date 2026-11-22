import { describe, expect, it } from "vitest";
import {
  API_TOKEN_NAME_MAX_LENGTH,
  formatApiTokenCreatedAt,
  validateApiTokenName,
} from "./api-tokens-model";

const t = (key: string) => key;

describe("validateApiTokenName", () => {
  it("requires a non-empty name", () => {
    expect(validateApiTokenName("   ", t)).toBe("common.errors.nameRequired");
  });

  it("rejects names longer than the daemon limit", () => {
    expect(validateApiTokenName("x".repeat(API_TOKEN_NAME_MAX_LENGTH + 1), t)).toBe(
      "settings.host.apiTokens.nameTooLong",
    );
  });

  it("accepts a trimmed name at the limit", () => {
    expect(validateApiTokenName(`  ${"x".repeat(API_TOKEN_NAME_MAX_LENGTH)}  `, t)).toBeNull();
  });
});

describe("formatApiTokenCreatedAt", () => {
  it("formats an ISO timestamp", () => {
    expect(formatApiTokenCreatedAt("2026-11-22T10:00:00.000Z", "en-US")).not.toBe("");
  });

  it("returns an empty string for an invalid timestamp", () => {
    expect(formatApiTokenCreatedAt("not-a-date", "en-US")).toBe("");
  });
});

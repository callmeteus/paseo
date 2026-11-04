import { expect, test } from "vitest";
import { isUsageSourceEnabled } from "./visibility.js";

test("shows Claude when the provider is enabled", () => {
  expect(
    isUsageSourceEnabled("claude", {
      claude: {
        enabled: true,
      },
    }),
  ).toBe(true);
});

test("hides a provider the setting turns off", () => {
  expect(
    isUsageSourceEnabled("codex", {
      codex: {
        enabled: false,
      },
    }),
  ).toBe(false);
  expect(
    isUsageSourceEnabled("opencode-local", {
      opencode: {
        enabled: false,
      },
    }),
  ).toBe(false);
});

test("hides Kilo and Cline when they are not enabled", () => {
  expect(isUsageSourceEnabled("kilo-local", {})).toBe(false);
  expect(isUsageSourceEnabled("cline-local", {})).toBe(false);
});

test("shows Kilo when a setting enables it", () => {
  expect(
    isUsageSourceEnabled("kilo-local", {
      kilo: {
        enabled: true,
      },
    }),
  ).toBe(true);
});

test("shows OpenCode local and Cursor from their defaults", () => {
  expect(isUsageSourceEnabled("opencode-local", {})).toBe(true);
  expect(
    isUsageSourceEnabled("cursor", {
      cursor: {
        enabled: true,
      },
    }),
  ).toBe(true);
});

test("hides omp while its built-in default is off", () => {
  expect(isUsageSourceEnabled("omp", {})).toBe(false);
});

test("keeps a usage source that is not an agent provider", () => {
  expect(isUsageSourceEnabled("fixture", {})).toBe(true);
});

import { describe, expect, it } from "vitest";
import { MAX_DAEMON_CRASH_RETRIES, resolveCrashRecovery } from "./agent-crash-recovery.js";

const crash = { error: "OpenCode helper server exited (1)" };

describe("resolveCrashRecovery", () => {
  it("retries a provider crash while under the budget", () => {
    expect(resolveCrashRecovery({ event: crash, fromHistory: false, attempts: 0 })).toBe("retry");
    expect(
      resolveCrashRecovery({
        event: crash,
        fromHistory: false,
        attempts: MAX_DAEMON_CRASH_RETRIES - 1,
      }),
    ).toBe("retry");
  });

  it("gives up once the budget is spent", () => {
    expect(
      resolveCrashRecovery({
        event: crash,
        fromHistory: false,
        attempts: MAX_DAEMON_CRASH_RETRIES,
      }),
    ).toBe("give-up");
  });

  it("leaves non-crash and replayed failures to the existing path", () => {
    expect(
      resolveCrashRecovery({ event: { error: "quota exceeded" }, fromHistory: false, attempts: 0 }),
    ).toBe("none");
    expect(resolveCrashRecovery({ event: crash, fromHistory: true, attempts: 0 })).toBe("none");
  });
});

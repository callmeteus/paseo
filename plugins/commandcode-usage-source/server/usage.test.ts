import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandCodePlanLabel, discover, discoverSession, fetchUsage } from "./usage.js";
import type { UsageReport } from "@getpaseo/plugin/server/usage";

const FIVE_HOUR_RESET_MS = 1_800_000_000_000;
const WEEKLY_RESET_MS = 1_800_100_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handlers: Array<[prefix: string, handler: () => Response]>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const key = url.toString();
    const match = handlers.find(([prefix]) => key.startsWith(prefix));
    if (!match) throw new Error(`Unmocked fetch: ${key}`);
    return match[1]();
  }) as unknown as typeof fetch;
}

function writeAuthFile(home: string, auth: Record<string, unknown>): void {
  mkdirSync(join(home, ".commandcode"), { recursive: true });
  writeFileSync(join(home, ".commandcode", "auth.json"), JSON.stringify(auth));
}

function whoamiBody(overrides: Record<string, unknown> = {}) {
  return {
    user: { userName: "gio" },
    org: { id: "org_1", login: "gio" },
    ...overrides,
  };
}

function creditsBody(overrides: Record<string, unknown> = {}) {
  return {
    credits: {
      planId: "pro",
      monthlyCredits: 42.5,
      purchasedCredits: 10,
      freeCredits: 2,
      windowLimits: {
        limited: true,
        fiveHour: { used: 6, cap: 16, resetAt: FIVE_HOUR_RESET_MS },
        weekly: { used: 20, cap: 40, resetAt: WEEKLY_RESET_MS },
      },
      ...overrides,
    },
  };
}

function subscriptionBody() {
  return {
    data: {
      planId: "pro",
      status: "active",
      currentPeriodStart: "2026-10-01T00:00:00.000Z",
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    },
  };
}

function successHandlers(): Array<[string, () => Response]> {
  return [
    ["https://api.commandcode.ai/alpha/whoami", () => jsonResponse(whoamiBody())],
    ["https://api.commandcode.ai/alpha/billing/credits", () => jsonResponse(creditsBody())],
    [
      "https://api.commandcode.ai/alpha/billing/subscriptions",
      () => jsonResponse(subscriptionBody()),
    ],
    [
      "https://api.commandcode.ai/alpha/usage/summary",
      () => jsonResponse({ totalCost: 12.25, totalCount: 120 }),
    ],
  ];
}

describe("Command Code usage source", () => {
  let homeDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "commandcode-usage-home-"));
    originalEnv = { ...process.env };
    process.env["HOME"] = homeDir;
    process.env["USERPROFILE"] = homeDir;
    for (const key of ["COMMAND_CODE_API_KEY", "COMMANDCODE_API_URL", "COMMANDCODE_API_ENV"]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const key in originalEnv) process.env[key] = originalEnv[key];
  });

  it("maps the 5-hour and weekly caps, credits, and billing details", async () => {
    process.env["COMMAND_CODE_API_KEY"] = "cmd_key";

    const report = await fetchUsage(
      { store: "env", locator: "COMMAND_CODE_API_KEY" },
      mockFetch(successHandlers()),
    );

    expect(report).toMatchObject({
      status: "available",
      planLabel: "Pro",
      windows: [
        expect.objectContaining({
          id: "five_hour",
          label: "5-hour",
          shortLabel: "5h",
          summary: true,
          usedPct: 37.5,
          resetsAt: new Date(FIVE_HOUR_RESET_MS).toISOString(),
        }),
        expect.objectContaining({
          id: "weekly",
          label: "Weekly",
          shortLabel: "wk",
          usedPct: 50,
          resetsAt: new Date(WEEKLY_RESET_MS).toISOString(),
        }),
      ],
      balances: [
        expect.objectContaining({ id: "monthly_credits", remaining: 42.5, unit: "usd" }),
        expect.objectContaining({ id: "extra_credits", remaining: 12, unit: "usd" }),
      ],
      details: expect.arrayContaining([
        expect.objectContaining({ id: "status", value: "active" }),
        expect.objectContaining({ id: "renews", value: "2026-11-01" }),
        expect.objectContaining({ id: "spent", value: "$12.25 · 120 requests" }),
        expect.objectContaining({ id: "studio", value: "commandcode.ai/gio/settings/usage" }),
      ]),
    } satisfies Partial<UsageReport>);
  });

  it("omits windows when the plan is not windowed", async () => {
    process.env["COMMAND_CODE_API_KEY"] = "cmd_key";
    const handlers = successHandlers();
    handlers[1] = [
      "https://api.commandcode.ai/alpha/billing/credits",
      () => jsonResponse(creditsBody({ windowLimits: { limited: false } })),
    ];

    const report = await fetchUsage(
      { store: "env", locator: "COMMAND_CODE_API_KEY" },
      mockFetch(handlers),
    );

    expect(report).toMatchObject({ status: "available", windows: [] });
  });

  it("accepts an ISO reset timestamp instead of failing the card", async () => {
    process.env["COMMAND_CODE_API_KEY"] = "cmd_key";
    const handlers = successHandlers();
    handlers[1] = [
      "https://api.commandcode.ai/alpha/billing/credits",
      () =>
        jsonResponse(
          creditsBody({
            windowLimits: {
              limited: true,
              fiveHour: { used: 8, cap: 16, resetAt: "2026-10-30T12:00:00.000Z" },
            },
          }),
        ),
    ];

    const report = await fetchUsage(
      { store: "env", locator: "COMMAND_CODE_API_KEY" },
      mockFetch(handlers),
    );

    expect(report).toMatchObject({
      status: "available",
      windows: [
        expect.objectContaining({
          id: "five_hour",
          usedPct: 50,
          resetsAt: "2026-10-30T12:00:00.000Z",
        }),
      ],
    });
  });

  it("reports an expired login as unavailable", async () => {
    process.env["COMMAND_CODE_API_KEY"] = "cmd_expired";

    const report = await fetchUsage(
      { store: "env", locator: "COMMAND_CODE_API_KEY" },
      mockFetch([["https://api.commandcode.ai/alpha/whoami", () => jsonResponse({}, 401)]]),
    );

    expect(report).toEqual({
      status: "unavailable",
      problem: { kind: "rejected", status: 401 },
    });
  });

  it("throws when the login store disappeared", async () => {
    await expect(
      fetchUsage({ store: "file", locator: join(homeDir, ".commandcode", "auth.json") }),
    ).rejects.toThrow("Command Code login store no longer exists");
  });

  it("discovers the CLI login store and names the account by handle", async () => {
    writeAuthFile(homeDir, { apiKey: "file_key", userName: "gio" });

    const accounts = await discover();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      label: "gio",
      input: { store: "file", locator: join(homeDir, ".commandcode", "auth.json") },
    });
    expect(accounts[0]?.key).toMatch(/^account-[a-f0-9]{64}$/);
  });

  it("discovers only Command Code sessions from that session's home", async () => {
    const sessionHome = join(homeDir, "session-home");
    writeAuthFile(sessionHome, { apiKey: "session_key", userName: "other" });

    expect(
      await discoverSession({
        kind: "session",
        provider: "claude",
        env: { HOME: sessionHome },
      }),
    ).toEqual([]);

    const accounts = await discoverSession({
      kind: "session",
      provider: "commandcode",
      env: { HOME: sessionHome },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.input).toEqual({
      store: "file",
      locator: join(sessionHome, ".commandcode", "auth.json"),
    });
  });

  it("does not try to name a session-only env credential", async () => {
    const accounts = await discoverSession({
      kind: "session",
      provider: "commandcode",
      env: { HOME: homeDir, COMMAND_CODE_API_KEY: "session_only" },
    });

    expect(accounts).toEqual([]);
  });

  it("labels known plans and keeps unknown plan ids", () => {
    expect(commandCodePlanLabel("max-20x")).toBe("Max 20×");
    expect(commandCodePlanLabel("goat")).toBe("GOAT");
    expect(commandCodePlanLabel("enterprise-pool")).toBe("enterprise-pool");
    expect(commandCodePlanLabel(undefined)).toBeUndefined();
  });
});

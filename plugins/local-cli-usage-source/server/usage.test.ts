import { describe, expect, it } from "vitest";
import { parseClineHistory, parseKiloStats, parseOpencodeStats } from "./usage.js";

describe("parseOpencodeStats", () => {
  it("maps sessions, tokens and cost", () => {
    expect(
      parseOpencodeStats({
        range: { from: 1792720982212, to: 1793151500425 },
        sessions: 35,
        prompts: 508,
        steps: 8767,
        tokens: {
          input: 42_065_280,
          output: 2_212_874,
          reasoning: 1_197_546,
          cache: { read: 1_419_717_941, write: 277_065 },
        },
        cost: 4.108_801_559,
      }),
    ).toEqual({
      sessions: 35,
      prompts: 508,
      steps: 8767,
      tokens: {
        input: 42_065_280,
        output: 2_212_874,
        cacheRead: 1_419_717_941,
        cacheWrite: 277_065,
      },
      costUsd: 4.108_801_559,
      from: new Date(1792720982212).toISOString(),
      to: new Date(1793151500425).toISOString(),
    });
  });

  it("rejects empty payloads", () => {
    expect(() => parseOpencodeStats(null)).toThrow();
  });
});

describe("parseKiloStats", () => {
  it("parses the text table incl. compact token units", () => {
    const text = [
      "│Sessions                                            150 │",
      "│Total Cost                                        $0.00 │",
      "│Input                                             29.2K │",
      "│Output                                               15 │",
      "│Cache Read                                            0 │",
      "│Cache Write                                          12 │",
    ].join("\n");
    expect(parseKiloStats(text)).toEqual({
      sessions: 150,
      tokens: { input: 29_200, output: 15, cacheRead: 0, cacheWrite: 12 },
      costUsd: 0,
    });
  });
});

describe("parseClineHistory", () => {
  it("sums per-session usage", () => {
    expect(
      parseClineHistory([
        {
          usage: {
            inputTokens: 6797,
            outputTokens: 154,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalCost: 0,
          },
        },
        {
          usage: {
            inputTokens: 1000,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            totalCost: 0.25,
          },
        },
      ]),
    ).toEqual({
      sessions: 2,
      tokens: { input: 7797, output: 204, cacheRead: 10, cacheWrite: 5 },
      costUsd: 0.25,
    });
  });

  it("rejects non-array payloads", () => {
    expect(() => parseClineHistory({})).toThrow();
  });
});

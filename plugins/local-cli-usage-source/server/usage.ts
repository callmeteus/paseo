import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  hashAccountKey,
  type UsageAccount,
  type UsageBalance,
  type UsageDetail,
  type UsageReport,
} from "@getpaseo/plugin/server/usage";
import type { Input, LocalCliSource } from "../shared/input.js";

const run = promisify(exec);
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 32 * 1024 * 1024;

interface CommandRunner {
  (command: string): Promise<string>;
}

const defaultRunner: CommandRunner = async (command) => {
  const { stdout } = await run(command, {
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout;
};

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LocalUsageTotals {
  sessions: number;
  prompts?: number;
  steps?: number;
  tokens: TokenUsage;
  costUsd: number;
  from?: string;
  to?: string;
}

const SOURCE_LABELS: Record<LocalCliSource, string> = {
  opencode: "OpenCode (local)",
  kilo: "Kilo (local)",
  cline: "Cline (local)",
};

const SOURCE_COMMANDS: Record<LocalCliSource, string> = {
  opencode: "opencode stats --json --all --cost",
  kilo: "kilo stats",
  cline: "cline history --json --limit 50",
};

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Parses OpenCode's `stats --json` payload. */
export function parseOpencodeStats(payload: unknown): LocalUsageTotals {
  if (!payload || typeof payload !== "object") throw new Error("OpenCode stats returned no data");
  const data = payload as Record<string, unknown>;
  const tokens = (data.tokens ?? {}) as Record<string, unknown>;
  const cache = (tokens.cache ?? {}) as Record<string, unknown>;
  const range = (data.range ?? {}) as Record<string, unknown>;
  return {
    sessions: toNumber(data.sessions),
    prompts: toNumber(data.prompts),
    steps: toNumber(data.steps),
    tokens: {
      input: toNumber(tokens.input),
      output: toNumber(tokens.output),
      cacheRead: toNumber(cache.read),
      cacheWrite: toNumber(cache.write),
    },
    costUsd: toNumber(data.cost),
    ...(typeof range.from === "number" ? { from: new Date(range.from).toISOString() } : {}),
    ...(typeof range.to === "number" ? { to: new Date(range.to).toISOString() } : {}),
  };
}

function parseCompactNumber(raw: string): number {
  const match = /([\d.,]+)\s*([KMB])?/i.exec(raw.trim());
  if (!match) return 0;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const scale = match[2]?.toUpperCase();
  if (scale === "K") return Math.round(base * 1_000);
  if (scale === "M") return Math.round(base * 1_000_000);
  if (scale === "B") return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

function tableValue(text: string, label: string): number {
  const pattern = new RegExp(`[│|]\\s*${label}\\s+([^│|]+)`, "i");
  const match = pattern.exec(text);
  return match ? parseCompactNumber(match[1]) : 0;
}

/** Parses Kilo's `stats` text table (Kilo has no JSON flag). */
export function parseKiloStats(text: string): LocalUsageTotals {
  const costRaw = tableValue(text, "Total Cost");
  return {
    sessions: tableValue(text, "Sessions"),
    tokens: {
      input: tableValue(text, "Input"),
      output: tableValue(text, "Output"),
      cacheRead: tableValue(text, "Cache Read"),
      cacheWrite: tableValue(text, "Cache Write"),
    },
    // Shared table helper returns an integer; recover cents from the raw line.
    costUsd: /Total Cost\s+\$([\d.,]+)/i.test(text)
      ? Number(/Total Cost\s+\$([\d.,]+)/i.exec(text)![1].replace(/,/g, ""))
      : costRaw,
  };
}

interface ClineHistoryEntry {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCost?: number;
  };
}

/** Parses `cline history --json` and sums per-session usage. */
export function parseClineHistory(payload: unknown): LocalUsageTotals {
  if (!Array.isArray(payload)) throw new Error("Cline history returned no sessions");
  const totals: LocalUsageTotals = {
    sessions: payload.length,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
  };
  for (const entry of payload as ClineHistoryEntry[]) {
    const usage = entry.usage ?? {};
    totals.tokens.input += toNumber(usage.inputTokens);
    totals.tokens.output += toNumber(usage.outputTokens);
    totals.tokens.cacheRead += toNumber(usage.cacheReadTokens);
    totals.tokens.cacheWrite += toNumber(usage.cacheWriteTokens);
    totals.costUsd += toNumber(usage.totalCost);
  }
  return totals;
}

function buildReport(source: LocalCliSource, totals: LocalUsageTotals): UsageReport {
  const tokenTotal =
    totals.tokens.input + totals.tokens.output + totals.tokens.cacheRead + totals.tokens.cacheWrite;
  const balances: UsageBalance[] = [
    {
      id: "cost",
      label: "Spent",
      used: Number(totals.costUsd.toFixed(4)),
      unit: "usd",
    },
    { id: "tokens", label: "Tokens", used: tokenTotal, unit: "tokens" },
  ];
  const details: UsageDetail[] = [
    { id: "sessions", label: "Sessions", value: String(totals.sessions) },
    { id: "input", label: "Input", value: String(totals.tokens.input) },
    { id: "output", label: "Output", value: String(totals.tokens.output) },
  ];
  if (totals.prompts !== undefined) {
    details.push({ id: "prompts", label: "Prompts", value: String(totals.prompts) });
  }
  if (totals.steps !== undefined) {
    details.push({ id: "steps", label: "Steps", value: String(totals.steps) });
  }
  if (totals.tokens.cacheRead > 0) {
    details.push({ id: "cacheRead", label: "Cache read", value: String(totals.tokens.cacheRead) });
  }
  if (totals.from) details.push({ id: "from", label: "Since", value: totals.from.slice(0, 10) });
  return { status: "available", planLabel: "Local", windows: [], balances, details };
}

export function discover(source: LocalCliSource): UsageAccount[] {
  return [
    {
      key: hashAccountKey(`local-cli:${source}`),
      label: SOURCE_LABELS[source],
      harness: source,
      input: { source },
    },
  ];
}

export async function fetchUsage(
  input: Input,
  runner: CommandRunner = defaultRunner,
): Promise<UsageReport> {
  try {
    const stdout = await runner(SOURCE_COMMANDS[input.source]);
    if (input.source === "opencode") {
      return buildReport(input.source, parseOpencodeStats(JSON.parse(stdout)));
    }
    if (input.source === "cline") {
      return buildReport(input.source, parseClineHistory(JSON.parse(stdout)));
    }
    return buildReport(input.source, parseKiloStats(stdout));
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

import type { UsageInput } from "../shared/input.js";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  balanceToneFromRemaining,
  hashAccountKey,
  toneFromUsedPct,
  unavailable,
  usedPctOf,
  windowFromUsedPct,
  type UsageAccount,
  type UsageBalance,
  type UsageDetail,
  type UsageReport,
  type UsageScope,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";

// The Command Code CLI reads the same /alpha endpoints for its `/usage` overlay.
// Server-side source: dist/cli.mjs in the command-code npm package (fetchUsageData).
// Usage lives on the API host; the website host serves marketing pages and returns 404.
const PROD_BASE_URL = "https://api.commandcode.ai";
const STAGING_BASE_URL = "https://staging-api.commandcode.ai";
const STUDIO_BASE_URL = "https://commandcode.ai";
const REQUEST_TIMEOUT_MS = 18_000;
const AUTH_FILE_DIRECTORY = ".commandcode";
const AUTH_FILE_NAME = "auth.json";
const API_KEY_ENV_VAR = "COMMAND_CODE_API_KEY";

const ApiOptionalNumberSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.coerce.number().finite().optional(),
);
// The CLI compares resetAt to Date.now(), so the API sends epoch milliseconds. Accept an
// ISO timestamp too so a shape change degrades to a missing reset instead of failing the card.
const EpochMsSchema = z.preprocess((value) => {
  if (value == null) return undefined;
  if (typeof value !== "string") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}, z.number().finite().optional());
const ApiOptionalStringSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.coerce.string().optional(),
);

const AuthFileSchema = z
  .object({
    apiKey: z.string().min(1).nullish(),
    userName: z.string().nullish(),
  })
  .passthrough();

const WindowLimitSchema = z
  .object({
    used: ApiOptionalNumberSchema,
    cap: ApiOptionalNumberSchema,
    resetAt: EpochMsSchema,
  })
  .passthrough();

const WindowLimitsSchema = z
  .object({
    limited: z.boolean().nullish(),
    fiveHour: WindowLimitSchema.nullish(),
    weekly: WindowLimitSchema.nullish(),
  })
  .passthrough();

const SandboxMinutesSchema = z
  .object({
    usedMinutes: ApiOptionalNumberSchema,
    limitMinutes: ApiOptionalNumberSchema,
    resetAt: EpochMsSchema,
  })
  .passthrough();

const CreditsSchema = z
  .object({
    credits: z
      .object({
        planId: ApiOptionalStringSchema,
        monthlyCredits: ApiOptionalNumberSchema,
        purchasedCredits: ApiOptionalNumberSchema,
        freeCredits: ApiOptionalNumberSchema,
        windowLimits: WindowLimitsSchema.nullish(),
        sandboxMinutes: SandboxMinutesSchema.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const WhoamiSchema = z
  .object({
    user: z.object({ userName: ApiOptionalStringSchema }).passthrough().nullish(),
    org: z
      .object({
        id: ApiOptionalStringSchema,
        login: ApiOptionalStringSchema,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const SubscriptionSchema = z
  .object({
    data: z
      .object({
        planId: ApiOptionalStringSchema,
        status: ApiOptionalStringSchema,
        currentPeriodStart: ApiOptionalStringSchema,
        currentPeriodEnd: ApiOptionalStringSchema,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const SummarySchema = z
  .object({
    totalCost: ApiOptionalNumberSchema,
    totalCount: ApiOptionalNumberSchema,
  })
  .passthrough();

type WindowLimit = z.infer<typeof WindowLimitSchema>;
type SandboxMinutes = z.infer<typeof SandboxMinutesSchema>;
type Credits = z.infer<typeof CreditsSchema>["credits"];

const PLAN_LABELS: Record<string, string> = {
  go: "Go",
  goat: "GOAT",
  pro: "Pro",
  "max-10x": "Max 10×",
  "max-20x": "Max 20×",
  "team-pro": "Team Pro",
  team: "Team",
  provider: "Provider",
};

const PLAN_PREFIXES = Object.keys(PLAN_LABELS).sort((left, right) => right.length - left.length);

function commandCodeApiBase(env: NodeJS.ProcessEnv): string {
  const override = env["COMMANDCODE_API_URL"]?.trim();
  if (override) return override.replace(/\/+$/, "");
  if (env["COMMANDCODE_API_ENV"] === "staging") return STAGING_BASE_URL;
  return PROD_BASE_URL;
}

function commandCodeAuthPath(env: Record<string, string | undefined>): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  return join(home, AUTH_FILE_DIRECTORY, AUTH_FILE_NAME);
}

export function commandCodePlanLabel(planId: string | undefined): string | undefined {
  if (!planId) return undefined;
  const normalized = planId.toLowerCase();
  const exact = PLAN_LABELS[normalized];
  if (exact) return exact;
  const prefix = PLAN_PREFIXES.find((candidate) => normalized.startsWith(candidate));
  return prefix ? PLAN_LABELS[prefix] : planId;
}

function queryString(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function isoFromEpochMs(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function isoFromDateString(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function windowFromLimit(input: {
  limit: WindowLimit | null | undefined;
  id: string;
  label: string;
  shortLabel: string;
  summary?: boolean;
}): UsageWindow | null {
  const cap = input.limit?.cap;
  if (typeof cap !== "number" || cap <= 0) return null;
  const usedPct = usedPctOf(input.limit?.used, cap);
  return windowFromUsedPct({
    id: input.id,
    label: input.label,
    shortLabel: input.shortLabel,
    summary: input.summary,
    utilizationPct: usedPct,
    resetsAt: isoFromEpochMs(input.limit?.resetAt),
    tone: toneFromUsedPct(usedPct),
  });
}

function usageWindows(credits: Credits): UsageWindow[] {
  const limits = credits?.windowLimits;
  // `limited: false` marks pay-as-you-go and enterprise pools, which have no windows.
  if (!limits || limits.limited === false) return [];
  const windows: UsageWindow[] = [];
  const fiveHour = windowFromLimit({
    limit: limits.fiveHour,
    id: "five_hour",
    label: "5-hour",
    shortLabel: "5h",
    summary: true,
  });
  if (fiveHour) windows.push(fiveHour);
  const weekly = windowFromLimit({
    limit: limits.weekly,
    id: "weekly",
    label: "Weekly",
    shortLabel: "wk",
    summary: false,
  });
  if (weekly) windows.push(weekly);
  return windows;
}

function creditBalances(credits: Credits): UsageBalance[] {
  if (!credits) return [];
  const balances: UsageBalance[] = [];
  const monthly = credits.monthlyCredits ?? null;
  if (monthly !== null) {
    balances.push({
      id: "monthly_credits",
      label: "Monthly credits",
      remaining: monthly,
      unit: "usd",
      tone: balanceToneFromRemaining(monthly),
    });
  }
  const purchased = credits.purchasedCredits ?? 0;
  const free = credits.freeCredits ?? 0;
  const extra = purchased + free;
  if (extra > 0) {
    balances.push({
      id: "extra_credits",
      label: "Extra credits",
      remaining: extra,
      unit: "usd",
      tone: balanceToneFromRemaining(extra),
    });
  }
  return balances;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function sandboxDetail(
  sandbox: SandboxMinutes | null | undefined,
  now: number,
): UsageDetail | null {
  if (!sandbox) return null;
  const used = sandbox.usedMinutes ?? 0;
  const limit = sandbox.limitMinutes ?? 0;
  if (limit <= 0 && used <= 0) return null;
  if (limit <= 0) {
    return {
      id: "cloud_minutes",
      label: "Cloud minutes",
      value: `${used} min used this month`,
    };
  }
  const resetsAt = isoFromEpochMs(sandbox.resetAt);
  const resets = resetsAt && Date.parse(resetsAt) > now ? ` · resets ${resetsAt.slice(0, 10)}` : "";
  return {
    id: "cloud_minutes",
    label: "Cloud minutes",
    value: `${used} / ${limit} min${resets}`,
  };
}

function usageDetails(input: {
  subscription: z.infer<typeof SubscriptionSchema>["data"];
  summary: z.infer<typeof SummarySchema> | null;
  sandbox: SandboxMinutes | null | undefined;
  orgLogin: string | undefined;
  now: number;
}): UsageDetail[] {
  const details: UsageDetail[] = [];
  const status = input.subscription?.status;
  if (status) details.push({ id: "status", label: "Status", value: status });

  const renewsAt = isoFromDateString(input.subscription?.currentPeriodEnd);
  if (renewsAt) details.push({ id: "renews", label: "Renews", value: renewsAt.slice(0, 10) });

  const totalCost = input.summary?.totalCost;
  if (typeof totalCost === "number") {
    const requests = input.summary?.totalCount;
    const suffix = typeof requests === "number" ? ` · ${requests.toLocaleString()} requests` : "";
    details.push({
      id: "spent",
      label: "Spent this period",
      value: `${formatUsd(totalCost)}${suffix}`,
    });
  }

  const sandbox = sandboxDetail(input.sandbox, input.now);
  if (sandbox) details.push(sandbox);

  if (input.orgLogin) {
    details.push({
      id: "studio",
      label: "Studio",
      value: `${STUDIO_BASE_URL.replace(/^https?:\/\//, "")}/${input.orgLogin}/settings/usage`,
    });
  }

  return details;
}

async function readApiKey(input: UsageInput): Promise<string | undefined> {
  if (input.store === "env") return process.env[input.locator];
  const auth = await readAuthFile(input.locator);
  return auth?.apiKey ?? undefined;
}

async function readAuthFile(locator: string): Promise<z.infer<typeof AuthFileSchema> | null> {
  try {
    const parsed = AuthFileSchema.safeParse(JSON.parse(await fs.readFile(locator, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function accountLocator(env: Record<string, string | undefined>): UsageInput | null {
  if (env[API_KEY_ENV_VAR]) return { store: "env", locator: API_KEY_ENV_VAR };
  return { store: "file", locator: commandCodeAuthPath(env) };
}

async function accountFor(input: UsageInput): Promise<UsageAccount | null> {
  const apiKey = await readApiKey(input);
  if (!apiKey) return null;
  // Prefer the CLI's handle so token rotation and file moves keep one card.
  const auth = input.store === "file" ? await readAuthFile(input.locator) : null;
  const userName = auth?.userName?.trim();
  const key = userName
    ? `account-${hashAccountKey(userName)}`
    : `store-${hashAccountKey(JSON.stringify(input))}`;
  const account: UsageAccount = { key, input };
  if (userName) account.label = userName;
  return account;
}

export async function discover(): Promise<UsageAccount[]> {
  const input = accountLocator(process.env);
  if (!input) return [];
  const account = await accountFor(input);
  return account ? [account] : [];
}

export async function discoverSession(
  scope: Extract<UsageScope, { kind: "session" }>,
): Promise<UsageAccount[]> {
  if (scope.provider !== "commandcode") return [];
  // An env credential belongs to the daemon process, not to a single session, so it
  // cannot be named by an input that fetch() re-reads later.
  if (scope.env[API_KEY_ENV_VAR] && !process.env[API_KEY_ENV_VAR]) return [];
  const input = accountLocator(scope.env);
  if (!input) return [];
  const account = await accountFor(input);
  return account ? [account] : [];
}

type ApiOutcome<T> = { kind: "ok"; data: T } | { kind: "rejected"; status: number };

async function requestJson<T>(
  get: (path: string) => Promise<Response>,
  schema: z.ZodType<T>,
  path: string,
  label: string,
): Promise<ApiOutcome<T>> {
  const res = await get(path);
  if (res.status === 401 || res.status === 403) return { kind: "rejected", status: res.status };
  if (!res.ok) throw new Error(`Command Code ${label} returned ${res.status}`);
  return { kind: "ok", data: schema.parse(await res.json()) };
}

function rejectedReport(status: number): UsageReport {
  return unavailable({ kind: "rejected", status });
}

async function readSummary(
  get: (path: string) => Promise<Response>,
  orgId: string | null,
  since: string,
): Promise<ApiOutcome<z.infer<typeof SummarySchema>> | null> {
  try {
    return await requestJson(
      get,
      SummarySchema,
      `/alpha/usage/summary${queryString({ orgId, since })}`,
      "summary",
    );
  } catch {
    // Spend totals are supporting detail; a failure here must not blank the card.
    return null;
  }
}

export async function fetchUsage(
  input: UsageInput,
  fetchApi: typeof fetch = fetch,
): Promise<UsageReport> {
  const apiKey = await readApiKey(input);
  if (!apiKey) throw new Error("Command Code login store no longer exists");

  const baseUrl = commandCodeApiBase(process.env);
  // One deadline for the whole card, matching the daemon's 20-second fetch budget.
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const get = (path: string): Promise<Response> =>
    fetchApi(`${baseUrl}${path}`, {
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

  const whoamiOutcome = await requestJson(
    get,
    WhoamiSchema,
    `/alpha/whoami${queryString({ limits: "1" })}`,
    "whoami",
  );
  if (whoamiOutcome.kind === "rejected") return rejectedReport(whoamiOutcome.status);
  const whoami = whoamiOutcome.data;
  const orgId = whoami.org?.id ?? null;

  const [creditsOutcome, subscriptionOutcome] = await Promise.all([
    requestJson(get, CreditsSchema, `/alpha/billing/credits${queryString({ orgId })}`, "credits"),
    requestJson(
      get,
      SubscriptionSchema,
      `/alpha/billing/subscriptions${queryString({ orgId })}`,
      "subscriptions",
    ),
  ]);
  if (creditsOutcome.kind === "rejected") return rejectedReport(creditsOutcome.status);
  if (subscriptionOutcome.kind === "rejected") return rejectedReport(subscriptionOutcome.status);
  const credits = creditsOutcome.data;
  const subscription = subscriptionOutcome.data;

  const periodStart = subscription.data?.currentPeriodStart;
  const summaryOutcome = periodStart ? await readSummary(get, orgId, periodStart) : null;
  if (summaryOutcome?.kind === "rejected") return rejectedReport(summaryOutcome.status);
  const summary = summaryOutcome?.kind === "ok" ? summaryOutcome.data : null;

  return {
    status: "available",
    planLabel: commandCodePlanLabel(subscription.data?.planId ?? credits.credits?.planId),
    windows: usageWindows(credits.credits),
    balances: creditBalances(credits.credits),
    details: usageDetails({
      subscription: subscription.data,
      summary,
      sandbox: credits.credits?.sandboxMinutes,
      orgLogin: whoami.org?.login,
      now: Date.now(),
    }),
  };
}

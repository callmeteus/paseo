/**
 * Where one Multitask task runs.
 *
 * `paseo` is a Paseo-managed child on the parent chat's CLI and model.
 * `cli` is a provider the daemon already launches, plus a model that CLI lists.
 * The pair is never hardcoded: callers pass the catalog they already have.
 */
export type MultitaskTaskTarget =
  | { kind: "paseo" }
  | { kind: "cli"; provider: string; model: string | null };

/**
 * What `create_agent` asked for before the catalog is consulted.
 * An omitted model means the CLI's own default.
 */
export type MultitaskTaskTargetRequest =
  | { kind: "paseo" }
  | { kind: "cli"; provider: string; model?: string | null };

/** One CLI the daemon can launch, in the shape the provider snapshot already uses. */
export interface MultitaskCliCatalogEntry {
  id: string;
  label: string;
  enabled: boolean;
  status: "ready" | "loading" | "error" | "unavailable";
  error?: string;
  models: ReadonlyArray<{ id: string; label: string; aliases?: readonly string[] }>;
}

export type MultitaskTaskTargetFailureCode =
  | "missing"
  | "unauthenticated"
  | "unknown-model"
  | "unknown-cli"
  | "unavailable";

export type MultitaskTaskTargetResolution =
  | { ok: true; target: MultitaskTaskTarget }
  | {
      ok: false;
      code: MultitaskTaskTargetFailureCode;
      message: string;
      closest: string[];
    };

/** Label that stores the Multitask control's choice on the parent chat. */
export const MULTITASK_TASK_TARGET_LABEL = "paseo.multitask-task-target";

/**
 * Encodes a task target into the parent chat's label.
 *
 * The provider id is the text before the first slash. Model ids may contain
 * slashes, so `cli:opencode/org/model` is provider `opencode` and model `org/model`.
 *
 * @param target - Choice made in the Multitask control
 * @returns `paseo`, or `cli:<provider>` / `cli:<provider>/<model>`
 */
export function encodeMultitaskTaskTarget(target: MultitaskTaskTarget): string {
  if (target.kind === "paseo") {
    return "paseo";
  }
  const provider = target.provider.trim();
  const model = target.model?.trim() ?? "";
  return model ? `cli:${provider}/${model}` : `cli:${provider}`;
}

/**
 * Reads a task target back from the label value.
 *
 * A missing or unrecognised value is a Paseo agent, which is also the default
 * when the control has never been changed.
 *
 * @param value - Stored label, if the chat has one
 * @returns The stored choice, or `{ kind: "paseo" }`
 */
export function decodeMultitaskTaskTarget(value: string | null | undefined): MultitaskTaskTarget {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "paseo") {
    return { kind: "paseo" };
  }
  if (!trimmed.startsWith("cli:")) {
    return { kind: "paseo" };
  }
  const rest = trimmed.slice("cli:".length).trim();
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    const provider = rest.trim();
    return provider ? { kind: "cli", provider, model: null } : { kind: "paseo" };
  }
  const provider = rest.slice(0, slash).trim();
  const model = rest.slice(slash + 1).trim();
  if (!provider) {
    return { kind: "paseo" };
  }
  return { kind: "cli", provider, model: model || null };
}

/**
 * Reads the Multitask control's choice from a chat's labels.
 *
 * @param labels - Agent labels, or nothing when the chat has none
 * @returns The stored choice, or a Paseo agent when the label is absent
 */
export function readMultitaskTaskTarget(
  labels: Record<string, string | null | undefined> | null | undefined,
): MultitaskTaskTarget {
  return decodeMultitaskTaskTarget(labels?.[MULTITASK_TASK_TARGET_LABEL] ?? null);
}

/**
 * Resolves one task onto a Paseo agent or a CLI model from the catalog.
 *
 * An unknown name is a failure. This never invents a model id and never
 * substitutes the closest name. `closest` only lists names the catalog
 * already has, so the caller can show them on the failed task.
 *
 * A CLI whose model list is still empty (loading, or a CLI that does not
 * advertise models) keeps the requested id. Unknown-model applies only once
 * the catalog actually lists models and none of them match.
 *
 * @param request - Paseo, or a CLI plus an optional model
 * @param catalog - Providers and models the daemon already knows
 * @returns The target to launch, or a failure that names the closest real entries
 */
export function resolveMultitaskTaskTarget(
  request: MultitaskTaskTargetRequest,
  catalog: readonly MultitaskCliCatalogEntry[],
): MultitaskTaskTargetResolution {
  if (request.kind === "paseo") {
    return { ok: true, target: { kind: "paseo" } };
  }

  const providerName = request.provider.trim();
  const entry = findCatalogEntry(catalog, providerName);
  if (!entry) {
    const closest = closestProviderNames(catalog, providerName);
    return fail(
      "unknown-cli",
      closest.length > 0
        ? `No CLI named "${providerName}". Closest: ${closest.join(", ")}.`
        : `No CLI named "${providerName}".`,
      closest,
    );
  }

  const availability = classifyAvailability(entry);
  if (availability === "missing") {
    const closest = otherProviderNames(catalog, entry.id);
    const detail = entry.error?.trim() || "not installed";
    return fail(
      "missing",
      closest.length > 0
        ? `${displayName(entry)} is not available (${detail}). Closest CLIs: ${closest.join(", ")}.`
        : `${displayName(entry)} is not available (${detail}).`,
      closest,
    );
  }
  if (availability === "unauthenticated") {
    return fail(
      "unauthenticated",
      `${displayName(entry)} needs a login before this task can run.`,
      otherProviderNames(catalog, entry.id),
    );
  }
  if (availability === "unavailable") {
    const detail = entry.error?.trim();
    return fail(
      "unavailable",
      detail
        ? `${displayName(entry)} is not available (${detail}).`
        : `${displayName(entry)} is not available.`,
      otherProviderNames(catalog, entry.id),
    );
  }

  const requestedModel = request.model?.trim() ?? "";
  if (!requestedModel) {
    return { ok: true, target: { kind: "cli", provider: entry.id, model: null } };
  }

  const matched = entry.models.find((model) => modelMatches(model, requestedModel));
  if (matched) {
    return { ok: true, target: { kind: "cli", provider: entry.id, model: matched.id } };
  }
  if (entry.models.length === 0) {
    return { ok: true, target: { kind: "cli", provider: entry.id, model: requestedModel } };
  }

  const closest = closestModelNames(entry.models, requestedModel);
  return fail(
    "unknown-model",
    closest.length > 0
      ? `${displayName(entry)} does not expose a model named "${requestedModel}". Closest: ${closest.join(", ")}.`
      : `${displayName(entry)} does not expose a model named "${requestedModel}".`,
    closest,
  );
}

function fail(
  code: MultitaskTaskTargetFailureCode,
  message: string,
  closest: string[],
): MultitaskTaskTargetResolution {
  return { ok: false, code, message, closest };
}

function displayName(entry: MultitaskCliCatalogEntry): string {
  const label = entry.label.trim();
  return label || entry.id;
}

function findCatalogEntry(
  catalog: readonly MultitaskCliCatalogEntry[],
  name: string,
): MultitaskCliCatalogEntry | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) {
    return undefined;
  }
  return (
    catalog.find((entry) => entry.id.toLowerCase() === wanted) ??
    catalog.find((entry) => entry.label.trim().toLowerCase() === wanted)
  );
}

function classifyAvailability(
  entry: MultitaskCliCatalogEntry,
): "ready" | "loading" | "missing" | "unauthenticated" | "unavailable" {
  if (!entry.enabled) {
    return "unavailable";
  }
  if (entry.status === "ready") {
    return "ready";
  }
  if (entry.status === "loading") {
    return "loading";
  }
  const text = `${entry.error ?? ""}`.toLowerCase();
  if (
    /auth|login|sign in|signed out|logged out|not logged|unauthor|credential|api key/.test(text)
  ) {
    return "unauthenticated";
  }
  if (
    /not installed|enoent|no such file|binary not found|command not found|spawn /.test(text) ||
    entry.status === "unavailable"
  ) {
    return "missing";
  }
  return "unavailable";
}

function modelMatches(
  model: { id: string; label: string; aliases?: readonly string[] },
  requested: string,
): boolean {
  const names = [model.id, model.label, ...(model.aliases ?? [])];
  return names.some((name) => sameModelName(name, requested));
}

function sameModelName(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const aSlash = a.lastIndexOf("/");
  const bSlash = b.lastIndexOf("/");
  if (aSlash === -1 && bSlash === -1) {
    return false;
  }
  const aTail = aSlash === -1 ? a : a.slice(aSlash + 1);
  const bTail = bSlash === -1 ? b : b.slice(bSlash + 1);
  return aTail.length > 0 && aTail === bTail;
}

function modelDisplay(model: { id: string; label: string }): string {
  const label = model.label.trim();
  if (label && label !== model.id) {
    return `${label} (${model.id})`;
  }
  return model.id;
}

function closestModelNames(
  models: ReadonlyArray<{ id: string; label: string; aliases?: readonly string[] }>,
  requested: string,
): string[] {
  const ranked = models
    .map((model) => ({
      name: modelDisplay(model),
      score: Math.max(
        similarity(requested, model.id),
        similarity(requested, model.label),
        ...(model.aliases ?? []).map((alias) => similarity(requested, alias)),
      ),
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return uniqueNames(ranked.map((row) => row.name)).slice(0, 3);
}

function closestProviderNames(
  catalog: readonly MultitaskCliCatalogEntry[],
  requested: string,
): string[] {
  const ranked = catalog
    .map((entry) => ({
      name: displayName(entry),
      score: Math.max(similarity(requested, entry.id), similarity(requested, entry.label)),
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return uniqueNames(ranked.map((row) => row.name)).slice(0, 3);
}

function otherProviderNames(
  catalog: readonly MultitaskCliCatalogEntry[],
  exceptId: string,
): string[] {
  const others = catalog.filter((entry) => entry.id !== exceptId);
  const ready = others.filter((entry) => entry.enabled && entry.status === "ready");
  const rest = others.filter((entry) => !ready.includes(entry));
  return uniqueNames([...ready, ...rest].map((entry) => displayName(entry))).slice(0, 3);
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

function similarity(left: string, right: string): number {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.85;
  }
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.length === 0 || bGrams.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const gram of aGrams) {
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (const gram of bGrams) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (aGrams.length + bGrams.length);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function bigrams(value: string): string[] {
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

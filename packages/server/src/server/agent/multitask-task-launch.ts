import type { ProviderSnapshotEntry, ProviderStatus } from "@getpaseo/protocol/agent-types";
import {
  decodeMultitaskTaskTarget,
  resolveMultitaskTaskTarget,
  type MultitaskTaskTargetFailureCode,
  type MultitaskTaskTargetRequest,
} from "@getpaseo/protocol/multitask-task-target";
import { resolveDefaultWritableProviderMode } from "./workflow-modes.js";

/** Parent chat fields the task launch needs. The rest of the session stays put. */
export interface MultitaskLaunchParent {
  workflowModeId?: string | null;
  provider: string;
  model?: string | null;
  /** Raw `paseo.multitask-task-target` label, when the control has stored one. */
  taskTargetLabel?: string | null;
}

/** One CLI row, narrowed to what task resolution reads from a provider snapshot. */
export interface MultitaskLaunchProvider {
  id: string;
  label?: string;
  enabled: boolean;
  status: ProviderStatus;
  error?: string;
  models?: ReadonlyArray<{ id: string; label: string; aliases?: readonly string[] }>;
  modeIds?: readonly string[];
  defaultModeId?: string | null;
}

export interface ResolveCreateAgentTaskLaunchInput {
  parent: MultitaskLaunchParent | null;
  /** Explicit per-task choice. Wins over the Multitask control. */
  taskAgent?: MultitaskTaskTargetRequest | null;
  /**
   * Legacy `provider/model` argument. Multitask ignores it unless `taskAgent`
   * is set, so a model that still fills `provider` cannot override the control.
   */
  provider?: string | null;
  /** Mode the caller already chose. Otherwise a cross-CLI child gets a writable mode. */
  requestedMode?: string;
  providers: readonly MultitaskLaunchProvider[];
}

export type MultitaskLaunchResult =
  | {
      ok: true;
      kind: "paseo" | "cli";
      provider: string;
      model: string | null;
      /** `provider` or `provider/model` for `create_agent`. */
      providerArgument: string;
      /** Set when the child CLI cannot inherit the parent's mode. */
      modeId?: string;
    }
  | {
      ok: false;
      code: MultitaskTaskTargetFailureCode | "provider-required";
      message: string;
      closest: string[];
      providerId: string | null;
    };

/**
 * Chooses the CLI and model for one `create_agent` call.
 *
 * In Multitask, the stored control wins over the legacy `provider` argument.
 * `taskAgent` is the per-task override. A Paseo agent uses the parent chat's
 * CLI and model. A different CLI gets that CLI's writable mode so the child
 * does not inherit a mode it does not have. Catalog failures (missing CLI,
 * no login, unknown model) apply to Multitask and to `taskAgent`. A normal
 * `create_agent` still passes its provider argument through. A failure
 * describes that task only: the result has no workflow mode to change.
 *
 * @param input - Parent chat, the optional override, and the provider catalog
 * @returns What to launch, or why this task cannot start
 */
export function resolveCreateAgentTaskLaunch(
  input: ResolveCreateAgentTaskLaunchInput,
): MultitaskLaunchResult {
  const request = selectLaunchRequest(input);
  if (request.kind === "provider-required") {
    return {
      ok: false,
      code: "provider-required",
      message: "provider is required",
      closest: [],
      providerId: null,
    };
  }

  if (request.kind === "paseo") {
    if (!input.parent?.provider) {
      return {
        ok: false,
        code: "unavailable",
        message: "A Paseo task needs the parent chat's CLI.",
        closest: [],
        providerId: null,
      };
    }
    const model = input.parent.model?.trim() || null;
    return {
      ok: true,
      kind: "paseo",
      provider: input.parent.provider,
      model,
      providerArgument: formatProviderArgument(input.parent.provider, model),
    };
  }

  const enforceCatalog = input.parent?.workflowModeId === "multitask" || input.taskAgent != null;
  if (!enforceCatalog) {
    return launchResolvedCli(input, request.provider, request.model ?? null);
  }

  const resolved = resolveMultitaskTaskTarget(
    { kind: "cli", provider: request.provider, model: request.model },
    input.providers.map((provider) => ({
      id: provider.id,
      label: provider.label?.trim() || provider.id,
      enabled: provider.enabled,
      status: provider.status,
      error: provider.error,
      models: provider.models ?? [],
    })),
  );
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message: resolved.message,
      closest: resolved.closest,
      providerId: request.provider,
    };
  }
  if (resolved.target.kind !== "cli") {
    return {
      ok: false,
      code: "unavailable",
      message: "The task target did not resolve to a CLI.",
      closest: [],
      providerId: request.provider,
    };
  }
  return launchResolvedCli(input, resolved.target.provider, resolved.target.model);
}

/**
 * Builds a successful CLI launch, including a writable mode when the child
 * CLI is not the parent's.
 *
 * @param input - The launch request, used for the parent and the mode catalog
 * @param providerId - CLI to start
 * @param model - Model id, or null to let that CLI use its default
 * @returns The provider argument and mode `create_agent` should pass
 */
function launchResolvedCli(
  input: ResolveCreateAgentTaskLaunchInput,
  providerId: string,
  model: string | null,
): Extract<MultitaskLaunchResult, { ok: true }> {
  const provider = findLaunchProvider(input.providers, providerId);
  const modeId = resolveMultitaskChildMode({
    parentProvider: input.parent?.provider ?? null,
    targetProvider: providerId,
    requestedMode: input.requestedMode,
    availableModeIds: provider?.modeIds,
    defaultModeId: provider?.defaultModeId,
  });
  return {
    ok: true,
    kind: "cli",
    provider: providerId,
    model,
    providerArgument: formatProviderArgument(providerId, model),
    ...(modeId ? { modeId } : {}),
  };
}

/**
 * Picks a session mode when the child CLI is not the parent's.
 *
 * The same CLI inherits the parent's mode by leaving this unset, or uses the
 * mode the caller asked for. A different CLI uses that mode only when it
 * lists it. Otherwise it gets that CLI's writable mode, or its own default,
 * so a parent plan mode is not forced onto a CLI that does not have it.
 *
 * @param input - Parent CLI, child CLI, and the modes the child advertised
 * @returns A mode id to pass, or undefined to let the child inherit
 */
export function resolveMultitaskChildMode(input: {
  parentProvider: string | null;
  targetProvider: string;
  requestedMode?: string;
  availableModeIds?: readonly string[];
  defaultModeId?: string | null;
}): string | undefined {
  const requested = input.requestedMode?.trim();
  const sameCli = !input.parentProvider || input.parentProvider === input.targetProvider;
  if (requested && (sameCli || modeIsListed(requested, input.availableModeIds))) {
    return requested;
  }
  if (sameCli) {
    return undefined;
  }
  const writable = resolveDefaultWritableProviderMode(input.targetProvider);
  if (writable && modeIsListed(writable, input.availableModeIds)) {
    return writable;
  }
  const defaultMode = input.defaultModeId?.trim();
  if (defaultMode && modeIsListed(defaultMode, input.availableModeIds)) {
    return defaultMode;
  }
  return input.availableModeIds?.[0];
}

/**
 * Maps provider snapshots into the rows task launch reads.
 *
 * @param entries - Snapshot rows from the provider catalog
 * @returns The id, status, models, and modes for each CLI
 */
export function toMultitaskLaunchProviders(
  entries: readonly ProviderSnapshotEntry[],
): MultitaskLaunchProvider[] {
  return entries.map((entry) => ({
    id: entry.provider,
    label: entry.label,
    enabled: entry.enabled,
    status: entry.status,
    error: entry.error,
    models: entry.models?.map((model) => ({
      id: model.id,
      label: model.label,
      aliases: model.aliases,
    })),
    modeIds: entry.modes?.map((mode) => mode.id),
    defaultModeId: entry.defaultModeId,
  }));
}

/**
 * The CLI whose catalog should be warmed before launch, if it is still loading.
 *
 * Paseo tasks do not look up a second CLI. Multitask uses the control, not the
 * legacy provider argument.
 *
 * @param input - The same choice `resolveCreateAgentTaskLaunch` will make
 * @returns A provider id to refresh, or null when the catalog is not needed
 */
export function multitaskProviderToWarm(
  input: Pick<ResolveCreateAgentTaskLaunchInput, "parent" | "taskAgent" | "provider">,
): string | null {
  const request = selectLaunchRequest(input);
  if (request.kind !== "cli") {
    return null;
  }
  return request.provider;
}

function selectLaunchRequest(
  input: Pick<ResolveCreateAgentTaskLaunchInput, "parent" | "taskAgent" | "provider">,
): MultitaskTaskTargetRequest | { kind: "provider-required" } {
  if (input.taskAgent?.kind === "paseo") {
    return { kind: "paseo" };
  }
  if (input.taskAgent?.kind === "cli") {
    return {
      kind: "cli",
      provider: input.taskAgent.provider.trim(),
      model: input.taskAgent.model?.trim() || null,
    };
  }
  if (input.parent?.workflowModeId === "multitask") {
    const stored = decodeMultitaskTaskTarget(input.parent.taskTargetLabel);
    if (stored.kind === "paseo") {
      return { kind: "paseo" };
    }
    return { kind: "cli", provider: stored.provider, model: stored.model };
  }
  const provider = input.provider?.trim() ?? "";
  const slash = provider.indexOf("/");
  if (slash <= 0 || slash === provider.length - 1) {
    return { kind: "provider-required" };
  }
  return {
    kind: "cli",
    provider: provider.slice(0, slash).trim(),
    model: provider.slice(slash + 1).trim() || null,
  };
}

function findLaunchProvider(
  providers: readonly MultitaskLaunchProvider[],
  id: string,
): MultitaskLaunchProvider | undefined {
  const wanted = id.trim().toLowerCase();
  return providers.find((provider) => provider.id.toLowerCase() === wanted);
}

function modeIsListed(modeId: string, available: readonly string[] | undefined): boolean {
  if (available === undefined) {
    return true;
  }
  return available.includes(modeId);
}

function formatProviderArgument(provider: string, model: string | null): string {
  const trimmed = model?.trim() ?? "";
  return trimmed ? `${provider}/${trimmed}` : provider;
}

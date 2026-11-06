import { selectRouterEntryTarget, type ModelRouter } from "@getpaseo/protocol/model-router";
import type { StagedModelTarget } from "@/composer/agent-controls/pending-provider-switch";

/** Advances across distribution picks for this app session. Fallback ignores it. */
let distributionCursor = 0;

/**
 * The model a draft is already showing because the user just picked that router.
 * Creating the chat consumes it, so the next new chat rotates again.
 */
let pinnedEntry: { routerId: string; provider: string; model: string | null } | null = null;

/**
 * Picks the model a chat should switch to when the user binds a router.
 * Fallback returns the first target. Distribution returns the next slot.
 *
 * @param router - The router the user just selected
 * @returns The target, or null when the router has no target
 */
export function takeRouterEntryTarget(router: ModelRouter): {
  provider: string;
  model: string | null;
} | null {
  const picked = selectRouterEntryTarget({ router, cursor: distributionCursor });
  if (!picked) return null;
  distributionCursor = picked.cursor;
  return { provider: picked.target.provider, model: picked.target.model ?? null };
}

/**
 * Stages a router pick as a model switch so the trigger shows that model now
 * and the next send commits it together with the router.
 *
 * @param input - The host, the router id, and the router itself
 * @returns The staged model, or null when the router has no target
 */
export function routerPickAsModel(input: {
  targetServerId: string;
  routerId: string;
  router: ModelRouter;
}): StagedModelTarget | null {
  const target = takeRouterEntryTarget(input.router);
  if (!target) return null;
  return {
    kind: "model",
    targetServerId: input.targetServerId,
    provider: target.provider,
    modelId: target.model ?? "",
    clearRouter: false,
    routerId: input.routerId,
  };
}

/**
 * Remembers the model a draft just switched to, so creating that chat does not
 * pick a second slot.
 *
 * @param routerId - The router the user selected
 * @param provider - The provider now shown in the draft
 * @param model - The model now shown in the draft
 */
export function pinRouterEntry(routerId: string, provider: string, model: string | null): void {
  pinnedEntry = { routerId, provider, model };
}

/**
 * Keeps the pinned model when the draft still shows it, and clears the pin.
 *
 * @param routerId - The default router about to create the chat
 * @param provider - The provider currently shown
 * @param model - The model currently shown
 * @returns Whether the create should keep that model
 */
export function takePinnedRouterEntry(
  routerId: string,
  provider: string,
  model: string | null | undefined,
): boolean {
  const pinned = pinnedEntry;
  if (!pinned || pinned.routerId !== routerId) return false;
  pinnedEntry = null;
  return pinned.provider === provider && (pinned.model ?? "") === (model ?? "");
}

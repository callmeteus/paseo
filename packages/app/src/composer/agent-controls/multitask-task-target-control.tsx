import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Layers } from "lucide-react-native";
import {
  decodeMultitaskTaskTarget,
  encodeMultitaskTaskTarget,
  MULTITASK_TASK_TARGET_LABEL,
  type MultitaskTaskTarget,
} from "@getpaseo/protocol/multitask-task-target";
import { useAgentProfilePicker, type AgentProfileApplyTarget } from "@/agent-profiles";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { useToast } from "@/contexts/toast-context";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

/** Synthetic provider id for "run this task as a Paseo agent". It is not a CLI. */
export const PASEO_TASK_AGENT_PROVIDER_ID = "paseo-agent";

const PASEO_TASK_AGENT_MODEL_ID = "paseo";
const ThemedLayers = withUnistyles(Layers);
const mutedGlyphColor = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const PASEO_TASK_TARGET: MultitaskTaskTarget = { kind: "paseo" };

const draftTargets = new Map<string, MultitaskTaskTarget>();
const draftListeners = new Set<() => void>();

/**
 * The task target stored for a draft chat that does not have an agent id yet.
 *
 * @param key - Draft id shared with the create request
 * @returns The choice, or a Paseo agent when the control has not been changed
 */
export function getDraftMultitaskTaskTarget(key: string): MultitaskTaskTarget {
  return draftTargets.get(key) ?? PASEO_TASK_TARGET;
}

/**
 * Stores the draft task target and notifies the control.
 *
 * @param key - Draft id shared with the create request
 * @param target - Paseo agent, or a CLI and model
 */
export function setDraftMultitaskTaskTarget(key: string, target: MultitaskTaskTarget): void {
  draftTargets.set(key, target);
  for (const listener of draftListeners) {
    listener();
  }
}

/**
 * Subscribes to draft task-target changes.
 *
 * @param listener - Called after any draft target changes
 * @returns Unsubscribe
 */
export function subscribeDraftMultitaskTaskTargets(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

/**
 * Labels to stamp on a new chat when Multitask is selected.
 *
 * Other workflow modes omit the label. The daemon then keeps the normal
 * `create_agent` provider argument.
 *
 * @param key - Draft id the control wrote
 * @param workflowModeId - Workflow selected in the composer
 * @returns The task-target label, or undefined when Multitask is off
 */
export function draftMultitaskTaskTargetLabels(
  key: string,
  workflowModeId: string | null | undefined,
): Record<string, string> | undefined {
  if (workflowModeId !== "multitask") {
    return undefined;
  }
  return {
    [MULTITASK_TASK_TARGET_LABEL]: encodeMultitaskTaskTarget(getDraftMultitaskTaskTarget(key)),
  };
}

/**
 * Reads and writes the task target of a live chat, without changing its model.
 *
 * @param serverId - Host that owns the chat
 * @param agentId - Parent chat
 * @returns The current target and a setter that stores it on the chat's labels
 */
export function useLiveMultitaskTaskTarget(
  serverId: string,
  agentId: string,
): { target: MultitaskTaskTarget; onChange: (target: MultitaskTaskTarget) => void } {
  const encoded = useSessionStore(
    (state) =>
      state.sessions[serverId]?.agents.get(agentId)?.labels?.[MULTITASK_TASK_TARGET_LABEL] ?? null,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();
  const [pending, setPending] = useState<MultitaskTaskTarget | null>(null);

  useEffect(() => {
    if (pending && encodeMultitaskTaskTarget(pending) === (encoded ?? "paseo")) {
      setPending(null);
    }
  }, [encoded, pending]);

  const onChange = useCallback(
    (next: MultitaskTaskTarget) => {
      setPending(next);
      if (!client) {
        return;
      }
      void client
        .updateAgent(agentId, {
          labels: { [MULTITASK_TASK_TARGET_LABEL]: encodeMultitaskTaskTarget(next) },
        })
        .catch((error: unknown) => {
          setPending(null);
          toast.error(toErrorMessage(error));
        });
    },
    [agentId, client, toast],
  );

  return { target: pending ?? decodeMultitaskTaskTarget(encoded), onChange };
}

/**
 * Reads and writes the task target of a draft composer.
 *
 * @param key - Draft id, or null when this composer cannot persist the choice
 * @returns The current target and a setter
 */
export function useDraftMultitaskTaskTarget(key: string | null): {
  target: MultitaskTaskTarget;
  onChange: (target: MultitaskTaskTarget) => void;
} {
  const target = useSyncExternalStore(
    subscribeDraftMultitaskTaskTargets,
    () => (key ? getDraftMultitaskTaskTarget(key) : PASEO_TASK_TARGET),
    () => PASEO_TASK_TARGET,
  );
  const onChange = useCallback(
    (next: MultitaskTaskTarget) => {
      if (!key) {
        return;
      }
      setDraftMultitaskTaskTarget(key, next);
    },
    [key],
  );
  return { target, onChange };
}

/** Props the composer passes into the task selector. The parent model selector stays separate. */
export interface MultitaskTaskTargetBinding {
  serverId: string | null;
  providers: ProviderSelectorProvider[];
  disabled?: boolean;
  target: MultitaskTaskTarget;
  onChange: (target: MultitaskTaskTarget) => void;
}

/**
 * Model selector for the Multitask control.
 *
 * The first row is a Paseo agent. Every other row is a CLI and model the
 * composer already lists. Choosing one does not switch the parent chat's provider.
 */
export function MultitaskTaskTargetControl({
  serverId,
  providers,
  disabled = false,
  target,
  onChange,
  surface,
}: MultitaskTaskTargetBinding & { surface: "toolbar" | "sheet" }) {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  const paseoName = t("agentControls.workflowMode.taskTarget.paseoName");
  const providersWithPaseo = useMemo(() => {
    const paseo: ProviderSelectorProvider = {
      id: PASEO_TASK_AGENT_PROVIDER_ID,
      label: paseoName,
      serverId,
      modelSelection: {
        kind: "models",
        rows: [
          {
            favoriteKey: `${PASEO_TASK_AGENT_PROVIDER_ID}:${PASEO_TASK_AGENT_MODEL_ID}`,
            provider: PASEO_TASK_AGENT_PROVIDER_ID,
            providerLabel: paseoName,
            modelId: PASEO_TASK_AGENT_MODEL_ID,
            modelLabel: paseoName,
            description: t("agentControls.workflowMode.taskTarget.paseoDescription"),
            isDefault: true,
            serverId,
          },
        ],
      },
    };
    return [paseo, ...providers.filter((provider) => provider.id !== PASEO_TASK_AGENT_PROVIDER_ID)];
  }, [paseoName, providers, serverId, t]);
  const providerIds = useMemo(() => providers.map((provider) => provider.id), [providers]);
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({
      kind: "draft",
      controls: {
        applyProfile: (profile) => {
          onChange({
            kind: "cli",
            provider: profile.provider,
            model: profile.modelId.trim() ? profile.modelId : null,
          });
        },
      },
    }),
    [onChange],
  );
  const profiles = useAgentProfilePicker({
    serverId,
    availableProviders: providerIds,
    target: profileTarget,
  });
  const handleSelect = useCallback(
    (provider: string, modelId: string) => {
      if (provider === PASEO_TASK_AGENT_PROVIDER_ID) {
        onChange({ kind: "paseo" });
        return;
      }
      onChange({
        kind: "cli",
        provider,
        model: modelId.trim() ? modelId : null,
      });
    },
    [onChange],
  );
  const valueLabel = useMemo(() => {
    if (target.kind === "paseo") {
      return paseoName;
    }
    const provider = providers.find((entry) => entry.id === target.provider);
    const providerLabel = provider?.label ?? target.provider;
    if (!target.model) {
      return providerLabel;
    }
    if (provider?.modelSelection.kind === "models") {
      const row = provider.modelSelection.rows.find((item) => item.modelId === target.model);
      if (row?.modelLabel) {
        return row.modelLabel;
      }
    }
    return target.model;
  }, [paseoName, providers, target]);

  const toolbar = useMemo(
    () => ({ glyphSize, showCaret: surface === "toolbar" }),
    [glyphSize, surface],
  );
  const renderTrigger = useCallback(
    ({ selectedModelLabel }: { selectedModelLabel: string }) => (
      <View style={styles.chip}>
        <ThemedLayers size={glyphSize} uniProps={mutedGlyphColor} />
        <Text style={styles.label}>{t("agentControls.workflowMode.taskTarget.label")}</Text>
        <Text style={styles.value} numberOfLines={1}>
          {selectedModelLabel || valueLabel}
        </Text>
      </View>
    ),
    [glyphSize, t, valueLabel],
  );

  return (
    <View
      style={surface === "sheet" ? styles.sheet : styles.toolbar}
      testID="multitask-task-target"
    >
      <CombinedModelSelector
        providers={providersWithPaseo}
        selectedProvider={target.kind === "paseo" ? PASEO_TASK_AGENT_PROVIDER_ID : target.provider}
        selectedModel={target.kind === "paseo" ? PASEO_TASK_AGENT_MODEL_ID : (target.model ?? "")}
        onSelect={handleSelect}
        isLoading={false}
        profiles={profiles}
        onApplyProfile={profiles?.applyProfile}
        disabled={disabled}
        serverId={serverId}
        desktopPlacement="top-start"
        desktopMinWidth={280}
        toolbar={toolbar}
        accessibilityLabel={t("agentControls.workflowMode.taskTarget.selectWithValue", {
          value: valueLabel,
        })}
        tooltip={t("agentControls.workflowMode.taskTarget.hint")}
        renderTrigger={renderTrigger}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    minWidth: 0,
    flexShrink: 1,
  },
  sheet: {
    minWidth: 0,
  },
  chip: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  value: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));

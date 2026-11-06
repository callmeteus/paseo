import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { Bug, Layers, ListTodo, MessageCircle, Sparkles } from "lucide-react-native";
import {
  WORKFLOW_MODES as WORKFLOW_MODE_CATALOG,
  type WorkflowModeId,
} from "@getpaseo/protocol/workflow-modes";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import type { AgentControlIcon } from "@/agent-controls/icons";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { resolveNextWorkflowModeId } from "@/composer/agent-controls/mode";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import {
  reduceWorkflowModeSelection,
  type WorkflowModeSelection,
} from "@/utils/workflow-mode-selection";

export type { WorkflowModeId };

export interface WorkflowModeDefinition {
  id: WorkflowModeId;
  labelKey: string;
  descriptionKey: string;
  color: string;
  icon: AgentControlIcon;
}

/**
 * Translated label and icon for each shared mode id. Colors stay on the catalog.
 */
const WORKFLOW_MODE_PRESENTATION: Record<
  WorkflowModeId,
  { labelKey: string; descriptionKey: string; icon: AgentControlIcon }
> = {
  agent: {
    labelKey: "agentControls.workflowMode.modes.agent.label",
    descriptionKey: "agentControls.workflowMode.modes.agent.description",
    icon: Sparkles,
  },
  plan: {
    labelKey: "agentControls.workflowMode.modes.plan.label",
    descriptionKey: "agentControls.workflowMode.modes.plan.description",
    icon: ListTodo,
  },
  ask: {
    labelKey: "agentControls.workflowMode.modes.ask.label",
    descriptionKey: "agentControls.workflowMode.modes.ask.description",
    icon: MessageCircle,
  },
  debug: {
    labelKey: "agentControls.workflowMode.modes.debug.label",
    descriptionKey: "agentControls.workflowMode.modes.debug.description",
    icon: Bug,
  },
  multitask: {
    labelKey: "agentControls.workflowMode.modes.multitask.label",
    descriptionKey: "agentControls.workflowMode.modes.multitask.description",
    icon: Layers,
  },
};

export const WORKFLOW_MODES: WorkflowModeDefinition[] = WORKFLOW_MODE_CATALOG.map((mode) => {
  const presentation = WORKFLOW_MODE_PRESENTATION[mode.id];
  return {
    id: mode.id,
    color: mode.color,
    labelKey: presentation.labelKey,
    descriptionKey: presentation.descriptionKey,
    icon: presentation.icon,
  };
});

const BY_ID = new Map(WORKFLOW_MODES.map((mode) => [mode.id, mode]));

export function resolveWorkflowMode(id: string | null | undefined): WorkflowModeDefinition {
  return (id && BY_ID.get(id as WorkflowModeId)) || WORKFLOW_MODES[0];
}

function WorkflowModeComboboxOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const mode = resolveWorkflowMode(option.id);
  const Icon = mode.icon;
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionLeading}>
        <Icon size={16} color={mode.color} />
      </View>
    ),
    [Icon, mode.color],
  );
  return (
    <ComboboxItem
      label={t(mode.labelKey)}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
      description={t(mode.descriptionKey)}
    />
  );
}

export interface WorkflowModeControlValue {
  selectedWorkflowModeId: string | null | undefined;
  onSelectWorkflowMode: (workflowModeId: string) => void;
  disabled?: boolean;
}

export function WorkflowModeControl({
  selectedWorkflowModeId,
  onSelectWorkflowMode,
  disabled = false,
  surface = "toolbar",
  onClose,
}: WorkflowModeControlValue & { surface?: "toolbar" | "sheet"; onClose?: () => void }) {
  const { t } = useTranslation();
  const { presentation } = useComposerControlLayout();
  const { isActiveComposer } = useComposerKeyboardScope();
  const cycleShortcutKeys = useShortcutKeys("cycle-agent-mode");
  const anchorRef = useRef<View>(null);
  const keyboardHandlerIdRef = useRef(
    `workflow-mode-control:${Math.random().toString(36).slice(2)}`,
  );
  const [open, setOpen] = useState(false);

  const selected = resolveWorkflowMode(selectedWorkflowModeId);
  const Icon = selected.icon;
  const selectedLabel = t(selected.labelKey);
  const options = useMemo<ComboboxOption[]>(
    () => WORKFLOW_MODES.map((mode) => ({ id: mode.id, label: t(mode.labelKey) })),
    [t],
  );

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "message-input.mode-cycle") return false;
      if (disabled) return false;
      const nextModeId = resolveNextWorkflowModeId({
        modeOptions: WORKFLOW_MODES,
        selectedMode: selectedWorkflowModeId,
      });
      if (!nextModeId) return false;
      onSelectWorkflowMode(nextModeId);
      return true;
    },
    [disabled, onSelectWorkflowMode, selectedWorkflowModeId],
  );

  useKeyboardActionHandler({
    handlerId: keyboardHandlerIdRef.current,
    actions: ["message-input.mode-cycle"],
    enabled: isActiveComposer && !disabled && WORKFLOW_MODES.length > 1,
    priority: 250,
    handle: handleKeyboardAction,
  });

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) onClose?.();
    },
    [onClose],
  );
  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  const handleSelect = useCallback(
    (id: string) => {
      onSelectWorkflowMode(id);
      handleOpenChange(false);
    },
    [onSelectWorkflowMode, handleOpenChange],
  );

  const renderOption = useCallback(
    (args: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }): ReactElement => <WorkflowModeComboboxOption {...args} />,
    [],
  );

  const sheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.workflowMode.title") }),
    [t],
  );

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            ref={anchorRef}
            icon={Icon}
            iconColor={selected.color}
            surface={surface}
            label={t("agentControls.workflowMode.title")}
            value={selectedLabel}
            showToolbarLabel={presentation.showModeLabel}
            showCaret={surface === "toolbar" && presentation.showCarets}
            open={open}
            disabled={disabled}
            onPress={handlePress}
            accessibilityLabel={t("agentControls.workflowMode.selectWithValue", {
              value: selectedLabel,
            })}
            testID="workflow-mode-control"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <View style={styles.tooltipRow}>
            <Text style={styles.tooltipText}>{t("agentControls.workflowMode.hint")}</Text>
            {isActiveComposer && cycleShortcutKeys ? <Shortcut chord={cycleShortcutKeys} /> : null}
          </View>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={options}
        value={selected.id}
        onSelect={handleSelect}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={260}
        header={sheetHeader}
        renderOption={renderOption}
      />
    </>
  );
}

function workflowModeSelectionOf(agent: {
  workflowModeId?: string | null;
  workflowModeRevision?: number;
}): WorkflowModeSelection {
  return {
    modeId: agent.workflowModeId ?? null,
    revision: agent.workflowModeRevision ?? 0,
  };
}

function writeWorkflowModeSelection(
  serverId: string,
  agentId: string,
  next: WorkflowModeSelection,
): void {
  useSessionStore.getState().setAgents(serverId, (current) => {
    const agent = current.get(agentId);
    if (!agent) return current;
    if (
      (agent.workflowModeId ?? null) === next.modeId &&
      (agent.workflowModeRevision ?? 0) === next.revision
    ) {
      return current;
    }
    const updated = new Map(current);
    updated.set(agentId, {
      ...agent,
      workflowModeId: next.modeId,
      workflowModeRevision: next.revision,
    });
    return updated;
  });
}

export function useLiveWorkflowModeControl(
  serverId: string,
  agentId: string,
): WorkflowModeControlValue | null {
  const slice = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      if (!agent) return null;
      return {
        workflowModeId: agent.workflowModeId ?? null,
      };
    }),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();
  const requestSequence = useRef(0);

  const handleSelect = useCallback(
    (workflowModeId: string) => {
      if (!client) return;
      const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
      const current = agent ? workflowModeSelectionOf(agent) : { modeId: null, revision: 0 };
      const chosen = reduceWorkflowModeSelection(current, {
        type: "choose",
        modeId: workflowModeId,
      });
      if (agent) writeWorkflowModeSelection(serverId, agentId, chosen);
      const requestId = ++requestSequence.current;
      const requestRevision = chosen.revision;
      const previousModeId = current.modeId;
      void client
        .setAgentWorkflowMode(agentId, workflowModeId)
        .then((applied) => {
          if (requestId !== requestSequence.current) return undefined;
          console.log("[WorkflowModeControl] setAgentWorkflowMode result:", applied);
          const live = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
          const confirmed = reduceWorkflowModeSelection(
            live ? workflowModeSelectionOf(live) : chosen,
            { type: "confirm", modeId: applied ?? workflowModeId, revision: requestRevision },
          );
          writeWorkflowModeSelection(serverId, agentId, confirmed);
          return undefined;
        })
        .catch((error: unknown) => {
          if (requestId !== requestSequence.current) return;
          console.warn("[WorkflowModeControl] setAgentWorkflowMode failed", error);
          const live = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
          const rejected = reduceWorkflowModeSelection(
            live ? workflowModeSelectionOf(live) : chosen,
            { type: "reject", revision: requestRevision, modeId: previousModeId },
          );
          writeWorkflowModeSelection(serverId, agentId, rejected);
          toast.error(toErrorMessage(error));
        });
    },
    [agentId, client, serverId, toast],
  );

  return useMemo(() => {
    if (!slice) return null;
    return {
      selectedWorkflowModeId: slice.workflowModeId,
      onSelectWorkflowMode: handleSelect,
      disabled: !client,
    };
  }, [client, handleSelect, slice]);
}

const styles = StyleSheet.create((theme) => ({
  optionLeading: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));

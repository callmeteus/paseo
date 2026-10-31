import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { Bug, Layers, ListTodo, MessageCircle, Sparkles } from "lucide-react-native";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import type { AgentControlIcon } from "@/agent-controls/icons";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";

export type WorkflowModeId = "agent" | "plan" | "ask" | "debug" | "multitask";

export interface WorkflowModeDefinition {
  id: WorkflowModeId;
  labelKey: string;
  descriptionKey: string;
  color: string;
  icon: AgentControlIcon;
}

/** Mirrors the daemon's workflow mode table. Labels and descriptions are translated. */
export const WORKFLOW_MODES: WorkflowModeDefinition[] = [
  {
    id: "agent",
    labelKey: "agentControls.workflowMode.modes.agent.label",
    descriptionKey: "agentControls.workflowMode.modes.agent.description",
    color: "#3b82f6",
    icon: Sparkles,
  },
  {
    id: "plan",
    labelKey: "agentControls.workflowMode.modes.plan.label",
    descriptionKey: "agentControls.workflowMode.modes.plan.description",
    color: "#eab308",
    icon: ListTodo,
  },
  {
    id: "ask",
    labelKey: "agentControls.workflowMode.modes.ask.label",
    descriptionKey: "agentControls.workflowMode.modes.ask.description",
    color: "#8b5cf6",
    icon: MessageCircle,
  },
  {
    id: "debug",
    labelKey: "agentControls.workflowMode.modes.debug.label",
    descriptionKey: "agentControls.workflowMode.modes.debug.description",
    color: "#f97316",
    icon: Bug,
  },
  {
    id: "multitask",
    labelKey: "agentControls.workflowMode.modes.multitask.label",
    descriptionKey: "agentControls.workflowMode.modes.multitask.description",
    color: "#22c55e",
    icon: Layers,
  },
];

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
        <View style={[styles.colorDot, { backgroundColor: mode.color }]} />
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
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const selected = resolveWorkflowMode(selectedWorkflowModeId);
  const Icon = selected.icon;
  const selectedLabel = t(selected.labelKey);
  const options = useMemo<ComboboxOption[]>(
    () => WORKFLOW_MODES.map((mode) => ({ id: mode.id, label: t(mode.labelKey) })),
    [t],
  );

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

  const handleSelect = useCallback(
    (workflowModeId: string) => {
      if (!client) return;
      void client.setAgentWorkflowMode(agentId, workflowModeId).catch((error: unknown) => {
        console.warn("[WorkflowModeControl] setAgentWorkflowMode failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, client, toast],
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
  colorDot: {
    position: "absolute",
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
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

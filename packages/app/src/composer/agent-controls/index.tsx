import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import {
  View,
  Pressable,
  Keyboard,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { Settings2 } from "lucide-react-native";
import { resolveForcedLiveModeId } from "@/agent-controls/policy";
import { ChatModeToggle } from "@/composer/agent-controls/chat-mode-toggle";
import { MaestroModeControl } from "@/composer/agent-controls/maestro-control";
import { readSelectOption, type ComposerOptionControls } from "@/agent-controls/option-controls";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { resolveModelPriceTier } from "@/model-pricing/tier";
import {
  disabledModelIdsByProviderFromConfig,
  omitDisabledModels,
  type DisabledModelIdsByProvider,
} from "@getpaseo/protocol/disabled-models";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useSessionStore } from "@/stores/session-store";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { useAppSettings } from "@/hooks/use-settings";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import { mergeProviderPreferences, useFormPreferences } from "@/hooks/use-form-preferences";
import {
  AgentModeControl,
  useLiveAgentModeControl,
  type AgentModeControlValue,
} from "@/composer/agent-controls/mode-control";
import {
  WorkflowModeControl,
  useLiveWorkflowModeControl,
  type WorkflowModeControlValue,
} from "@/composer/agent-controls/workflow-mode-control";
import {
  MultitaskTaskTargetControl,
  useDraftMultitaskTaskTarget,
  useLiveMultitaskTaskTarget,
  type MultitaskTaskTargetBinding,
} from "@/composer/agent-controls/multitask-task-target-control";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import type {
  AgentOptionControl,
  JsonValue,
  ProviderOptions,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import {
  getAgentControlHintKey,
  resolveAgentModelSelection,
  resolveProviderSnapshotEntry,
} from "@/composer/agent-controls/utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  controlSizingForLayout,
  TOOLBAR_CONTROL_GAP,
  toolbarGlyphColor,
  type ToolbarGlyphs,
  toolbarSlot,
} from "@/components/ui/control-geometry";
import { readMeasuredWidth } from "@/hooks/use-container-width";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import {
  clearProviderSwitch,
  planProviderSwitch,
  resolveDisplayModelId,
  resolveDisplayProvider,
  resolveDisplayRouterId,
  stageProviderSwitch,
  updateStagedProviderModel,
  usePendingProviderSwitch,
} from "@/composer/agent-controls/pending-provider-switch";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import {
  useAgentControlCommandCenterActions,
  type AgentControlCommandCenterSource,
} from "@/command-center/agent-control-registration";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import {
  composerToolbarGeometry,
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  type ComposerControlDensity,
  type ComposerControlPresentation,
} from "@/composer/agent-controls/layout";
import { ComposerControlLayoutProvider } from "@/composer/agent-controls/layout-context";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import {
  ComposerControls,
  ControlTooltipHint,
  type ComposerControlItem,
} from "@/composer/agent-controls/composer-control";
import {
  useAgentControlItems,
  useEffortCycleShortcut,
  useModelPickerShortcut,
} from "@/composer/agent-controls/control-items";
import { CompactModelSheet } from "@/composer/agent-controls/model-sheet";
import { useComposerSheetBridge } from "@/composer/agent-controls/sheet-bridge";
import { draftComposerAgent } from "@/composer/draft/composer-agent";
import { agentComposer } from "@/composer/agent-composer";
import { composerModelFromHalves } from "@/composer/halves-model";
import { ComposerModelProvider } from "@/composer/model";
import { ComposerAgentProvider, useComposerInput } from "@/composer/session";
import { PluginComposerItems, usePluginComposerItemCount } from "@/plugins/composer-items";
import {
  PluginToolbarSlot,
  usePluginToolbarWidth,
} from "@/composer/agent-controls/plugin-toolbar-slot";
import {
  useAgentProfileEditor,
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
  type AgentProfileEditorControls,
  type AgentProfilePicker,
  type AgentProfileSeed,
  type DraftAgentProfileControls,
} from "@/agent-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useStagedRouterTarget } from "@/model-routers/use-staged-router-target";
import { routerPickAsModel } from "@/model-routers/entry-target";
import {
  useModelPickerRequest,
  useModelPickerRequestStore,
} from "@/composer/model-picker-request-store";
import { commitPickedModelAndRetry } from "@/agent-stream/switch-model-and-retry";
import {
  finishPortingActivity,
  startPortingActivity,
} from "@/composer/agent-controls/porting-activity";
import { navigateToAgent } from "@/utils/navigate-to-agent";

interface AgentControlOption {
  id: string;
  label: string;
}

const EMPTY_AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [];
const EMPTY_OPTIONS: ProviderOptions = {};

interface ControlledAgentControlsProps {
  agentId?: string;
  serverId?: string;
  isOpenUIChat?: boolean;
  isMaestroChat?: boolean;
  maestroScope?: "workspace" | "all";
  supportsMaestro?: boolean;
  provider: string;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string, serverId?: string | null) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  modelSelectorProviders?: ProviderSelectorProvider[];
  agentProfiles?: AgentProfilePicker | null;
  onApplyAgentProfile?: (profileId: string) => void;
  onEditAgentProfiles?: () => void;
  onCreateAgentProfile?: (seed: AgentProfileSeed) => void;
  onEditAgentProfile?: (profileId: string) => void;
  optionControls?: ComposerOptionControls;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  modeControl?: AgentModeControlValue | null;
  workflowModeControl?: WorkflowModeControlValue | null;
  multitaskTaskTarget?: MultitaskTaskTargetBinding | null;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
  /** Router the chat is bound to (or staged), for the selector subtitle. */
  activeRouterId?: string | null;
  /** Called after the user picks (or clears) a router in the model selector. */
  onRouterPicked?: (routerId: string | null) => void;
  modelPickerOpenNonce?: number;
}

export interface DraftAgentControlsProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  selectedWorkflowMode: string;
  onSelectWorkflowMode: (workflowModeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  effectiveModelId: string;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (
    provider: AgentProvider,
    modelId: string,
    serverId?: string | null,
  ) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  onApplyAgentProfile: DraftAgentProfileControls["applyProfile"];
  /** The controls the daemon described for the draft; absent until it answers. */
  optionControls?: ComposerOptionControls;
  /** What the draft will create with, edits included, whether or not the daemon has answered. */
  options: ProviderOptions;
  onSetOption: (key: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
  activeRouterId?: string | null;
  onRouterPicked?: (routerId: string | null) => void;
  /** Draft id used to remember where Multitask tasks run before the chat exists. */
  multitaskTaskTargetKey?: string | null;
  /** OpenUI Chat hides the workflow-mode picker; code Agents keep it. */
  hideWorkflowMode?: boolean;
  /** Which composer a plugin's `useComposer()` reports. */
  context?: "draft" | "new-workspace";
  /** What plugins set on the agent this draft creates. */
  metadata: Record<string, JsonValue>;
  onSetMetadata: (patch: Record<string, JsonValue>) => void;
}

interface AgentControlsProps {
  showToolbar: boolean;
  agentId: string;
  serverId: string;
  onDropdownClose?: () => void;
  isCompactLayout?: boolean;
}

function AgentControlCommandCenterRegistration({
  sourceId,
  enabled,
  controls,
}: {
  sourceId: string;
  enabled: boolean;
  controls: AgentControlCommandCenterSource;
}) {
  const { isCommandCenterTarget } = useComposerKeyboardScope();
  useAgentControlCommandCenterActions({
    sourceId,
    enabled: enabled && isCommandCenterTarget,
    controls,
  });
  return null;
}

function findOptionLabel(
  options: AgentControlOption[] | undefined,
  selectedId: string | undefined,
  fallback: string,
) {
  if (!options || options.length === 0) {
    return fallback;
  }
  const selected = options.find((option) => option.id === selectedId);
  return selected?.label ?? fallback;
}

function toCommandCenterModes(modeControl: AgentModeControlValue | null) {
  if (!modeControl) return undefined;
  return {
    options: modeControl.modeOptions,
    selectedId: modeControl.selectedModeId,
    select: modeControl.onSelectMode,
  };
}

function getModeProviderDefinitions(modeControl: AgentModeControlValue | null) {
  return modeControl?.providerDefinitions ?? EMPTY_AGENT_PROVIDER_DEFINITIONS;
}

function useModeControls(serverId: string, agentId: string, supportsWorkflowModes: boolean) {
  const workflowModeSource = useAppSettings().settings.workflowModeSource;
  const usesPaseoWorkflowModes = workflowModeSource === "paseo" && supportsWorkflowModes;
  const liveModeControl = useLiveAgentModeControl(serverId, agentId);
  const liveWorkflowModeControl = useLiveWorkflowModeControl(serverId, agentId);
  // Only OpenUI Chats hide the mode picker. Code Agents keep the selector.
  const isOpenUIChat = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.labels?.["paseo.openui"] === "1",
  );
  const maestroLabels = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.labels ?? null,
  );
  const isMaestroChat = maestroLabels?.["paseo.maestro"] === "1";
  const maestroScope: "workspace" | "all" =
    maestroLabels?.["paseo.maestro.scope"] === "all" ? "all" : "workspace";
  const supportsMaestro = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.maestro === true,
  );
  return {
    usesPaseoWorkflowModes,
    isOpenUIChat,
    isMaestroChat,
    maestroScope,
    supportsMaestro,
    modeControl: !usesPaseoWorkflowModes && !isOpenUIChat ? liveModeControl : null,
    workflowModeControl: usesPaseoWorkflowModes && !isOpenUIChat ? liveWorkflowModeControl : null,
  };
}

/**
 * The product hides the provider permission-mode picker and always runs chats
 * in Build while Paseo workflow modes are active. Providers that do not
 * advertise Build keep their default mode.
 */
function useForceAgentMode(serverId: string, agentId: string, enabled: boolean): void {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const agent = useSessionStore(
    useShallow((state) => {
      const current = state.sessions[serverId]?.agents?.get(agentId);
      if (!current) return null;
      return {
        currentModeId: current.currentModeId,
        forcedModeId: resolveForcedLiveModeId(current.availableModes, current.currentModeId),
      };
    }),
  );

  useEffect(() => {
    if (!enabled || !client || !agent?.forcedModeId) {
      return;
    }
    if (agent.currentModeId === agent.forcedModeId) {
      return;
    }
    void client.setAgentMode(agentId, agent.forcedModeId).catch((error: unknown) => {
      console.warn("[AgentControls] force permission mode failed", error);
    });
  }, [agent, agentId, client, enabled]);
}

/**
 * The product runs every chat in the Agent workflow mode and hides the mode
 * picker, so an agent carried over from Plan/Ask/Debug snaps back to Agent.
 */
function useForceWorkflowAgentMode(serverId: string, agentId: string, enabled: boolean): void {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const workflowModeId = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.workflowModeId ?? null,
  );

  useEffect(() => {
    if (!enabled || !client || workflowModeId === "agent") {
      return;
    }
    void client.setAgentWorkflowMode(agentId, "agent").catch((error: unknown) => {
      console.warn("[AgentControls] force workflow agent mode failed", error);
    });
  }, [agentId, client, enabled, workflowModeId]);
}

type ActiveSheet = "features" | null;

function resolveHasAnyControl({
  canSelectModel,
  thinkingOptions,
  controls,
  hasMode,
  hasWorkflowMode,
  pluginItemCount,
  hasChatMode,
}: {
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  controls: readonly AgentOptionControl[] | undefined;
  hasMode: boolean;
  hasWorkflowMode: boolean;
  pluginItemCount: number;
  hasChatMode: boolean;
}) {
  return (
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(controls?.length) ||
    hasMode ||
    hasWorkflowMode ||
    pluginItemCount > 0 ||
    hasChatMode
  );
}

function toThinkingControlOptions(options: AgentControlOption[] | undefined): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
  }));
}

/**
 * The picker's edit shortcut. Agent profiles are host config, so it lands on the
 * host settings section that owns the list.
 */
function useEditAgentProfilesNavigation(
  serverId: string | null,
  isSupported: boolean,
): (() => void) | undefined {
  const handleEdit = useCallback(() => {
    if (!serverId) return;
    router.push(buildSettingsHostSectionRoute(serverId, "agents"));
  }, [serverId]);
  return serverId && isSupported ? handleEdit : undefined;
}

function resolveAgentProfileEditorActions(
  isSupported: boolean,
  editor: AgentProfileEditorControls,
): {
  create?: (seed: AgentProfileSeed) => void;
  edit?: (profileId: string) => void;
} {
  if (!isSupported) {
    return {};
  }
  return {
    create: editor.openCreateFromModel,
    edit: editor.openEdit,
  };
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: `${provider}:${option.id}`,
          provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
          priceTier: resolveModelPriceTier({ id: option.id, label: option.label }),
        })),
      },
    },
  ];
}

function pickSheetModel({
  nextProviderId,
  modelId,
  onSelectProviderAndModel,
  onSelectModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string, serverId?: string | null) => void;
  onSelectModel?: (modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  onSelectModel?.(modelId);
}

function pickDesktopModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectModel,
  onSelectProviderAndModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string, serverId?: string | null) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId === currentProvider) {
    onSelectModel?.(modelId);
  }
}

type AgentControlsSlice = {
  provider: string;
  cwd: string | null;
  runtimeModelId: string | null;
  model: string | null | undefined;
  modelRouterId: string | null | undefined;
  options: ProviderOptions | undefined;
  controls: AgentOptionControl[] | undefined;
  runtimeThinkingOptionId: string | null;
  thinkingOptionId: string | null | undefined;
  lastUsage: unknown;
  metadata: Record<string, JsonValue> | undefined;
} | null;

function selectAgentControlsSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  return {
    provider: currentAgent.provider,
    cwd: currentAgent.cwd,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    model: currentAgent.model,
    modelRouterId: currentAgent.modelRouterId ?? null,
    options: currentAgent.options,
    controls: currentAgent.controls,
    runtimeThinkingOptionId: currentAgent.runtimeInfo?.thinkingOptionId ?? null,
    thinkingOptionId: currentAgent.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
    metadata: currentAgent.metadata,
  };
}

function resolveSnapshotSelectedEntry(
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
  agentProvider: string | undefined,
) {
  if (!snapshotEntries || !agentProvider) {
    return null;
  }
  return snapshotEntries.find((e) => e.provider === agentProvider) ?? null;
}

function selectableModelsForEntry(
  entry: ReturnType<typeof resolveSnapshotSelectedEntry>,
  config: { providers?: Parameters<typeof disabledModelIdsByProviderFromConfig>[0] } | null,
): {
  disabledModelIdsByProvider: DisabledModelIdsByProvider;
  models: AgentModelDefinition[] | null;
} {
  const disabledModelIdsByProvider = disabledModelIdsByProviderFromConfig(config?.providers);
  return {
    disabledModelIdsByProvider,
    models: omitDisabledModels(
      filterSelectableModels(entry?.models ?? null),
      entry ? disabledModelIdsByProvider[entry.provider] : undefined,
    ),
  };
}

function resolveSnapshotModeIds(
  entry: ReturnType<typeof resolveProviderSnapshotEntry>,
): string[] | null {
  if (entry?.status !== "ready" || !entry.modes) {
    return null;
  }
  return entry.modes.map((mode) => mode.id);
}

function buildAgentProviderDefinitions(
  agentProvider: string | undefined,
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
): AgentProviderDefinition[] {
  const definition = agentProvider
    ? resolveProviderDefinition(agentProvider, snapshotEntries)
    : undefined;
  return definition ? [definition] : [];
}

function buildAgentProviderModels(
  agentProvider: string | undefined,
  models: AgentModelDefinition[] | null,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  if (agentProvider && models) {
    map.set(agentProvider, models);
  }
  return map;
}

function densityFolds(density: ComposerControlDensity): boolean {
  return resolveComposerControlPresentation(density).foldControls;
}

// oxlint-disable-next-line complexity
function ControlledAgentControls({
  agentId,
  serverId,
  isOpenUIChat,
  isMaestroChat = false,
  maestroScope = "workspace",
  supportsMaestro = false,
  provider,
  modelOptions,
  selectedModelId,
  onSelectModel,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  agentProfiles = null,
  onApplyAgentProfile,
  onEditAgentProfiles,
  onCreateAgentProfile,
  onEditAgentProfile,
  optionControls,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  modeControl,
  workflowModeControl,
  multitaskTaskTarget = null,
  modelSelectorServerId = null,
  isCompactLayout,
  activeRouterId,
  onRouterPicked,
  modelPickerOpenNonce,
}: ControlledAgentControlsProps) {
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  // Control sizes follow the window layout, as the toolbar's stylesheet does. A narrow pane in a
  // wide window (`isCompactLayout`) changes which labels show, never how large a control is.
  const toolbarSizing = controlSizingForLayout(isCompactFormFactor);
  const toolbarGeometry = useMemo(() => composerToolbarGeometry(toolbarSizing), [toolbarSizing]);
  const { fontScale } = useWindowDimensions();
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [openSelector, setOpenSelector] = useState<string | null>(null);
  // A compact composer always folds its controls into the model sheet; the width budget only
  // decides whether the model keeps its label.
  const minimumDensity: ComposerControlDensity = isCompact ? "compact" : "full";
  const initialDensity = minimumDensity;
  const [density, setDensity] = useState<ComposerControlDensity>(initialDensity);
  const densityRef = useRef<ComposerControlDensity>(initialDensity);
  const availableWidthRef = useRef(0);

  const canSelectModel = Boolean(onSelectModel);
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );
  const pluginItemCount = usePluginComposerItemCount(modelSelectorServerId);
  const { width: pluginItemsWidth, onLayout: handlePluginItemsLayout } = usePluginToolbarWidth();

  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions),
    [thinkingOptions],
  );
  const displayThinking = findOptionLabel(
    formattedThinkingOptions,
    selectedThinkingOptionId,
    formattedThinkingOptions[0]?.label ?? t("agentControls.thinking.unknown"),
  );

  const hasAnyControl = resolveHasAnyControl({
    canSelectModel,
    thinkingOptions,
    controls: optionControls?.controls,
    hasMode: modeControl !== null && modeControl !== undefined,
    hasWorkflowMode: workflowModeControl !== null && workflowModeControl !== undefined,
    pluginItemCount,
    hasChatMode: Boolean(agentId && serverId),
  });
  const featureControls = useMemo(
    () =>
      (optionControls?.controls ?? []).map((control) => {
        if (control.type === "toggle") return { type: "toggle" as const };
        if (control.desktopTrigger === "icon") return { type: "select" as const, label: null };
        const selected = readSelectOption(control, optionControls?.options ?? {});
        const choice = control.choices.find((candidate) => candidate.value === selected);
        return {
          type: "select" as const,
          label: choice?.label ?? control.label,
        };
      }),
    [optionControls],
  );
  let chatModeLabel: string | null = null;
  if (agentId && serverId) {
    chatModeLabel = isOpenUIChat
      ? t("composer.chatModeToggle.chat")
      : t("composer.chatModeToggle.agent");
  }
  const controlPresence = useMemo(
    () => ({
      hasModel: canSelectModel,
      hasThinking: canSelectThinking,
      hasMode: modeControl !== null && modeControl !== undefined,
      features: featureControls,
      pluginItemsWidth,
      fontScale,
      chatModeLabel,
    }),
    [
      canSelectModel,
      canSelectThinking,
      chatModeLabel,
      featureControls,
      fontScale,
      modeControl,
      pluginItemsWidth,
    ],
  );
  const presentation = useMemo(() => resolveComposerControlPresentation(density), [density]);
  const layoutContextValue = useMemo(
    () => ({
      glyphs: toolbarGeometry.glyphs,
      presentation,
    }),
    [presentation, toolbarGeometry],
  );

  const updateDensityForWidth = useCallback(
    (availableWidth: number) => {
      const nextDensity = resolveComposerControlDensity({
        availableWidth,
        currentDensity: densityRef.current,
        controls: controlPresence,
        geometry: toolbarGeometry,
        minimumDensity,
      });
      if (nextDensity === densityRef.current) return;
      // Folding swaps the toolbar controls for the model sheet and back, so whatever menu or
      // sheet was open belonged to controls that are gone.
      if (densityFolds(nextDensity) !== densityFolds(densityRef.current)) {
        setOpenSelector(null);
        setActiveSheet(null);
      }
      densityRef.current = nextDensity;
      setDensity(nextDensity);
    },
    [controlPresence, minimumDensity, toolbarGeometry],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const availableWidth = readMeasuredWidth(event);
      if (availableWidth === null) return;
      availableWidthRef.current = availableWidth;
      updateDensityForWidth(availableWidth);
    },
    [updateDensityForWidth],
  );

  useEffect(() => {
    if (availableWidthRef.current > 0) {
      updateDensityForWidth(availableWidthRef.current);
    }
  }, [updateDensityForWidth]);

  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;

  const thinking = useMemo(
    () =>
      canSelectThinking && onSelectThinkingOption
        ? {
            options: formattedThinkingOptions,
            selectedId: selectedThinkingOptionId,
            onSelect: onSelectThinkingOption,
            displayLabel: displayThinking,
          }
        : null,
    [
      canSelectThinking,
      displayThinking,
      formattedThinkingOptions,
      onSelectThinkingOption,
      selectedThinkingOptionId,
    ],
  );
  const effortKeys = useEffortCycleShortcut(thinking, disabled);
  const items = useAgentControlItems({
    surface: presentation.foldControls ? "sheet" : "toolbar",
    presentation,
    thinking,
    optionControls,
  });

  const handleToolbarOpenChange = useCallback(
    (id: string | null) => {
      setOpenSelector(id);
      if (id === null) onDropdownClose?.();
    },
    [onDropdownClose],
  );

  const handleDesktopModelSelect = useCallback(
    (nextProviderId: string, modelId: string, targetServerId?: string | null) => {
      pickDesktopModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectModel,
        onSelectProviderAndModel: onSelectProviderAndModel
          ? (p, m) => onSelectProviderAndModel(p, m, targetServerId)
          : undefined,
      });
    },
    [onSelectModel, onSelectProviderAndModel, provider],
  );

  const handleOpenSheet = useCallback((sheet: Exclude<ActiveSheet, null>) => {
    Keyboard.dismiss();
    setActiveSheet(sheet);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
    if (!presentation.foldControls) onDropdownClose?.();
  }, [onDropdownClose, presentation.foldControls]);

  const handleSheetModelSelect = useCallback(
    (nextProviderId: string, modelId: string, targetServerId?: string | null) => {
      pickSheetModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectProviderAndModel: onSelectProviderAndModel
          ? (p, m) => onSelectProviderAndModel(p, m, targetServerId)
          : undefined,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProviderAndModel, provider],
  );

  if (!hasAnyControl) {
    return null;
  }

  const modelPickerNonce = modelPickerOpenNonce ?? 0;
  const chatModeToggle =
    agentId && serverId ? (
      <View style={styles.modeControlsRow}>
        <ChatModeToggle
          agentId={agentId}
          serverId={serverId}
          isOpenUIChat={Boolean(isOpenUIChat)}
          isMaestro={isMaestroChat}
        />
        {supportsMaestro ? (
          <MaestroModeControl
            agentId={agentId}
            serverId={serverId}
            isMaestro={isMaestroChat}
            scope={maestroScope}
          />
        ) : null}
      </View>
    ) : null;

  return (
    <ComposerControlLayoutProvider value={layoutContextValue}>
      <View style={styles.container} onLayout={handleLayout} testID="agent-controls-toolbar">
        {!presentation.foldControls ? (
          <DesktopAgentControlsContent
            provider={provider}
            selectedModelId={selectedModelId}
            thinkingItems={items.thinking}
            effortKeys={effortKeys}
            featureItems={items.features}
            onApplyAgentProfile={onApplyAgentProfile}
            onEditAgentProfiles={onEditAgentProfiles}
            onCreateAgentProfile={onCreateAgentProfile}
            onEditAgentProfile={onEditAgentProfile}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            agentProfiles={agentProfiles}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectModel={canSelectModel}
            modelSelectorProviders={effectiveModelSelectorProviders}
            openSelector={openSelector}
            handleDesktopModelSelect={handleDesktopModelSelect}
            handleToolbarOpenChange={handleToolbarOpenChange}
            handleSheetOpenChange={setOpenSelector}
            modeControl={modeControl}
            workflowModeControl={workflowModeControl}
            multitaskTaskTarget={multitaskTaskTarget}
            presentation={presentation}
            hasPluginItems={pluginItemsWidth > 0}
            glyphs={layoutContextValue.glyphs}
            activeSheet={activeSheet}
            handleOpenSheet={handleOpenSheet}
            handleCloseSheet={handleCloseSheet}
            modelSelectorServerId={modelSelectorServerId}
            onRouterPicked={onRouterPicked}
            activeRouterId={activeRouterId}
            modelPickerOpenNonce={modelPickerNonce}
          />
        ) : (
          <SheetAgentControlsContent
            provider={provider}
            selectedModelId={selectedModelId}
            thinkingItems={items.thinking}
            effortKeys={effortKeys}
            featureItems={items.features}
            onApplyAgentProfile={onApplyAgentProfile}
            onEditAgentProfiles={onEditAgentProfiles}
            onCreateAgentProfile={onCreateAgentProfile}
            onEditAgentProfile={onEditAgentProfile}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            agentProfiles={agentProfiles}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectModel={canSelectModel}
            modelSelectorProviders={effectiveModelSelectorProviders}
            openSelector={openSelector}
            displayThinking={thinking ? displayThinking : null}
            handleSheetModelSelect={handleSheetModelSelect}
            handleSheetOpenChange={setOpenSelector}
            modeControl={modeControl}
            workflowModeControl={workflowModeControl}
            multitaskTaskTarget={multitaskTaskTarget}
            glyphs={layoutContextValue.glyphs}
            showLabels={presentation.showModelLabel}
            presentation={presentation}
            activeSheet={activeSheet}
            handleOpenSheet={handleOpenSheet}
            handleCloseSheet={handleCloseSheet}
            modelSelectorServerId={modelSelectorServerId}
            canSwitchProvider={Boolean(onSelectProviderAndModel)}
            onRouterPicked={onRouterPicked}
            activeRouterId={activeRouterId}
            modelPickerOpenNonce={modelPickerNonce}
            chatModeAgentId={agentId}
            chatModeServerId={serverId}
            chatModeIsOpenUIChat={Boolean(isOpenUIChat)}
            chatModeIsMaestro={Boolean(isMaestroChat)}
            chatModeMaestroScope={maestroScope}
            supportsMaestro={supportsMaestro}
          />
        )}
        {!isCompact ? (
          <PluginToolbarSlot
            serverId={modelSelectorServerId}
            width={pluginItemsWidth}
            fits={!presentation.aggregateFeatures}
            onLayout={handlePluginItemsLayout}
          />
        ) : null}
        {!isCompact ? chatModeToggle : null}
      </View>
    </ComposerControlLayoutProvider>
  );
}

interface AgentControlsContentProps {
  provider: string;
  selectedModelId?: string;
  thinkingItems: ComposerControlItem[];
  effortKeys: ReturnType<typeof useShortcutKeys>;
  featureItems: ComposerControlItem[];
  onApplyAgentProfile?: (profileId: string) => void;
  onEditAgentProfiles?: () => void;
  onCreateAgentProfile?: (seed: AgentProfileSeed) => void;
  onEditAgentProfile?: (profileId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  agentProfiles: AgentProfilePicker | null;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectModel: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  openSelector: string | null;
  handleSheetOpenChange: (id: string | null) => void;
  modeControl?: AgentModeControlValue | null;
  workflowModeControl?: WorkflowModeControlValue | null;
  multitaskTaskTarget?: MultitaskTaskTargetBinding | null;
  presentation: ComposerControlPresentation;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  glyphs: ToolbarGlyphs;
  modelSelectorServerId: string | null;
  activeRouterId?: string | null;
  onRouterPicked?: (routerId: string | null) => void;
  modelPickerOpenNonce?: number;
}

interface DesktopAgentControlsContentProps extends AgentControlsContentProps {
  handleDesktopModelSelect: (providerId: string, modelId: string) => void;
  handleToolbarOpenChange: (id: string | null) => void;
  presentation: ComposerControlPresentation;
  hasPluginItems: boolean;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
}

function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {
  const sheetBridge = useComposerSheetBridge();
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const {
    provider,
    selectedModelId,
    thinkingItems,
    effortKeys,
    featureItems,
    onApplyAgentProfile,
    onEditAgentProfiles,
    onCreateAgentProfile,
    onEditAgentProfile,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    agentProfiles,
    disabled,
    isModelLoading,
    canSelectModel,
    modelSelectorProviders,
    openSelector,
    handleDesktopModelSelect,
    handleToolbarOpenChange,
    handleSheetOpenChange,
    modeControl,
    workflowModeControl,
    multitaskTaskTarget,
    presentation,
    hasPluginItems,
    glyphs,
    activeSheet,
    handleOpenSheet,
    handleCloseSheet,
    modelSelectorServerId,
    onRouterPicked,
    activeRouterId,
    modelPickerOpenNonce = 0,
  } = props;
  const { action: toggleAction, keys: modelKeys } = useModelPickerShortcut(disabled);
  const modelTooltipLabel = t(getAgentControlHintKey("model"));
  const modelToolbar = useMemo(
    () => ({
      glyph: glyphs.label,
      showCaret: presentation.showCarets,
      tooltip: <ControlTooltipHint label={modelTooltipLabel} shortcutKeys={modelKeys} />,
    }),
    [glyphs.label, presentation.showCarets, modelTooltipLabel, modelKeys],
  );
  const featuresSheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.features.title") }),
    [t],
  );
  const handleOpenFeatures = useCallback(() => handleOpenSheet("features"), [handleOpenSheet]);
  const hasFeatures = featureItems.length > 0 || hasPluginItems;
  return (
    <>
      {canSelectModel ? (
        <View style={styles.modelControl}>
          <CombinedModelSelector
            providers={modelSelectorProviders}
            selectedProvider={provider}
            selectedModel={selectedModelId ?? ""}
            onSelect={handleDesktopModelSelect}
            profiles={agentProfiles}
            onApplyProfile={onApplyAgentProfile}
            onEditProfiles={onEditAgentProfiles}
            onCreateProfile={onCreateAgentProfile}
            onEditProfile={onEditAgentProfile}
            isLoading={isModelLoading}
            disabled={disabled}
            toggleAction={toggleAction}
            onOpen={onModelSelectorOpen}
            onClose={onDropdownClose}
            onRetryProvider={onRetryModelProvider}
            isRetryingProvider={isRetryingModelProvider}
            serverId={modelSelectorServerId}
            desktopPlacement="top-start"
            desktopMinWidth={360}
            toolbar={modelToolbar}
            onRouterPicked={onRouterPicked}
            activeRouterId={activeRouterId}
            tooltip={t(getAgentControlHintKey("model"))}
            openRequestNonce={modelPickerOpenNonce}
          />
        </View>
      ) : null}

      <ComposerControls
        items={thinkingItems}
        shortcutKeys={effortKeys}
        surface="toolbar"
        disabled={disabled}
        openId={openSelector}
        onOpenIdChange={handleToolbarOpenChange}
      />

      {modeControl ? <AgentModeControl {...modeControl} onClose={onDropdownClose} /> : null}
      {workflowModeControl ? (
        <WorkflowModeControl {...workflowModeControl} onClose={onDropdownClose} />
      ) : null}
      {multitaskTaskTarget ? (
        <MultitaskTaskTargetControl {...multitaskTaskTarget} surface="toolbar" />
      ) : null}

      {presentation.aggregateFeatures && hasFeatures ? (
        <>
          <Pressable
            onPress={handleOpenFeatures}
            disabled={disabled}
            style={styles.modeIconBadge}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.features.open")}
            testID="agent-controls-features"
          >
            <ComposerToolbarGlyph role="icon">
              <Settings2
                size={glyphs.icon.size}
                strokeWidth={glyphs.icon.strokeWidth}
                color={toolbarGlyphColor(theme, glyphs.icon.tone)}
              />
            </ComposerToolbarGlyph>
          </Pressable>
          <AdaptiveModalSheet
            header={featuresSheetHeader}
            visible={activeSheet === "features"}
            onClose={handleCloseSheet}
            contextBridge={sheetBridge}
            testID="agent-features-sheet"
          >
            <ComposerControls
              items={featureItems}
              surface="sheet"
              disabled={disabled}
              openId={openSelector}
              onOpenIdChange={handleSheetOpenChange}
            />
            <PluginComposerItems serverId={modelSelectorServerId} surface="sheet" />
          </AdaptiveModalSheet>
        </>
      ) : (
        <ComposerControls
          items={featureItems}
          surface="toolbar"
          disabled={disabled}
          openId={openSelector}
          onOpenIdChange={handleToolbarOpenChange}
          onActionComplete={onDropdownClose}
        />
      )}
    </>
  );
}

interface SheetAgentControlsContentProps extends AgentControlsContentProps {
  showLabels: boolean;
  displayThinking: string | null;
  handleSheetModelSelect: (providerId: string, modelId: string) => void;
  workflowModeControl?: WorkflowModeControlValue | null;
  multitaskTaskTarget?: MultitaskTaskTargetBinding | null;
  canSwitchProvider: boolean;
  activeRouterId?: string | null;
  onRouterPicked?: (routerId: string | null) => void;
  modelPickerOpenNonce?: number;
  chatModeAgentId?: string;
  chatModeServerId?: string;
  chatModeIsOpenUIChat?: boolean;
  chatModeIsMaestro?: boolean;
  chatModeMaestroScope?: "workspace" | "all";
  supportsMaestro?: boolean;
}

function SheetAgentControlsContent(props: SheetAgentControlsContentProps) {
  const sheetBridge = useComposerSheetBridge();
  const {
    provider,
    selectedModelId,
    thinkingItems,
    effortKeys,
    featureItems,
    onApplyAgentProfile,
    onEditAgentProfiles,
    onCreateAgentProfile,
    onEditAgentProfile,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    agentProfiles,
    disabled,
    isModelLoading,
    canSelectModel,
    modelSelectorProviders,
    openSelector,
    displayThinking,
    handleSheetModelSelect,
    handleSheetOpenChange,
    modeControl,
    workflowModeControl,
    multitaskTaskTarget,
    glyphs,
    showLabels,
    modelSelectorServerId,
    canSwitchProvider,
    onRouterPicked,
    activeRouterId,
    modelPickerOpenNonce = 0,
    chatModeAgentId,
    chatModeServerId,
    chatModeIsOpenUIChat,
    chatModeIsMaestro = false,
    chatModeMaestroScope = "workspace",
    supportsMaestro = false,
  } = props;

  const sheetControls = (
    <View style={styles.combinedSheetControls} testID="agent-controls-combined-sheet-controls">
      <ComposerControls
        items={thinkingItems}
        surface="sheet"
        disabled={disabled}
        openId={openSelector}
        onOpenIdChange={handleSheetOpenChange}
      />

      {modeControl ? <AgentModeControl {...modeControl} surface="sheet" /> : null}
      {workflowModeControl ? (
        <WorkflowModeControl {...workflowModeControl} surface="sheet" />
      ) : null}
      {multitaskTaskTarget ? (
        <MultitaskTaskTargetControl {...multitaskTaskTarget} surface="sheet" />
      ) : null}

      <ComposerControls
        items={featureItems}
        surface="sheet"
        disabled={disabled}
        openId={openSelector}
        onOpenIdChange={handleSheetOpenChange}
      />
      <PluginComposerItems serverId={modelSelectorServerId} surface="sheet" />
      {chatModeAgentId && chatModeServerId ? (
        <>
          <ChatModeToggle
            agentId={chatModeAgentId}
            serverId={chatModeServerId}
            isOpenUIChat={Boolean(chatModeIsOpenUIChat)}
            isMaestro={chatModeIsMaestro}
            surface="sheet"
          />
          {supportsMaestro ? (
            <MaestroModeControl
              agentId={chatModeAgentId}
              serverId={chatModeServerId}
              isMaestro={chatModeIsMaestro}
              scope={chatModeMaestroScope}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );

  return canSelectModel ? (
    <CompactModelSheet
      providers={modelSelectorProviders}
      selectedProvider={provider}
      selectedModel={selectedModelId ?? ""}
      thinkingLabel={displayThinking}
      effortKeys={effortKeys}
      onSelect={handleSheetModelSelect}
      profiles={agentProfiles}
      onApplyProfile={onApplyAgentProfile}
      onEditProfiles={onEditAgentProfiles}
      onCreateProfile={onCreateAgentProfile}
      onEditProfile={onEditAgentProfile}
      contextBridge={sheetBridge}
      isLoading={isModelLoading}
      disabled={disabled}
      onOpen={onModelSelectorOpen}
      onClose={onDropdownClose}
      onRetryProvider={onRetryModelProvider}
      isRetryingProvider={isRetryingModelProvider}
      serverId={modelSelectorServerId}
      glyphs={glyphs}
      showLabels={showLabels}
      canSwitchProvider={canSwitchProvider}
      activeRouterId={activeRouterId}
      onRouterPicked={onRouterPicked}
      openRequestNonce={modelPickerOpenNonce}
    >
      {sheetControls}
    </CompactModelSheet>
  ) : null;
}

function useAgentOptionControls(
  agent: { controls?: AgentOptionControl[]; options?: ProviderOptions } | null | undefined,
  onSetOption: ComposerOptionControls["onSetOption"],
): ComposerOptionControls {
  const controls = agent?.controls;
  const options = agent?.options;
  return useMemo(
    () => ({ controls: controls ?? [], options: options ?? EMPTY_OPTIONS, onSetOption }),
    [controls, onSetOption, options],
  );
}

function anyTrue(...values: boolean[]): boolean {
  return values.some(Boolean);
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function optionalNonEmpty<T>(value: T[]): T[] | undefined {
  return value.length > 0 ? value : undefined;
}

/** Providers exposed by every other connected host, for cross-host porting. */ async function loadCrossHostProviders(input: {
  hosts: Array<{ serverId?: string | null }>;
  serverId: string;
  cwd: string | null | undefined;
}): Promise<ProviderSelectorProvider[]> {
  const otherHosts = input.hosts.filter(
    (host) => host.serverId && host.serverId !== input.serverId,
  );
  const results = await Promise.all(
    otherHosts.map(async (host) => {
      const hostClient = getHostRuntimeStore().getClient(host.serverId ?? "");
      if (!hostClient) return [] as ProviderSelectorProvider[];
      try {
        const [snapshot, configResult] = await Promise.all([
          hostClient.getProvidersSnapshot({ cwd: input.cwd ?? undefined }),
          hostClient.getDaemonConfig().catch(() => null),
        ]);
        return buildSelectableProviderSelectorProviders(snapshot.entries, {
          selectedProvider: null,
          serverId: host.serverId ?? null,
          disabledModelIdsByProvider: disabledModelIdsByProviderFromConfig(
            configResult?.config.providers,
          ),
        });
      } catch {
        return [] as ProviderSelectorProvider[];
      }
    }),
  );
  return results.flat();
}

function buildModelSelectorProviders(input: {
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"];
  snapshotSelectedEntry: ReturnType<typeof resolveSnapshotSelectedEntry>;
  serverId: string;
  providerDefinitions: AgentProviderDefinition[];
  modelsByProvider: Map<string, AgentModelDefinition[]>;
  supportsSnapshotTransfer: boolean;
  crossHostProviders: ProviderSelectorProvider[];
  disabledModelIdsByProvider?: DisabledModelIdsByProvider;
}): ProviderSelectorProvider[] {
  let base: ProviderSelectorProvider[];
  if (input.snapshotEntries) {
    base = buildSelectableProviderSelectorProviders(input.snapshotEntries, {
      selectedProvider: null,
      serverId: input.serverId,
      disabledModelIdsByProvider: input.disabledModelIdsByProvider,
    });
  } else if (input.snapshotSelectedEntry) {
    base = buildSelectableProviderSelectorProviders([input.snapshotSelectedEntry], {
      selectedProvider: null,
      serverId: input.serverId,
      disabledModelIdsByProvider: input.disabledModelIdsByProvider,
    });
  } else {
    base = buildProviderSelectorProviders({
      providerDefinitions: input.providerDefinitions,
      modelsByProvider: input.modelsByProvider,
      serverId: input.serverId,
      disabledModelIdsByProvider: input.disabledModelIdsByProvider,
    });
  }
  if (input.supportsSnapshotTransfer && input.crossHostProviders.length > 0) {
    return [...base, ...input.crossHostProviders];
  }
  return base;
}

export const AgentControls = memo(function AgentControls({
  showToolbar,
  agentId,
  serverId,
  onDropdownClose,
  isCompactLayout,
}: AgentControlsProps) {
  const { updatePreferences } = useFormPreferences();
  const agent = useSessionStore(
    useShallow((state) => selectAgentControlsSlice(state, serverId, agentId)),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();
  const { t } = useTranslation();
  const pendingProviderSwitch = usePendingProviderSwitch(serverId, agentId);
  const { openNonce: modelPickerOpenNonce, retry: retryAfterModelPick } =
    useModelPickerRequest(agentId);
  const stagedRouterTarget = useStagedRouterTarget(serverId, pendingProviderSwitch);
  const supportsProviderSwap = useHostFeature(serverId, "agentProviderSwap");
  const supportsSnapshotTransfer = useHostFeature(serverId, "agentSnapshotTransfer");
  const hosts = useHosts();
  const [crossHostProviders, setCrossHostProviders] = useState<ProviderSelectorProvider[]>([]);
  const supportsWorkflowModes = useHostFeature(serverId, "workflowModes");
  const {
    usesPaseoWorkflowModes,
    isOpenUIChat,
    isMaestroChat,
    maestroScope,
    supportsMaestro,
    modeControl,
    workflowModeControl,
  } = useModeControls(serverId, agentId, supportsWorkflowModes);
  useForceAgentMode(serverId, agentId, usesPaseoWorkflowModes);
  useForceWorkflowAgentMode(serverId, agentId, isOpenUIChat);
  const commandCenterModes = toCommandCenterModes(modeControl);
  const modeProviderDefinitions = getModeProviderDefinitions(modeControl);

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });

  const snapshotSelectedEntry = useMemo(
    () => resolveProviderSnapshotEntry(snapshotEntries, agent?.provider),
    [snapshotEntries, agent?.provider],
  );
  const { config } = useDaemonConfig(serverId);
  const { disabledModelIdsByProvider, models } = useMemo(
    () => selectableModelsForEntry(snapshotSelectedEntry, config),
    [config, snapshotSelectedEntry],
  );
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";

  const agentProviderDefinitions = useMemo(
    () => buildAgentProviderDefinitions(agent?.provider, snapshotEntries),
    [agent?.provider, snapshotEntries],
  );

  const agentProviderModels = useMemo(
    () => buildAgentProviderModels(agent?.provider, models),
    [agent?.provider, models],
  );
  const agentModelSelectorProviders = useMemo(() => {
    return buildModelSelectorProviders({
      snapshotEntries,
      snapshotSelectedEntry,
      serverId,
      providerDefinitions: agentProviderDefinitions,
      modelsByProvider: agentProviderModels,
      supportsSnapshotTransfer,
      crossHostProviders,
      disabledModelIdsByProvider,
    });
  }, [
    agentProviderDefinitions,
    agentProviderModels,
    crossHostProviders,
    disabledModelIdsByProvider,
    serverId,
    snapshotEntries,
    snapshotSelectedEntry,
    supportsSnapshotTransfer,
  ]);

  const modelSelection = resolveAgentModelSelection({
    models,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    runtimeThinkingOptionId: agent?.runtimeThinkingOptionId,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });

  const modelOptions = useMemo<AgentControlOption[]>(() => {
    return (models ?? []).map((model) => ({ id: model.id, label: model.label }));
  }, [models]);

  const thinkingOptions = useMemo<AgentControlOption[]>(() => {
    return (modelSelection.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: formatThinkingOptionLabel(option),
    }));
  }, [modelSelection.thinkingOptions]);

  const agentProvider = agent?.provider;
  const activeModelId = modelSelection.activeModelId;

  const retryPickedModel = useCallback(
    async (pick: {
      provider: string;
      modelId: string;
      targetServerId: string;
      clearRouter: boolean;
      routerId?: string | null;
    }) => {
      useModelPickerRequestStore.getState().clearIntent();
      clearProviderSwitch(serverId, agentId);
      const retryClient = getHostRuntimeStore().getClient(serverId);
      if (!retryClient) {
        return;
      }
      const workspaceId =
        useSessionStore.getState().sessions[serverId]?.agents.get(agentId)?.workspaceId ?? null;
      const ports = pick.provider !== agentProvider || pick.targetServerId !== serverId;
      if (ports) {
        startPortingActivity(serverId, agentId, { toProvider: pick.provider });
      }
      try {
        await commitPickedModelAndRetry({
          client: retryClient,
          serverId,
          agentId,
          provider: pick.provider,
          modelId: pick.modelId,
          currentProvider: agentProvider,
          targetServerId: pick.targetServerId,
          clearRouter: pick.clearRouter,
          ...(pick.routerId !== undefined ? { routerId: pick.routerId } : {}),
          workspaceId,
          persistPreference: (nextProvider, nextModelId) =>
            updatePreferences((current) =>
              mergeProviderPreferences({
                preferences: current,
                provider: nextProvider as AgentProvider,
                updates: { model: nextModelId || undefined },
              }),
            ),
          navigate: ({
            serverId: nextServerId,
            agentId: nextAgentId,
            workspaceId: nextWorkspaceId,
          }) => {
            navigateToAgent({
              serverId: nextServerId,
              agentId: nextAgentId,
              ...(nextWorkspaceId ? { workspaceId: nextWorkspaceId } : {}),
            });
          },
        });
      } catch (error: unknown) {
        console.warn("[AgentControls] switch model and retry failed", error);
        toast.error(toErrorMessage(error));
      } finally {
        if (ports) {
          finishPortingActivity(serverId, agentId);
        }
      }
    },
    [agentId, agentProvider, serverId, toast, updatePreferences],
  );

  const handleSelectProviderAndModel = useCallback(
    async (provider: string, modelId: string, targetServerId?: string | null) => {
      const plan = planProviderSwitch({
        currentProvider: agentProvider,
        currentServerId: serverId,
        nextProvider: provider,
        nextServerId: targetServerId,
        supportsProviderSwap,
        targetSupportsSnapshotTransfer:
          useSessionStore.getState().sessions[(targetServerId ?? "").trim() || serverId]?.serverInfo
            ?.features?.agentSnapshotTransfer === true,
        targetClientConnected:
          getHostRuntimeStore().getClient((targetServerId ?? "").trim() || serverId) !== null,
      });
      if (plan.kind === "reject") {
        toast.error(t(plan.messageKey));
        return;
      }
      // A pick from the provider error card commits now and resends the rejected
      // prompt. Every other pick stays staged until the next message: a port
      // would archive this agent, and a plain model change must not apply to a
      // goal auto-continuation the user did not send.
      if (retryAfterModelPick) {
        await retryPickedModel({
          provider,
          modelId,
          targetServerId: plan.targetHost,
          clearRouter: Boolean(agent?.modelRouterId),
        });
        return;
      }
      stageProviderSwitch(serverId, agentId, {
        kind: "model",
        targetServerId: plan.targetHost,
        provider,
        modelId,
        clearRouter: Boolean(agent?.modelRouterId),
      });
      toast.show(t("agentControls.provider.pendingOnNextMessage"), { variant: "info" });
    },
    [
      agent?.modelRouterId,
      agentId,
      agentProvider,
      retryAfterModelPick,
      retryPickedModel,
      serverId,
      supportsProviderSwap,
      t,
      toast,
    ],
  );

  /**
   * While a switch is staged, the provider glyph and model label already show
   * the destination, so picking another model must edit the staged pick instead
   * of writing a model the current agent cannot run.
   */
  const handleSelectModelFromPicker = useCallback(
    (modelId: string) => {
      if (retryAfterModelPick) {
        if (!agentProvider) {
          return;
        }
        void retryPickedModel({
          provider: agentProvider,
          modelId,
          targetServerId: serverId,
          clearRouter: Boolean(agent?.modelRouterId),
        });
        return;
      }
      if (updateStagedProviderModel(serverId, agentId, modelId)) {
        return;
      }
      if (!agentProvider) {
        return;
      }
      stageProviderSwitch(serverId, agentId, {
        kind: "model",
        targetServerId: serverId,
        provider: agentProvider,
        modelId,
        clearRouter: Boolean(agent?.modelRouterId),
      });
      toast.show(t("agentControls.provider.pendingOnNextMessage"), { variant: "info" });
    },
    [
      agent?.modelRouterId,
      agentId,
      agentProvider,
      retryAfterModelPick,
      retryPickedModel,
      serverId,
      t,
      toast,
    ],
  );

  useEffect(() => {
    return () => clearProviderSwitch(serverId, agentId);
  }, [agentId, serverId]);

  const handleSelectCommandCenterModel = useCallback(
    (provider: AgentProvider, modelId: string, targetServerId?: string | null) => {
      void handleSelectProviderAndModel(provider, modelId, targetServerId);
    },
    [handleSelectProviderAndModel],
  );

  // A running agent is one provider's process, so only that provider's profiles
  // can apply to it.
  const profileProviders = useMemo(() => (agentProvider ? [agentProvider] : []), [agentProvider]);
  const profileModeIds = useMemo(
    () => resolveSnapshotModeIds(snapshotSelectedEntry),
    [snapshotSelectedEntry],
  );
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({ kind: "agent", agentId, availableModeIds: profileModeIds }),
    [agentId, profileModeIds],
  );
  const agentProfiles = useAgentProfilePicker({
    serverId,
    availableProviders: profileProviders,
    target: profileTarget,
  });
  const handleEditAgentProfiles = useEditAgentProfilesNavigation(serverId, agentProfiles !== null);
  const profileEditor = useAgentProfileEditor(serverId);
  const profileActions = resolveAgentProfileEditorActions(agentProfiles !== null, profileEditor);

  const handleSelectThinkingOption = useCallback(
    (thinkingOptionId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      if (activeModelId) {
        void updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: activeModelId,
              thinkingByModel: {
                [activeModelId]: thinkingOptionId,
              },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentControls] persist thinking preference failed", error);
        });
      }
      void client
        .setAgentThinkingOption(agentId, thinkingOptionId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentControls] setAgentThinkingOption failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [activeModelId, agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSetOption = useCallback(
    (key: string, value: unknown) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            options: {
              [key]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist option preference failed", error);
      });
      void client.setAgentOptions(agentId, { [key]: value }).catch((error) => {
        console.warn("[AgentControls] setAgentOptions failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  // The Command Center lists this agent's host only. Cross-host providers power the
  // full model browser's porting flow; their duplicate provider/model ids would
  // otherwise collide in the Command Center registry.
  const commandCenterModelSelectorProviders = useMemo(
    () =>
      agentModelSelectorProviders.filter(
        (provider) => !provider.serverId || provider.serverId === serverId,
      ),
    [agentModelSelectorProviders, serverId],
  );

  const agentOptionControls = useAgentOptionControls(agent, handleSetOption);

  // The agent's composer exists apart from this component; while this is mounted, prompt
  // commands go through the input the user is typing in.
  const composer = useMemo(() => agentComposer(serverId, agentId), [agentId, serverId]);
  const composerInput = useComposerInput();
  useEffect(
    () =>
      composerInput
        ? composer.attachInput({
            isLive: composerInput.isLive,
            setText: composerInput.setText,
            insertText: composerInput.insertText,
            isRevealed: composerInput.isRevealed,
            focus: composerInput.focus,
          })
        : undefined,
    [composer, composerInput],
  );

  const commandCenterControls = useMemo<AgentControlCommandCenterSource>(
    () => ({
      serverId,
      ownerKey: agentId,
      provider: agentProvider,
      providerDefinitions: modeProviderDefinitions,
      models: {
        providers: commandCenterModelSelectorProviders,
        selectedProvider: agentProvider,
        selectedModelId: activeModelId,
        select: handleSelectCommandCenterModel,
      },
      thinking: {
        options: modelSelection.thinkingOptions,
        selectedId: modelSelection.selectedThinkingId,
        select: handleSelectThinkingOption,
      },
      modes: commandCenterModes,
      optionControls: client ? agentOptionControls : null,
    }),
    [
      activeModelId,
      agentOptionControls,
      client,
      agentId,
      agentProvider,
      commandCenterModelSelectorProviders,
      commandCenterModes,
      handleSelectCommandCenterModel,
      handleSelectThinkingOption,
      modeProviderDefinitions,
      modelSelection.selectedThinkingId,
      modelSelection.thinkingOptions,
      serverId,
    ],
  );

  const commandCenterRegistration = (
    <AgentControlCommandCenterRegistration
      sourceId={`agent:${serverId}:${agentId}`}
      enabled={Boolean(client)}
      controls={commandCenterControls}
    />
  );

  const handleModelSelectorOpen = useCallback(() => {
    refetchSnapshotIfStale(agentProvider);
    if (!supportsSnapshotTransfer) return;
    void loadCrossHostProviders({ hosts, serverId, cwd: agent?.cwd }).then(setCrossHostProviders);
  }, [
    agent?.cwd,
    agentProvider,
    hosts,
    refetchSnapshotIfStale,
    serverId,
    supportsSnapshotTransfer,
  ]);

  const handleRetryModelProvider = useCallback(
    (provider: AgentProvider) => {
      void refreshSnapshot([provider]);
    },
    [refreshSnapshot],
  );

  const handleRouterPicked = useCallback(
    (routerId: string | null) => {
      if (!agent) {
        return;
      }
      if (routerId) {
        // The trigger shows the router's entry model now. The next send commits
        // that model and keeps the chat bound to the router. A pick from the
        // provider error card commits immediately and resends the rejected prompt.
        const pickedRouter = config?.modelRouters?.routers.find((entry) => entry.id === routerId);
        const staged = pickedRouter
          ? routerPickAsModel({ targetServerId: serverId, routerId, router: pickedRouter })
          : null;
        if (retryAfterModelPick && staged) {
          void retryPickedModel({
            provider: staged.provider,
            modelId: staged.modelId,
            targetServerId: staged.targetServerId,
            clearRouter: false,
            routerId: staged.routerId,
          });
          return;
        }
        stageProviderSwitch(
          serverId,
          agentId,
          staged ?? { kind: "router", targetServerId: serverId, routerId },
        );
      } else {
        if (!agentProvider) {
          return;
        }
        if (retryAfterModelPick) {
          void retryPickedModel({
            provider: agentProvider,
            modelId: agent.runtimeModelId ?? agent.model ?? "",
            targetServerId: serverId,
            clearRouter: true,
          });
          return;
        }
        stageProviderSwitch(serverId, agentId, {
          kind: "model",
          targetServerId: serverId,
          provider: agentProvider,
          modelId: agent.runtimeModelId ?? agent.model ?? "",
          clearRouter: true,
        });
      }
      toast.show(t("agentControls.provider.pendingOnNextMessage"), { variant: "info" });
    },
    [
      agent,
      agentId,
      agentProvider,
      config?.modelRouters?.routers,
      retryAfterModelPick,
      retryPickedModel,
      serverId,
      t,
      toast,
    ],
  );

  const liveTaskTarget = useLiveMultitaskTaskTarget(serverId, agentId);
  const taskSelectorProviders = useMemo(
    () =>
      buildSelectableProviderSelectorProviders(snapshotEntries ?? undefined, {
        selectedProvider: agentProvider ?? null,
        serverId,
        disabledModelIdsByProvider,
      }),
    [agentProvider, disabledModelIdsByProvider, serverId, snapshotEntries],
  );
  const multitaskTaskTarget = useMemo(
    () =>
      workflowModeControl?.selectedWorkflowModeId === "multitask"
        ? {
            serverId,
            providers: taskSelectorProviders,
            disabled: client === null,
            target: liveTaskTarget.target,
            onChange: liveTaskTarget.onChange,
          }
        : null,
    [
      client,
      liveTaskTarget.onChange,
      liveTaskTarget.target,
      serverId,
      taskSelectorProviders,
      workflowModeControl?.selectedWorkflowModeId,
    ],
  );

  if (!agent) {
    return null;
  }

  return (
    <ComposerModelProvider value={composer}>
      {commandCenterRegistration}
      {showToolbar ? (
        <>
          {profileEditor.element}
          <ControlledAgentControls
            agentId={agentId}
            serverId={serverId}
            isOpenUIChat={Boolean(isOpenUIChat)}
            isMaestroChat={Boolean(isMaestroChat)}
            maestroScope={maestroScope}
            supportsMaestro={supportsMaestro}
            provider={resolveDisplayProvider(
              pendingProviderSwitch,
              agent.provider,
              stagedRouterTarget,
            )}
            modelSelectorProviders={agentModelSelectorProviders}
            modelOptions={modelOptions}
            selectedModelId={resolveDisplayModelId(
              pendingProviderSwitch,
              modelSelection.activeModelId,
              stagedRouterTarget,
            )}
            activeRouterId={resolveDisplayRouterId(pendingProviderSwitch, agent.modelRouterId)}
            onSelectModel={handleSelectModelFromPicker}
            onSelectProviderAndModel={handleSelectProviderAndModel}
            agentProfiles={agentProfiles}
            onApplyAgentProfile={agentProfiles?.applyProfile}
            onEditAgentProfiles={handleEditAgentProfiles}
            onCreateAgentProfile={profileActions.create}
            onEditAgentProfile={profileActions.edit}
            thinkingOptions={optionalNonEmpty(thinkingOptions)}
            selectedThinkingOptionId={optionalValue(modelSelection.selectedThinkingId)}
            onSelectThinkingOption={handleSelectThinkingOption}
            optionControls={agentOptionControls}
            isModelLoading={anyTrue(snapshotIsLoading, selectedProviderIsLoading)}
            onModelSelectorOpen={handleModelSelectorOpen}
            onRetryModelProvider={handleRetryModelProvider}
            isRetryingModelProvider={snapshotIsRefreshing}
            onDropdownClose={onDropdownClose}
            disabled={anyTrue(client === null)}
            modeControl={modeControl}
            workflowModeControl={workflowModeControl}
            multitaskTaskTarget={multitaskTaskTarget}
            modelSelectorServerId={serverId}
            isCompactLayout={isCompactLayout}
            onRouterPicked={handleRouterPicked}
            modelPickerOpenNonce={modelPickerOpenNonce}
          />
        </>
      ) : null}
    </ComposerModelProvider>
  );
});

export function DraftAgentControls({
  showToolbar,
  draftId,
  serverId,
  providerDefinitions,
  selectedProvider,
  modeOptions,
  selectedMode,
  onSelectMode,
  selectedWorkflowMode,
  onSelectWorkflowMode,
  models,
  selectedModel,
  effectiveModelId,
  onSelectModel,
  isModelLoading: _isModelLoading,
  modelSelectorProviders,
  isAllModelsLoading,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  onApplyAgentProfile,
  optionControls,
  options,
  onSetOption,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  onRouterPicked,
  disabled = false,
  modelSelectorServerId = null,
  isCompactLayout,
  multitaskTaskTargetKey = null,
  hideWorkflowMode = false,
  context = "draft",
  metadata,
  onSetMetadata,
}: DraftAgentControlsProps & { draftId: string; serverId: string; showToolbar: boolean }) {
  const mappedThinkingOptions = useMemo<AgentControlOption[]>(() => {
    return toThinkingControlOptions(thinkingOptions);
  }, [thinkingOptions]);

  const effectiveSelectedThinkingOption = selectedThinkingOptionId || mappedThinkingOptions[0]?.id;

  const modelOptions = useMemo<AgentControlOption[]>(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    [models],
  );

  // The draft form is the one surface that can switch provider, so every profile
  // the host can actually run is offered here.
  const profileProviders = useMemo(
    () => modelSelectorProviders.map((entry) => entry.id),
    [modelSelectorProviders],
  );
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({
      kind: "draft",
      controls: {
        applyProfile: onApplyAgentProfile,
      },
    }),
    [onApplyAgentProfile],
  );
  const agentProfiles = useAgentProfilePicker({
    serverId: modelSelectorServerId,
    availableProviders: profileProviders,
    target: profileTarget,
  });
  const handleEditAgentProfiles = useEditAgentProfilesNavigation(
    modelSelectorServerId,
    agentProfiles !== null,
  );
  const profileEditor = useAgentProfileEditor(modelSelectorServerId);
  const profileActions = resolveAgentProfileEditorActions(agentProfiles !== null, profileEditor);

  const workflowModeSource = useAppSettings().settings.workflowModeSource;
  const supportsWorkflowModes = useHostFeature(modelSelectorServerId, "workflowModes");
  const usesPaseoWorkflowModes = workflowModeSource === "paseo" && supportsWorkflowModes;
  const modeControl = useMemo<AgentModeControlValue | null>(
    () =>
      !usesPaseoWorkflowModes && !hideWorkflowMode && selectedProvider && modeOptions.length > 0
        ? {
            provider: selectedProvider,
            providerDefinitions,
            modeOptions,
            selectedModeId: selectedMode,
            onSelectMode,
            disabled,
          }
        : null,
    [
      usesPaseoWorkflowModes,
      hideWorkflowMode,
      selectedProvider,
      providerDefinitions,
      modeOptions,
      selectedMode,
      onSelectMode,
      disabled,
    ],
  );
  const workflowModeControl = useMemo<WorkflowModeControlValue | null>(
    () =>
      usesPaseoWorkflowModes && !hideWorkflowMode
        ? {
            selectedWorkflowModeId: selectedWorkflowMode,
            onSelectWorkflowMode,
            disabled,
          }
        : null,
    [
      selectedWorkflowMode,
      onSelectWorkflowMode,
      disabled,
      usesPaseoWorkflowModes,
      hideWorkflowMode,
    ],
  );
  const draftTaskTarget = useDraftMultitaskTaskTarget(multitaskTaskTargetKey);
  const multitaskTaskTarget = useMemo(
    () =>
      workflowModeControl && selectedWorkflowMode === "multitask"
        ? {
            serverId: modelSelectorServerId,
            providers: modelSelectorProviders,
            disabled,
            target: draftTaskTarget.target,
            onChange: draftTaskTarget.onChange,
          }
        : null,
    [
      disabled,
      draftTaskTarget.onChange,
      draftTaskTarget.target,
      modelSelectorProviders,
      modelSelectorServerId,
      selectedWorkflowMode,
      workflowModeControl,
    ],
  );

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const isLocked = useCallback(() => disabledRef.current, []);
  const composerAgent = useMemo(
    () =>
      draftComposerAgent({
        context,
        disabled,
        isLocked,
        selectedProvider,
        selectedModel,
        selectedMode,
        thinking: effectiveSelectedThinkingOption ?? null,
        options,
        metadata,
        onSelectProviderAndModel,
        onSelectModel,
        onSelectMode,
        onSelectThinkingOption,
        onSetOption,
        onSetMetadata,
      }),
    [
      context,
      disabled,
      isLocked,
      effectiveSelectedThinkingOption,
      metadata,
      onSelectMode,
      onSelectModel,
      onSelectProviderAndModel,
      onSelectThinkingOption,
      onSetMetadata,
      onSetOption,
      options,
      selectedMode,
      selectedModel,
      selectedProvider,
    ],
  );

  const composerInput = useComposerInput();
  const composerModel = useMemo(
    () =>
      composerInput
        ? composerModelFromHalves({ agent: composerAgent, input: composerInput })
        : null,
    [composerAgent, composerInput],
  );

  const commandCenterControls = useMemo<AgentControlCommandCenterSource>(
    () => ({
      serverId,
      ownerKey: draftId,
      provider: selectedProvider,
      providerDefinitions,
      models: {
        providers: modelSelectorProviders,
        selectedProvider,
        selectedModelId: effectiveModelId,
        select: (provider, modelId) => {
          onSelectProviderAndModel(provider, modelId);
        },
      },
      thinking: {
        options: thinkingOptions,
        selectedId: selectedThinkingOptionId,
        select: onSelectThinkingOption,
      },
      modes: toCommandCenterModes(modeControl),
      optionControls: optionControls ?? null,
    }),
    [
      serverId,
      draftId,
      selectedProvider,
      providerDefinitions,
      modelSelectorProviders,
      effectiveModelId,
      onSelectProviderAndModel,
      thinkingOptions,
      selectedThinkingOptionId,
      onSelectThinkingOption,
      modeControl,
      optionControls,
    ],
  );

  return (
    <ComposerAgentProvider value={composerAgent}>
      <ComposerModelProvider value={composerModel}>
        <AgentControlCommandCenterRegistration
          sourceId={`draft:${serverId}:${draftId}`}
          enabled={!disabled}
          controls={commandCenterControls}
        />
        {showToolbar ? (
          <>
            {profileEditor.element}
            <ControlledAgentControls
              provider={selectedProvider ?? ""}
              modelSelectorProviders={modelSelectorProviders}
              modelOptions={modelOptions}
              selectedModelId={selectedModel}
              onSelectModel={onSelectModel}
              onSelectProviderAndModel={onSelectProviderAndModel}
              isModelLoading={isAllModelsLoading}
              agentProfiles={agentProfiles}
              onApplyAgentProfile={agentProfiles?.applyProfile}
              onEditAgentProfiles={handleEditAgentProfiles}
              onCreateAgentProfile={profileActions.create}
              onEditAgentProfile={profileActions.edit}
              thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
              selectedThinkingOptionId={effectiveSelectedThinkingOption}
              onSelectThinkingOption={onSelectThinkingOption}
              optionControls={optionControls}
              onDropdownClose={onDropdownClose}
              onModelSelectorOpen={onModelSelectorOpen}
              onRetryModelProvider={onRetryModelProvider}
              isRetryingModelProvider={isRetryingModelProvider}
              disabled={disabled}
              modeControl={modeControl}
              workflowModeControl={workflowModeControl}
              multitaskTaskTarget={multitaskTaskTarget}
              modelSelectorServerId={modelSelectorServerId}
              isCompactLayout={isCompactLayout}
              onRouterPicked={onRouterPicked}
            />
          </>
        ) : null}
      </ComposerModelProvider>
    </ComposerAgentProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: TOOLBAR_CONTROL_GAP,
    // Clips pickers that run out of room.
    overflow: "hidden",
  },
  modelControl: {
    minWidth: 0,
    flexShrink: 1,
  },
  modeControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modeIconBadge: {
    ...toolbarSlot(),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
    flexShrink: 0,
    backgroundColor: "transparent",
    borderRadius: theme.borderRadius.full,
  },
  combinedSheetControls: {
    gap: theme.spacing[1],
  },
}));

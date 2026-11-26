import type { ComposerOptionControls } from "@/agent-controls/option-controls";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Keyboard, ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { CHAT_COLUMN_RAIL_DATASET } from "@/chat-rail";
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import invariant from "tiny-invariant";
import { Composer } from "@/composer";
import { ComposerDock } from "@/composer/dock";
import { type ComposerEditingSession, useComposerFullscreen } from "@/composer/editing-session";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { ComposerImportPill } from "@/composer/draft/import-pill";
import { COMPOSER_PILL_CLEARANCE } from "@/composer/pill-styles";
import { AgentStreamView } from "@/agent-stream/view";
import { useAddSelectionToSideChat } from "@/side-chat/use-add-selection";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { insertSelectionAsInlineChip } from "@/composer/selection-inline-chip";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { useDraftAgentCreateFlow, type DraftCreateAttempt } from "@/composer/draft/create-flow";
import { buildDraftQueueKey, moveDraftQueueToAgent } from "@/composer/draft/message-queue";
import { resolveTurnPresentation, TURN_LIVENESS_IDLE } from "@/timeline/turn-liveness";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { OPENUI_CHAT_LABEL, OPENUI_SYSTEM_PROMPT } from "@/new-workspace-launch/openui";
import { resolveForcedAgentModeId, resolveKnownAgentModeId } from "@/agent-controls/policy";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import type { Agent } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { encodeImages } from "@/utils/encode-images";
import { takePinnedRouterEntry, takeRouterEntryTarget } from "@/model-routers/entry-target";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { shouldAutoFocusWorkspaceDraftComposer } from "@/screens/workspace/workspace-draft-pane-focus";
import {
  resolveDraftWorkingDirectory,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "@/composer/draft/workspace-tab-core";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import { DRAFT_CAPABILITIES, resolveDraftTimeline } from "@/composer/draft/timeline";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type {
  DaemonClient,
  CreateAgentRequestOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  useDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { PendingMessageSubmission } from "@/composer/submission/model";
import type { StreamItem, UserMessageImageAttachment } from "@/types/stream";
import { COMPACT_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";
import { openWorkspaceChanges } from "@/workspace-tabs/open-supporting-view";
import { useSettings, type WorkflowModeSource } from "@/hooks/use-settings";
import { draftMultitaskTaskTargetLabels } from "@/composer/agent-controls/multitask-task-target-control";
import { draftCreationKey } from "@/composer/draft/creation-key";
import { useAgentControlCommandCenterActions } from "@/command-center/agent-control-registration";

const EMPTY_PENDING_PERMISSIONS = new Map();
const EMPTY_PENDING_MESSAGE_SUBMISSIONS: readonly PendingMessageSubmission[] = [];
const EMPTY_SUBMITTED_STREAM_ITEMS: StreamItem[] = [];

interface AutoSubmitConfig {
  provider: string;
  modeId: string | null;
  workflowModeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  providerOptions: Record<string, unknown>;
}

function resolveAutoSubmitConfig(
  pending: {
    provider: string;
    modeId?: string | null;
    workflowModeId?: string | null;
    model?: string | null;
    thinkingOptionId?: string | null;
    providerOptions?: Record<string, unknown>;
  } | null,
): AutoSubmitConfig | null {
  if (!pending) return null;
  return {
    provider: pending.provider,
    modeId: pending.modeId ?? null,
    workflowModeId: pending.workflowModeId ?? null,
    model: pending.model ?? null,
    thinkingOptionId: pending.thinkingOptionId ?? null,
    providerOptions: pending.providerOptions ?? {},
  };
}

function resolveDraftCreateModeId(input: {
  workflowModeSource: WorkflowModeSource;
  autoSubmitConfig: AutoSubmitConfig | null;
  composerState: {
    effectiveModeId: string;
    modeOptions: readonly AgentMode[];
    agentDefinition?: AgentProviderDefinition | null;
  };
}): { modeId: string } | Record<string, never> {
  const requestedModeId =
    input.workflowModeSource === "paseo"
      ? resolveForcedAgentModeId(
          input.composerState.modeOptions,
          input.composerState.agentDefinition?.defaultModeId ?? null,
        )
      : (input.autoSubmitConfig?.modeId ?? input.composerState.effectiveModeId);
  const modeId = resolveKnownAgentModeId(input.composerState.modeOptions, requestedModeId);
  return modeId ? { modeId } : {};
}

function resolveDraftModeId(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  effectiveModeId: string;
  modeOptions: readonly AgentMode[];
}): string | null {
  const requestedModeId =
    input.autoSubmitConfig?.modeId !== undefined
      ? input.autoSubmitConfig.modeId
      : input.effectiveModeId;
  return resolveKnownAgentModeId(input.modeOptions, requestedModeId);
}

async function resolveDraftRouterTarget(
  client: DaemonClient | null,
  selection: { provider: string; model: string | undefined },
): Promise<{ routerId: string; provider: string; model: string | null } | null> {
  if (!client) return null;
  try {
    const { config } = await client.getDaemonConfig();
    const settings = config.modelRouters;
    const router = settings?.defaultRouterId
      ? settings.routers.find((entry) => entry.id === settings.defaultRouterId)
      : undefined;
    if (!router) return null;
    // The composer already shows this router's model. Keep it, or the next
    // slot would replace what the user just picked.
    if (takePinnedRouterEntry(router.id, selection.provider, selection.model)) {
      return {
        routerId: router.id,
        provider: selection.provider,
        model: selection.model ?? null,
      };
    }
    const target = takeRouterEntryTarget(router);
    if (!target) return null;
    return { routerId: router.id, provider: target.provider, model: target.model };
  } catch {
    return null;
  }
}

function resolveDraftRoute(input: {
  provider: string;
  model: string | undefined;
  routerTarget: { provider: string; model: string | null } | null;
}): { provider: string; model: string | undefined } {
  if (!input.routerTarget) return { provider: input.provider, model: input.model };
  return { provider: input.routerTarget.provider, model: input.routerTarget.model ?? undefined };
}
function mergeOpenUIChatLabels(
  labels: Record<string, string> | undefined,
  openui: boolean,
): Record<string, string> {
  const base = labels ?? {};
  return openui ? { ...base, [OPENUI_CHAT_LABEL]: "1" } : base;
}

function openuiChatConfigPatch(openui: boolean): Partial<AgentSessionConfig> {
  return openui ? { systemPrompt: OPENUI_SYSTEM_PROMPT } : {};
}

function buildDraftCreateOptions(input: {
  draftId: string;
  config: ReturnType<typeof buildWorkspaceDraftAgentConfig>;
  workspaceId: string;
  routerTarget: { routerId: string } | null;
  text: string;
  clientMessageId: string;
  images?: Awaited<ReturnType<typeof encodeImages>>;
  attachments?: unknown;
  labels?: Record<string, string>;
  metadata?: Record<string, JsonValue>;
  idempotencyKey?: string;
}): CreateAgentRequestOptions {
  const attachments = Array.isArray(input.attachments) ? input.attachments : undefined;
  return {
    idempotencyKey: input.idempotencyKey ?? input.draftId,
    config: input.config,
    workspaceId: input.workspaceId,
    modelRouterId: input.routerTarget?.routerId ?? null,
    initialPrompt: input.text,
    clientMessageId: input.clientMessageId,
    ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(input.labels ? { labels: input.labels } : {}),
    ...(input.metadata && Object.keys(input.metadata).length > 0
      ? { metadata: input.metadata }
      : {}),
  };
}

function isUnknownModelConfigOptionError(error: unknown): boolean {
  return error instanceof Error && /unknown model config option/i.test(error.message);
}

function withoutThinkingOption(options: CreateAgentRequestOptions): CreateAgentRequestOptions {
  const config = options.config;
  if (!config?.thinkingOptionId) {
    return options;
  }
  const { thinkingOptionId: _thinkingOptionId, ...rest } = config;
  return { ...options, config: rest };
}

async function createAgentWithThinkingFallback(input: {
  create: (request: CreateAgentRequestOptions) => Promise<AgentSnapshotPayload>;
  options: CreateAgentRequestOptions;
  draftId: string;
}): Promise<AgentSnapshotPayload> {
  try {
    return await input.create(input.options);
  } catch (error) {
    if (!isUnknownModelConfigOptionError(error) || !input.options.config?.thinkingOptionId) {
      throw error;
    }
    // Cursor exposes per-model thought-level options and can reject the one
    // carried over from the previous model. Keep the agent creation instead of
    // failing the whole request; the model's default level applies.
    console.warn(
      "[WorkspaceDraft] provider rejected the thinking option; retrying without it",
      error,
    );
    return await input.create({
      ...withoutThinkingOption(input.options),
      idempotencyKey: `${input.draftId}:no-thinking`,
    });
  }
}

// eslint-disable-next-line complexity -- merge: combined two implementations
async function submitDraftCreateRequest(input: {
  draftId: string;
  attempt: { clientMessageId: string };
  text: string;
  images?: UserMessageImageAttachment[];
  attachments?: unknown;
  cwd: string;
  client: DaemonClient | null;
  workspaceDirectory: string | null;
  workspaceId: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  workflowModeSource: WorkflowModeSource;
  openui?: boolean;
  composerState: {
    selectedProvider: string | null;
    selectedWorkflowMode: string;
    effectiveModeId: string;
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    modeOptions: readonly AgentMode[];
    agentDefinition?: AgentProviderDefinition | null;
    providerOptions: Record<string, unknown> | undefined;
    metadata: Record<string, JsonValue>;
  };
  hostDisconnectedMessage: string;
  selectModelMessage: string;
}): Promise<{ agentId: string | null; result: AgentSnapshotPayload }> {
  const {
    attempt,
    text,
    images,
    attachments,
    cwd,
    client,
    workspaceDirectory,
    workspaceId,
    autoSubmitConfig,
    workflowModeSource,
    openui = false,
    composerState,
  } = input;

  invariant(workspaceDirectory, "Workspace directory is required");
  invariant(workspaceId, "Workspace id is required");
  if (!client) {
    throw new Error(input.hostDisconnectedMessage);
  }

  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  const selectedWorkflowMode =
    autoSubmitConfig?.workflowModeId ?? composerState.selectedWorkflowMode;
  const modeIdOverride = resolveDraftCreateModeId({
    workflowModeSource,
    autoSubmitConfig,
    composerState,
  });
  // A default router overrides the draft's provider/model so new chats rotate
  // (distribution) or start at the top of the chain (fallback).
  const routerTarget = autoSubmitConfig
    ? null
    : await resolveDraftRouterTarget(client, {
        provider,
        model: composerState.effectiveModelId || undefined,
      });
  const route = resolveDraftRoute({
    provider,
    model: composerState.effectiveModelId || undefined,
    routerTarget,
  });
  const config = buildWorkspaceDraftAgentConfig({
    provider: route.provider,
    cwd,
    ...modeIdOverride,
    workflowModeId: workflowModeSource === "paseo" ? selectedWorkflowMode : "agent",
    model: autoSubmitConfig?.model ?? route.model,
    thinkingOptionId:
      autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || undefined),
    providerOptions: autoSubmitConfig?.providerOptions ?? composerState.providerOptions,
    ...openuiChatConfigPatch(openui),
  });

  const attachmentsArray = Array.isArray(attachments) ? attachments : undefined;
  const imagesData = await encodeImages(images);
  const options = buildDraftCreateOptions({
    draftId: input.draftId,
    config,
    workspaceId,
    routerTarget,
    text,
    clientMessageId: attempt.clientMessageId,
    images: imagesData,
    attachments: attachmentsArray,
    labels: mergeOpenUIChatLabels(
      draftMultitaskTaskTargetLabels(
        input.draftId,
        workflowModeSource === "paseo" ? selectedWorkflowMode : "agent",
      ),
      openui,
    ),
    metadata: composerState.metadata,
  });
  // An edited draft is a new request, so key creation on the request rather than the draft id.
  const idempotencyKey = draftCreationKey(input.draftId, options);
  const result = await createAgentWithThinkingFallback({
    create: (request) => client.createAgent(request),
    options: { ...options, idempotencyKey },
    draftId: idempotencyKey,
  });

  return {
    agentId: result.id,
    result,
  };
}

function buildDraftAgentSnapshot(input: {
  attempt: { timestamp: Date };
  serverId: string;
  tabId: string;
  workspaceDirectory: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  workflowModeSource: WorkflowModeSource;
  openui?: boolean;
  composerState: {
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    effectiveModeId: string;
    selectedProvider: string | null;
    selectedWorkflowMode: string;
    modeOptions: readonly AgentMode[];
    agentDefinition?: AgentProviderDefinition | null;
    agentControls: { optionControls?: ComposerOptionControls };
  };
  selectModelMessage: string;
}): Agent {
  const { attempt, serverId, tabId, workspaceDirectory, autoSubmitConfig, workflowModeSource } =
    input;
  const { composerState } = input;
  invariant(workspaceDirectory, "Workspace directory is required");
  const now = attempt.timestamp;
  const model = autoSubmitConfig?.model ?? (composerState.effectiveModelId || null);
  const thinkingOptionId =
    autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || null);
  const modeId =
    workflowModeSource === "paseo"
      ? resolveKnownAgentModeId(
          composerState.modeOptions,
          resolveForcedAgentModeId(
            composerState.modeOptions,
            composerState.agentDefinition?.defaultModeId ?? null,
          ),
        )
      : resolveDraftModeId({
          autoSubmitConfig,
          effectiveModeId: composerState.effectiveModeId,
          modeOptions: composerState.modeOptions,
        });
  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  const selectedWorkflowMode =
    autoSubmitConfig?.workflowModeId ?? composerState.selectedWorkflowMode;
  return {
    serverId,
    id: tabId,
    provider,
    status: "running",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: DRAFT_CAPABILITIES,
    currentModeId: modeId,
    workflowModeId: workflowModeSource === "paseo" ? selectedWorkflowMode : null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: { provider, sessionId: null, model, modeId },
    title: "Agent",
    cwd: workspaceDirectory,
    model,
    options: composerState.agentControls.optionControls?.options,
    controls: composerState.agentControls.optionControls?.controls,
    thinkingOptionId,
    parentAgentId: null,
    labels: mergeOpenUIChatLabels(undefined, input.openui === true),
  };
}

function buildDraftInitialValues(input: {
  initialSetup: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (!input.initialSetup) return undefined;
  return {
    provider: input.initialSetup.provider,
    modeId: input.initialSetup.modeId,
    model: input.initialSetup.model,
    thinkingOptionId: input.initialSetup.thinkingOptionId,
  };
}

interface WorkspaceDraftComposerProps {
  serverId: string;
  workspaceId: string;
  tabId: string;
  draftId: string;
  initialSetup?: WorkspaceDraftTabSetup;
  openui?: boolean;
  isPaneFocused: boolean;
  editingSession: ComposerEditingSession;
  onCreated: (snapshot: AgentSnapshotPayload) => void;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet?: () => void;
  /**
   * Full-screen setup presentation. Shows the same centered hero as New workspace
   * and drops the workspace-specific fields (the workspace is already chosen).
   */
  setupPresentation?: boolean;
  heroTitle?: string;
}

type WorkspaceDraftAgentTabProps = WorkspaceDraftComposerProps;

function resolveImportPillPress(
  onOpenImportSheet: (() => void) | undefined,
  isSubmitting: boolean,
): (() => void) | null {
  if (isSubmitting) {
    return null;
  }
  return onOpenImportSheet ?? null;
}

function wrapDraftDockContent(setupPresentation: boolean, body: ReactNode): ReactNode {
  if (setupPresentation) {
    return body;
  }
  return <View style={styles.contentContainer}>{body}</View>;
}

function DraftSetupHeader({ heroTitle, isCompact }: { heroTitle?: string; isCompact: boolean }) {
  if (isCompact) {
    return <View style={styles.compactSetupSpace} pointerEvents="none" />;
  }
  if (!heroTitle) {
    return null;
  }
  return (
    <View style={styles.heroTitleContainer} pointerEvents="none">
      <Text style={styles.heroTitle}>{heroTitle}</Text>
    </View>
  );
}

function DraftSetupContent({
  centered,
  isSubmitting,
  hasDraftAgent,
  renderStream,
}: {
  centered: boolean;
  isSubmitting: boolean;
  hasDraftAgent: boolean;
  renderStream: () => ReactNode;
}) {
  if (isSubmitting && hasDraftAgent) {
    return (
      <View style={centered ? styles.setupStreamContainer : styles.streamContainer}>
        {renderStream()}
      </View>
    );
  }
  if (centered) {
    return <View style={styles.configSection} />;
  }
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.configScrollContent}>
      <View style={styles.configSection} />
    </ScrollView>
  );
}

// eslint-disable-next-line complexity -- merge: combined two implementations
export function WorkspaceDraftAgentTab({
  serverId,
  workspaceId,
  tabId,
  draftId,
  initialSetup = undefined,
  openui = false,
  isPaneFocused,
  editingSession,
  onCreated,
  onOpenWorkspaceFile,
  onOpenImportSheet,
  setupPresentation = false,
  heroTitle,
}: WorkspaceDraftAgentTabProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const workspaceFields = useWorkspaceFields(serverId, workspaceId, (w) => ({
    workspaceDirectory: w.workspaceDirectory,
    id: w.id,
  }));
  const workspaceDirectory = workspaceFields?.workspaceDirectory || null;
  const draftSetup = initialSetup ?? null;
  const draftWorkingDirectory = resolveDraftWorkingDirectory({
    workspaceDirectory,
    initialSetup: draftSetup,
  });
  const draftInitialValues = buildDraftInitialValues({
    initialSetup: draftSetup,
  });
  const draftStoreKey = useMemo(
    () =>
      buildDraftStoreKey({
        serverId,
        agentId: tabId,
        draftId,
      }),
    [draftId, serverId, tabId],
  );
  const draftInput = useAgentInputDraft({
    draftKey: draftStoreKey,
    composer: {
      initialServerId: serverId,
      initialValues: draftInitialValues,
      initialProviderOptions: draftSetup?.providerOptions,
      isVisible: true,
      lockedWorkingDir: draftWorkingDirectory ?? undefined,
    },
  });
  const composerState = draftInput.composerState;
  if (!composerState) {
    throw new Error("Workspace draft composer state is required");
  }

  const draftProvider = composerState.selectedProvider;
  const draftProviderDefinitions = composerState.providerDefinitions;
  const draftThinkingOptions = composerState.availableThinkingOptions;
  const draftSelectedThinkingId = composerState.selectedThinkingOptionId;
  const draftSetThinkingOption = composerState.setThinkingOptionFromUser;
  const draftModeOptions = composerState.modeOptions;
  const draftSelectedMode = composerState.selectedMode;
  const draftSetMode = composerState.setModeFromUser;

  const clearDraftInput = draftInput.clear;
  const replaceDraftText = draftInput.replaceText;
  const setDraftAttachments = draftInput.setAttachments;
  const pendingAutoSubmit = useWorkspaceDraftSubmissionStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.workspaceId === workspaceId ? pending : null;
  });
  const pendingCreateAttempt = useCreateFlowStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.lifecycle === "active" ? pending : null;
  });
  const consumePendingAutoSubmit = useWorkspaceDraftSubmissionStore(
    (state) => state.consumePending,
  );
  const autoSubmitConfig = resolveAutoSubmitConfig(pendingAutoSubmit);
  const initialCreateAttempt = useMemo<DraftCreateAttempt | null>(() => {
    if (!pendingCreateAttempt) {
      return null;
    }
    return {
      clientMessageId: pendingCreateAttempt.clientMessageId,
      text: pendingCreateAttempt.text,
      timestamp: new Date(pendingCreateAttempt.timestamp),
      ...(pendingCreateAttempt.images && pendingCreateAttempt.images.length > 0
        ? { images: pendingCreateAttempt.images }
        : {}),
      ...(pendingCreateAttempt.attachments && pendingCreateAttempt.attachments.length > 0
        ? { attachments: pendingCreateAttempt.attachments }
        : {}),
    };
  }, [pendingCreateAttempt]);
  const allowsEmptyAutoSubmit = pendingAutoSubmit?.allowEmptyText === true;
  const isCompactFormFactor = useIsCompactFormFactor();
  const isComposerFullscreen = useComposerFullscreen(editingSession);
  const { onLayout: onInputAreaLayout, isBelow: isCompactComposerLayout } = useContainerWidthBelow(
    COMPACT_CONTENT_WIDTH,
    { initialIsBelow: isCompactFormFactor },
  );
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd: composerState.workingDir,
    workspaceId,
  });
  const draftAttachmentScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const workflowModeSource = useSettings((settings) => settings.workflowModeSource);
  const attachmentScopeKeys = useMemo(
    () => [draftAttachmentScopeKey, workspaceAttachmentScopeKey].filter(Boolean),
    [draftAttachmentScopeKey, workspaceAttachmentScopeKey],
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind !== "review") {
        return;
      }
      openWorkspaceChanges({
        isCompact: isCompactFormFactor,
        workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? "" }),
        preferences: openInSidePane,
      });
    },
    [isCompactFormFactor, openInSidePane, serverId, workspaceId],
  );

  const {
    formErrorMessage,
    isSubmitting,
    draftAgent,
    handleCreateFromInput,
    continueCreateFromAttempt,
  } = useDraftAgentCreateFlow<Agent, AgentSnapshotPayload>({
    draftId,
    getPendingServerId: () => serverId,
    initialAttempt: initialCreateAttempt,
    allowEmptyText: allowsEmptyAutoSubmit,
    validateBeforeSubmit: ({ text, attachments }) => {
      const allowsEmptyDraftText = shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit,
        attachments,
      });
      return validateDraftSubmission({
        text,
        allowsEmptyAutoSubmit: allowsEmptyDraftText,
        composerState,
        autoSubmitConfig,
        workspaceDirectory: draftWorkingDirectory,
        isConnected,
      });
    },
    onBeforeSubmit: async () => {
      await composerState.persistFormPreferences();
      if (isWeb) {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      Keyboard.dismiss();
    },
    buildDraftAgent: (attempt) =>
      buildDraftAgentSnapshot({
        attempt,
        serverId,
        tabId,
        workspaceDirectory: draftWorkingDirectory,
        autoSubmitConfig,
        workflowModeSource,
        openui,
        composerState,
        selectModelMessage: t("workspaceSetup.errors.selectModel"),
      }),
    createRequest: async ({ attempt, text, images, attachments, cwd }) => {
      if (pendingAutoSubmit?.agentCreation) {
        const result = await pendingAutoSubmit.agentCreation.result;
        return { agentId: result.id, result };
      }
      return submitDraftCreateRequest({
        draftId,
        attempt,
        text,
        images,
        attachments,
        cwd,
        client,
        workspaceDirectory: draftWorkingDirectory,
        workspaceId: workspaceFields?.id ?? null,
        autoSubmitConfig,
        workflowModeSource,
        openui,
        composerState,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
        selectModelMessage: t("workspaceSetup.errors.selectModel"),
      });
    },
    onCreateSuccess: ({ result }) => {
      clearDraftInput("sent");
      clearWorkspaceAttachments({ scopeKey: draftAttachmentScopeKey });
      useWorkspaceDraftSubmissionStore.getState().clearDraftSetup({ draftId });
      // Anything the user sent while the agent was being created drains from here.
      moveDraftQueueToAgent({
        key: buildDraftQueueKey({ serverId, draftId }),
        serverId,
        agentId: result.id,
      });
      onCreated(result);
    },
  });
  const draftTimeline = useMemo(
    () =>
      resolveDraftTimeline({
        pending: pendingCreateAttempt ?? undefined,
        serverId,
        tabId,
        cwd: draftWorkingDirectory,
      }),
    [pendingCreateAttempt, serverId, tabId, draftWorkingDirectory],
  );
  const submittedStreamItems: StreamItem[] =
    draftTimeline?.streamItems ?? EMPTY_SUBMITTED_STREAM_ITEMS;
  const pendingMessageSubmissions: readonly PendingMessageSubmission[] =
    draftTimeline?.pendingMessageSubmissions ?? EMPTY_PENDING_MESSAGE_SUBMISSIONS;
  const turnPresentation = useMemo(
    () => resolveTurnPresentation(TURN_LIVENESS_IDLE, pendingMessageSubmissions.length > 0),
    [pendingMessageSubmissions],
  );
  useAgentControlCommandCenterActions({
    sourceId: `draft:${serverId}:${tabId}`,
    enabled: isPaneFocused && !isSubmitting,
    controls: {
      serverId,
      ownerKey: tabId,
      provider: draftProvider,
      providerDefinitions: draftProviderDefinitions,
      models: {
        providers: composerState.modelSelectorProviders,
        selectedProvider: draftProvider,
        selectedModelId: composerState.effectiveModelId,
        select: (provider, modelId) => {
          composerState.setProviderAndModelFromUser(provider, modelId);
        },
      },
      thinking: {
        options: draftThinkingOptions,
        selectedId: draftSelectedThinkingId,
        select: draftSetThinkingOption,
      },
      modes: {
        options: draftModeOptions,
        selectedId: draftSelectedMode,
        select: draftSetMode,
      },
      optionControls: composerState.agentControls.optionControls ?? null,
    },
  });
  const isReadyForPendingAutoSubmit = Boolean(
    pendingAutoSubmit &&
    draftInput.isHydrated &&
    draftWorkingDirectory &&
    client &&
    !composerState.isModelLoading,
  );
  const autoSubmitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReadyForPendingAutoSubmit) {
      return;
    }
    const submitKey = `${serverId}:${workspaceId}:${draftId}`;
    if (autoSubmitKeyRef.current === submitKey) {
      return;
    }
    const submission = consumePendingAutoSubmit({ serverId, workspaceId, draftId });
    if (!submission) {
      return;
    }
    autoSubmitKeyRef.current = submitKey;
    replaceDraftText("");
    setDraftAttachments([]);
    const preparedAttempt =
      initialCreateAttempt?.clientMessageId === submission.clientMessageId
        ? initialCreateAttempt
        : null;
    const createPromise = preparedAttempt
      ? continueCreateFromAttempt({
          attempt: preparedAttempt,
          cwd: submission.cwd,
        })
      : handleCreateFromInput({
          text: submission.text,
          attachments: submission.attachments,
          cwd: submission.cwd,
        });
    void createPromise.catch(() => {
      replaceDraftText(submission.text);
      setDraftAttachments(composerWorkspaceAttachment.userAttachmentsOnly(submission.attachments));
      autoSubmitKeyRef.current = null;
    });
  }, [
    continueCreateFromAttempt,
    consumePendingAutoSubmit,
    draftId,
    handleCreateFromInput,
    initialCreateAttempt,
    isReadyForPendingAutoSubmit,
    serverId,
    setDraftAttachments,
    replaceDraftText,
    workspaceId,
  ]);

  const focusInputRef = useRef<(() => void) | null>(null);

  const handleFocusInputCallback = useCallback((focus: () => void) => {
    focusInputRef.current = focus;
  }, []);

  const handleDropdownCloseFocus = useCallback(() => {
    focusInputRef.current?.();
  }, []);
  const importPillPress = resolveImportPillPress(onOpenImportSheet, isSubmitting);
  const composerAgentControls = useMemo(
    () => ({
      ...composerState.agentControls,
      onDropdownClose: handleDropdownCloseFocus,
      disabled: isSubmitting,
      multitaskTaskTargetKey: draftId,
    }),
    [composerState.agentControls, draftId, handleDropdownCloseFocus, isSubmitting],
  );
  const handleAddSelectionToChat = useCallback(
    (selection: string) => {
      const next = insertSelectionAsInlineChip({
        currentText: draftInput.textSource.getSnapshot(),
        selectionText: selection,
      });
      replaceDraftText(next.text);
      focusInputRef.current?.();
    },
    [draftInput, replaceDraftText],
  );
  const { addSelection: onAddSelectionToSideChat } = useAddSelectionToSideChat({
    serverId,
    workspaceId,
  });

  // New workspace centers its setup on wide layouts and leaves the composer near
  // the thumb on compact ones. Mirror that when this tab is used as a full screen.
  const centeredSetup = setupPresentation && !isCompactFormFactor;
  const renderDraftStream = useCallback(() => {
    // In a workspace tab the agent panel already renders the draft timeline. Rendering it here
    // as well paints the first prompt twice. Only the full-screen new-agent route owns it here.
    if (!setupPresentation || !draftAgent) {
      return null;
    }
    return (
      <AgentStreamView
        agentId={tabId}
        serverId={serverId}
        context={draftAgent}
        streamItems={submittedStreamItems}
        pendingMessageSubmissions={pendingMessageSubmissions}
        turnPresentation={turnPresentation}
        pendingPermissions={EMPTY_PENDING_PERMISSIONS}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        onAddSelectionToChat={handleAddSelectionToChat}
        onAddSelectionToSideChat={onAddSelectionToSideChat}
      />
    );
  }, [
    draftAgent,
    handleAddSelectionToChat,
    onAddSelectionToSideChat,
    onOpenWorkspaceFile,
    pendingMessageSubmissions,
    serverId,
    setupPresentation,
    submittedStreamItems,
    tabId,
    turnPresentation,
  ]);
  const setupBody = (
    <>
      {setupPresentation ? (
        <DraftSetupHeader heroTitle={heroTitle} isCompact={isCompactFormFactor} />
      ) : null}
      <DraftSetupContent
        centered={centeredSetup}
        isSubmitting={isSubmitting}
        hasDraftAgent={Boolean(draftAgent)}
        renderStream={renderDraftStream}
      />
    </>
  );
  const dockContent = wrapDraftDockContent(setupPresentation, setupBody);

  return (
    <FileDropZone style={styles.container}>
      <ComposerDock fullscreen={isComposerFullscreen} centered={centeredSetup}>
        {dockContent}
        <View style={animatedStaticStyles.inputAreaWrapper} onLayout={onInputAreaLayout}>
          {importPillPress && !isComposerFullscreen ? (
            <View style={styles.importPillRow} dataSet={CHAT_COLUMN_RAIL_DATASET}>
              <View style={styles.importPillContent}>
                <ComposerImportPill onPress={importPillPress} />
              </View>
            </View>
          ) : null}
          <Composer
            agentId={tabId}
            serverId={serverId}
            workspaceId={workspaceId}
            isPaneFocused={isPaneFocused}
            onSubmitMessage={handleCreateFromInput}
            isSubmitLoading={isSubmitting}
            submissionError={formErrorMessage || null}
            draftQueueKey={buildDraftQueueKey({ serverId, draftId })}
            blurOnSubmit={true}
            textSource={draftInput.textSource}
            onChangeText={draftInput.editText}
            textReplacement={draftInput.textReplacement}
            attachments={draftInput.attachments}
            attachmentScopeKeys={attachmentScopeKeys}
            onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
            onChangeAttachments={draftInput.setAttachments}
            cwd={composerState.workingDir}
            clearDraft={draftInput.clear}
            editingSession={editingSession}
            autoFocus={shouldAutoFocusWorkspaceDraftComposer({ isPaneFocused, isSubmitting })}
            autoFocusKey={String(draftInput.attachmentFocusRequestId)}
            onFocusInput={handleFocusInputCallback}
            commandDraft={composerState.commandDraft}
            agentControls={composerAgentControls}
            isCompactLayout={isCompactComposerLayout}
          />
        </View>
      </ComposerDock>
    </FileDropZone>
  );
}

/** The composer panel's entry point: the same draft tab without the full-screen setup chrome. */
export const WorkspaceDraftComposer = WorkspaceDraftAgentTab;

const animatedStaticStyles = RNStyleSheet.create({
  inputAreaWrapper: {
    width: "100%",
    flexShrink: 1,
    // Content-sized inline; fills the dock's fullscreen slot.
    flexGrow: 1,
  },
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    width: "100%",
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    flex: 1,
  },
  compactSetupSpace: {
    flex: 1,
  },
  heroTitleContainer: {
    marginBottom: theme.spacing[8],
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[4],
  },
  heroTitle: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  setupStreamContainer: {
    minHeight: 200,
  },
  streamContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  configScrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  configSection: {
    gap: theme.spacing[3],
  },
  importPillRow: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    paddingTop: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
    paddingBottom: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
    alignItems: "center",
  },
  importPillContent: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    flexDirection: "row",
  },
}));

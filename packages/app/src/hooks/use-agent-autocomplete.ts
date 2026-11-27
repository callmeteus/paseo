import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption, AutocompleteStatus } from "@/components/ui/autocomplete";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import {
  useAutocompleteCommands,
  type AgentSlashCommand,
  type DraftCommandConfig,
  type DraftCommandTarget,
} from "@/agent-commands";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useAutocomplete } from "./use-autocomplete";
import { resolveAutocompleteEscape, type AutocompleteMode } from "./autocomplete-escape";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { pluginDisplayName, usePluginList } from "@/plugins/plugin-list";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { CLIENT_SLASH_COMMANDS, type ClientSlashCommand } from "@/client-slash-commands";
import type { PluginClientSlashCommand } from "@/plugins/client-slash-commands";
import { mergeSlashCommandSources } from "@/plugins/client-slash-commands/model";
import {
  applySlashCommandReplacement,
  filterAndRankCommandAutocompleteEntries,
  filterInlineSkillCommandEntries,
  findActiveSlashCommand,
  type SlashCommandRange,
} from "@/utils/agent-command-autocomplete";
import {
  applyFileMentionReplacement,
  findActiveFileMention,
  type FileMentionRange,
} from "@/utils/file-mention-autocomplete";
import type { ChatMentionCandidate } from "@/utils/chat-mention-autocomplete";
import {
  insertInlineChip,
  maskInlineChips,
  mentionChipLabel,
} from "@getpaseo/protocol/inline-chip";
import { chatMentionAttachmentId } from "@/composer/chat-history-attachment";
import { useChatMentionSuggestions } from "./use-chat-mention-suggestions";
import { useHostFeature } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";

/** Compact layouts close the picker here: it would otherwise cover the conversation. */
const COMPACT_MENTION_MAX_WORDS = 4;

function resolveMentionWordLimit(isCompactFormFactor: boolean): number | undefined {
  return isCompactFormFactor ? COMPACT_MENTION_MAX_WORDS : undefined;
}

interface UseAgentAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  setUserInput: (nextValue: string, selection?: { start: number; end: number }) => void;
  serverId: string;
  agentId: string;
  draft?: DraftCommandTarget;
  onAutocompleteApplied?: () => void;
  onClientSlashCommand?: (command: ClientSlashCommand) => void;
  canExecuteClientSlashCommand?: boolean;
  pluginClientSlashCommands?: readonly PluginClientSlashCommand[];
  /** Selecting a chat replaces the @ token with an inline mention and attaches its history. */
  onChatSelected?: (chat: ChatMentionCandidate) => void | Promise<void>;
}

interface AgentAutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: AgentAutocompleteInputSnapshot;
}

interface AgentAutocompleteInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

type AgentAutocompleteOption =
  | (AutocompleteOption & { type: "client_command"; command: ClientSlashCommand })
  | (AutocompleteOption & {
      type: "plugin_command";
      command: PluginClientSlashCommand;
    })
  | (AutocompleteOption & { type: "provider_command" })
  | (AutocompleteOption & {
      type: "workspace_entry";
      entryPath: string;
      mention: FileMentionRange;
    })
  | (AutocompleteOption & { type: "chat"; chat: ChatMentionCandidate });

interface AgentAutocompleteResult {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  /** Shown in place of options; set exactly when `options` is empty. */
  status: AutocompleteStatus | null;
  onSelectOption: (option: AutocompleteOption, input?: AgentAutocompleteInputSnapshot) => void;
  onKeyPress: (event: AgentAutocompleteKeyPressEvent) => boolean;
}

interface AgentAutocompleteSnapshot {
  text: string;
  slashCommand: SlashCommandRange | null;
  fileMention: FileMentionRange | null;
}

function resolveAgentAutocompleteSnapshot(input: {
  input?: AgentAutocompleteInputSnapshot;
  userInput: string;
  cursorIndex: number;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  mentionWordLimit?: number;
}): AgentAutocompleteSnapshot {
  if (!input.input) {
    return {
      text: input.userInput,
      slashCommand: input.activeSlashCommand,
      fileMention: input.activeFileMention,
    };
  }

  const text = input.input.text;
  const cursorIndex = input.input.selection.start;
  // Chip bodies can contain `@` or `/`. Mask them so the caret index still lines up.
  const masked = maskInlineChips(text);
  return {
    text,
    slashCommand: findActiveSlashCommand({ text: masked, cursorIndex }),
    fileMention: findActiveFileMention({
      text: masked,
      cursorIndex,
      maxWords: input.mentionWordLimit,
    }),
  };
}

interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

type AvailableCommand =
  | { source: "client"; command: ClientSlashCommand }
  | { source: "plugin"; command: PluginClientSlashCommand }
  | { source: "provider"; command: AgentSlashCommand };

export function resolveDraftQueryConfig(
  draft?: DraftCommandTarget,
): DraftCommandConfig | undefined {
  if (draft?.status !== "ready") {
    return undefined;
  }

  const draftConfig = draft.config;
  const cwd = draftConfig.cwd.trim();
  const modeId = draftConfig.modeId?.trim() ?? "";
  const model = draftConfig.model?.trim() ?? "";
  const thinkingOptionId = draftConfig.thinkingOptionId?.trim() ?? "";
  const providerOptions = draftConfig.providerOptions;
  return {
    provider: draftConfig.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(providerOptions && Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}

function mapDirectorySuggestionsToEntries(payload: {
  entries?: Array<{ path: string; kind: string }>;
  directories?: string[];
}): DirectorySuggestionEntry[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        (entry.kind !== "file" && entry.kind !== "directory")
      ) {
        return [];
      }
      return [{ path: entry.path, kind: entry.kind }];
    });
  }

  return (payload.directories ?? []).map((path) => ({
    path,
    kind: "directory" as const,
  }));
}

const CLIENT_COMMAND_ICONS = {
  "archive-agent": "archive",
  "replace-agent-with-draft": "new-draft",
  // COMPAT(clientCommands): new client slash commands reuse the generic command glyph.
  "open-side-chat": "command",
  "paseo-update": "command",
  "toggle-chat-mode": "command",
} as const satisfies Record<ClientSlashCommand["kind"], AutocompleteOption["icon"]>;

interface CommandOptionContext {
  query: string;
  pluginNames: ReadonlyMap<string, string>;
  t: TFunction;
}

function mapCommandToOption(
  entry: AvailableCommand,
  context: CommandOptionContext,
): AgentAutocompleteOption {
  const command = entry.command;
  const base = {
    id: command.name,
    label: `/${command.name}`,
    // The label carries a leading slash the query does not.
    labelMatches: findHighlightRanges(context.query, command.name).map((range) => ({
      start: range.start + 1,
      length: range.length,
    })),
    argumentHint: command.argumentHint || undefined,
  };
  if (entry.source === "client") {
    return {
      ...base,
      type: "client_command",
      command: entry.command,
      icon: CLIENT_COMMAND_ICONS[entry.command.kind],
      description: context.t(entry.command.descriptionKey),
      tag: "Paseo",
    };
  }
  if (entry.source === "plugin") {
    return {
      ...base,
      type: "plugin_command",
      command: entry.command,
      icon: "plugin",
      description: entry.command.description,
      tag: context.pluginNames.get(entry.command.pluginId) ?? entry.command.pluginId,
    };
  }
  const isSkill = entry.command.kind === "skill";
  return {
    ...base,
    type: "provider_command",
    icon: isSkill ? "skill" : "command",
    description: entry.command.description,
    tag: isSkill ? context.t("agentAutocomplete.skillTag") : undefined,
  };
}

interface BuildAutocompleteOptionsInput {
  mode: AutocompleteMode;
  commands: AgentSlashCommand[];
  pluginCommands: readonly PluginClientSlashCommand[];
  pluginNames: ReadonlyMap<string, string>;
  isDraftContext: boolean;
  commandFilterQuery: string;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  fileSuggestions: DirectorySuggestionEntry[];
  chatSuggestions: ChatMentionCandidate[];
  t: TFunction;
}

function buildAutocompleteOptions(input: BuildAutocompleteOptionsInput): AgentAutocompleteOption[] {
  if (input.mode === "command") {
    const providerCommands = input.commands.map((command) => ({
      source: "provider" as const,
      command,
    }));
    const rootCommands: AvailableCommand[] = mergeSlashCommandSources({
      builtIn: CLIENT_SLASH_COMMANDS,
      plugins: input.pluginCommands,
      provider: input.commands,
      onPluginCollision(command, winner) {
        console.warn(
          `[Plugins] Client slash command /${command.name} from ${command.pluginId} ignored; ${winner} command wins`,
        );
      },
    })
      .filter((entry) => !input.isDraftContext || entry.source !== "built-in")
      .map((entry): AvailableCommand => {
        if (entry.source === "built-in") return { source: "client", command: entry.command };
        return entry;
      });
    const availableCommands: AvailableCommand[] =
      input.activeSlashCommand?.position === "inline"
        ? filterInlineSkillCommandEntries(providerCommands)
        : rootCommands;
    const matches = filterAndRankCommandAutocompleteEntries(
      availableCommands,
      input.commandFilterQuery,
    );
    const context = {
      query: input.commandFilterQuery,
      pluginNames: input.pluginNames,
      t: input.t,
    };
    return orderAutocompleteOptions(matches).map((entry) => mapCommandToOption(entry, context));
  }

  const activeFileMention = input.activeFileMention;
  if (input.mode === "file" && activeFileMention) {
    // Chats are prepended so they sit closest to the input once the popover
    // reverses the list, and so a file rename never outranks an explicit pick.
    const chatOptions: AgentAutocompleteOption[] = input.chatSuggestions.map((chat) => ({
      type: "chat" as const,
      id: `chat:${chat.serverId}:${chat.agentId}`,
      label: chat.title?.trim() || input.t("agentAutocomplete.untitledChat"),
      kind: "chat",
      description: chat.snippet ?? chat.workspaceName ?? chat.cwd,
      detail: chat.archived ? input.t("agentAutocomplete.archivedChat") : undefined,
      chat,
    }));
    const orderedEntries = orderAutocompleteOptions(input.fileSuggestions);
    return [
      ...chatOptions,
      ...orderedEntries.map((entry) => ({
        type: "workspace_entry" as const,
        id: `${entry.kind}:${entry.path}`,
        label: entry.path,
        kind: entry.kind,
        entryPath: entry.path,
        mention: activeFileMention,
      })),
    ];
  }

  return [];
}

function resolveAutocompleteMode(args: {
  showFileAutocomplete: boolean;
  showCommandAutocomplete: boolean;
}): AutocompleteMode {
  if (args.showFileAutocomplete) {
    return "file";
  }
  if (args.showCommandAutocomplete) {
    return "command";
  }
  return null;
}

function resolveAutocompleteIsVisible(args: {
  mode: AutocompleteMode;
  canLoadCommands: boolean;
  serverId: string;
  autocompleteCwd: string;
}): boolean {
  if (args.mode === "command") {
    return args.canLoadCommands;
  }
  if (args.mode === "file") {
    return Boolean(args.serverId) && args.autocompleteCwd.length > 0;
  }
  return false;
}

// Selecting a chat attaches its history, so the picker needs the fork-context RPC
// as well as the search itself.
function resolveChatMentionSupport(args: {
  chatSearch: boolean;
  agentForkContext: boolean;
}): boolean {
  return args.chatSearch && args.agentForkContext;
}

function resolveCanLoadCommands(args: {
  serverId: string;
  agentId: string;
  isDraftContext: boolean;
}): boolean {
  if (!args.serverId) {
    return false;
  }
  return Boolean(args.agentId) || args.isDraftContext;
}

type CommandsState = "ready" | "loading" | "error";

function resolveCommandsState(input: {
  canListCommands: boolean;
  isLoading: boolean;
  isError: boolean;
}): CommandsState {
  if (!input.canListCommands) return "ready";
  if (input.isError) return "error";
  if (input.isLoading) return "loading";
  return "ready";
}

interface AutocompleteMenu {
  options: AgentAutocompleteOption[];
  status: AutocompleteStatus | null;
}

/**
 * One state for the open menu, so options and a loading or error row cannot both claim it:
 * while a status row shows there are no options for Enter or Tab to pick.
 */
function resolveCommandMenu(input: {
  commandsState: CommandsState;
  options: () => AgentAutocompleteOption[];
  providerLabel: string | null;
  error: Error | null;
  onRetry: () => void;
  emptyText: string;
  t: TFunction;
}): AutocompleteMenu {
  const { t } = input;
  if (input.commandsState === "loading") {
    const message = input.providerLabel
      ? t("agentAutocomplete.loadingProviderCommands", { provider: input.providerLabel })
      : t("agentAutocomplete.loadingCommands");
    return { options: [], status: { kind: "loading", message } };
  }
  if (input.commandsState === "error") {
    const title = input.providerLabel
      ? t("agentAutocomplete.providerCommandsFailed", { provider: input.providerLabel })
      : t("agentAutocomplete.commandsFailed");
    return {
      options: [],
      status: { kind: "error", title, reason: input.error?.message, onRetry: input.onRetry },
    };
  }
  return withEmptyStatus(input.options(), input.emptyText);
}

function resolveFileMenu(input: {
  options: () => AgentAutocompleteOption[];
  isPending: boolean;
  isLoading: boolean;
  error: unknown;
  t: TFunction;
}): AutocompleteMenu {
  const options = input.options();
  if (input.isPending || (input.isLoading && options.length === 0)) {
    return {
      options: [],
      status: { kind: "loading", message: input.t("agentAutocomplete.searchingWorkspace") },
    };
  }
  if (input.error instanceof Error) {
    return {
      options: [],
      status: {
        kind: "error",
        title: input.t("agentAutocomplete.filesFailed"),
        reason: input.error.message,
      },
    };
  }
  return withEmptyStatus(options, input.t("agentAutocomplete.noFiles"));
}

function withEmptyStatus(options: AgentAutocompleteOption[], emptyText: string): AutocompleteMenu {
  return options.length > 0
    ? { options, status: null }
    : { options, status: { kind: "empty", message: emptyText } };
}

/** How long a command menu waits for commands before it opens on a loading row. */
const COMMANDS_LOADING_REVEAL_MS = 300;

/**
 * Whether the open command menu has waited long enough to show a loading row. Commands that
 * arrive sooner paint the list as the first frame; once the wait is over, loading (a retry)
 * shows at once so the open menu never closes on itself.
 */
function useLoadingRevealed(isMenuOpen: boolean): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!isMenuOpen) {
      setRevealed(false);
      return undefined;
    }
    const timer = setTimeout(() => setRevealed(true), COMMANDS_LOADING_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [isMenuOpen]);
  return revealed;
}

/** The names command rows and status rows show: the provider's label and each plugin's name. */
function useCommandSourceNames(input: {
  serverId: string;
  agentId: string;
  draftConfig: DraftCommandConfig | undefined;
  cwd: string;
  isCommandMenuOpen: boolean;
  commandsState: CommandsState;
  pluginCommandCount: number;
}): { providerLabel: string | null; pluginNames: ReadonlyMap<string, string> } {
  const agentProvider = useSessionStore(
    (state) => state.sessions[input.serverId]?.agents?.get(input.agentId)?.provider,
  );
  const provider = input.draftConfig?.provider ?? agentProvider;
  // Only a loading or error row names the provider; only plugin rows need plugin names.
  const { entries: providerEntries } = useProvidersSnapshot(input.serverId, {
    cwd: input.cwd,
    enabled: input.isCommandMenuOpen && input.commandsState !== "ready",
  });
  const pluginList = usePluginList(input.serverId, {
    enabled: input.isCommandMenuOpen && input.pluginCommandCount > 0,
  });
  const pluginNames = useMemo(
    () => new Map((pluginList.data ?? []).map((plugin) => [plugin.id, pluginDisplayName(plugin)])),
    [pluginList.data],
  );
  return {
    providerLabel: provider ? resolveProviderLabel(provider, providerEntries) : null,
    pluginNames,
  };
}

// A draft's agentId is a draft key the daemon does not know, so a draft lists
// commands by its config only, and not at all until that config is complete.
function resolveDraftCommandContext(draft: DraftCommandTarget | undefined) {
  const queryDraftConfig = resolveDraftQueryConfig(draft);
  const isDraftContext = draft !== undefined;
  return {
    isDraftContext,
    queryDraftConfig,
    canListCommands: !isDraftContext || queryDraftConfig !== undefined,
  };
}

function resolveCommandsEmptyText(args: {
  draft: DraftCommandTarget | undefined;
  t: TFunction;
}): string {
  if (args.draft?.status === "needs-project") {
    return args.t("agentAutocomplete.chooseProjectForCommands");
  }
  if (args.draft?.status === "needs-provider") {
    return args.t("agentAutocomplete.chooseModelForCommands");
  }
  return args.t("agentAutocomplete.noCommands");
}

/**
 * Escape closes the picker for the token it was pressed on. Tracking the start
 * index keeps it closed while the user keeps editing that same token, and reopens
 * it as soon as a different one begins.
 */
function useDismissedToken<TToken extends { start: number }>(
  active: TToken | null,
): { token: TToken | null; dismiss: (start: number) => void } {
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  useEffect(() => {
    if (dismissedStart !== null && active?.start !== dismissedStart) {
      setDismissedStart(null);
    }
  }, [active, dismissedStart]);
  const token = dismissedStart !== null && active?.start === dismissedStart ? null : active;
  return { token, dismiss: setDismissedStart };
}

export function useAgentAutocomplete(input: UseAgentAutocompleteInput): AgentAutocompleteResult {
  const { t } = useTranslation();
  const {
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    draft,
    onAutocompleteApplied,
    onClientSlashCommand,
    canExecuteClientSlashCommand,
    pluginClientSlashCommands = [],
    onChatSelected,
  } = input;

  const maskedUserInput = maskInlineChips(userInput);
  const activeSlashCommand = useMemo(
    () =>
      findActiveSlashCommand({
        text: maskedUserInput,
        cursorIndex,
      }),
    [cursorIndex, maskedUserInput],
  );
  const { token: slashCommand, dismiss: dismissSlashCommand } =
    useDismissedToken(activeSlashCommand);
  const showCommandAutocomplete = slashCommand !== null;
  const commandFilterQuery = slashCommand?.query ?? "";

  const mentionWordLimit = resolveMentionWordLimit(useIsCompactFormFactor());
  const activeFileMention = useMemo(
    () =>
      findActiveFileMention({
        text: maskedUserInput,
        cursorIndex,
        maxWords: mentionWordLimit,
      }),
    [cursorIndex, maskedUserInput, mentionWordLimit],
  );
  const { token: fileMention, dismiss: dismissMention } = useDismissedToken(activeFileMention);
  const showFileAutocomplete = fileMention !== null;
  const fileFilterQuery = fileMention?.query ?? "";
  const [debouncedFileFilterQuery, setDebouncedFileFilterQuery] = useState(fileFilterQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileFilterQuery(fileFilterQuery), 180);
    return () => clearTimeout(timer);
  }, [fileFilterQuery]);

  const { isDraftContext, queryDraftConfig, canListCommands } = useMemo(
    () => resolveDraftCommandContext(draft),
    [draft],
  );
  const canLoadCommands = resolveCanLoadCommands({ serverId, agentId, isDraftContext });

  const agentCwd = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? "",
  );
  const autocompleteCwd = useMemo(() => {
    if (isDraftContext) {
      return queryDraftConfig?.cwd ?? "";
    }
    return agentCwd.trim();
  }, [agentCwd, isDraftContext, queryDraftConfig]);

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsChatMention = resolveChatMentionSupport({
    chatSearch: useHostFeature(serverId, "chatSearch"),
    agentForkContext: useHostFeature(serverId, "agentForkContext"),
  });

  const mode = resolveAutocompleteMode({ showFileAutocomplete, showCommandAutocomplete });
  const isMentionMode = mode === "file";
  const canShowAutocomplete = resolveAutocompleteIsVisible({
    mode,
    canLoadCommands,
    serverId,
    autocompleteCwd,
  });

  const commandsQuery = useAutocompleteCommands({
    serverId,
    agentId,
    enabled: mode === "command" && canLoadCommands && canListCommands,
    draftConfig: queryDraftConfig,
  });
  const commandsState = resolveCommandsState({
    canListCommands,
    isLoading: commandsQuery.isLoading,
    isError: commandsQuery.isError,
  });
  const isCommandMenuOpen = mode === "command" && canShowAutocomplete;
  const isLoadingRevealed = useLoadingRevealed(isCommandMenuOpen);
  const isVisible =
    canShowAutocomplete &&
    !(isCommandMenuOpen && commandsState === "loading" && !isLoadingRevealed);
  const { providerLabel, pluginNames } = useCommandSourceNames({
    serverId,
    agentId,
    draftConfig: queryDraftConfig,
    cwd: autocompleteCwd,
    isCommandMenuOpen,
    commandsState,
    pluginCommandCount: pluginClientSlashCommands.length,
  });

  const fileSuggestionsQuery = useQuery({
    queryKey: [
      "directorySuggestions",
      serverId,
      autocompleteCwd,
      debouncedFileFilterQuery,
      true,
      true,
    ],
    queryFn: async (): Promise<DirectorySuggestionEntry[]> => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const response = await client.getDirectorySuggestions({
        cwd: autocompleteCwd,
        query: debouncedFileFilterQuery,
        limit: 50,
        includeFiles: true,
        includeDirectories: true,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return mapDirectorySuggestionsToEntries(response);
    },
    enabled:
      mode === "file" &&
      Boolean(serverId) &&
      autocompleteCwd.length > 0 &&
      Boolean(client) &&
      isConnected,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const chatSuggestions = useChatMentionSuggestions({
    serverId,
    agentId,
    enabled: isMentionMode,
    query: debouncedFileFilterQuery,
    client,
    isConnected,
    supportsChatMention,
  });

  const commandsEmptyText = resolveCommandsEmptyText({ draft, t });
  const retryCommandsQuery = commandsQuery.retry;
  const retryCommands = useCallback(() => {
    retryCommandsQuery();
    // Pressing Retry takes focus on web; hand it back so the user keeps typing the command.
    onAutocompleteApplied?.();
  }, [onAutocompleteApplied, retryCommandsQuery]);
  const { options, status } = useMemo<AutocompleteMenu>(() => {
    if (!isVisible) return { options: [], status: null };
    const buildOptions = () =>
      buildAutocompleteOptions({
        activeFileMention,
        commandFilterQuery,
        commands: commandsQuery.commands,
        pluginCommands: pluginClientSlashCommands,
        pluginNames,
        activeSlashCommand,
        fileSuggestions: fileSuggestionsQuery.data ?? [],
        chatSuggestions,
        isDraftContext,
        mode,
        t,
      });
    if (mode === "file") {
      return resolveFileMenu({
        options: buildOptions,
        isPending: fileSuggestionsQuery.isPending,
        isLoading: fileSuggestionsQuery.isLoading,
        error: fileSuggestionsQuery.error,
        t,
      });
    }
    return resolveCommandMenu({
      commandsState,
      options: buildOptions,
      providerLabel,
      error: commandsQuery.error,
      onRetry: retryCommands,
      emptyText: commandsEmptyText,
      t,
    });
  }, [
    activeFileMention,
    activeSlashCommand,
    chatSuggestions,
    commandFilterQuery,
    commandsEmptyText,
    commandsQuery.commands,
    commandsQuery.error,
    commandsState,
    fileSuggestionsQuery.data,
    fileSuggestionsQuery.error,
    fileSuggestionsQuery.isLoading,
    fileSuggestionsQuery.isPending,
    isDraftContext,
    isVisible,
    mode,
    pluginClientSlashCommands,
    pluginNames,
    providerLabel,
    retryCommands,
    t,
  ]);

  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: AgentAutocompleteInputSnapshot) => {
      const selected = option as AgentAutocompleteOption;
      const current = resolveAgentAutocompleteSnapshot({
        input: snapshot,
        userInput,
        cursorIndex,
        activeSlashCommand,
        activeFileMention: fileMention,
        mentionWordLimit,
      });
      const selectedIsCommand =
        selected.type === "client_command" ||
        selected.type === "plugin_command" ||
        selected.type === "provider_command";
      if (snapshot && selectedIsCommand && !current.slashCommand) return;
      if (
        selected.type === "client_command" &&
        selected.command.execution === "immediate" &&
        canExecuteClientSlashCommand &&
        onClientSlashCommand
      ) {
        onClientSlashCommand(selected.command);
        return;
      }

      if (selectedIsCommand) {
        if (!current.slashCommand) {
          const next = `/${selected.id} `;
          setUserInput(next, { start: next.length, end: next.length });
          onAutocompleteApplied?.();
          return;
        }

        const next = applySlashCommandReplacement({
          text: current.text,
          command: current.slashCommand,
          commandName: selected.id,
        });
        setUserInput(next.text, next.selection);
        onAutocompleteApplied?.();
        return;
      }

      if (!current.fileMention) return;

      if (selected.type === "chat") {
        const next = insertInlineChip({
          text: current.text,
          selection: { start: current.fileMention.start, end: current.fileMention.end },
          chip: {
            id: chatMentionAttachmentId(selected.chat.agentId),
            kind: "mention",
            label: mentionChipLabel({
              title: selected.chat.title,
              workspaceName: selected.chat.workspaceName,
              agentId: selected.chat.agentId,
            }),
            body: "",
          },
        });
        setUserInput(next.text, next.selection);
        void onChatSelected?.(selected.chat);
        onAutocompleteApplied?.();
        return;
      }

      const next = applyFileMentionReplacement({
        text: current.text,
        mention: current.fileMention,
        relativePath: selected.entryPath,
      });
      setUserInput(next.text, next.selection);
      onAutocompleteApplied?.();
    },
    [
      canExecuteClientSlashCommand,
      onAutocompleteApplied,
      onChatSelected,
      onClientSlashCommand,
      setUserInput,
      userInput,
      cursorIndex,
      fileMention,
      activeSlashCommand,
      mentionWordLimit,
    ],
  );

  const selectOptionFromKeyPress = useCallback(
    (option: AutocompleteOption, event?: AgentAutocompleteKeyPressEvent) =>
      onSelectOption(option, event?.input),
    [onSelectOption],
  );

  const clearInputOnEscape = useCallback(() => setUserInput(""), [setUserInput]);
  const onEscape = resolveAutocompleteEscape({
    mode,
    slashCommand,
    fileMention,
    clearInput: clearInputOnEscape,
    dismissCommand: dismissSlashCommand,
    dismissMention,
  });

  const { selectedIndex, onKeyPress: handleAutocompleteKeyPress } = useAutocomplete({
    isVisible,
    options,
    query: mode === "command" ? commandFilterQuery : fileFilterQuery,
    onSelectOption: selectOptionFromKeyPress,
    onEscape,
  });
  // useAutocomplete ignores Escape when there are no options, which would let it
  // fall through to the global shortcut (interrupt the agent) while a slash or
  // mention token is still open with an empty result list. Escape owns the picker.
  const onKeyPress = useCallback(
    (event: AgentAutocompleteKeyPressEvent) => {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return true;
      }
      return handleAutocompleteKeyPress(event);
    },
    [handleAutocompleteKeyPress, onEscape],
  );

  return {
    isVisible,
    options,
    selectedIndex,
    status,
    onSelectOption,
    onKeyPress,
  };
}

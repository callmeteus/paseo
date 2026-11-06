import type pino from "pino";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";

import {
  applyGeneratedChatTitle,
  resolveFirstAgentPromptTitle,
  type ChatTitleTarget,
} from "./agent/create-agent-title.js";
import type { AgentManager } from "./agent/agent-manager.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { StructuredGenerationDaemonConfig } from "./agent/structured-generation-providers.js";
import {
  attemptFirstAgentBranchAutoName,
  type AttemptFirstAgentBranchAutoNameResult,
} from "./paseo-worktree-service.js";
import type { GitMutationService } from "./session/git-mutation/git-mutation-service.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";
import {
  generateBranchNameFromFirstAgentContext,
  type GeneratedWorkspaceName,
  type GenerateBranchNameFromFirstAgentContextOptions,
} from "./worktree-branch-name-generator.js";

type WorkspaceNameGenerator = typeof generateBranchNameFromFirstAgentContext;

type CurrentSelection = GenerateBranchNameFromFirstAgentContextOptions["currentSelection"] | null;

interface WorkspaceAutoNameOptions {
  agentManager: AgentManager;
  workspaceRegistry: Pick<WorkspaceRegistry, "update">;
  workspaceGitService: WorkspaceGitService;
  providerSnapshotManager: ProviderSnapshotManager;
  readDaemonConfig: () => StructuredGenerationDaemonConfig;
  gitMutation: Pick<GitMutationService, "notifyGitMutation">;
  emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
  logger: pino.Logger;
  generateWorkspaceName?: WorkspaceNameGenerator;
  /** Agents whose visible name should follow the chat title. Absent in tests that only rename the workspace. */
  listWorkspaceAgentTitles?: (workspaceId: string) => Promise<readonly ChatTitleTarget[]>;
  /** Current workspace record, used when an agent is created after the title landed. */
  readWorkspace?: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
}

interface ScheduleContext {
  currentSelection?: CurrentSelection;
}

export class WorkspaceAutoName {
  private readonly agentManager: AgentManager;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "update">;
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly readDaemonConfig: () => StructuredGenerationDaemonConfig;
  private readonly gitMutation: Pick<GitMutationService, "notifyGitMutation">;
  private readonly emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  private readonly emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
  private readonly logger: pino.Logger;
  private readonly generateWorkspaceName: WorkspaceNameGenerator;
  private readonly listWorkspaceAgentTitles: WorkspaceAutoNameOptions["listWorkspaceAgentTitles"];
  private readonly readWorkspace: WorkspaceAutoNameOptions["readWorkspace"];
  /** Prompt prefix captured when the workspace was scheduled, so a later provider title can replace it. */
  private readonly promptTitles = new Map<string, string>();
  /** Last title this flow wrote. A side still showing it follows the next title. */
  private readonly previousTitles = new Map<string, string>();

  constructor(options: WorkspaceAutoNameOptions) {
    this.agentManager = options.agentManager;
    this.workspaceRegistry = options.workspaceRegistry;
    this.workspaceGitService = options.workspaceGitService;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.readDaemonConfig = options.readDaemonConfig;
    this.gitMutation = options.gitMutation;
    this.emitWorkspaceUpdateForCwd = options.emitWorkspaceUpdateForCwd;
    this.emitWorkspaceUpdateForWorkspaceId = options.emitWorkspaceUpdateForWorkspaceId;
    this.logger = options.logger;
    this.generateWorkspaceName =
      options.generateWorkspaceName ?? generateBranchNameFromFirstAgentContext;
    this.listWorkspaceAgentTitles = options.listWorkspaceAgentTitles;
    this.readWorkspace = options.readWorkspace;
  }

  scheduleForWorktree(
    input: {
      workspace: PersistedWorkspaceRecord;
      firstAgentContext: FirstAgentContext;
    },
    context: ScheduleContext = {},
  ): void {
    this.rememberPromptTitle(input.workspace.workspaceId, input.firstAgentContext);
    this.schedule(
      () =>
        this.maybeAutoNameWorkspaceBranchForFirstAgent({
          ...input,
          currentSelection: context.currentSelection ?? null,
        }),
      {
        cwd: input.workspace.cwd,
        message: "Failed to auto-name worktree branch",
      },
    );
  }

  scheduleForDirectory(
    input: {
      workspaceId: string;
      cwd: string;
      firstAgentContext: FirstAgentContext;
    },
    context: ScheduleContext = {},
  ): void {
    this.rememberPromptTitle(input.workspaceId, input.firstAgentContext);
    this.schedule(
      () =>
        this.maybeAutoNameDirectoryWorkspaceTitle({
          ...input,
          currentSelection: context.currentSelection ?? null,
        }),
      { cwd: input.cwd, message: "Failed to auto-name directory workspace title" },
    );
  }

  private async maybeAutoNameWorkspaceBranchForFirstAgent(input: {
    workspace: PersistedWorkspaceRecord;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<void> {
    const worktreeRoot = input.workspace.worktreeRoot ?? input.workspace.cwd;
    let generated: GeneratedWorkspaceName | null = null;
    const result: AttemptFirstAgentBranchAutoNameResult = await attemptFirstAgentBranchAutoName({
      cwd: worktreeRoot,
      firstAgentContext: input.firstAgentContext,
      generateBranchNameFromContext: ({ firstAgentContext }) => {
        return this.generateFromContext({
          cwd: input.workspace.cwd,
          firstAgentContext,
          currentSelection: input.currentSelection,
        }).then((nextGenerated) => {
          generated = nextGenerated;
          return nextGenerated?.branch ?? null;
        });
      },
    });

    if (!generated) {
      generated = await this.generateFromContext({
        cwd: input.workspace.cwd,
        firstAgentContext: input.firstAgentContext,
        currentSelection: input.currentSelection,
      });
    }
    const generatedTitle = generated?.title ?? null;
    if (!generatedTitle) {
      return;
    }

    // K4: re-read from the registry before writing so any concurrent upsert
    // that happened between workspace creation and this async path is not clobbered.
    // When the first-agent rename changed the git branch too, persist that branch
    // alongside the title — both are this path's own fields.
    await this.applyGeneratedWorkspaceTitle(input.workspace.workspaceId, {
      title: generatedTitle,
      ...(result.renamed ? { branch: result.branchName } : {}),
      promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),
    });
    if (result.renamed) {
      await this.gitMutation.notifyGitMutation(worktreeRoot, "rename-branch");
    }
    await this.emitWorkspaceUpdateForCwd(input.workspace.cwd);
  }

  private async maybeAutoNameDirectoryWorkspaceTitle(input: {
    workspaceId: string;
    cwd: string;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<void> {
    const generated = await this.generateFromContext({
      cwd: input.cwd,
      firstAgentContext: input.firstAgentContext,
      currentSelection: input.currentSelection,
    });
    const title = generated?.title ?? null;
    if (!title) {
      return;
    }
    // K4: applyGeneratedWorkspaceTitle re-reads from the registry before writing.
    // Directory workspaces have no branch — write only the title.
    await this.applyGeneratedWorkspaceTitle(input.workspaceId, {
      title,
      promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),
    });
    await this.emitWorkspaceUpdateForWorkspaceId(input.workspaceId);
  }

  /**
   * Copies the workspace name onto an agent created after that name was chosen.
   * A workspace that is still the prompt is left for the scheduled title.
   */
  async adoptWorkspaceTitleForAgent(input: {
    workspaceId: string;
    agentId: string;
    promptTitle: string | null;
    agentTitle: string | null;
  }): Promise<void> {
    if (input.promptTitle) {
      this.promptTitles.set(input.workspaceId, input.promptTitle);
    }
    if (!this.readWorkspace) {
      return;
    }
    const workspace = await this.readWorkspace(input.workspaceId);
    if (!workspace) {
      return;
    }
    const agents = [{ id: input.agentId, title: input.agentTitle }];
    const applied = applyGeneratedChatTitle({
      generatedTitle: workspace.title,
      promptTitle: input.promptTitle,
      previousTitle: this.previousTitles.get(input.workspaceId) ?? null,
      workspaceTitle: workspace.title,
      agentTitles: agents,
    });
    await this.writeAgentTitles(agents, applied.agents);
  }

  /**
   * Applies a provider session title, such as an OpenCode or Cloud rename,
   * through the same rule as the chat title the workspace generator produces.
   */
  async applyObservedSessionTitle(input: {
    workspaceId: string | null;
    agentId: string;
    agentTitle: string | null;
    observedTitle: string;
  }): Promise<void> {
    const observed = input.observedTitle.trim();
    if (!observed) {
      return;
    }
    if (!input.workspaceId) {
      await this.writeAgentTitles(
        [{ id: input.agentId, title: input.agentTitle }],
        [{ id: input.agentId, title: observed }],
      );
      return;
    }
    const workspaceId = input.workspaceId;
    const promptTitle = this.promptTitles.get(workspaceId) ?? null;
    const previousTitle = this.previousTitles.get(workspaceId) ?? null;
    const agents = await this.titlesForWorkspace(workspaceId, {
      id: input.agentId,
      title: input.agentTitle,
    });
    const current = this.readWorkspace ? await this.readWorkspace(workspaceId) : null;
    const preview = applyGeneratedChatTitle({
      generatedTitle: observed,
      promptTitle,
      previousTitle,
      workspaceTitle: current?.title ?? null,
      agentTitles: agents,
    });
    let nextAgents = preview.agents;
    const titleChanges = current !== null && (current.title ?? null) !== preview.workspaceTitle;
    if (titleChanges || current === null) {
      let changed = false;
      await this.workspaceRegistry.update(workspaceId, (record) => {
        const applied = applyGeneratedChatTitle({
          generatedTitle: observed,
          promptTitle,
          previousTitle,
          workspaceTitle: record.title,
          agentTitles: agents,
        });
        nextAgents = applied.agents;
        this.rememberWrittenTitle(workspaceId, applied);
        if ((record.title ?? null) === applied.workspaceTitle) {
          return record;
        }
        changed = true;
        return {
          ...record,
          title: applied.workspaceTitle,
          updatedAt: new Date().toISOString(),
        };
      });
      if (changed) {
        await this.emitWorkspaceUpdateForWorkspaceId(workspaceId);
      }
    } else {
      this.rememberWrittenTitle(workspaceId, preview);
    }
    await this.writeAgentTitles(agents, nextAgents);
  }

  private async applyGeneratedWorkspaceTitle(
    workspaceId: string,
    input: { title: string; branch?: string | null; promptTitle?: string | null },
  ): Promise<void> {
    const agents = this.listWorkspaceAgentTitles
      ? await this.listWorkspaceAgentTitles(workspaceId)
      : [];
    const promptTitle = input.promptTitle ?? this.promptTitles.get(workspaceId) ?? null;
    const previousTitle = this.previousTitles.get(workspaceId) ?? null;
    let nextAgents: readonly ChatTitleTarget[] = agents;
    await this.workspaceRegistry.update(workspaceId, (current) => {
      const applied = applyGeneratedChatTitle({
        generatedTitle: input.title,
        promptTitle,
        previousTitle,
        workspaceTitle: current.title,
        agentTitles: agents,
      });
      nextAgents = applied.agents;
      this.rememberWrittenTitle(workspaceId, applied);
      return {
        ...current,
        title: applied.workspaceTitle,
        ...(input.branch ? { branch: input.branch } : {}),
        updatedAt: new Date().toISOString(),
      };
    });
    await this.writeAgentTitles(agents, nextAgents);
  }

  private async titlesForWorkspace(
    workspaceId: string,
    reported: ChatTitleTarget,
  ): Promise<ChatTitleTarget[]> {
    const listed = this.listWorkspaceAgentTitles
      ? await this.listWorkspaceAgentTitles(workspaceId)
      : [];
    return [...listed.filter((agent) => agent.id !== reported.id), reported];
  }

  private rememberPromptTitle(workspaceId: string, firstAgentContext: FirstAgentContext): void {
    const promptTitle = resolveFirstAgentPromptTitle(firstAgentContext);
    if (promptTitle) {
      this.promptTitles.set(workspaceId, promptTitle);
    }
  }

  private rememberWrittenTitle(
    workspaceId: string,
    applied: { wroteGeneratedTitle: boolean; workspaceTitle: string | null },
  ): void {
    if (applied.wroteGeneratedTitle && applied.workspaceTitle) {
      this.previousTitles.set(workspaceId, applied.workspaceTitle);
    }
  }

  private async writeAgentTitles(
    before: readonly ChatTitleTarget[],
    after: readonly ChatTitleTarget[],
  ): Promise<void> {
    for (const next of after) {
      if (!next.title) {
        continue;
      }
      const previous = before.find((agent) => agent.id === next.id)?.title ?? null;
      const normalizedPrevious = typeof previous === "string" ? previous.trim() : "";
      if (next.title === normalizedPrevious) {
        continue;
      }
      if (typeof this.agentManager.setTitle !== "function") {
        return;
      }
      try {
        await this.agentManager.setTitle(next.id, next.title);
      } catch (error) {
        // A stored agent that is not loaded must not stop the live session,
        // or the workspace, from taking the title.
        this.logger.warn(
          { err: error, agentId: next.id },
          "Failed to apply the chat title to an agent",
        );
      }
    }
  }

  private generateFromContext(input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<GeneratedWorkspaceName | null> {
    return this.generateWorkspaceName({
      agentManager: this.agentManager,
      cwd: input.cwd,
      workspaceGitService: this.workspaceGitService,
      providerSnapshotManager: this.providerSnapshotManager,
      daemonConfig: this.readDaemonConfig(),
      currentSelection: input.currentSelection ?? undefined,
      firstAgentContext: input.firstAgentContext,
      logger: this.logger,
    });
  }

  private schedule(run: () => Promise<void>, context: { cwd: string; message: string }): void {
    setTimeout(() => {
      void run().catch((error) => {
        this.logger.warn({ err: error, cwd: context.cwd }, context.message);
      });
    }, 0);
  }
}

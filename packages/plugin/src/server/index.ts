export type {
  UsageSourceRegistration,
  UsageReport,
  UsageWindow,
  UsageBalance,
  UsageDetail,
} from "./usage.js";
export type {
  PluginHandlerContext,
  PluginServerContext,
  PluginServerContribution,
  PluginSettings,
  PluginSettingsState,
  PluginSubscriptionContext,
} from "./contracts.js";
export type {
  PluginHooks,
  PluginHookEvents,
  PluginHookRequests,
  PluginHookPayload,
  PluginHookResult,
  PluginHookContext,
  PluginHookWorkspace,
  PluginHookWorktree,
  PluginWorktreeCreateRequest,
  PluginHookAgent,
  PluginSessionOpenRequest,
  PluginTurnOutcome,
  PluginLifecycleEvents,
  PluginBeforeRequests,
  PluginLifecycleRegistration,
} from "./lifecycle.js";

export { spawnProcess, execCommand, terminateProcess } from "./process.js";

// Model-router helpers live in the protocol package. Built-ins may import only
// host modules, so the SDK re-exports the runtime values they need instead of
// letting a plugin reach into `@getpaseo/protocol` at run time.
export {
  buildProviderRouters,
  isAutoProviderRouter,
  mergeAutoProviderRouters,
} from "@getpaseo/protocol/auto-provider-routers";
export { disabledModelIdsByProviderFromConfig } from "@getpaseo/protocol/disabled-models";

export { defineAgentTool } from "./agent-tools.js";
export type { AgentToolDefinition, AgentToolResult, AgentToolContext } from "./agent-tools.js";
export type {
  PluginWorktreeContext,
  PluginWorktreeCreateInput,
  PluginWorktreeCreateResult,
  PluginWorktreeRemoveRequest,
  PluginWorktreeRemoveResult,
  PluginWorktreeRestoreTarget,
  PluginWorktreeRestoreRequest,
  PluginWorktreeRestoreResult,
  WorktreeManagerRegistration,
} from "./worktree.js";

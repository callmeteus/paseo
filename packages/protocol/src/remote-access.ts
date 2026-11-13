import { z } from "zod";

/** How much file access a remote peer may have on this daemon. */
export const RemoteFileAccessSchema = z.enum(["off", "read", "write"]);
export type RemoteFileAccess = z.infer<typeof RemoteFileAccessSchema>;

export const RemoteCommandModeSchema = z.enum(["off", "allowlist", "any"]);
export type RemoteCommandMode = z.infer<typeof RemoteCommandModeSchema>;

const DEFAULT_ALLOWLIST: readonly string[] = [];
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_REMOTE_MAX_OUTPUT_BYTES = 1_048_576;

export const RemoteCommandConfigSchema = z
  .object({
    /**
     * `any` runs whatever the caller asks for. It is the default because the
     * direction itself is off by default; turning commands on is the explicit
     * dangerous step, and the app asks for confirmation again.
     */
    mode: RemoteCommandModeSchema.default("any"),
    /** Executable names accepted when `mode` is `allowlist`. */
    allowlist: z
      .array(z.string().min(1).max(1024))
      .max(64)
      .default([...DEFAULT_ALLOWLIST]),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(DEFAULT_COMMAND_TIMEOUT_MS),
    maxOutputBytes: z
      .number()
      .int()
      .min(1_024)
      .max(16 * 1024 * 1024)
      .default(DEFAULT_REMOTE_MAX_OUTPUT_BYTES),
  })
  .strict();

export type RemoteCommandConfig = z.infer<typeof RemoteCommandConfigSchema>;

const DEFAULT_REMOTE_COMMANDS = {
  mode: "any" as const,
  allowlist: [...DEFAULT_ALLOWLIST],
  timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
  maxOutputBytes: DEFAULT_REMOTE_MAX_OUTPUT_BYTES,
};

/**
 * One direction of remote access. Outbound is what this daemon's agents may do
 * on peers; inbound is what peers' agents may do here. Both are off by default
 * and both require an explicit peer list.
 */
export const RemoteAccessScopeSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Outbound: destination server IDs. Inbound: origin server IDs. */
    peers: z.array(z.string().min(1).max(256)).max(64).default([]),
    chats: z.boolean().default(false),
    agents: z.boolean().default(false),
    files: RemoteFileAccessSchema.default("off"),
    commands: RemoteCommandConfigSchema.default(DEFAULT_REMOTE_COMMANDS),
    /**
     * When true, remote actions must target an active workspace. Turning it off
     * lets a peer pass any `cwd` the daemon can read.
     */
    restrictToWorkspaces: z.boolean().default(true),
  })
  .strict();

export type RemoteAccessScope = z.infer<typeof RemoteAccessScopeSchema>;

const DEFAULT_REMOTE_SCOPE = {
  enabled: false,
  peers: [],
  chats: false,
  agents: false,
  files: "off" as const,
  commands: DEFAULT_REMOTE_COMMANDS,
  restrictToWorkspaces: true,
};

export const RemoteAccessConfigSchema = z
  .object({
    outbound: RemoteAccessScopeSchema.default(DEFAULT_REMOTE_SCOPE),
    inbound: RemoteAccessScopeSchema.default(DEFAULT_REMOTE_SCOPE),
  })
  .strict();

export type RemoteAccessConfig = z.infer<typeof RemoteAccessConfigSchema>;

export const DEFAULT_REMOTE_ACCESS: RemoteAccessConfig = {
  outbound: { ...DEFAULT_REMOTE_SCOPE, peers: [], commands: { ...DEFAULT_REMOTE_COMMANDS } },
  inbound: { ...DEFAULT_REMOTE_SCOPE, peers: [], commands: { ...DEFAULT_REMOTE_COMMANDS } },
};

export type RemoteDirection = keyof RemoteAccessConfig;

export type RemoteAccessCapability = "chats" | "agents" | "files.read" | "files.write" | "commands";

/** Reads one capability out of a scope. `files.write` implies read. */
export function scopeAllowsCapability(
  scope: RemoteAccessScope,
  capability: RemoteAccessCapability,
): boolean {
  if (!scope.enabled) return false;
  switch (capability) {
    case "chats":
      return scope.chats;
    case "agents":
      return scope.agents;
    case "files.read":
      return scope.files === "read" || scope.files === "write";
    case "files.write":
      return scope.files === "write";
    case "commands":
      return scope.commands.mode !== "off";
  }
}

export function commandMatchesAllowlist(scope: RemoteAccessScope, executable: string): boolean {
  const { mode, allowlist } = scope.commands;
  if (mode === "any") return true;
  if (mode === "off") return false;
  const normalized = normalizeExecutable(executable);
  return allowlist.some((entry) => normalizeExecutable(entry) === normalized);
}

function normalizeExecutable(value: string): string {
  return value.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
}

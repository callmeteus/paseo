import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DaemonPermission } from "@getpaseo/protocol/messages";
import { expandUserPath } from "../../path-utils.js";
import type { RemoteAccessPolicy } from "../../remote-access/policy.js";
import { PaseoToolInputError } from "../tools/types.js";
import type { ToolHosts } from "./index.js";

const READ_PERMISSIONS: readonly DaemonPermission[] = ["workspace.read"];
const WRITE_PERMISSIONS: readonly DaemonPermission[] = ["workspace.read", "workspace.write"];

export interface RemoteTarget {
  serverId: string;
  workspaceId?: string;
  cwd?: string;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
}

export interface RemoteWriteResult {
  status: "written" | "conflict" | "error";
  path: string;
  revision?: string;
  size?: number;
  error?: string;
  conflict?: { status: string; modifiedAt?: string; revision?: string };
}

export interface RemoteActions {
  listFiles(input: RemoteTarget & { path?: string }): Promise<{
    serverId: string;
    cwd: string;
    path: string;
    entries: RemoteFileEntry[];
  }>;
  readFile(input: RemoteTarget & { path: string; maxBytes?: number }): Promise<{
    serverId: string;
    cwd: string;
    path: string;
    kind: "text" | "image" | "binary";
    mime: string;
    size: number;
    modifiedAt: string;
    revision: string | null;
    content: string | null;
  }>;
  searchFiles(
    input: RemoteTarget & {
      path?: string;
      query: string;
      mode: "name" | "content";
      caseSensitive?: boolean;
      maxResults?: number;
      maxFileBytes?: number;
    },
  ): Promise<{
    serverId: string;
    cwd: string;
    path: string;
    matches: Array<{ path: string; line?: number; column?: number; preview?: string }>;
    filesScanned: number;
    truncated: boolean;
  }>;
  writeFile(
    input: RemoteTarget & {
      path: string;
      content: string;
      expectedRevision?: string;
      createIfMissing?: boolean;
    },
  ): Promise<RemoteWriteResult>;
  editFile(
    input: RemoteTarget & {
      path: string;
      oldText: string;
      newText: string;
      replaceAll?: boolean;
    },
  ): Promise<RemoteWriteResult & { replacements: number }>;
  runCommand(
    input: RemoteTarget & {
      command: string;
      args?: string[];
      shell?: boolean;
      timeoutMs?: number;
      maxOutputBytes?: number;
    },
  ): Promise<{
    serverId: string;
    cwd: string;
    command: string;
    status: "exited" | "timeout" | "error";
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    durationMs: number;
    error: string | null;
  }>;
}

export function createRemoteActions(input: {
  serverId: string;
  hosts: () => ToolHosts;
  policy: () => RemoteAccessPolicy;
}): RemoteActions {
  return {
    listFiles: (args) =>
      run("files.read", args, READ_PERMISSIONS, async (client, cwd) => {
        const directory = await client.listDirectory(cwd, args.path ?? ".");
        return {
          serverId: args.serverId,
          cwd,
          path: directory.path,
          entries: directory.entries,
        };
      }),
    readFile: (args) =>
      run("files.read", args, READ_PERMISSIONS, async (client, cwd) => {
        const file = await client.readFile(cwd, args.path, undefined, args.maxBytes ?? 1_048_576);
        const isText = file.kind === "text";
        return {
          serverId: args.serverId,
          cwd,
          path: file.path,
          kind: file.kind,
          mime: file.mime,
          size: file.size,
          modifiedAt: file.modifiedAt,
          revision: file.revision ?? null,
          content: isText ? Buffer.from(file.bytes).toString("utf8") : null,
        };
      }),
    searchFiles: (args) =>
      run("files.read", args, READ_PERMISSIONS, async (client, cwd) => {
        const result = await client.searchFiles({
          cwd,
          path: args.path,
          query: args.query,
          mode: args.mode,
          caseSensitive: args.caseSensitive,
          maxResults: args.maxResults,
          maxFileBytes: args.maxFileBytes,
        });
        if (result.error) throw new PaseoToolInputError(result.error);
        return {
          serverId: args.serverId,
          cwd,
          path: result.path,
          matches: result.matches,
          filesScanned: result.filesScanned,
          truncated: result.truncated,
        };
      }),
    writeFile: (args) =>
      run("files.write", args, WRITE_PERMISSIONS, async (client, cwd) => {
        const current = await readVersion(client, cwd, args.path);
        const expectedRevision = args.expectedRevision ?? current?.revision;
        const result = await client.writeFile({
          cwd,
          path: args.path,
          content: args.content,
          expectedModifiedAt: current?.modifiedAt ?? "",
          ...(expectedRevision ? { expectedRevision } : {}),
          ...(args.createIfMissing === true && !current ? { createIfMissing: true } : {}),
        });
        return toWriteResult(args.path, result);
      }),
    editFile: (args) =>
      run("files.write", args, WRITE_PERMISSIONS, async (client, cwd) => {
        const current = await readVersion(client, cwd, args.path);
        if (!current) throw new PaseoToolInputError(`File not found: ${args.path}`);
        const file = await client.readFile(cwd, args.path, undefined, 1_048_576);
        if (file.kind !== "text") throw new PaseoToolInputError("Only text files can be edited");
        const text = Buffer.from(file.bytes).toString("utf8");
        const occurrences = countOccurrences(text, args.oldText);
        if (occurrences === 0) {
          throw new PaseoToolInputError("oldText was not found in the remote file");
        }
        if (!args.replaceAll && occurrences > 1) {
          throw new PaseoToolInputError(
            `oldText occurs ${occurrences} times; pass replaceAll or a more specific oldText`,
          );
        }
        const next = args.replaceAll
          ? text.split(args.oldText).join(args.newText)
          : text.replace(args.oldText, args.newText);
        const result = await client.writeFile({
          cwd,
          path: args.path,
          content: next,
          expectedModifiedAt: file.modifiedAt,
          ...(file.revision ? { expectedRevision: file.revision } : {}),
        });
        return {
          ...toWriteResult(args.path, result),
          replacements: args.replaceAll ? occurrences : 1,
        };
      }),
    runCommand: (args) =>
      run("commands", args, WRITE_PERMISSIONS, async (client, cwd) => {
        const scope = input.policy().scope("outbound");
        if (args.shell === true && scope.commands.mode !== "any") {
          throw new PaseoToolInputError(
            'shell execution requires daemon.remoteAccess.outbound.commands.mode = "any"',
          );
        }
        const result = await client.runCommand({
          cwd,
          command: args.command,
          args: args.args,
          shell: args.shell,
          timeoutMs: args.timeoutMs ?? scope.commands.timeoutMs,
          maxOutputBytes: scope.commands.maxOutputBytes,
        });
        return {
          serverId: args.serverId,
          cwd,
          command: args.command,
          status: result.status,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
          durationMs: result.durationMs,
          error: result.error,
        };
      }),
  };

  function assertRemote(serverId: string): void {
    if (!serverId) throw new PaseoToolInputError("serverId is required");
    if (serverId === input.serverId) {
      throw new PaseoToolInputError(
        "These tools act on another host. Omit the local host and use your own file and terminal tools.",
      );
    }
  }

  async function run<T>(
    capability: "files.read" | "files.write" | "commands",
    args: RemoteTarget,
    permissions: readonly DaemonPermission[],
    action: (client: DaemonClient, cwd: string) => Promise<T>,
  ): Promise<T> {
    assertRemote(args.serverId);
    const decision = input.policy().outboundDecision(args.serverId, capability);
    if (!decision.allowed) throw new PaseoToolInputError(decision.reason ?? "Remote access denied");
    return input.hosts().use(
      args.serverId,
      async (client) => {
        const cwd = await resolveCwd(client, args);
        return action(client, cwd);
      },
      undefined,
      { permissions },
    );
  }

  async function resolveCwd(client: DaemonClient, args: RemoteTarget): Promise<string> {
    const hasWorkspace = typeof args.workspaceId === "string" && args.workspaceId.length > 0;
    const hasCwd = typeof args.cwd === "string" && args.cwd.trim().length > 0;
    if (hasWorkspace === hasCwd) {
      throw new PaseoToolInputError("Pass exactly one of workspaceId or cwd");
    }
    if (hasWorkspace) {
      const { entries } = await client.fetchWorkspaces({});
      const workspace = entries.find((entry) => entry.id === args.workspaceId);
      if (!workspace) throw new PaseoToolInputError(`Workspace ${args.workspaceId} not found`);
      return workspace.workspaceDirectory;
    }
    if (input.policy().restrictsToWorkspaces("outbound")) {
      throw new PaseoToolInputError(
        "cwd is only allowed when daemon.remoteAccess.outbound.restrictToWorkspaces is false",
      );
    }
    return expandUserPath(args.cwd!.trim());
  }

  async function readVersion(
    client: DaemonClient,
    cwd: string,
    path: string,
  ): Promise<{ modifiedAt: string; revision?: string } | null> {
    try {
      const file = await client.readFile(cwd, path, undefined, 1_048_576);
      return { modifiedAt: file.modifiedAt, revision: file.revision };
    } catch {
      return null;
    }
  }
}

function toWriteResult(
  path: string,
  result: {
    status: "written" | "conflict" | "error";
    modifiedAt?: string;
    size?: number;
    revision?: string;
    version?: { status: string; modifiedAt?: string; revision?: string };
    error?: string;
  },
): RemoteWriteResult {
  if (result.status === "written") {
    return { status: "written", path, revision: result.revision, size: result.size };
  }
  if (result.status === "conflict" && result.version) {
    return {
      status: "conflict",
      path,
      conflict: {
        status: result.version.status,
        modifiedAt: result.version.modifiedAt,
        revision: result.version.revision,
      },
    };
  }
  return { status: "error", path, error: result.error ?? "Remote write failed" };
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

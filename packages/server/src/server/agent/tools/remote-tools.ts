import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { RemoteAccessPolicy } from "../../remote-access/policy.js";
import type { RemoteActions } from "../host-operations/remote-actions.js";
import type { PaseoToolConfig, PaseoToolResult } from "./types.js";

export interface RegisterRemoteToolsOptions {
  register: (
    name: string,
    config: PaseoToolConfig,
    handler: (input: Record<string, unknown>) => Promise<PaseoToolResult>,
  ) => void;
  actions: RemoteActions;
  policy: () => RemoteAccessPolicy;
}

const targetShape = {
  serverId: z
    .string()
    .min(1)
    .describe("Destination server ID from list_hosts. Must be another host, never this one."),
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .describe("Workspace on the destination. Pass exactly one of workspaceId or cwd."),
  cwd: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Absolute directory on the destination. Only accepted when that host allows paths outside workspaces.",
    ),
};

const targetSchema = z.object(targetShape);

const result = (structuredContent: unknown): PaseoToolResult => ({
  content: [],
  structuredContent: ensureValidJson(structuredContent),
});

/**
 * Remote host tools. They only exist when outbound remote access can do
 * something, and every call re-checks the live outbound policy. The destination
 * re-checks its own inbound policy.
 */
export function registerRemoteTools(options: RegisterRemoteToolsOptions): void {
  const { register, actions, policy } = options;

  register(
    "list_remote_files",
    {
      title: "List remote files",
      description:
        "List a directory on another connected host. Requires remote file read access on both hosts. Use list_hosts to discover serverId and list_workspaces for workspaceId.",
      inputSchema: {
        ...targetSchema.shape,
        path: z.string().optional().describe("Relative path. Defaults to the workspace root."),
      },
    },
    async (input) => {
      const args = targetSchema.extend({ path: z.string().optional() }).parse(input);
      return result(await actions.listFiles(args));
    },
  );

  register(
    "read_remote_file",
    {
      title: "Read remote file",
      description:
        "Read a text file on another connected host. Binary files return metadata only. Requires remote file read access on both hosts.",
      inputSchema: {
        ...targetSchema.shape,
        path: z.string().min(1).describe("File path relative to the workspace or cwd."),
        maxBytes: z
          .number()
          .int()
          .positive()
          .max(16 * 1024 * 1024)
          .optional()
          .describe("Reject files larger than this."),
      },
    },
    async (input) => {
      const args = targetSchema
        .extend({ path: z.string().min(1), maxBytes: z.number().int().positive().optional() })
        .parse(input);
      return result(await actions.readFile(args));
    },
  );

  register(
    "search_remote_files",
    {
      title: "Search remote files",
      description:
        "Search file names or text content inside a workspace on another connected host. Requires remote file read access on both hosts.",
      inputSchema: {
        ...targetSchema.shape,
        path: z.string().optional().describe("Directory to search, relative to the target."),
        query: z.string().min(1),
        mode: z.enum(["name", "content"]).describe("Match file names or file contents."),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().int().positive().max(1000).optional(),
        maxFileBytes: z
          .number()
          .int()
          .positive()
          .max(16 * 1024 * 1024)
          .optional(),
      },
    },
    async (input) => {
      const args = targetSchema
        .extend({
          path: z.string().optional(),
          query: z.string().min(1),
          mode: z.enum(["name", "content"]),
          caseSensitive: z.boolean().optional(),
          maxResults: z.number().int().positive().max(1000).optional(),
          maxFileBytes: z
            .number()
            .int()
            .positive()
            .max(16 * 1024 * 1024)
            .optional(),
        })
        .parse(input);
      return result(await actions.searchFiles(args));
    },
  );

  register(
    "write_remote_file",
    {
      title: "Write remote file",
      description:
        "Create or overwrite a file on another connected host. Requires remote file write access on both hosts. Reading and writing are revision-checked; a conflict returns the latest revision.",
      inputSchema: {
        ...targetSchema.shape,
        path: z.string().min(1),
        content: z.string(),
        expectedRevision: z
          .string()
          .optional()
          .describe("Revision from a previous read. Omit to write against the current version."),
        createIfMissing: z.boolean().optional(),
      },
    },
    async (input) => {
      const args = targetSchema
        .extend({
          path: z.string().min(1),
          content: z.string(),
          expectedRevision: z.string().optional(),
          createIfMissing: z.boolean().optional(),
        })
        .parse(input);
      return result(await actions.writeFile(args));
    },
  );

  register(
    "edit_remote_file",
    {
      title: "Edit remote file",
      description:
        "Replace exact text in a text file on another connected host. Requires remote file write access on both hosts. Fails when oldText is missing or ambiguous unless replaceAll is set.",
      inputSchema: {
        ...targetSchema.shape,
        path: z.string().min(1),
        oldText: z.string().min(1),
        newText: z.string(),
        replaceAll: z.boolean().optional(),
      },
    },
    async (input) => {
      const args = targetSchema
        .extend({
          path: z.string().min(1),
          oldText: z.string().min(1),
          newText: z.string(),
          replaceAll: z.boolean().optional(),
        })
        .parse(input);
      return result(await actions.editFile(args));
    },
  );

  register(
    "run_remote_command",
    {
      title: "Run remote command",
      description:
        "Run a command in a workspace on another connected host and return its exit code and output. Requires remote command access on both hosts. The destination applies its own allowlist and timeout.",
      inputSchema: {
        ...targetSchema.shape,
        command: z.string().min(1).describe("Executable name or path."),
        args: z.array(z.string()).max(256).optional(),
        shell: z
          .boolean()
          .optional()
          .describe(
            'Run through a shell. Only allowed when the destination command mode is "any".',
          ),
        timeoutMs: z.number().int().min(1000).max(600000).optional(),
      },
    },
    async (input) => {
      const args = targetSchema
        .extend({
          command: z.string().min(1),
          args: z.array(z.string()).max(256).optional(),
          shell: z.boolean().optional(),
          timeoutMs: z.number().int().min(1000).max(600000).optional(),
        })
        .parse(input);
      const scope = policy().scope("outbound");
      if (scope.commands.mode === "off") {
        throw new Error("Remote commands are off for this host");
      }
      return result(await actions.runCommand(args));
    },
  );
}

export function hasRemoteToolsConfigured(policy: RemoteAccessPolicy): boolean {
  const scope = policy.scope("outbound");
  if (!scope.enabled) return false;
  return scope.files !== "off" || scope.commands.mode !== "off" || scope.chats || scope.agents;
}

import type { ToolPolicy } from "@getpaseo/protocol/agent-types";

/**
 * Whether a Cursor ACP permission is one exact MCP grant from the session policy.
 *
 * Cursor's ACP permission for an MCP call uses kind `other` and the title
 * `${name}: ${toolName}`. `name` is the tool's own name when the CLI has no
 * qualified name, so the title is `finish_execution: finish_execution`. The
 * server id stays inside Cursor (`providerIdentifier`) and is not copied into
 * that title. A title that does include the server (`hub: finish_execution`)
 * still matches that one grant.
 *
 * A tool name shared by two grants is not approved from the unqualified title.
 * Shell, edits, and questions use other titles or kinds, so they stay prompts.
 *
 * @param input - The permission title, its ACP kind, and the session policy. A missing title never matches.
 * @returns True when this call is the only grant that fits the title.
 */
export function isPreapprovedAcpMcpTool(input: {
  title: string | null | undefined;
  kind: string | null | undefined;
  toolPolicy: ToolPolicy | undefined;
}): boolean {
  if (input.kind !== "other" || typeof input.title !== "string") {
    return false;
  }

  const grants = input.toolPolicy?.preapproved ?? [];
  if (grants.length === 0) {
    return false;
  }

  // The server is in the title, so the grant is exact even if another server
  // exposes a tool with the same name.
  const namedServer = grants.some((grant) => input.title === `${grant.server}: ${grant.tool}`);
  if (namedServer) {
    return true;
  }

  const sameName = grants.filter((grant) => input.title === `${grant.tool}: ${grant.tool}`);
  return sameName.length === 1;
}

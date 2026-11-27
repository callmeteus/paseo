import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import { createTransport } from "./upstream.js";

export interface McpElicitationAnswer {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

/**
 * Some harnesses do not forward MCP elicitation requests to their client.
 * Run the tool through a Paseo-owned MCP client that does advertise the
 * capability, so the server's real form can be shown to the user.
 */
export async function callMcpToolWithElicitation(input: {
  config: McpServerConfig;
  toolName: string;
  args: Record<string, unknown>;
  ask: (request: unknown) => Promise<McpElicitationAnswer>;
}): Promise<unknown> {
  const client = new Client(
    { name: "paseo-elicitation-bridge", version: "1.0.0" },
    { capabilities: { elicitation: { form: {}, url: {} } } },
  );
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    try {
      return (await input.ask(request.params)) as never;
    } catch {
      return { action: "decline" } as never;
    }
  });
  await client.connect(createTransport(input.config));
  try {
    return await client.callTool({ name: input.toolName, arguments: input.args ?? {} });
  } finally {
    await client.close().catch(() => undefined);
  }
}

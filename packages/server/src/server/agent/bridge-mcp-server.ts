import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpBridgeManager } from "../mcp/bridge.js";

export async function createBridgeMcpServer(params: {
  bridgeName: string;
  manager: McpBridgeManager;
}): Promise<Server> {
  const tools = await params.manager.listTools(params.bridgeName);
  const server = new Server(
    { name: "paseo-mcp-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toBridgeTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await params.manager.callTool(
      params.bridgeName,
      request.params.name,
      request.params.arguments,
    );
    return result as CallToolResult;
  });

  return server;
}

function toBridgeTool(tool: { name: string; description?: string; inputSchema: unknown }) {
  const entry: { name: string; description?: string; inputSchema: Record<string, unknown> } = {
    name: tool.name,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
  if (tool.description) entry.description = tool.description;
  return entry;
}

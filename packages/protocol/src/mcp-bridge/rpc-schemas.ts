import { z } from "zod";

export const McpBridgeToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.unknown(),
  })
  .passthrough();

export const McpBridgeServerSchema = z.object({
  server: z.string().min(1),
  description: z.string().nullable().optional(),
  tools: z.array(z.string().min(1)).optional(),
});

export const McpBridgeListServersRequestSchema = z.object({
  type: z.literal("mcp.bridge.list_servers.request"),
  requestId: z.string(),
});

export const McpBridgeListServersResponseSchema = z.object({
  type: z.literal("mcp.bridge.list_servers.response"),
  payload: z.object({
    requestId: z.string(),
    servers: z.array(McpBridgeServerSchema),
    error: z.string().nullable(),
  }),
});

export const McpBridgeListToolsRequestSchema = z.object({
  type: z.literal("mcp.bridge.list_tools.request"),
  requestId: z.string(),
  server: z.string().min(1),
});

export const McpBridgeListToolsResponseSchema = z.object({
  type: z.literal("mcp.bridge.list_tools.response"),
  payload: z.object({
    requestId: z.string(),
    server: z.string().min(1),
    tools: z.array(McpBridgeToolSchema),
    error: z.string().nullable(),
  }),
});

export const McpBridgeCallToolRequestSchema = z.object({
  type: z.literal("mcp.bridge.call_tool.request"),
  requestId: z.string(),
  server: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const McpBridgeCallToolResponseSchema = z.object({
  type: z.literal("mcp.bridge.call_tool.response"),
  payload: z.object({
    requestId: z.string(),
    server: z.string().min(1),
    tool: z.string().min(1),
    result: z.unknown(),
    error: z.string().nullable(),
  }),
});

export type McpBridgeTool = z.infer<typeof McpBridgeToolSchema>;
export type McpBridgeServer = z.infer<typeof McpBridgeServerSchema>;
export type McpBridgeListServersRequest = z.infer<typeof McpBridgeListServersRequestSchema>;
export type McpBridgeListServersResponse = z.infer<typeof McpBridgeListServersResponseSchema>;
export type McpBridgeListToolsRequest = z.infer<typeof McpBridgeListToolsRequestSchema>;
export type McpBridgeListToolsResponse = z.infer<typeof McpBridgeListToolsResponseSchema>;
export type McpBridgeCallToolRequest = z.infer<typeof McpBridgeCallToolRequestSchema>;
export type McpBridgeCallToolResponse = z.infer<typeof McpBridgeCallToolResponseSchema>;

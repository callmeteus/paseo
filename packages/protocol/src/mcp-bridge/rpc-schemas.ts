import { z } from "zod";

export const McpBridgeServerSchema = z.record(z.string(), z.unknown());
export const McpBridgeToolSchema = z.record(z.string(), z.unknown());

export const McpBridgeListServersRequestSchema = z.object({
  type: z.literal("mcp.bridge.list_servers.request"),
  requestId: z.string(),
});

export const McpBridgeListToolsRequestSchema = z.object({
  type: z.literal("mcp.bridge.list_tools.request"),
  requestId: z.string(),
  server: z.string(),
});

export const McpBridgeCallToolRequestSchema = z.object({
  type: z.literal("mcp.bridge.call_tool.request"),
  requestId: z.string(),
  server: z.string(),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const McpBridgeListServersResponseSchema = z.object({
  type: z.literal("mcp.bridge.list_servers.response"),
  payload: z.object({
    requestId: z.string(),
    servers: z.array(McpBridgeServerSchema),
    error: z.string().nullable(),
  }),
});

export const McpBridgeListToolsResponseSchema = z.object({
  type: z.literal("mcp.bridge.list_tools.response"),
  payload: z.object({
    requestId: z.string(),
    server: z.string(),
    tools: z.array(McpBridgeToolSchema),
    error: z.string().nullable(),
  }),
});

export const McpBridgeCallToolResponseSchema = z.object({
  type: z.literal("mcp.bridge.call_tool.response"),
  payload: z.object({
    requestId: z.string(),
    server: z.string(),
    tool: z.string(),
    result: z.unknown().nullable(),
    error: z.string().nullable(),
  }),
});

export type McpBridgeServer = z.infer<typeof McpBridgeServerSchema>;
export type McpBridgeTool = z.infer<typeof McpBridgeToolSchema>;
export type McpBridgeListServersRequest = z.infer<typeof McpBridgeListServersRequestSchema>;
export type McpBridgeListServersResponse = z.infer<typeof McpBridgeListServersResponseSchema>;
export type McpBridgeListToolsRequest = z.infer<typeof McpBridgeListToolsRequestSchema>;
export type McpBridgeListToolsResponse = z.infer<typeof McpBridgeListToolsResponseSchema>;
export type McpBridgeCallToolRequest = z.infer<typeof McpBridgeCallToolRequestSchema>;
export type McpBridgeCallToolResponse = z.infer<typeof McpBridgeCallToolResponseSchema>;

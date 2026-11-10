import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { withRuntimePaseoMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimePaseoMcpServer", () => {
  test("injects the paseo MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:17000/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:17000/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:17000/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:17000/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });

  test("injects host-wide shared MCP servers alongside the paseo server", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:17000/mcp/agents",
      mcpAuthToken: null,
      sharedMcpServers: {
        docs: { type: "http", url: "https://docs.example.com/mcp" },
      },
    });

    expect(result.mcpServers?.docs).toEqual({
      type: "http",
      url: "https://docs.example.com/mcp",
    });
    expect(result.mcpServers?.paseo).toBeDefined();
  });

  test("agent-specific MCP servers override shared servers with the same name", () => {
    const result = withRuntimePaseoMcpServer({
      config: {
        ...BASE_CONFIG,
        mcpServers: { docs: { type: "http", url: "https://agent.example.com/mcp" } },
      },
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: null,
      sharedMcpServers: {
        docs: { type: "http", url: "https://shared.example.com/mcp" },
      },
    });

    expect(result.mcpServers?.docs).toEqual({
      type: "http",
      url: "https://agent.example.com/mcp",
    });
  });

  test("ignores a shared server named paseo so the internal server always wins", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:17000/mcp/agents",
      mcpAuthToken: null,
      sharedMcpServers: {
        paseo: { type: "http", url: "https://evil.example.com/mcp" },
      },
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:17000/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("injects shared servers even when the paseo endpoint is disabled", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: null,
      sharedMcpServers: {
        docs: { type: "http", url: "https://docs.example.com/mcp" },
      },
    });

    expect(result.mcpServers?.docs).toEqual({
      type: "http",
      url: "https://docs.example.com/mcp",
    });
    expect(result.mcpServers?.paseo).toBeUndefined();
  });
});

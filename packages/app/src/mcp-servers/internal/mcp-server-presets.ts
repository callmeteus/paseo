export type PresetCategory =
  | "browser"
  | "dev"
  | "productivity"
  | "design"
  | "data"
  | "infra"
  | "search"
  | "payments"
  | "identity";

export type PresetFieldTarget = "env" | "header" | "url" | "placeholder";

export interface PresetField {
  key: string;
  label: string;
  placeholder: string;
  target: PresetFieldTarget;
  required?: boolean;
  secret?: boolean;
  defaultValue?: string;
  kind?: "text" | "url" | "path" | "select" | "boolean";
  options?: string[];
}

export interface McpServerPresetVariant {
  id: string;
  label: string;
  transport: "stdio" | "http" | "sse";
  auth: "none" | "oauth" | "token";
  command?: string;
  args?: string[];
  url?: string;
  fields?: PresetField[];
  notes?: string;
}

export interface McpServerPreset {
  id: string;
  label: string;
  description: string;
  category: PresetCategory;
  docsUrl: string;
  variants: McpServerPresetVariant[];
}

export const MCP_SERVER_PRESETS: McpServerPreset[] = [
  {
    id: "browse",
    label: "Browser (OpenCode)",
    description: "The browse MCP server already installed in OpenCode.",
    category: "browser",
    docsUrl: "https://github.com/remorses/browse",
    variants: [
      {
        id: "stdio",
        label: "Local",
        transport: "stdio",
        auth: "none",
        command: "browse",
        args: ["mcp"],
        fields: [
          {
            key: "OPENCODE_BROWSER_RUNTIME",
            label: "Runtime",
            placeholder: "auto-update",
            target: "env",
            kind: "text",
            defaultValue: "auto-update",
          },
        ],
      },
    ],
  },
  {
    id: "github",
    label: "GitHub",
    description: "Repositories, issues, pull requests and code search.",
    category: "dev",
    docsUrl: "https://github.com/github/github-mcp-server",
    variants: [
      {
        id: "remote",
        label: "Hosted",
        transport: "http",
        auth: "oauth",
        url: "https://api.githubcopilot.com/mcp/",
        fields: [
          {
            key: "Authorization",
            label: "Personal access token (optional, replaces OAuth)",
            placeholder: "Bearer github_pat_...",
            target: "header",
            secret: true,
          },
          {
            key: "X-MCP-Readonly",
            label: "Read only",
            placeholder: "true",
            target: "header",
            kind: "boolean",
          },
        ],
      },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    description: "Search conversations, read channels and send messages.",
    category: "productivity",
    docsUrl:
      "https://slack.com/help/articles/48855576908307-Guide-to-Model-Context-Protocol-in-Slack",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.slack.com/mcp",
        notes: "Requires a Slack app and workspace admin approval.",
      },
      {
        id: "local",
        label: "Local token",
        transport: "stdio",
        auth: "token",
        command: "npx",
        args: ["-y", "slack-mcp-server@latest", "--transport", "stdio"],
        fields: [
          {
            key: "SLACK_MCP_XOXP_TOKEN",
            label: "Slack user token",
            placeholder: "xoxp-...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "grafana",
    label: "Grafana",
    description: "Dashboards, metrics, logs, alerts and incidents.",
    category: "infra",
    docsUrl: "https://grafana.com/docs/grafana/latest/ai-tools/mcp",
    variants: [
      {
        id: "stdio",
        label: "Local (uvx)",
        transport: "stdio",
        auth: "token",
        command: "uvx",
        args: ["mcp-grafana"],
        fields: [
          {
            key: "GRAFANA_URL",
            label: "Grafana URL",
            placeholder: "https://grafana.example.com",
            target: "env",
            required: true,
            kind: "url",
          },
          {
            key: "GRAFANA_SERVICE_ACCOUNT_TOKEN",
            label: "Service account token",
            placeholder: "glsa_...",
            target: "env",
            required: true,
            secret: true,
          },
          {
            key: "GRAFANA_ORG_ID",
            label: "Organization ID",
            placeholder: "1",
            target: "env",
          },
        ],
      },
    ],
  },
  {
    id: "atlassian",
    label: "Atlassian / Jira",
    description: "Jira issues, Confluence pages and Jira Service Management.",
    category: "productivity",
    docsUrl: "https://github.com/atlassian/atlassian-mcp-server",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      {
        id: "local",
        label: "Local token",
        transport: "stdio",
        auth: "token",
        command: "uvx",
        args: ["mcp-atlassian"],
        fields: [
          {
            key: "JIRA_URL",
            label: "Jira URL",
            placeholder: "https://example.atlassian.net",
            target: "env",
            required: true,
            kind: "url",
          },
          {
            key: "JIRA_USERNAME",
            label: "Jira email",
            placeholder: "you@example.com",
            target: "env",
            required: true,
          },
          {
            key: "JIRA_API_TOKEN",
            label: "Jira API token",
            placeholder: "ATATT...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "clickup",
    label: "ClickUp",
    description: "Tasks, docs, time tracking and workspace search.",
    category: "productivity",
    docsUrl: "https://clickup.com/blog/how-to-use-clickup-mcp-server",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.clickup.com/mcp",
      },
    ],
  },
  {
    id: "google-workspace",
    label: "Google Workspace",
    description: "Drive, Docs, Gmail, Calendar and Sheets.",
    category: "productivity",
    docsUrl: "https://github.com/taylorwilsdon/google_workspace_mcp",
    variants: [
      {
        id: "stdio",
        label: "Local (uvx)",
        transport: "stdio",
        auth: "oauth",
        command: "uvx",
        args: ["workspace-mcp"],
        fields: [
          {
            key: "GOOGLE_OAUTH_CLIENT_ID",
            label: "OAuth client ID",
            placeholder: "....apps.googleusercontent.com",
            target: "env",
            required: true,
          },
          {
            key: "GOOGLE_OAUTH_CLIENT_SECRET",
            label: "OAuth client secret",
            placeholder: "GOCSPX-...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
        notes: "Requires Google Cloud OAuth credentials and a first browser login.",
      },
    ],
  },
  {
    id: "supabase",
    label: "Supabase",
    description: "Database, auth, storage and project management.",
    category: "data",
    docsUrl: "https://supabase.com/docs/guides/ai-tools/mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.supabase.com/mcp",
      },
      {
        id: "local",
        label: "Local token",
        transport: "stdio",
        auth: "token",
        command: "npx",
        args: ["-y", "@supabase/mcp-server-supabase@latest"],
        fields: [
          {
            key: "SUPABASE_ACCESS_TOKEN",
            label: "Supabase access token",
            placeholder: "sbp_...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "figma",
    label: "Figma",
    description: "Design context, components and variables for code generation.",
    category: "design",
    docsUrl: "https://github.com/GLips/Figma-Context-MCP",
    variants: [
      {
        id: "stdio",
        label: "Local (API key)",
        transport: "stdio",
        auth: "token",
        command: "npx",
        args: ["-y", "figma-developer-mcp", "--stdio"],
        fields: [
          {
            key: "FIGMA_API_KEY",
            label: "Figma API key",
            placeholder: "figd_...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "mobbin",
    label: "Mobbin",
    description: "Real shipped app screens and flows for design reference.",
    category: "design",
    docsUrl: "https://mobbin.com/mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.mobbin.com/mcp",
        notes: "Requires a paid Mobbin plan.",
      },
    ],
  },
  {
    id: "notion",
    label: "Notion",
    description: "Search and edit pages, databases and workspace content.",
    category: "productivity",
    docsUrl: "https://developers.notion.com/docs/mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.notion.com/mcp",
      },
      {
        id: "local",
        label: "Local token",
        transport: "stdio",
        auth: "token",
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        fields: [
          {
            key: "NOTION_API_KEY",
            label: "Notion integration token",
            placeholder: "ntn_...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "linear",
    label: "Linear",
    description: "Issues, projects, cycles and team comments.",
    category: "productivity",
    docsUrl: "https://linear.app/docs/mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.linear.app/mcp",
      },
      {
        id: "readonly",
        label: "Hosted read-only",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.linear.app/mcp/readonly",
      },
    ],
  },
  {
    id: "sentry",
    label: "Sentry",
    description: "Errors, issues, traces and releases for debugging.",
    category: "dev",
    docsUrl: "https://docs.sentry.io/product/sentry-mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.sentry.dev/mcp",
      },
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    description: "Payments, customers, invoices and subscriptions.",
    category: "payments",
    docsUrl: "https://docs.stripe.com/mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted (OAuth)",
        transport: "http",
        auth: "oauth",
        url: "https://mcp.stripe.com",
      },
      {
        id: "local",
        label: "Local API key",
        transport: "stdio",
        auth: "token",
        command: "npx",
        args: ["-y", "@stripe/mcp"],
        fields: [
          {
            key: "STRIPE_SECRET_KEY",
            label: "Stripe secret key",
            placeholder: "sk_...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "playwright",
    label: "Playwright",
    description: "Browser automation for tests and web navigation.",
    category: "browser",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    variants: [
      {
        id: "stdio",
        label: "Local",
        transport: "stdio",
        auth: "none",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest"],
      },
    ],
  },
  {
    id: "chrome-devtools",
    label: "Chrome DevTools",
    description: "Inspect performance, console and network in Chrome.",
    category: "browser",
    docsUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    variants: [
      {
        id: "stdio",
        label: "Local",
        transport: "stdio",
        auth: "none",
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@latest"],
      },
    ],
  },
  {
    id: "context7",
    label: "Context7",
    description: "Up-to-date library documentation for coding agents.",
    category: "dev",
    docsUrl: "https://github.com/upstash/context7",
    variants: [
      {
        id: "remote",
        label: "Hosted",
        transport: "http",
        auth: "none",
        url: "https://mcp.context7.com/mcp",
      },
      {
        id: "local",
        label: "Local",
        transport: "stdio",
        auth: "none",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    ],
  },
  {
    id: "exa",
    label: "Exa",
    description: "Neural web search and page fetch.",
    category: "search",
    docsUrl: "https://docs.exa.ai/reference/exa-mcp",
    variants: [
      {
        id: "local",
        label: "Local (API key)",
        transport: "stdio",
        auth: "token",
        command: "npx",
        args: ["-y", "exa-mcp-server"],
        fields: [
          {
            key: "EXA_API_KEY",
            label: "Exa API key",
            placeholder: "exa-...",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    description: "Crawl, scrape and turn web pages into Markdown.",
    category: "search",
    docsUrl: "https://docs.firecrawl.dev/mcp",
    variants: [
      {
        id: "remote",
        label: "Hosted",
        transport: "http",
        auth: "token",
        url: "https://mcp.firecrawl.dev/v2/mcp",
        fields: [
          {
            key: "Authorization",
            label: "Firecrawl API key",
            placeholder: "Bearer fc-...",
            target: "header",
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "postgres",
    label: "Postgres",
    description: "Query and inspect a PostgreSQL database.",
    category: "data",
    docsUrl: "https://github.com/crystaldba/postgres-mcp",
    variants: [
      {
        id: "stdio",
        label: "Local",
        transport: "stdio",
        auth: "token",
        command: "uvx",
        args: ["postgres-mcp"],
        fields: [
          {
            key: "DATABASE_URI",
            label: "Connection string",
            placeholder: "postgresql://user:password@host:5432/db",
            target: "env",
            required: true,
            secret: true,
          },
        ],
      },
    ],
  },
  {
    id: "mysql",
    label: "MySQL",
    description: "Query and inspect a MySQL database.",
    category: "data",
    docsUrl: "https://github.com/designcomputer/mysql_mcp_server",
    variants: [
      {
        id: "stdio",
        label: "Local (uvx)",
        transport: "stdio",
        auth: "token",
        command: "uvx",
        args: ["--from", "mysql-mcp-server", "mysql_mcp_server"],
        fields: [
          {
            key: "MYSQL_HOST",
            label: "Host",
            placeholder: "127.0.0.1",
            target: "env",
            required: true,
          },
          {
            key: "MYSQL_PORT",
            label: "Port",
            placeholder: "3306",
            target: "env",
          },
          {
            key: "MYSQL_USER",
            label: "User",
            placeholder: "mcp_reader",
            target: "env",
            required: true,
          },
          {
            key: "MYSQL_PASSWORD",
            label: "Password",
            placeholder: "••••••",
            target: "env",
            required: true,
            secret: true,
          },
          {
            key: "MYSQL_DATABASE",
            label: "Database",
            placeholder: "app",
            target: "env",
            required: true,
          },
        ],
        notes: "Use a read-only MySQL user whenever possible.",
      },
    ],
  },
  {
    id: "warpgate",
    label: "Warpgate (MCP gateway)",
    description: "A single MCP gateway endpoint that proxies many upstream servers.",
    category: "infra",
    docsUrl: "https://usewarpgate.com",
    variants: [
      {
        id: "remote",
        label: "Hosted gateway",
        transport: "http",
        auth: "token",
        url: "{{WARPGATE_URL}}",
        fields: [
          {
            key: "WARPGATE_URL",
            label: "Warpgate MCP endpoint",
            placeholder: "https://mcp.usewarpgate.com/mcp",
            target: "url",
            required: true,
            kind: "url",
          },
          {
            key: "Authorization",
            label: "Warpgate token",
            placeholder: "Bearer mcp_...",
            target: "header",
            required: true,
            secret: true,
          },
        ],
        notes: "This is the Warpgate MCP gateway, not the SSH bastion.",
      },
    ],
  },
  {
    id: "authentik",
    label: "Authentik",
    description: "Users, groups, applications, flows and audit events.",
    category: "identity",
    docsUrl: "https://github.com/cdmx-in/authentik-mcp",
    variants: [
      {
        id: "full",
        label: "Full access",
        transport: "stdio",
        auth: "token",
        command: "uvx",
        args: [
          "authentik-mcp",
          "--base-url",
          "{{AUTHENTIK_URL}}",
          "--token",
          "{{AUTHENTIK_TOKEN}}",
        ],
        fields: [
          {
            key: "AUTHENTIK_URL",
            label: "Authentik URL",
            placeholder: "https://authentik.example.com",
            target: "placeholder",
            required: true,
            kind: "url",
          },
          {
            key: "AUTHENTIK_TOKEN",
            label: "API token",
            placeholder: "ak-...",
            target: "placeholder",
            required: true,
            secret: true,
          },
        ],
      },
      {
        id: "readonly",
        label: "Diagnostics (read-only)",
        transport: "stdio",
        auth: "token",
        command: "uvx",
        args: [
          "authentik-diag-mcp",
          "--base-url",
          "{{AUTHENTIK_URL}}",
          "--token",
          "{{AUTHENTIK_TOKEN}}",
        ],
        fields: [
          {
            key: "AUTHENTIK_URL",
            label: "Authentik URL",
            placeholder: "https://authentik.example.com",
            target: "placeholder",
            required: true,
            kind: "url",
          },
          {
            key: "AUTHENTIK_TOKEN",
            label: "API token",
            placeholder: "ak-...",
            target: "placeholder",
            required: true,
            secret: true,
          },
        ],
        notes: "Community-maintained diagnostics server.",
      },
    ],
  },
];

export const PRESET_CATEGORIES: PresetCategory[] = [
  "browser",
  "dev",
  "productivity",
  "design",
  "data",
  "infra",
  "search",
  "payments",
  "identity",
];

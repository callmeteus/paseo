import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";

/** Agent provider override the usage window reads. Only `enabled` matters here. */
export interface UsageProviderOverride {
  enabled?: boolean;
}

/** Built-in provider row used to resolve the default when a setting is absent. */
export interface UsageProviderDefinition {
  id: string;
  enabledByDefault?: boolean;
}

const USAGE_SOURCE_PROVIDERS: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor",
  pi: "pi",
  omp: "omp",
  opencode: "opencode",
  muse: "muse",
  "opencode-local": "opencode",
  "opencode-go": "opencode",
  "kilo-local": "kilo",
  "cline-local": "cline",
};

/** CLIs that publish usage without being an agent provider. Hidden unless explicitly enabled. */
const LOCAL_ONLY_PROVIDERS = new Set(["kilo", "cline"]);

/**
 * Whether a usage source should appear for the current agent settings.
 *
 * Built-in providers follow their default. Custom providers such as Cursor stay
 * visible unless the setting turns them off. Kilo and Cline are not providers,
 * so they stay hidden until a setting enables them.
 *
 * @param sourceId - Usage source id, such as `claude` or `kilo-local`
 * @param providers - Agent provider overrides from the daemon config
 * @param definitions - Built-in provider catalog. Tests can pass a smaller list
 * @returns True when the source may be discovered
 */
export function isUsageSourceEnabled(
  sourceId: string,
  providers: Readonly<Record<string, UsageProviderOverride | undefined>> | undefined,
  definitions: readonly UsageProviderDefinition[] = AGENT_PROVIDER_DEFINITIONS,
): boolean {
  const providerId = USAGE_SOURCE_PROVIDERS[sourceId];

  // A source that is not an agent toggle keeps its own login discovery.
  if (!providerId) {
    return true;
  }

  const override = providers?.[providerId]?.enabled;

  if (typeof override === "boolean") {
    return override;
  }

  const definition = definitions.find((entry) => entry.id === providerId);

  if (definition) {
    return definition.enabledByDefault !== false;
  }

  if (LOCAL_ONLY_PROVIDERS.has(providerId)) {
    return false;
  }

  return true;
}

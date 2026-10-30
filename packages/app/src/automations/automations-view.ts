export interface AutomationsHostSnapshot {
  serverId: string;
  label: string;
  online: boolean;
  relationship: "connected" | "not_connected" | "pending" | "unavailable";
  hubOrigin: string | null;
  /** Null when this daemon cannot report a local Hub install. */
  localInstalled: boolean | null;
  localRunning: boolean;
  localOrigin: string | null;
}

export type AutomationsView =
  | { kind: "loading" }
  | { kind: "webview"; origin: string }
  | { kind: "choose"; options: readonly { serverId: string; label: string; origin: string }[] }
  | { kind: "install"; serverId: string; label: string; installed: boolean }
  | {
      kind: "setup";
      serverId: string;
      label: string;
      /** True when this daemon can install or start a Hub on this computer. */
      canInstall: boolean;
      installed: boolean;
      /** Origin of a Hub that is already running here, so the address field can start filled in. */
      localOrigin: string | null;
    }
  | { kind: "connect" }
  | { kind: "offline" };

/**
 * Decides what the Automations page shows from each daemon's Hub relationship.
 *
 * A connected origin opens inside the app. Several origins ask which one.
 * The first time, with no connection yet, the page asks whether to connect a Hub
 * that already exists or to install one. A stopped local install is reached from
 * that choice. Otherwise the page says that no daemon is online.
 *
 * @param hosts - One snapshot per known daemon
 * @returns The page state
 */
export function resolveAutomationsView(hosts: readonly AutomationsHostSnapshot[]): AutomationsView {
  const connected = hosts.filter(
    (host) => host.relationship === "connected" && host.hubOrigin !== null,
  );
  const origins = uniqueOrigins(connected);
  if (origins.length === 1) {
    const origin = origins[0];
    if (origin !== undefined) return { kind: "webview", origin };
  }
  if (origins.length > 1) {
    return {
      kind: "choose",
      options: connected.flatMap((host) => {
        if (host.hubOrigin === null) return [];
        return [{ serverId: host.serverId, label: host.label, origin: host.hubOrigin }];
      }),
    };
  }

  if (hosts.some((host) => host.online && host.relationship === "pending")) {
    return { kind: "loading" };
  }

  const online = hosts.find((host) => host.online);
  if (online === undefined) {
    return { kind: "offline" };
  }

  // No relationship yet: ask before installing or opening a Hub that happens to be running.
  return {
    kind: "setup",
    serverId: online.serverId,
    label: online.label,
    canInstall: online.localInstalled !== null,
    installed: online.localInstalled === true,
    localOrigin: online.localRunning ? online.localOrigin : null,
  };
}

function uniqueOrigins(hosts: readonly AutomationsHostSnapshot[]): string[] {
  const origins: string[] = [];
  for (const host of hosts) {
    if (host.hubOrigin === null || origins.includes(host.hubOrigin)) continue;
    origins.push(host.hubOrigin);
  }
  return origins;
}

/**
 * Page address the embedded Hub opens on.
 *
 * @param origin - Connected Hub origin, without a trailing slash
 * @returns Triggers page on that origin
 */
export function automationsHubUrl(origin: string): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}/triggers`;
}

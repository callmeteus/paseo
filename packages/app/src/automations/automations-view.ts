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
  | { kind: "connect" }
  | { kind: "offline" };

/**
 * Decides what the Automations page shows from each daemon's Hub relationship.
 *
 * A connected origin opens inside the app. Several origins ask which one.
 * A daemon that is online and has no local Hub offers install. A local Hub
 * that is already running opens inside the app. Otherwise the page asks for
 * `paseo hub connect`, or says that no daemon is online.
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

  const missing = hosts.find((host) => host.online && host.localInstalled === false);
  if (missing !== undefined) {
    return {
      kind: "install",
      serverId: missing.serverId,
      label: missing.label,
      installed: false,
    };
  }

  const stopped = hosts.find(
    (host) => host.online && host.localInstalled === true && !host.localRunning,
  );
  if (stopped !== undefined) {
    return {
      kind: "install",
      serverId: stopped.serverId,
      label: stopped.label,
      installed: true,
    };
  }

  const local = runningLocalHubs(hosts);
  if (local.length === 1) {
    const origin = local[0]?.origin;
    if (origin !== undefined) return { kind: "webview", origin };
  }
  if (local.length > 1) {
    return { kind: "choose", options: local };
  }

  if (!hosts.some((host) => host.online)) return { kind: "offline" };
  return { kind: "connect" };
}

/**
 * Local Hubs that are already running, one entry per origin.
 *
 * @param hosts - Daemon snapshots
 * @returns Origins the page can open without a daemon enrollment
 */
function runningLocalHubs(
  hosts: readonly AutomationsHostSnapshot[],
): { serverId: string; label: string; origin: string }[] {
  const options: { serverId: string; label: string; origin: string }[] = [];
  for (const host of hosts) {
    if (!host.online || !host.localRunning || host.localOrigin === null) continue;
    if (options.some((option) => option.origin === host.localOrigin)) continue;
    options.push({
      serverId: host.serverId,
      label: host.label,
      origin: host.localOrigin,
    });
  }
  return options;
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

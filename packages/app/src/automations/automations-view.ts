export interface AutomationsHostSnapshot {
  serverId: string;
  label: string;
  online: boolean;
  relationship: "connected" | "not_connected" | "pending" | "unavailable";
  hubOrigin: string | null;
  /** True for the daemon on this computer, whose loopback a Hub here is reachable on. */
  isLocalHost: boolean;
  /** Null when this daemon cannot report a local Hub install. */
  localInstalled: boolean | null;
  localRunning: boolean;
  localOrigin: string | null;
}

export interface ResolveAutomationsViewOptions {
  /**
   * Whether a loopback Hub origin on another host resolves from here. A browser
   * served by that host rewrites it to the page hostname; the desktop app stays
   * on its own loopback, where another machine's Hub does not exist.
   */
  loopbackOriginOnRemoteHostIsReachable?: boolean;
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
 * A connected Hub this computer cannot reach — a loopback origin on another
 * machine — is not opened: that frame would load this computer's own loopback
 * and stay blank, so the page falls through to the local Hub choice instead.
 * The first time, with no connection yet, the page asks whether to connect a Hub
 * that already exists or to install one. A stopped local install is reached from
 * that choice. Otherwise the page says that no daemon is online.
 *
 * @param hosts - One snapshot per known daemon
 * @param options - Whether a remote loopback origin is reachable from here
 * @returns The page state
 */
export function resolveAutomationsView(
  hosts: readonly AutomationsHostSnapshot[],
  options: ResolveAutomationsViewOptions = {},
): AutomationsView {
  const loopbackOnRemoteHostIsReachable = options.loopbackOriginOnRemoteHostIsReachable ?? false;
  const connected = hosts.filter(
    (host) =>
      host.relationship === "connected" &&
      host.hubOrigin !== null &&
      isReachableHubOrigin(host, loopbackOnRemoteHostIsReachable),
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

  // The local daemon is the one whose Hub this computer can install and start,
  // so it drives the setup step even while remote hosts are online.
  const setupHost =
    hosts.find((host) => host.online && host.isLocalHost) ?? hosts.find((host) => host.online);
  if (setupHost === undefined) {
    return { kind: "offline" };
  }

  // No reachable relationship yet: ask before installing or opening a Hub that happens to be running.
  return {
    kind: "setup",
    serverId: setupHost.serverId,
    label: setupHost.label,
    canInstall: setupHost.localInstalled !== null,
    installed: setupHost.localInstalled === true,
    localOrigin: setupHost.localRunning ? setupHost.localOrigin : null,
  };
}

/**
 * A loopback Hub belongs to the machine that runs it. Only the local daemon can
 * reach it from the desktop app; a browser served by the other machine can too.
 *
 * @param host - Daemon with a connected Hub
 * @param loopbackOnRemoteHostIsReachable - Whether a browser rewrites the origin
 * @returns Whether this page can open that origin
 */
function isReachableHubOrigin(
  host: AutomationsHostSnapshot,
  loopbackOnRemoteHostIsReachable: boolean,
): boolean {
  if (host.hubOrigin === null) return false;
  if (host.isLocalHost || loopbackOnRemoteHostIsReachable) return true;
  return !isLoopbackOrigin(host.hubOrigin);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
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

/**
 * A loopback Hub origin is the daemon's own machine. A browser that opened Paseo
 * through another host, such as Tailscale, has to load that same host or the
 * frame asks the viewer's own loopback for the Hub.
 *
 * @param origin - Connected Hub origin
 * @param pageHostname - Host that served this page, without a port
 * @returns Origin the browser can open
 */
export function hubOriginOnPageHost(origin: string, pageHostname: string): string {
  if (pageHostname === "" || isLoopbackHostname(pageHostname)) return origin;
  let hub: URL;
  try {
    hub = new URL(origin);
  } catch {
    return origin;
  }
  if (
    (hub.protocol !== "http:" && hub.protocol !== "https:") ||
    !isLoopbackHostname(hub.hostname)
  ) {
    return origin;
  }
  hub.hostname = pageHostname;
  return hub.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

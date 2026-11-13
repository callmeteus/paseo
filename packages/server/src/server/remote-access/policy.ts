import {
  RemoteAccessConfigSchema,
  commandMatchesAllowlist,
  scopeAllowsCapability,
  type RemoteAccessCapability,
  type RemoteAccessConfig,
  type RemoteAccessScope,
  type RemoteCommandMode,
  type RemoteDirection,
} from "@getpaseo/protocol/remote-access";
import type { DaemonConfigStore, MutableDaemonConfig } from "../daemon-config-store.js";

export interface RemoteAccessDecision {
  allowed: boolean;
  reason: string | null;
}

const ALLOWED: RemoteAccessDecision = { allowed: true, reason: null };

export interface RemoteAccessPolicy {
  config(): RemoteAccessConfig;
  scope(direction: RemoteDirection): RemoteAccessScope;
  outboundDecision(serverId: string, capability: RemoteAccessCapability): RemoteAccessDecision;
  allowsOutbound(serverId: string, capability: RemoteAccessCapability): boolean;
  allowsInbound(originServerId: string, capability: RemoteAccessCapability): boolean;
  inboundDecision(originServerId: string, capability: RemoteAccessCapability): RemoteAccessDecision;
  commandMode(direction: RemoteDirection): RemoteCommandMode;
  commandAllowed(direction: RemoteDirection, executable: string): boolean;
  restrictsToWorkspaces(direction: RemoteDirection): boolean;
}

/** Missing or partial persisted config resolves to fully-off defaults. */
export function resolveRemoteAccessConfig(
  value: MutableDaemonConfig["remoteAccess"],
): RemoteAccessConfig {
  return RemoteAccessConfigSchema.parse(value ?? {});
}

export class DaemonConfigRemoteAccessPolicy implements RemoteAccessPolicy {
  public constructor(private readonly configStore: Pick<DaemonConfigStore, "get">) {}

  public config(): RemoteAccessConfig {
    return resolveRemoteAccessConfig(this.configStore.get().remoteAccess);
  }

  public scope(direction: RemoteDirection): RemoteAccessScope {
    return this.config()[direction];
  }

  public outboundDecision(
    serverId: string,
    capability: RemoteAccessCapability,
  ): RemoteAccessDecision {
    return this.decide("outbound", serverId, capability);
  }

  public inboundDecision(
    originServerId: string,
    capability: RemoteAccessCapability,
  ): RemoteAccessDecision {
    return this.decide("inbound", originServerId, capability);
  }

  public allowsOutbound(serverId: string, capability: RemoteAccessCapability): boolean {
    return this.outboundDecision(serverId, capability).allowed;
  }

  public allowsInbound(originServerId: string, capability: RemoteAccessCapability): boolean {
    return this.inboundDecision(originServerId, capability).allowed;
  }

  public commandMode(direction: RemoteDirection): RemoteCommandMode {
    return this.scope(direction).commands.mode;
  }

  public commandAllowed(direction: RemoteDirection, executable: string): boolean {
    return commandMatchesAllowlist(this.scope(direction), executable);
  }

  public restrictsToWorkspaces(direction: RemoteDirection): boolean {
    return this.scope(direction).restrictToWorkspaces;
  }

  private decide(
    direction: RemoteDirection,
    peerServerId: string,
    capability: RemoteAccessCapability,
  ): RemoteAccessDecision {
    const scope = this.scope(direction);
    const label = direction === "outbound" ? "destination" : "origin";
    if (!scope.enabled) {
      return {
        allowed: false,
        reason: `Remote access is off for this host. Enable daemon.remoteAccess.${direction}.enabled first.`,
      };
    }
    if (!scope.peers.includes(peerServerId)) {
      return {
        allowed: false,
        reason: `Server ${peerServerId} is not an allowed ${label}. Add it to daemon.remoteAccess.${direction}.peers.`,
      };
    }
    if (!scopeAllowsCapability(scope, capability)) {
      return {
        allowed: false,
        reason: `Remote ${capability} is not enabled for ${peerServerId} in daemon.remoteAccess.${direction}.`,
      };
    }
    return ALLOWED;
  }
}

export class StaticRemoteAccessPolicy implements RemoteAccessPolicy {
  public constructor(private readonly value: RemoteAccessConfig) {}

  public config(): RemoteAccessConfig {
    return this.value;
  }

  public scope(direction: RemoteDirection): RemoteAccessScope {
    return this.value[direction];
  }

  public outboundDecision(
    serverId: string,
    capability: RemoteAccessCapability,
  ): RemoteAccessDecision {
    return decide(this.value.outbound, "outbound", serverId, capability);
  }

  public inboundDecision(
    originServerId: string,
    capability: RemoteAccessCapability,
  ): RemoteAccessDecision {
    return decide(this.value.inbound, "inbound", originServerId, capability);
  }

  public allowsOutbound(serverId: string, capability: RemoteAccessCapability): boolean {
    return this.outboundDecision(serverId, capability).allowed;
  }

  public allowsInbound(originServerId: string, capability: RemoteAccessCapability): boolean {
    return this.inboundDecision(originServerId, capability).allowed;
  }

  public commandMode(direction: RemoteDirection): RemoteCommandMode {
    return this.value[direction].commands.mode;
  }

  public commandAllowed(direction: RemoteDirection, executable: string): boolean {
    return commandMatchesAllowlist(this.value[direction], executable);
  }

  public restrictsToWorkspaces(direction: RemoteDirection): boolean {
    return this.value[direction].restrictToWorkspaces;
  }
}

function decide(
  scope: RemoteAccessScope,
  direction: RemoteDirection,
  peerServerId: string,
  capability: RemoteAccessCapability,
): RemoteAccessDecision {
  if (!scope.enabled) {
    return { allowed: false, reason: `Remote access is off for this host (${direction}).` };
  }
  if (!scope.peers.includes(peerServerId)) {
    return { allowed: false, reason: `Server ${peerServerId} is not an allowed peer.` };
  }
  if (!scopeAllowsCapability(scope, capability)) {
    return { allowed: false, reason: `Remote ${capability} is not enabled.` };
  }
  return ALLOWED;
}

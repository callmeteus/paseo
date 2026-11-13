import {
  RemoteAccessConfigSchema,
  type RemoteAccessConfig,
  type RemoteAccessScope,
  type RemoteDirection,
} from "@getpaseo/protocol/remote-access";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";

export function readRemoteAccess(config: MutableDaemonConfig | null): RemoteAccessConfig {
  return RemoteAccessConfigSchema.parse(config?.remoteAccess ?? {});
}

export function isRemoteAccessVisible(isConnected: boolean): boolean {
  return isConnected;
}

export function updateRemoteScope(
  config: RemoteAccessConfig,
  direction: RemoteDirection,
  patch: Partial<RemoteAccessScope>,
): RemoteAccessConfig {
  return { ...config, [direction]: { ...config[direction], ...patch } };
}

export function createRemoteAccessPatch(
  config: RemoteAccessConfig,
  direction: RemoteDirection,
  patch: Partial<RemoteAccessScope>,
): MutableDaemonConfigPatch {
  return { remoteAccess: updateRemoteScope(config, direction, patch) };
}

export function toggleRemotePeer(scope: RemoteAccessScope, serverId: string): RemoteAccessScope {
  const peers = scope.peers.includes(serverId)
    ? scope.peers.filter((peer) => peer !== serverId)
    : [...scope.peers, serverId];
  return { ...scope, peers };
}

export function parseAllowlist(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
}

export function formatAllowlist(entries: readonly string[]): string {
  return entries.join("\n");
}

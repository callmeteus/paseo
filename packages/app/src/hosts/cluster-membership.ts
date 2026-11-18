/** Device cluster membership. An omitted host follows the matching global flag. */
export interface ClusterMembership {
  autoSyncNames: boolean;
  announceHosts: boolean;
  syncExcluded: readonly string[];
  announceExcluded: readonly string[];
}

export function hostSyncsName(prefs: ClusterMembership, serverId: string): boolean {
  return prefs.autoSyncNames && !prefs.syncExcluded.includes(serverId);
}

export function hostIsAnnounced(prefs: ClusterMembership, serverId: string): boolean {
  return prefs.announceHosts && !prefs.announceExcluded.includes(serverId);
}

/** Returns the exclusion list after including or leaving out one host. */
export function hostExclusionList(
  excluded: readonly string[],
  input: { serverId: string; include: boolean },
): string[] {
  const listed = excluded.includes(input.serverId);
  if (input.include) return listed ? excluded.filter((id) => id !== input.serverId) : [...excluded];
  return listed ? [...excluded] : [...excluded, input.serverId];
}

/**
 * The settings page and the sidebar host menu both remove a host through here,
 * so a local desktop daemon is stopped the same way in both places.
 *
 * Only `serverId` is removed. Workspaces that live on the daemon are not
 * deleted, and no other host is passed to `removeHost`.
 */
export async function removeSavedHost<Status>(
  input: {
    serverId: string;
    isLocalDaemon: boolean;
    daemon: { status: string; ownedByDesktop: boolean } | null;
  },
  deps: {
    removeHost: (serverId: string) => Promise<void>;
    updateSettings: (updates: { daemon: { manageBuiltInDaemon: boolean } }) => Promise<void>;
    stopDaemon: () => Promise<Status>;
    startDaemon: () => Promise<Status>;
    setDaemonStatus: (status: Status) => void;
  },
): Promise<void> {
  if (!input.isLocalDaemon) {
    await deps.removeHost(input.serverId);
    return;
  }

  let didDisableDaemonManagement = false;
  let didStopDaemon = false;
  try {
    await deps.updateSettings({ daemon: { manageBuiltInDaemon: false } });
    didDisableDaemonManagement = true;
    if (input.daemon?.status === "running" && input.daemon.ownedByDesktop) {
      deps.setDaemonStatus(await deps.stopDaemon());
      didStopDaemon = true;
    }
    await deps.removeHost(input.serverId);
  } catch (error) {
    if (didDisableDaemonManagement) {
      try {
        await deps.updateSettings({ daemon: { manageBuiltInDaemon: true } });
        if (didStopDaemon) {
          deps.setDaemonStatus(await deps.startDaemon());
        }
      } catch (rollbackError) {
        console.error("[HostPage] Failed to roll back localhost removal", rollbackError);
      }
    }
    throw error;
  }
}

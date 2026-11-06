import { describe, expect, it, vi } from "vitest";
import { removeSavedHost } from "./remove-saved-host";

function deps() {
  return {
    removeHost: vi.fn(async (_serverId: string) => undefined),
    updateSettings: vi.fn(
      async (_updates: { daemon: { manageBuiltInDaemon: boolean } }) => undefined,
    ),
    stopDaemon: vi.fn(async () => "stopped" as const),
    startDaemon: vi.fn(async () => "running" as const),
    setDaemonStatus: vi.fn((_status: "stopped" | "running") => undefined),
  };
}

describe("removeSavedHost", () => {
  it("removes only the named host when it is not the local daemon", async () => {
    const calls = deps();
    await removeSavedHost({ serverId: "srv_eleito", isLocalDaemon: false, daemon: null }, calls);
    expect(calls.removeHost).toHaveBeenCalledTimes(1);
    expect(calls.removeHost).toHaveBeenCalledWith("srv_eleito");
    expect(calls.updateSettings).not.toHaveBeenCalled();
    expect(calls.stopDaemon).not.toHaveBeenCalled();
  });

  it("stops an owned running local daemon before removing that host", async () => {
    const calls = deps();
    await removeSavedHost(
      {
        serverId: "srv_desktop",
        isLocalDaemon: true,
        daemon: { status: "running", ownedByDesktop: true },
      },
      calls,
    );
    expect(calls.updateSettings).toHaveBeenCalledWith({
      daemon: { manageBuiltInDaemon: false },
    });
    expect(calls.stopDaemon).toHaveBeenCalledTimes(1);
    expect(calls.setDaemonStatus).toHaveBeenCalledWith("stopped");
    expect(calls.removeHost).toHaveBeenCalledWith("srv_desktop");
    expect(calls.startDaemon).not.toHaveBeenCalled();
  });

  it("does not stop a local daemon that is not running or not owned", async () => {
    const calls = deps();
    await removeSavedHost(
      {
        serverId: "srv_desktop",
        isLocalDaemon: true,
        daemon: { status: "stopped", ownedByDesktop: true },
      },
      calls,
    );
    expect(calls.stopDaemon).not.toHaveBeenCalled();
    expect(calls.removeHost).toHaveBeenCalledWith("srv_desktop");
  });

  it("rolls the local daemon back when removal fails after it was stopped", async () => {
    const calls = deps();
    calls.removeHost.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      removeSavedHost(
        {
          serverId: "srv_desktop",
          isLocalDaemon: true,
          daemon: { status: "running", ownedByDesktop: true },
        },
        calls,
      ),
    ).rejects.toThrow("disk full");
    expect(calls.updateSettings).toHaveBeenLastCalledWith({
      daemon: { manageBuiltInDaemon: true },
    });
    expect(calls.startDaemon).toHaveBeenCalledTimes(1);
    expect(calls.setDaemonStatus).toHaveBeenLastCalledWith("running");
    expect(calls.removeHost).toHaveBeenCalledWith("srv_desktop");
  });

  it("does not restart the daemon when it was never stopped", async () => {
    const calls = deps();
    calls.removeHost.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      removeSavedHost(
        {
          serverId: "srv_desktop",
          isLocalDaemon: true,
          daemon: { status: "stopped", ownedByDesktop: true },
        },
        calls,
      ),
    ).rejects.toThrow("disk full");
    expect(calls.startDaemon).not.toHaveBeenCalled();
    expect(calls.updateSettings).toHaveBeenLastCalledWith({
      daemon: { manageBuiltInDaemon: true },
    });
  });
});

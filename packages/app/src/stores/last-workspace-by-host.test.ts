import { describe, expect, it } from "vitest";
import {
  createLastWorkspaceByHostStore,
  type LastWorkspaceByHostStorage,
} from "./last-workspace-by-host";

function createStorage(initial: string | null = null): LastWorkspaceByHostStorage & {
  saved: () => string | null;
} {
  let value = initial;
  return {
    saved: () => value,
    read: async () => value,
    write: async (next) => {
      value = next;
    },
  };
}

describe("last workspace by host", () => {
  it("remembers a separate workspace for each host", async () => {
    const storage = createStorage();
    const store = createLastWorkspaceByHostStore(storage);

    store.remember({ serverId: "host-a", workspaceId: "workspace-a" });
    store.remember({ serverId: "host-b", workspaceId: "workspace-b" });
    store.remember({ serverId: "host-a", workspaceId: "workspace-a-2" });

    expect(store.getForHost("host-a")).toEqual({
      serverId: "host-a",
      workspaceId: "workspace-a-2",
    });
    expect(store.getForHost("host-b")).toEqual({
      serverId: "host-b",
      workspaceId: "workspace-b",
    });
    expect(store.getForHost("unknown")).toBeNull();
  });

  it("hydrates persisted per-host workspaces", async () => {
    const storage = createStorage(
      JSON.stringify({
        "host-a": { serverId: "host-a", workspaceId: "workspace-a" },
      }),
    );
    const store = createLastWorkspaceByHostStore(storage);

    await store.hydrate();

    expect(store.isHydrated()).toBe(true);
    expect(store.getForHost("host-a")).toEqual({
      serverId: "host-a",
      workspaceId: "workspace-a",
    });
  });

  it("ignores malformed persisted data", async () => {
    const storage = createStorage("{not json");
    const store = createLastWorkspaceByHostStore(storage);

    await store.hydrate();

    expect(store.getForHost("host-a")).toBeNull();
  });
});

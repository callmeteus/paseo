import { afterEach, describe, expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { importCursorChats } from "./import.js";
import {
  cleanupFixtureDirectories,
  createCursorFixtureDb,
  mainFixtureChat,
} from "./test-fixtures.js";
import type { StoredAgentRecord } from "../../agent/agent-storage.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { WorkspaceProvisioningService } from "../../session/workspace-provisioning/workspace-provisioning-service.js";

const directories: string[] = [];

afterEach(() => {
  cleanupFixtureDirectories(directories);
});

class FakeAgentStorage {
  readonly records = new Map<string, StoredAgentRecord>();

  async list(): Promise<StoredAgentRecord[]> {
    return [...this.records.values()];
  }

  async upsert(record: StoredAgentRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

interface CreatedWorkspace {
  workspaceId: string;
  cwd: string;
  title: string | null;
}

function fakeProvisioning() {
  const created: CreatedWorkspace[] = [];
  let next = 0;
  const service = {
    async createWorkspaceForDirectory(cwd: string, title?: string | null) {
      const workspace = {
        workspaceId: `wks_cursor_${next++}`,
        cwd,
        title: title ?? null,
      } as PersistedWorkspaceRecord;
      created.push({ workspaceId: workspace.workspaceId, cwd, title: workspace.title });
      return workspace;
    },
  } satisfies Pick<WorkspaceProvisioningService, "createWorkspaceForDirectory">;
  return { created, service };
}

function importInput(
  dbPath: string,
  storage: FakeAgentStorage,
  composerIds: string[],
  provisioning = fakeProvisioning(),
) {
  return {
    agentStorage: storage,
    workspaceProvisioning: provisioning.service,
    logger: createTestLogger(),
    dbPath,
    composerIds,
    includeSubagents: true,
    idFactory: (() => {
      let next = 0;
      return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    })(),
  };
}

describe("importCursorChats", () => {
  test("gives a root chat its own workspace and keeps subagents in it", async () => {
    const parentId = "11111111-1111-4111-8111-111111111111";
    const childId = "33333333-3333-4333-8333-333333333333";
    const dbPath = createCursorFixtureDb(
      [
        mainFixtureChat({ composerId: parentId }),
        mainFixtureChat({
          composerId: childId,
          name: "Explore subagent",
          isSubagent: true,
          subagentTypeName: "explore",
          parentComposerId: parentId,
          toolCallId: "tool_9",
        }),
      ],
      directories,
    );
    const storage = new FakeAgentStorage();
    const provisioning = fakeProvisioning();

    const result = await importCursorChats(importInput(dbPath, storage, [parentId], provisioning));

    expect(result.importedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(provisioning.created).toEqual([
      {
        workspaceId: "wks_cursor_0",
        cwd: "C:\\Users\\Gio\\Documents\\Projetos\\Pacotes\\artdirector",
        title: "ArtDirector graphic design system",
      },
    ]);

    const parent = storage.records.get(result.chats[0]!.agentId as string);
    const child = storage.records.get(result.chats[1]!.agentId as string);
    expect(parent).toMatchObject({
      provider: "cursor",
      cwd: "C:\\Users\\Gio\\Documents\\Projetos\\Pacotes\\artdirector",
      lastStatus: "closed",
      persistence: null,
      workspaceId: "wks_cursor_0",
      title: "ArtDirector graphic design system",
      labels: {
        "paseo.import.source": "cursor",
        "paseo.import.source-id": parentId,
        "paseo.import.model": "composer-2.5",
      },
    });
    expect(parent?.portedTimeline?.length).toBeGreaterThan(0);
    expect(child?.workspaceId).toBe(parent?.workspaceId);
    expect(child?.labels[PARENT_AGENT_ID_LABEL]).toBe(parent?.id);
  });

  test("creates one workspace per root chat even when they share a directory", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const dbPath = createCursorFixtureDb(
      [
        mainFixtureChat({ composerId: firstId, name: "First chat" }),
        mainFixtureChat({ composerId: secondId, name: "Second chat" }),
      ],
      directories,
    );
    const storage = new FakeAgentStorage();
    const provisioning = fakeProvisioning();

    const result = await importCursorChats(
      importInput(dbPath, storage, [firstId, secondId], provisioning),
    );

    expect(result.importedCount).toBe(2);
    expect(provisioning.created.map((workspace) => workspace.title)).toEqual([
      "First chat",
      "Second chat",
    ]);
    const first = storage.records.get(result.chats[0]!.agentId as string);
    const second = storage.records.get(result.chats[1]!.agentId as string);
    expect(first?.workspaceId).toBe("wks_cursor_0");
    expect(second?.workspaceId).toBe("wks_cursor_1");
    expect(first?.workspaceId).not.toBe(second?.workspaceId);
  });

  test("is idempotent: a second run reports the existing agent instead of duplicating", async () => {
    const dbPath = createCursorFixtureDb([mainFixtureChat()], directories);
    const storage = new FakeAgentStorage();
    const provisioning = fakeProvisioning();

    const first = await importCursorChats(
      importInput(dbPath, storage, ["11111111-1111-4111-8111-111111111111"], provisioning),
    );
    const second = await importCursorChats(
      importInput(dbPath, storage, ["11111111-1111-4111-8111-111111111111"], provisioning),
    );

    expect(first.importedCount).toBe(1);
    expect(second.importedCount).toBe(0);
    expect(second.alreadyImportedCount).toBe(1);
    expect(second.chats[0]?.agentId).toBe(first.chats[0]?.agentId);
    expect(storage.records.size).toBe(1);
    expect(provisioning.created).toHaveLength(1);
  });

  test("skips chats Cursor never tied to a workspace folder", async () => {
    const dbPath = createCursorFixtureDb(
      [
        mainFixtureChat({
          composerId: "22222222-2222-4222-8222-222222222222",
          cwd: null,
        }),
      ],
      directories,
    );
    const storage = new FakeAgentStorage();
    const provisioning = fakeProvisioning();

    const result = await importCursorChats(
      importInput(dbPath, storage, ["22222222-2222-4222-8222-222222222222"], provisioning),
    );

    expect(result.skippedCount).toBe(1);
    expect(result.chats[0]?.error).toContain("workspace folder");
    expect(storage.records.size).toBe(0);
    expect(provisioning.created).toHaveLength(0);
  });
});

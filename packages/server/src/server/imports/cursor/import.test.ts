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
import type { ImportWorkspaceInput } from "../../session/workspace-provisioning/workspace-provisioning-service.js";

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

function fakeProvisioning(): Pick<WorkspaceProvisioningService, "runInImportWorkspace"> {
  return {
    async runInImportWorkspace<T>(
      input: ImportWorkspaceInput,
      operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
    ) {
      const workspace = {
        workspaceId: "wks_cursor_test",
        cwd: input.cwd,
      } as PersistedWorkspaceRecord;
      return { value: await operation(workspace), createdWorkspace: null };
    },
  };
}

function importInput(dbPath: string, storage: FakeAgentStorage, composerIds: string[]) {
  return {
    agentStorage: storage,
    workspaceProvisioning: fakeProvisioning(),
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
  test("imports a root chat and its Cursor subagents with a parent link", async () => {
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

    const result = await importCursorChats(importInput(dbPath, storage, [parentId]));

    expect(result.importedCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const parent = storage.records.get(result.chats[0]!.agentId as string);
    const child = storage.records.get(result.chats[1]!.agentId as string);
    expect(parent).toMatchObject({
      provider: "cursor",
      cwd: "C:\\Users\\Gio\\Documents\\Projetos\\Pacotes\\artdirector",
      lastStatus: "closed",
      persistence: null,
      workspaceId: "wks_cursor_test",
      title: "ArtDirector graphic design system",
      labels: {
        "paseo.import.source": "cursor",
        "paseo.import.source-id": parentId,
        "paseo.import.model": "composer-2.5",
      },
    });
    expect(parent?.portedTimeline?.length).toBeGreaterThan(0);
    expect(child?.labels[PARENT_AGENT_ID_LABEL]).toBe(parent?.id);
  });

  test("is idempotent: a second run reports the existing agent instead of duplicating", async () => {
    const dbPath = createCursorFixtureDb([mainFixtureChat()], directories);
    const storage = new FakeAgentStorage();

    const first = await importCursorChats(
      importInput(dbPath, storage, ["11111111-1111-4111-8111-111111111111"]),
    );
    const second = await importCursorChats(
      importInput(dbPath, storage, ["11111111-1111-4111-8111-111111111111"]),
    );

    expect(first.importedCount).toBe(1);
    expect(second.importedCount).toBe(0);
    expect(second.alreadyImportedCount).toBe(1);
    expect(second.chats[0]?.agentId).toBe(first.chats[0]?.agentId);
    expect(storage.records.size).toBe(1);
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

    const result = await importCursorChats(
      importInput(dbPath, storage, ["22222222-2222-4222-8222-222222222222"]),
    );

    expect(result.skippedCount).toBe(1);
    expect(result.chats[0]?.error).toContain("workspace folder");
    expect(storage.records.size).toBe(0);
  });
});

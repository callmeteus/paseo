import { beforeEach, describe, expect, it, vi } from "vitest";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

vi.mock("@/attachments/service", () => ({
  garbageCollectAttachments: async () => undefined,
  persistAttachmentFromDataUrl: async () => ({
    id: "image-1",
    mimeType: "image/png",
    storageType: "native-file",
    storageKey: "image-1",
    createdAt: 0,
  }),
  persistAttachmentFromFileUri: async () => ({
    id: "image-1",
    mimeType: "image/png",
    storageType: "native-file",
    storageKey: "image-1",
    createdAt: 0,
  }),
}));

import { restoreDroppedPrompt } from "@/composer/recover-dropped-prompt";
import { usePendingComposerSendStore } from "@/composer/pending-send";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";

const serverId = "host-1";
const agentId = "agent-1";
const draftKey = buildDraftStoreKey({ serverId, agentId });

describe("restoreDroppedPrompt", () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {}, createModalDraft: null });
    usePendingComposerSendStore.setState({ byAgent: {} });
  });

  it("puts the dropped prompt back with its attachments", () => {
    usePendingComposerSendStore.getState().remember({
      serverId,
      agentId,
      send: {
        clientMessageId: "client-1",
        text: "faz deploy por favor",
        attachments: [{ kind: "file", attachment: uploadedFile }],
      },
    });

    restoreDroppedPrompt({
      serverId,
      agentId,
      clientMessageId: "client-1",
      text: "ignored",
    });

    expect(useDraftStore.getState().getDraftInput(draftKey)).toEqual({
      text: "faz deploy por favor",
      attachments: [{ kind: "file", attachment: uploadedFile }],
    });
  });

  it("falls back to the dropped text when the send is not remembered", () => {
    restoreDroppedPrompt({
      serverId,
      agentId,
      clientMessageId: "client-2",
      text: "faz deploy por favor",
    });

    expect(useDraftStore.getState().getDraftInput(draftKey)).toEqual({
      text: "faz deploy por favor",
      attachments: [],
    });
  });

  it("never overwrites a draft the user is already typing", () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "outra coisa", attachments: [] } });

    restoreDroppedPrompt({
      serverId,
      agentId,
      clientMessageId: "client-3",
      text: "faz deploy por favor",
    });

    expect(useDraftStore.getState().getDraftInput(draftKey)?.text).toBe("outra coisa");
  });
});

const uploadedFile = {
  type: "uploaded_file" as const,
  id: "file-1",
  fileName: "notes.txt",
  mimeType: "text/plain",
  size: 12,
  path: "/tmp/notes.txt",
};

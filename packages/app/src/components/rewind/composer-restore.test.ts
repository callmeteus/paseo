import { describe, expect, test } from "vitest";
import { restoreComposerTextIfEmpty, shouldRestoreRewindAttachments } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";

describe("restoreComposerTextIfEmpty", () => {
  test("restores the rewound message when the composer is empty", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "",
        rewoundText: "message before rewind",
      }),
    ).toBe("message before rewind");
  });

  test("preserves an existing composer draft", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "keep this draft",
        rewoundText: "message before rewind",
      }),
    ).toBe("keep this draft");
  });
});

describe("shouldRestoreRewindAttachments", () => {
  test("restores when the composer has neither text nor attachments", () => {
    expect(shouldRestoreRewindAttachments({ currentText: "", currentAttachments: [] })).toBe(true);
  });

  test("keeps the draft when it already has text", () => {
    expect(shouldRestoreRewindAttachments({ currentText: "draft", currentAttachments: [] })).toBe(
      false,
    );
  });

  test("keeps the draft when it already has attachments", () => {
    expect(
      shouldRestoreRewindAttachments({
        currentText: "",
        currentAttachments: [{ kind: "quote", text: "quoted" }],
      }),
    ).toBe(false);
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});

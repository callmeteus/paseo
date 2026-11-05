import { describe, expect, it } from "vitest";
import { buildGroupSentence, planGroupLabel } from "./label";
import type { OverviewSummary } from "./model";

function summary(overrides: Partial<OverviewSummary> = {}): OverviewSummary {
  return {
    editedFileCount: 0,
    commandCount: 0,
    readFileCount: 0,
    searchCount: 0,
    fetchCount: 0,
    agentCount: 0,
    otherToolCount: 0,
    paseoCallCount: 0,
    failedFileCount: 0,
    readFiles: [],
    thinkingDurationMs: 0,
    thoughtCount: 0,
    hasText: false,
    ...overrides,
  };
}

describe("group label plan", () => {
  it("explores when the run only looked at things", () => {
    const plan = planGroupLabel(summary({ readFileCount: 8, searchCount: 8, otherToolCount: 1 }));

    expect(plan.action).toBe("explored");
    expect(plan.parts).toEqual([
      { key: "files", count: 8 },
      { key: "searches", count: 8 },
      { key: "tools", count: 1 },
    ]);
  });

  it("leads with edits and marks the reads that followed as explored", () => {
    const plan = planGroupLabel(
      summary({ editedFileCount: 2, readFileCount: 34, commandCount: 3 }),
    );

    expect(plan.action).toBe("edited");
    expect(plan.parts).toEqual([
      { key: "files", count: 2 },
      { key: "exploredFiles", count: 34 },
      { key: "commands", count: 3 },
    ]);
  });

  it("reports a run of shell commands as ran rather than explored", () => {
    const plan = planGroupLabel(summary({ commandCount: 3 }));

    expect(plan.action).toBe("ran");
    expect(plan.parts).toEqual([]);
  });

  it("reports a run whose writes were all rejected as skipped", () => {
    const plan = planGroupLabel(summary({ failedFileCount: 2 }));

    expect(plan.action).toBe("skipped");
    expect(plan.parts).toEqual([{ key: "files", count: 2 }]);
  });

  it("appends the diff totals when the edits reported a diff", () => {
    const plan = planGroupLabel(
      summary({ editedFileCount: 1, fileChangeStats: { additions: 12, deletions: 3 } }),
    );

    expect(plan.fileChangeStats).toBe("+12 -3");
  });

  it("omits the diff totals when nothing was added or removed", () => {
    const plan = planGroupLabel(
      summary({ editedFileCount: 1, fileChangeStats: { additions: 0, deletions: 0 } }),
    );

    expect(plan.fileChangeStats).toBeUndefined();
  });
});

describe("group label segments", () => {
  it("joins the parts into one sentence and marks only the tool part with an icon", () => {
    const label = buildGroupSentence(
      "Explored",
      [
        { kind: "files", text: "8 files" },
        { kind: "searches", text: "8 searches" },
        { kind: "tools", text: "1 tool" },
      ],
      undefined,
    );

    expect(label.text).toBe("Explored 8 files, 8 searches, 1 tool");
    expect(label.segments).toEqual([
      { text: "Explored" },
      { text: "\u00A08 files" },
      { text: ", 8 searches" },
      { text: ", 1 tool", icon: "tool" },
    ]);
  });

  it("keeps the first separator non-breaking so the action and count do not glue", () => {
    const label = buildGroupSentence("Editei", [{ kind: "files", text: "2 arquivos" }], undefined);

    expect(label.text).toBe("Editei 2 arquivos");
    expect(label.segments[1]?.text).toBe("\u00A02 arquivos");
  });

  it("appends the diff totals with a space, as Cursor does", () => {
    const label = buildGroupSentence("Edited", [{ kind: "files", text: "2 files" }], "+12 -3");

    expect(label.text).toBe("Edited 2 files +12 -3");
  });
});

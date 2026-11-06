import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  buildGroupSentence,
  buildOverviewSummaryDisplay,
  layoutOverviewLabelSegments,
  planGroupLabel,
  reasoningRowPresentation,
} from "./label";
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

  it("paints the tool icon with its label and leaves the comma on the previous word", () => {
    const label = buildGroupSentence(
      "Explorei",
      [
        { kind: "searches", text: "2 buscas" },
        { kind: "tools", text: "2 ferramentas" },
        { kind: "commands", text: "rodei 3 comandos" },
      ],
      undefined,
    );

    expect(label.text).toBe("Explorei 2 buscas, 2 ferramentas, rodei 3 comandos");
    expect(label.segments).toEqual([
      { text: "Explorei" },
      { text: "\u00A02 buscas" },
      { text: ", 2 ferramentas", icon: "tool" },
      { text: ", rodei 3 comandos" },
    ]);
    expect(layoutOverviewLabelSegments(label.segments)).toEqual([
      { text: "Explorei" },
      { text: "\u00A02 buscas," },
      { text: "2 ferramentas", icon: "tool" },
      { text: ", rodei 3 comandos" },
    ]);
  });

  it("drops the leading separator from a tool label when tools are the first part", () => {
    const label = buildGroupSentence(
      "Explorei",
      [{ kind: "tools", text: "2 ferramentas" }],
      undefined,
    );

    expect(label.text).toBe("Explorei 2 ferramentas");
    expect(layoutOverviewLabelSegments(label.segments)).toEqual([
      { text: "Explorei" },
      { text: "2 ferramentas", icon: "tool" },
    ]);
  });

  it("keeps each icon with its own label when several parts carry one", () => {
    expect(
      layoutOverviewLabelSegments([
        { text: "Explorei" },
        { text: "\u00A02 buscas", icon: "tool" },
        { text: ", 2 ferramentas", icon: "tool" },
        { text: ", rodei 3 comandos", icon: "tool" },
      ]),
    ).toEqual([
      { text: "Explorei" },
      { text: "2 buscas,", icon: "tool" },
      { text: "2 ferramentas,", icon: "tool" },
      { text: "rodei 3 comandos", icon: "tool" },
    ]);
  });
});

describe("activity line", () => {
  async function inPortuguese<T>(run: () => T): Promise<T> {
    const previous = i18n.language;
    await i18n.changeLanguage("pt-BR");
    try {
      return run();
    } finally {
      await i18n.changeLanguage(previous);
    }
  }

  it("keeps a short thought-only block as Pensei um instante", async () => {
    await inPortuguese(() => {
      expect(
        buildOverviewSummaryDisplay(summary({ thoughtCount: 1, thinkingDurationMs: 120 }), i18n.t)
          .text,
      ).toBe("Pensei um instante");
      expect(
        buildOverviewSummaryDisplay(
          summary({ thoughtCount: 1, thinkingDurationMs: 10_000 }),
          i18n.t,
        ).text,
      ).toBe("Pensei 10s");
    });
  });

  it("uses the bare thought word only when the block really only thought", async () => {
    await inPortuguese(() => {
      expect(
        buildOverviewSummaryDisplay(summary({ thoughtCount: 1, thinkingDurationMs: 0 }), i18n.t)
          .text,
      ).toBe("Pensei");
    });
  });

  it("does not leave a block that also ran a shell as Pensei", async () => {
    await inPortuguese(() => {
      const text = buildOverviewSummaryDisplay(
        summary({ thoughtCount: 1, commandCount: 2, thinkingDurationMs: 0 }),
        i18n.t,
      ).text;

      expect(text).toBe("Rodei");
      expect(text).not.toBe("Pensei");
    });
  });

  it("names searches and tools with the activity sentence the group already uses", async () => {
    await inPortuguese(() => {
      expect(
        buildOverviewSummaryDisplay(
          summary({ thoughtCount: 1, searchCount: 2, thinkingDurationMs: 0 }),
          i18n.t,
        ).text,
      ).toBe("Explorei 2 buscas");
      expect(
        buildOverviewSummaryDisplay(
          summary({ thoughtCount: 1, otherToolCount: 1, thinkingDurationMs: 0 }),
          i18n.t,
        ).text,
      ).toBe("Explorei 1 ferramenta");
      expect(
        buildOverviewSummaryDisplay(
          summary({ thoughtCount: 1, searchCount: 2, commandCount: 1, thinkingDurationMs: 0 }),
          i18n.t,
        ).text,
      ).toBe("Explorei 2 buscas, rodei 1 comando");
    });
  });

  it("keeps a turn that also ran a shell from collapsing to Pensei", async () => {
    await inPortuguese(() => {
      expect(
        buildOverviewSummaryDisplay(
          summary({ thoughtCount: 1, commandCount: 1, thinkingDurationMs: 0 }),
          i18n.t,
          ["escreveu 1 mensagem"],
        ).text,
      ).toBe("Escreveu 1 mensagem e rodei");
    });
  });

  it("does not badge a reasoning row as bare Pensei when the same stretch ran a tool", async () => {
    await inPortuguese(() => {
      expect(
        reasoningRowPresentation(
          { title: "", durationMs: undefined, embeddedInToolWork: true },
          i18n.t,
        ),
      ).toEqual({ kind: "text" });
      expect(
        reasoningRowPresentation({ title: "", durationMs: 0, embeddedInToolWork: true }, i18n.t),
      ).toEqual({ kind: "text" });
    });
  });

  it("keeps a short thought's duration even when the stretch also ran a tool", async () => {
    await inPortuguese(() => {
      expect(
        reasoningRowPresentation({ title: "", durationMs: 120, embeddedInToolWork: true }, i18n.t),
      ).toEqual({ kind: "badge", label: "Pensei", secondaryLabel: "um instante" });
      expect(
        reasoningRowPresentation(
          { title: "", durationMs: 10_000, embeddedInToolWork: true },
          i18n.t,
        ),
      ).toEqual({ kind: "badge", label: "Pensei", secondaryLabel: "10s" });
    });
  });

  it("keeps a bare Pensei badge when the stretch only thought and has no duration", async () => {
    await inPortuguese(() => {
      expect(
        reasoningRowPresentation(
          { title: "", durationMs: undefined, embeddedInToolWork: false },
          i18n.t,
        ),
      ).toEqual({ kind: "badge", label: "Pensei" });
    });
  });
});

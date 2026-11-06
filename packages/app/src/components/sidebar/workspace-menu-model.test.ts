import { describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import { ptBR } from "@/i18n/resources/pt-BR";
import { workspaceMenuRows, workspacePinAction } from "./workspace-menu-model";

const labels = {
  en: en.sidebar.workspace.actions,
  ptBR: ptBR.sidebar.workspace.actions,
} as const;

describe("workspace chat menu", () => {
  it("puts archive first, then pin, then rename and read state, then move and copy", () => {
    expect(
      workspaceMenuRows({
        archive: true,
        pin: true,
        rename: true,
        labels: true,
        "mark-as-unread": true,
        move: true,
        "copy-path": true,
        "copy-branch": true,
        "open-folder": true,
        delete: true,
      }),
    ).toEqual([
      "archive",
      "separator-before-pin",
      "pin",
      "separator-before-rename",
      "rename",
      "labels",
      "mark-as-unread",
      "separator-before-move",
      "move",
      "copy-path",
      "copy-branch",
      "open-folder",
      "separator-before-delete",
      "delete",
    ]);
  });

  it("uses the read action when the chat is unread, and the unread action otherwise", () => {
    expect(workspaceMenuRows({ "mark-as-read": true })).toEqual(["mark-as-read"]);
    expect(workspaceMenuRows({ "mark-as-unread": true })).toEqual(["mark-as-unread"]);
    expect(
      workspaceMenuRows({ "mark-as-read": true, "mark-as-unread": true }).filter(
        (row) => row === "mark-as-read" || row === "mark-as-unread",
      ),
    ).toEqual(["mark-as-read", "mark-as-unread"]);
  });

  it("names the pin row from the current state, one label at a time", () => {
    expect(workspaceMenuRows({ pin: true }).filter((row) => row === "pin")).toEqual(["pin"]);
    expect(workspacePinAction(false)).toBe("pin");
    expect(workspacePinAction(true)).toBe("unpin");
    expect(labels.en[workspacePinAction(false)]).toBe("Pin to top");
    expect(labels.en[workspacePinAction(true)]).toBe("Unpin");
    expect(labels.ptBR[workspacePinAction(false)]).toBe("Fixar no topo");
    expect(labels.ptBR[workspacePinAction(true)]).toBe("Desafixar");
    for (const text of [
      labels.en.pin,
      labels.en.unpin,
      labels.ptBR.pin,
      labels.ptBR.unpin,
      labels.en.archive,
      labels.ptBR.archive,
    ]) {
      expect(text).not.toContain("!");
    }
  });

  it("drops the divider when a group has nothing to show", () => {
    expect(
      workspaceMenuRows({
        archive: true,
        rename: true,
        "copy-path": true,
      }),
    ).toEqual([
      "archive",
      "separator-before-rename",
      "rename",
      "separator-before-copy-path",
      "copy-path",
    ]);
    expect(workspaceMenuRows({ delete: true })).toEqual(["delete"]);
    expect(workspaceMenuRows({})).toEqual([]);
  });
});

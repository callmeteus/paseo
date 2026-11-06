import { describe, expect, it } from "vitest";
import { ptBR } from "@/i18n/resources/pt-BR";
import { HOST_COLORS } from "@/hosts/appearance";
import { identityForeground } from "@/styles/identity-colors";
import {
  HOST_CONTEXT_MENU_ACTIONS,
  HOST_REMOVE_REMOVES_WORKSPACES,
  formatHostRemoveMessage,
  hostContextMenuRows,
  hostHeaderTitleColor,
  hostMenuColors,
  hostRemoveConfirmation,
  nextHostLabel,
} from "./host-menu";

describe("host context menu", () => {
  it("offers rename, color and remove, in that order", () => {
    expect(HOST_CONTEXT_MENU_ACTIONS).toEqual(["rename", "color", "remove"]);
  });

  it("draws those actions, with a separator before remove", () => {
    const rows = hostContextMenuRows();
    expect(rows.filter((row) => row !== "separator")).toEqual([...HOST_CONTEXT_MENU_ACTIONS]);
    expect(rows).toEqual(["rename", "color", "separator", "remove"]);
  });

  it("offers the host colors the profile already stores", () => {
    expect(hostMenuColors()).toBe(HOST_COLORS);
    expect(hostMenuColors()).toContain("none");
    expect(hostMenuColors()).toContain("teal");
  });

  it("does not write an empty or unchanged rename", () => {
    expect(nextHostLabel("EleitoMapa", "")).toBeNull();
    expect(nextHostLabel("EleitoMapa", "   ")).toBeNull();
    expect(nextHostLabel("EleitoMapa", "EleitoMapa")).toBeNull();
    expect(nextHostLabel(" EleitoMapa ", "EleitoMapa")).toBeNull();
  });

  it("trims a new label before it is written", () => {
    expect(nextHostLabel("EleitoMapa", "  Embarcados  ")).toBe("Embarcados");
  });

  it("names the host in the confirmation and skips the workspace sentence", () => {
    expect(HOST_REMOVE_REMOVES_WORKSPACES).toBe(false);
    const confirmation = hostRemoveConfirmation({
      name: "EleitoMapa",
      stopsOwnedDaemon: false,
      removesWorkspaces: HOST_REMOVE_REMOVES_WORKSPACES,
    });
    expect(confirmation.name).toBe("EleitoMapa");
    expect(confirmation.messageKey).toBe("sidebar.host.confirmations.removeMessage");
    expect(confirmation.workspaceSentenceKey).toBeNull();

    const message = formatHostRemoveMessage({
      connectionMessage:
        "Remover EleitoMapa? As conexões salvas deste host saem deste dispositivo.",
      workspaceSentence: null,
    });
    expect(message).toContain("EleitoMapa");
    expect(message).not.toContain("workspaces");
  });

  it("uses the local sentence when the click also stops the built-in daemon", () => {
    const confirmation = hostRemoveConfirmation({
      name: "DESKTOP-0NJ2SSU",
      stopsOwnedDaemon: true,
      removesWorkspaces: false,
    });
    expect(confirmation.name).toBe("DESKTOP-0NJ2SSU");
    expect(confirmation.messageKey).toBe("sidebar.host.confirmations.removeLocalMessage");
    expect(confirmation.workspaceSentenceKey).toBeNull();
  });

  it("adds one workspace sentence when the removal takes the host's workspaces", () => {
    const confirmation = hostRemoveConfirmation({
      name: "EleitoMapa",
      stopsOwnedDaemon: false,
      removesWorkspaces: true,
    });
    expect(confirmation.workspaceSentenceKey).toBe("sidebar.host.confirmations.removeWorkspaces");
    const message = formatHostRemoveMessage({
      connectionMessage:
        'Remover "EleitoMapa"? As conexões salvas deste host saem deste dispositivo.',
      workspaceSentence: ptBR.sidebar.host.confirmations.removeWorkspaces,
    });
    expect(message).toContain("EleitoMapa");
    expect(message.endsWith(ptBR.sidebar.host.confirmations.removeWorkspaces)).toBe(true);
  });

  it("keeps the Portuguese confirmation in the sidebar's tone", () => {
    const copy = ptBR.sidebar.host.confirmations;
    expect(copy.removeMessage).toContain("{{name}}");
    expect(copy.removeLocalMessage).toContain("{{name}}");
    expect(copy.removeTitle.endsWith("?")).toBe(true);
    for (const text of [
      copy.removeTitle,
      copy.removeMessage,
      copy.removeLocalMessage,
      copy.removeWorkspaces,
      copy.removeConfirm,
      ptBR.sidebar.host.actions.rename,
      ptBR.sidebar.host.actions.color,
      ptBR.sidebar.host.actions.remove,
    ]) {
      expect(text).not.toContain("!");
    }
  });

  it("leaves the title muted until a stored color is chosen", () => {
    expect(hostHeaderTitleColor("none", "dark")).toBeNull();
    expect(hostHeaderTitleColor("teal", "dark")).toBe(identityForeground("teal", "dark"));
    expect(hostHeaderTitleColor("orange", "light")).toBe(identityForeground("orange", "light"));
  });
});

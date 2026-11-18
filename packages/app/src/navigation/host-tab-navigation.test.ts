import { beforeEach, describe, expect, it } from "vitest";
import { focusHostTab } from "./host-tab-navigation";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

beforeEach(() => {
  useSidebarViewStore.setState({ hostFilters: [] });
});

describe("focusHostTab", () => {
  it("retargets a pinned host tab to the notification's host", () => {
    useSidebarViewStore.getState().setHostFilter("host-a");

    focusHostTab("host-b");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-b"]);
  });

  it("leaves the pin alone when it already points at the destination", () => {
    useSidebarViewStore.getState().setHostFilter("host-b");

    focusHostTab("host-b");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-b"]);
  });

  it("does not pin a host when no single tab was selected", () => {
    useSidebarViewStore.getState().toggleHostFilter("host-a");
    useSidebarViewStore.getState().toggleHostFilter("host-b");

    focusHostTab("host-b");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);
  });
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { PinnedUsagePopoverBody } from "./pinned-hover";
import { resolvePinnedUsageItems } from "./pinned";
import type { UsagePreferences } from "./preferences";
import { unifiedUsagePin } from "./preferences";
import type { UsageReportEntry } from "./types";

const resetsAt = new Date(Date.now() + 2 * 60 * 60 * 1000 + 30_000).toISOString();

const claude: UsageReportEntry = {
  id: "claude:default",
  account: { label: "gio@even7.dev" },
  fetchedAt: "2026-01-01T00:00:00.000Z",
  sourceId: "claude",
  sourceLabel: "Claude",
  report: {
    status: "available",
    windows: [
      { id: "five-hour", label: "Session", shortLabel: "5h", usedPct: 31, resetsAt },
      { id: "weekly", label: "Weekly", shortLabel: "wk", usedPct: 80, resetsAt },
    ],
  },
};

const preferences: UsagePreferences = {
  displayAs: "used",
  pins: [unifiedUsagePin("claude"), { sourceId: "claude", windowId: "five-hour" }],
  serverId: null,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await i18n.changeLanguage("en");
});

it("shows every window for an overall pin and only the pinned window otherwise", () => {
  const items = resolvePinnedUsageItems([claude], preferences);
  const unified = items.find((item) => item.kind === "unified");
  const session = items.find((item) => item.kind === "window");
  expect(unified).toBeDefined();
  expect(session).toBeDefined();
  if (!unified || !session) return;

  act(() => {
    root.render(
      <>
        <div id="overall">
          <PinnedUsagePopoverBody item={unified} entry={claude} displayAs="used" />
        </div>
        <div id="session">
          <PinnedUsagePopoverBody item={session} entry={claude} displayAs="used" />
        </div>
      </>,
    );
  });

  const overall = container.querySelector("#overall")?.textContent ?? "";
  const window = container.querySelector("#session")?.textContent ?? "";
  expect(overall).toContain("Unified usage");
  expect(overall).not.toContain("gio@even7.dev");
  expect(overall).toContain("Session");
  expect(overall).toContain("Weekly");
  expect(overall).toContain("in 2h");
  expect(overall).not.toContain("resets");
  expect(window).toContain("Session");
  expect(window).toContain("in 2h");
  expect(window).not.toContain("Weekly");
});

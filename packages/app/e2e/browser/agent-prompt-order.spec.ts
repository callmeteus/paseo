import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { submitMessage } from "../support/helpers/composer";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const STEER_PROMPT = "Second prompt sent while the agent is still working";

async function expectComposerVisible(page: Page): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible({
    timeout: 60_000,
  });
}

interface TimelineOrder {
  promptIndex: number;
  lastAssistantIndex: number;
}

function readTimelineOrder(page: Page, prompt: string): Promise<TimelineOrder> {
  return page.evaluate((promptText) => {
    const rows = Array.from(
      document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]'),
    );
    let promptIndex = -1;
    let lastAssistantIndex = -1;
    rows.forEach((row, index) => {
      const kind = row.getAttribute("data-testid");
      if (kind === "user-message" && promptIndex < 0 && row.textContent?.includes(promptText)) {
        promptIndex = index;
      }
      if (kind === "assistant-message") lastAssistantIndex = index;
    });
    return { promptIndex, lastAssistantIndex };
  }, prompt);
}

// A prompt typed while the agent is answering interrupts the run and starts a new one. The
// answer to that prompt has to land below it: live text that merged into the assistant row
// above the prompt left the prompt looking like the last thing in the chat, including after
// reopening it from the replica cache.
test("a prompt sent while the agent answers keeps its response below it", async ({ page }) => {
  test.setTimeout(180_000);
  const gate = await installDaemonWebSocketGate(page);
  gate.setAssistantMessageIdsStripped(true);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "prompt-order-steer-",
    title: "Prompt order steer",
    model: "ten-second-stream",
  });
  try {
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "First prompt");
    await expect(page.getByText("Cycle", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Drop the cancel event so the local head keeps the prompt while the replacement answer
    // streams, which is where the merge used to happen.
    gate.setAgentStreamEventSuppressed("turn_canceled", true);
    await submitMessage(page, STEER_PROMPT);
    await expect(page.getByTestId("user-message").filter({ hasText: STEER_PROMPT })).toHaveCount(
      1,
      {
        timeout: 30_000,
      },
    );

    await expect
      .poll(
        async () => {
          const order = await readTimelineOrder(page, STEER_PROMPT);
          return order.promptIndex >= 0 && order.promptIndex < order.lastAssistantIndex;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    await page.reload();
    await expectComposerVisible(page);
    await expect
      .poll(
        async () => {
          const order = await readTimelineOrder(page, STEER_PROMPT);
          return order.promptIndex >= 0 && order.promptIndex < order.lastAssistantIndex;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  } finally {
    gate.restore();
    await agent.cleanup();
  }
});

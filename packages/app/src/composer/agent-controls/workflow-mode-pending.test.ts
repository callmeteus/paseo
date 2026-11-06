import { describe, expect, it } from "vitest";
import { trackWorkflowModeChange, workflowModeSettled } from "./workflow-mode-pending";

describe("workflowModeSettled", () => {
  it("holds the next message until the mode change finishes", async () => {
    let release: (value: string) => void = () => undefined;
    const change = new Promise<string>((resolve) => {
      release = resolve;
    });
    trackWorkflowModeChange("agent-1", change);
    let sent = false;
    const send = workflowModeSettled("agent-1").then(() => {
      sent = true;
      return undefined;
    });
    await Promise.resolve();
    expect(sent).toBe(false);
    release("agent");
    await send;
    expect(sent).toBe(true);
    await expect(workflowModeSettled("agent-1")).resolves.toBeUndefined();
  });
});

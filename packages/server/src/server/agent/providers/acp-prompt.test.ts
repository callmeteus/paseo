import { describe, expect, it } from "vitest";

import { prependAcpPromptText } from "./acp-prompt.js";

describe("prependAcpPromptText", () => {
  // Happy path
  it("puts the note before a text prompt", () => {
    expect(prependAcpPromptText("Sabe criar automações?", "Call list_automations.")).toBe(
      "Call list_automations.\n\nSabe criar automações?",
    );
  });

  // Happy path - content blocks stay after the note
  it("inserts a text block before image content", () => {
    expect(
      prependAcpPromptText(
        [{ type: "image", data: "abc", mimeType: "image/png" }],
        "Call list_automations.",
      ),
    ).toEqual([
      { type: "text", text: "Call list_automations." },
      { type: "image", data: "abc", mimeType: "image/png" },
    ]);
  });

  // Sad path - blank note leaves the prompt alone
  it("returns the original prompt when the note is blank", () => {
    const prompt = "Sabe criar automações?";
    expect(prependAcpPromptText(prompt, "  ")).toBe(prompt);
  });
});

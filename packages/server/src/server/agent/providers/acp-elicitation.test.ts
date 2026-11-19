import { describe, expect, it } from "vitest";
import { acpElicitationContent, readACPElicitation } from "./acp-elicitation";

const GRANT_REQUEST = {
  mode: "form",
  sessionId: "session-1",
  message: "Grant production SSH for 30 minutes?",
  requestedSchema: {
    type: "object",
    properties: {
      confirm: { type: "boolean", title: "Confirm", description: "Grant SSH access" },
      duration: {
        type: "string",
        title: "Duration",
        enum: ["30m", "1h"],
        oneOf: [
          { const: "30m", title: "30 minutes" },
          { const: "1h", title: "1 hour", description: "Longer session" },
        ],
      },
    },
    required: ["confirm", "duration"],
  },
};

describe("readACPElicitation", () => {
  it("maps a form request to cards the question UI can render", () => {
    const form = readACPElicitation(GRANT_REQUEST);
    expect(form?.questions).toEqual([
      {
        header: "Confirm",
        question: "Grant SSH access",
        options: [],
        multiSelect: false,
        allowOther: false,
        allowEmpty: true,
        type: "boolean",
      },
      {
        header: "Duration",
        question: "Duration",
        options: [{ label: "30 minutes" }, { label: "1 hour", description: "Longer session" }],
        multiSelect: false,
        allowOther: false,
        allowEmpty: false,
        type: "text",
      },
    ]);
  });

  it("maps a URL request to a link card", () => {
    const form = readACPElicitation({
      mode: "url",
      sessionId: "session-1",
      message: "Open this page to sign in",
      url: "https://example.com/auth",
      elicitationId: "elicit-1",
    });
    expect(form?.questions[0]).toMatchObject({
      type: "link",
      url: "https://example.com/auth",
    });
    expect(form?.urlMode).toBe("elicit-1");
  });

  it("rejects a request with no message", () => {
    expect(readACPElicitation({ mode: "form", sessionId: "s" })).toBeNull();
  });
});

describe("acpElicitationContent", () => {
  it("turns the card's labels back into schema values", () => {
    const form = readACPElicitation(GRANT_REQUEST);
    expect(form).not.toBeNull();
    expect(acpElicitationContent(form!, { Confirm: "true", Duration: "1 hour" })).toEqual({
      confirm: true,
      duration: "1h",
    });
  });

  it("keeps an unchecked box as false and ignores untouched optional fields", () => {
    const form = readACPElicitation(GRANT_REQUEST);
    expect(acpElicitationContent(form!, {})).toEqual({ confirm: false });
  });
});

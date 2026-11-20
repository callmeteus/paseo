import { describe, expect, it } from "vitest";
import { collapseRepeatedFailures, hidePendingQuestionRefusals } from "./repeated-failures";

const BILLING = "Add a payment method to continue";

function item(kind: string, text?: string) {
  return { kind, text };
}

describe("hidePendingQuestionRefusals", () => {
  const items = [
    item("assistant_message", "Esse pedido de grant voltou recusado."),
    item("assistant_message", "Trabalhou por 16s"),
  ];

  it("hides refusal text while a question card is pending", () => {
    expect(hidePendingQuestionRefusals(items, true).map((entry) => entry.text)).toEqual([
      "Trabalhou por 16s",
    ]);
  });

  it("leaves ordinary replies alone", () => {
    expect(hidePendingQuestionRefusals(items, false)).toEqual(items);
  });
});

describe("collapseRepeatedFailures", () => {
  it("keeps one card for a provider that prints the same failure on every retry", () => {
    const items = [
      item("user_message", "tenta mandar de novo por favor"),
      ...Array.from({ length: 9 }, () => item("assistant_message", BILLING)),
      item("assistant_message", "Done, the tests pass."),
    ];
    expect(collapseRepeatedFailures(items).map((entry) => entry.text)).toEqual([
      "tenta mandar de novo por favor",
      BILLING,
      "Done, the tests pass.",
    ]);
  });

  it("reports a new failure after a user message", () => {
    const items = [
      item("assistant_message", BILLING),
      item("user_message", "de novo"),
      item("assistant_message", BILLING),
    ];
    expect(collapseRepeatedFailures(items)).toHaveLength(3);
  });

  it("leaves ordinary replies alone, even when they repeat", () => {
    const items = [
      item("assistant_message", "Checking the build."),
      item("assistant_message", "Checking the build."),
    ];
    expect(collapseRepeatedFailures(items)).toHaveLength(2);
  });
});

import { SYSTEM_ERROR_PREFIX } from "@getpaseo/protocol/provider-error";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { ptBR } from "@/i18n/resources/pt-BR";
import { readProviderErrorText } from "./provider-error";
import { readSessionLimitNotice, sessionLimitWarning } from "./session-limit";

const PHRASE = "You've hit your session limit \u00b7 resets 12:40am (America/Sao_Paulo)";
const BILLING = "Add a payment method to continue";
const copy = ptBR.agentStream.sessionLimit;

function translate(key: string, params?: Record<string, unknown>): string {
  const templates: Record<string, string> = {
    "agentStream.sessionLimit.reached": copy.reached,
    "agentStream.sessionLimit.resetsAt": copy.resetsAt,
    "agentStream.sessionLimit.resetsRaw": copy.resetsRaw,
    "agentStream.sessionLimit.billing": copy.billing,
  };
  const template = templates[key];
  if (!template) {
    throw new Error(`missing copy for ${key}`);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""));
}

const t = translate as unknown as TFunction;

describe("sessionLimitWarning", () => {
  it("turns the provider sentence into a São Paulo warning at 00:40", () => {
    expect(sessionLimitWarning(PHRASE, t)).toBe(
      "A sessão deste modelo chegou no limite e volta às 00:40 no horário de São Paulo.",
    );
  });

  it("keeps noon and formats another zone from its city", () => {
    expect(
      sessionLimitWarning(
        "You've hit your session limit \u00b7 resets 12:40pm (America/Sao_Paulo)",
        t,
      ),
    ).toBe("A sessão deste modelo chegou no limite e volta às 12:40 no horário de São Paulo.");
    expect(
      sessionLimitWarning(
        "You've hit your session limit \u00b7 resets 1:05pm (America/New_York)",
        t,
      ),
    ).toBe("A sessão deste modelo chegou no limite e volta às 13:05 no horário de New York.");
    expect(
      sessionLimitWarning(
        "You've hit your session limit \u00b7 resets 4:05 am (America/New_York)",
        t,
      ),
    ).toBe("A sessão deste modelo chegou no limite e volta às 04:05 no horário de New York.");
  });

  it("shows the reset clause when the clock or the zone cannot be read", () => {
    expect(
      sessionLimitWarning("You've hit your session limit \u00b7 resets 12:40am (Not/A_Zone)", t),
    ).toBe("A sessão deste modelo chegou no limite e volta em 12:40am (Not/A_Zone).");
    expect(sessionLimitWarning("You've hit your session limit \u00b7 resets tomorrow", t)).toBe(
      "A sessão deste modelo chegou no limite e volta em tomorrow.",
    );
    expect(sessionLimitWarning("You've hit your session limit \u00b7 resets 12:40am", t)).toBe(
      "A sessão deste modelo chegou no limite e volta em 12:40am.",
    );
    expect(
      sessionLimitWarning(
        "You've hit your session limit \u00b7 resets 13:40pm (America/Sao_Paulo)",
        t,
      ),
    ).toBe("A sessão deste modelo chegou no limite e volta em 13:40pm (America/Sao_Paulo).");
  });

  it("does not invent a time when the line has no reset", () => {
    expect(sessionLimitWarning("You've hit your session limit", t)).toBe(
      "A sessão deste modelo chegou no limite.",
    );
  });

  it("turns Cursor's billing line into a plan-limit warning", () => {
    expect(sessionLimitWarning(BILLING, t)).toBe(
      "O limite do Cursor foi atingido. Adicione um método de pagamento para continuar.",
    );
    expect(sessionLimitWarning("Please add a payment method to continue.", t)).toBe(copy.billing);
    expect(sessionLimitWarning("Add a payment method to continue using Cursor", t)).toBe(
      copy.billing,
    );
    expect(
      sessionLimitWarning(
        "You've reached your free trial limit. Add a payment method to continue.",
        t,
      ),
    ).toBe(copy.billing);
    expect(sessionLimitWarning(`${SYSTEM_ERROR_PREFIX} ${BILLING}`, t)).toBe(copy.billing);
    expect(readSessionLimitNotice(BILLING)).toEqual({ kind: "billing", reset: null });
    expect(readSessionLimitNotice(PHRASE)).toEqual({
      kind: "session",
      reset: "12:40am (America/Sao_Paulo)",
    });
  });

  it("leaves a reply that mentions the billing line alone", () => {
    expect(sessionLimitWarning("I fixed it. Add a payment method to continue.", t)).toBeNull();
    expect(sessionLimitWarning(`${BILLING}\n\nThen restart the app.`, t)).toBeNull();
  });

  it("reads the same sentence from a system error, including the daemon tail", () => {
    const line = `${SYSTEM_ERROR_PREFIX} ${PHRASE}`;
    const withTail = `${line}\n\ncode: session_limit\n\ntry again later`;

    expect(sessionLimitWarning(line, t)).toBe(
      "A sessão deste modelo chegou no limite e volta às 00:40 no horário de São Paulo.",
    );
    expect(sessionLimitWarning(withTail, t)).toBe(
      "A sessão deste modelo chegou no limite e volta às 00:40 no horário de São Paulo.",
    );
    expect(sessionLimitWarning(withTail, t)).not.toContain("try again later");
  });

  it("leaves ordinary replies and prose about the limit alone", () => {
    expect(sessionLimitWarning("Implemented the endpoint.", t)).toBeNull();
    expect(
      sessionLimitWarning("You've hit your session limit before, so the next run should wait.", t),
    ).toBeNull();
    expect(sessionLimitWarning(`${PHRASE}\n\nWait until morning.`, t)).toBeNull();
    expect(sessionLimitWarning("You've reached your 5-hour usage limit", t)).toBeNull();
  });

  it("counts the sentence as a provider error so the timeline does not treat it as a reply", () => {
    expect(readProviderErrorText(PHRASE)).toBe(PHRASE);
    expect(readProviderErrorText(BILLING)).toBe(BILLING);
    expect(readProviderErrorText("Failed to authenticate: OAuth session expired")).toBe(
      "Failed to authenticate: OAuth session expired",
    );
    expect(readProviderErrorText("Implemented the endpoint.")).toBeNull();
  });
});

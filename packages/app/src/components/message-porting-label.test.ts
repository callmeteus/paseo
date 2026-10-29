import { describe, expect, it } from "vitest";

import { ptBR } from "@/i18n/resources/pt-BR";
import { getPortingMarkerLabel } from "./message-porting-label";

describe("getPortingMarkerLabel", () => {
  it("renders loading and completed labels", () => {
    expect(getPortingMarkerLabel({ status: "loading" })).toBe("Porting context...");
    expect(getPortingMarkerLabel({ status: "completed", provider: "Claude" })).toBe(
      "Context ported to Claude",
    );
  });

  it("ships translated labels in pt-BR", () => {
    expect(ptBR.message.porting.loading).toBe("Portando contexto...");
    expect(ptBR.message.porting.completed).toBe("Contexto portado para {{provider}}");
  });
});

import { describe, expect, it } from "vitest";

import { i18n } from "@/i18n/i18next";
import { formatThoughtDuration } from "./thought-text";

const shortLabelByLanguage = {
  en: "briefly",
  ar: "للحظة",
  es: "un instante",
  fr: "un instant",
  ja: "一瞬",
  ko: "잠시",
  "pt-BR": "um instante",
  ru: "ненадолго",
  "zh-CN": "片刻",
} as const;

describe("formatThoughtDuration", () => {
  it("omits a duration that was never measured", () => {
    expect(formatThoughtDuration(undefined, i18n.t)).toBeUndefined();
    expect(formatThoughtDuration(0, i18n.t)).toBeUndefined();
    expect(formatThoughtDuration(-1, i18n.t)).toBeUndefined();
  });

  it("shows whole seconds once the thought lasts at least half a second", () => {
    expect(formatThoughtDuration(500, i18n.t)).toBe("1s");
    expect(formatThoughtDuration(10_000, i18n.t)).toBe("10s");
    expect(formatThoughtDuration(34_000, i18n.t)).toBe("34s");
  });

  it("translates the short case that used to be the English word briefly", async () => {
    const previous = i18n.language;
    try {
      for (const [language, shortLabel] of Object.entries(shortLabelByLanguage)) {
        await i18n.changeLanguage(language);
        expect(formatThoughtDuration(499, i18n.t)).toBe(shortLabel);
        expect(formatThoughtDuration(10_000, i18n.t)).toBe("10s");
        if (language !== "en") {
          expect(shortLabel).not.toBe("briefly");
        }
      }

      await i18n.changeLanguage("pt-BR");
      const shortDuration = formatThoughtDuration(120, i18n.t);
      expect(`${i18n.t("toolCallGroup.thought")} ${shortDuration}`).toBe("Pensei um instante");
      expect(`${i18n.t("toolCallGroup.thought")} ${formatThoughtDuration(10_000, i18n.t)}`).toBe(
        "Pensei 10s",
      );
    } finally {
      await i18n.changeLanguage(previous);
    }
  });
});

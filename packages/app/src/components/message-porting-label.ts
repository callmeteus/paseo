import { i18n } from "@/i18n/i18next";

export interface PortingMarkerLabelInput {
  status: "loading" | "completed";
  provider?: string;
}

export function getPortingMarkerLabel({ status, provider }: PortingMarkerLabelInput): string {
  if (status === "loading") return i18n.t("message.porting.loading");
  if (provider) {
    return i18n.t("message.porting.completed", { provider });
  }
  return i18n.t("message.porting.completed", { provider: "" });
}

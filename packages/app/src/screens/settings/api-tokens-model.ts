export const API_TOKEN_NAME_MAX_LENGTH = 80;

export function validateApiTokenName(value: string, t: (key: string) => string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t("common.errors.nameRequired");
  if (trimmed.length > API_TOKEN_NAME_MAX_LENGTH) {
    return t("settings.host.apiTokens.nameTooLong");
  }
  return null;
}

export function formatApiTokenCreatedAt(value: string, locale?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

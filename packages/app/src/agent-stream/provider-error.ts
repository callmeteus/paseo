import {
  classifyProviderError,
  isSystemErrorText,
  looksLikeProviderFailureText,
  readProviderErrorText as readClassifiedProviderErrorText,
  SYSTEM_ERROR_PREFIX,
  systemErrorMessage,
} from "@getpaseo/protocol/provider-error";
import type { ProviderErrorKind } from "@getpaseo/protocol/provider-error";
import { readSessionLimitNotice } from "./session-limit";

export {
  SYSTEM_ERROR_PREFIX,
  classifyProviderError,
  isSystemErrorText,
  looksLikeProviderFailureText,
  systemErrorMessage,
};
export type { ProviderErrorKind };

/**
 * Session-limit lines are provider failures. The shared classifier misses them,
 * so the timeline asks `readSessionLimitNotice` before treating the text as a reply.
 */
export function readProviderErrorText(text: string): string | null {
  if (readSessionLimitNotice(text)) {
    return systemErrorMessage(text).trim();
  }
  return readClassifiedProviderErrorText(text);
}

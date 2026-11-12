/** Thrown when a prompt reaches a plugin session whose connection died with its plugin. */
export class StaleProviderSessionError extends Error {
  constructor(sessionId: string) {
    super(`Provider session ${sessionId} is stale after its plugin reloaded`);
    this.name = "StaleProviderSessionError";
  }
}

export function isStaleProviderSessionError(error: unknown): error is StaleProviderSessionError {
  return error instanceof StaleProviderSessionError;
}

/** Thrown when a prompt reaches a provider runtime that has already shut down. */
export class ClosedProviderSessionError extends Error {
  constructor(provider: string) {
    super(`${provider} session is closed`);
    this.name = "ClosedProviderSessionError";
  }
}

export function isClosedProviderSessionError(error: unknown): boolean {
  if (error instanceof ClosedProviderSessionError) return true;
  return error instanceof Error && /session is closed$/i.test(error.message.trim());
}

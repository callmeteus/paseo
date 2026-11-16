import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { ProviderErrorKind } from "@getpaseo/protocol/provider-error";

type TranslateKey = string;

export interface ProviderErrorCopy {
  title: TranslateKey;
  description: TranslateKey;
}

const KIND_KEYS: Record<ProviderErrorKind, ProviderErrorCopy> = {
  usage_limit: {
    title: "agentStream.providerError.kinds.usageLimit.title",
    description: "agentStream.providerError.kinds.usageLimit.description",
  },
  credits_exhausted: {
    title: "agentStream.providerError.kinds.creditsExhausted.title",
    description: "agentStream.providerError.kinds.creditsExhausted.description",
  },
  auth: {
    title: "agentStream.providerError.kinds.auth.title",
    description: "agentStream.providerError.kinds.auth.description",
  },
  rate_limit: {
    title: "agentStream.providerError.kinds.rateLimit.title",
    description: "agentStream.providerError.kinds.rateLimit.description",
  },
  model_unavailable: {
    title: "agentStream.providerError.kinds.modelUnavailable.title",
    description: "agentStream.providerError.kinds.modelUnavailable.description",
  },
  crash: {
    title: "agentStream.providerError.kinds.crash.title",
    description: "agentStream.providerError.kinds.crash.description",
  },
  unknown: {
    title: "agentStream.providerError.kinds.unknown.title",
    description: "agentStream.providerError.kinds.unknown.description",
  },
};

const CLINE_USAGE_LIMIT: ProviderErrorCopy = {
  title: "agentStream.providerError.providers.cline.usageLimit.title",
  description: "agentStream.providerError.providers.cline.usageLimit.description",
};

const OPENCODE_PLAN_USAGE_LIMIT: ProviderErrorCopy = {
  title: "agentStream.providerError.providers.opencode.usageLimit.title",
  description: "agentStream.providerError.providers.opencode.usageLimit.description",
};

const OPENCODE_GO_USAGE_LIMIT: ProviderErrorCopy = {
  title: "agentStream.providerError.providers.opencode.goUsageLimit.title",
  description: "agentStream.providerError.providers.opencode.goUsageLimit.description",
};

export function isOpencodeGoModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const normalized = modelId.toLowerCase();
  return normalized.includes("opencode-go") || normalized.includes("opencode/go");
}

function errorMentionsOpencodeGo(message: string): boolean {
  return /opencode\s*go/i.test(message);
}

export function resolveProviderErrorCopy(input: {
  provider?: AgentProvider;
  kind: ProviderErrorKind;
  message: string;
  modelId?: string | null;
}): ProviderErrorCopy {
  if (input.provider === "cline" && input.kind === "usage_limit") {
    return CLINE_USAGE_LIMIT;
  }
  if (input.provider === "opencode" && input.kind === "usage_limit") {
    const onGoModel = isOpencodeGoModel(input.modelId);
    if (onGoModel) return OPENCODE_GO_USAGE_LIMIT;
    if (errorMentionsOpencodeGo(input.message) && !onGoModel) {
      return OPENCODE_PLAN_USAGE_LIMIT;
    }
    return OPENCODE_PLAN_USAGE_LIMIT;
  }
  return KIND_KEYS[input.kind];
}

export function providerErrorOffersModelSwitch(kind: ProviderErrorKind): boolean {
  return (
    kind === "usage_limit" ||
    kind === "rate_limit" ||
    kind === "credits_exhausted" ||
    kind === "model_unavailable"
  );
}

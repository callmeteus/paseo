import type { ModelRouter } from "@getpaseo/protocol/model-router";
import { MODEL_ICON_LABELS, MODEL_ICON_SVGS, type ModelIconId } from "@/model-icons/icons";

/**
 * First match wins. A narrower family stays above the brand it would otherwise
 * hit, such as Nemotron before Llama and an image Gemini before Gemini.
 */
const MODEL_ICON_RULES: readonly { id: ModelIconId; keywords: readonly string[] }[] = [
  { id: "sora", keywords: ["sora"] },
  { id: "dalle", keywords: ["dalle", "dall-e"] },
  {
    id: "openai",
    keywords: [
      "gpt-3",
      "gpt-4",
      "gpt-5",
      "gpt-oss",
      "o1-",
      "^o1",
      "/o1",
      "-o1",
      "o3-",
      "^o3",
      "/o3",
      "-o3",
      "o4-",
      "^o4",
      "/o4",
      "-o4",
      "text-embedding-",
      "tts-",
      "whisper-",
      "codex",
      "davinci",
      "babbage",
      "omni-moderation",
      "text-moderation",
      "text-ada",
      "computer-use",
      "^gpt-",
      "/gpt-",
      "gpt-",
      "(?:^|[^a-z0-9])gpt(?:[^a-z]|$)",
      "openai",
      "chatgpt",
    ],
  },
  { id: "glmv", keywords: ["^glm-(.*)v", "/glm-(.*)v", "-glm-(.*)v"] },
  {
    id: "zai",
    keywords: [
      "^glm-5",
      "/glm-5",
      "/glm5",
      "-glm-4",
      "^glm-4",
      "/glm-4",
      "/glm4",
      "-glm-5",
      "z-ai",
    ],
  },
  { id: "chatglm", keywords: ["^glm-", "/glm-", "chatglm", "-glm-"] },
  { id: "codegeex", keywords: ["^codegeex", "/codegeex"] },
  { id: "claude", keywords: ["claude"] },
  { id: "anthropic", keywords: ["anthropic"] },
  { id: "aws", keywords: ["titan"] },
  { id: "fireworks", keywords: ["accounts/fireworks/models/fire"] },
  { id: "internlm", keywords: ["internlm", "internvl"] },
  { id: "nousresearch", keywords: ["deephermes", "hermes", "genstruct", "minos"] },
  { id: "nvidia", keywords: ["nemotron", "openreasoning", "nemoretriever", "neva-", "nv-"] },
  { id: "meta", keywords: ["llama", "/l3"] },
  { id: "llava", keywords: ["llava"] },
  {
    id: "nanobanana",
    keywords: [
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
      "gemini-\\d+(?:\\.\\d+)?-(?:flash(?:-lite)?|pro)-image(?:-preview)?(?::|$)",
      "nanobanana",
      "nano-banana",
    ],
  },
  { id: "gemini", keywords: ["gemini"] },
  { id: "deepmind", keywords: ["^imagen-", "/imagen-", "^imagen\\d/", "/imagen\\d"] },
  { id: "gemma", keywords: ["gemma"] },
  { id: "kimi", keywords: ["kimi", "moonshot"] },
  { id: "qiniu", keywords: ["qiniu"] },
  {
    id: "qwen",
    keywords: ["qwen", "qwq", "qvq", "wanx", "wan\\d/", "wan\\d\\.\\d-", "tongyi", "gte-rerank"],
  },
  { id: "minimax", keywords: ["minimax", "abab"] },
  {
    id: "mistral",
    keywords: [
      "mistral",
      "mixtral",
      "codestral",
      "mathstral",
      "/mn-",
      "pixtral",
      "ministral",
      "magistral",
      "devstral",
      "voxtral",
    ],
  },
  { id: "perplexity", keywords: ["pplx", "sonar"] },
  { id: "yi", keywords: ["^yi-", "/yi-", "-yi-", "(?:^|[^a-z0-9])yi(?:[^a-z0-9]|$)"] },
  { id: "openrouter", keywords: ["^openrouter"] },
  { id: "relace", keywords: ["^relace-", "/relace-"] },
  {
    id: "arcee",
    keywords: [
      "^trinity-",
      "/trinity-",
      "afm-4.5b",
      "caller-large",
      "spotlight",
      "maestro-reasoning",
      "virtuoso-medium-v2",
      "virtuoso-large",
      "coder-large",
      "arcee-blitz",
    ],
  },
  { id: "essentialai", keywords: ["^rnj-", "/rnj-"] },
  { id: "deepcogito", keywords: ["^deepcogito-", "/deepcogito-", "^cogito-", "/cogito-"] },
  { id: "morph", keywords: ["^morph-", "/morph-"] },
  { id: "ai2", keywords: ["^olmo-", "/olmo-", "olmo"] },
  { id: "inception", keywords: ["^mercury", "/mercury"] },
  { id: "openchat", keywords: ["^openchat"] },
  {
    id: "cohere",
    keywords: ["(?:^|[^a-z0-9])command(?:[^a-z0-9]|$)", "(?:^|[^a-z0-9])aya(?:[^a-z0-9]|$)"],
  },
  { id: "dbrx", keywords: ["dbrx"] },
  { id: "ace", keywords: ["ace-step"] },
  { id: "stepfun", keywords: ["stepfun", "(?:^|[^a-z0-9])step(?:[^a-z0-9]|$)"] },
  { id: "aimass", keywords: ["taichu"] },
  { id: "ai360", keywords: ["360gpt", "360zhinao"] },
  { id: "baichuan", keywords: ["baichuan"] },
  { id: "rwkv", keywords: ["rwkv", "/eagle-"] },
  { id: "wenxin", keywords: ["ernie", "irag"] },
  { id: "jina", keywords: ["^jina", "/jina"] },
  { id: "jimeng", keywords: ["^jimeng-", "/jimeng-", "seedream", "seededit", "seedance-"] },
  { id: "doubao", keywords: ["doubao-"] },
  { id: "kling", keywords: ["^kling", "kling-", "klingai"] },
  { id: "hunyuan", keywords: ["hunyuan", "hy3", "hy4"] },
  { id: "bytedance", keywords: ["skylark", "seed-", "bytedance"] },
  { id: "burncloud", keywords: ["burncloud"] },
  {
    id: "stability",
    keywords: [
      "stable-diffusion",
      "stable-video",
      "stable-cascade",
      "sdxl",
      "stablelm",
      "^stable-",
      "^sd3",
      "^sd2",
      "^sd1",
    ],
  },
  { id: "flux", keywords: ["flux"] },
  { id: "suno", keywords: ["suno"] },
  {
    id: "microsoft",
    keywords: [
      "wizardlm",
      "/phi-",
      "^phi-",
      "-phi-",
      "(?:^|[^a-z0-9])phi(?:[^a-z]|$)",
      "mai-",
      "microsoft",
    ],
  },
  { id: "ai21", keywords: ["jamba", "^j2-", "ai21"] },
  { id: "upstage", keywords: ["^solar-", "/solar"] },
  { id: "palm", keywords: ["palm"] },
  { id: "sensenova", keywords: ["sensechat", "sensenova"] },
  { id: "xai", keywords: ["grok"] },
  { id: "ideogram", keywords: ["ideogram"] },
  { id: "muse", keywords: ["(^|/)muse-(spark|wonder|image|video)($|-)"] },
  { id: "spark", keywords: ["spark"] },
  { id: "udio", keywords: ["udio"] },
  { id: "unionalpha", keywords: ["union-alpha", "unionalpha", "pareto"] },
  { id: "deepseek", keywords: ["deepseek"] },
  { id: "voyage", keywords: ["voyage"] },
  { id: "assemblyai", keywords: ["assemblyai"] },
  { id: "liquid", keywords: ["liquid", "lfm"] },
  { id: "inflection", keywords: ["inflection-"] },
  { id: "aionlabs", keywords: ["aion-"] },
  { id: "aihubmix", keywords: ["aihubmix"] },
  { id: "v0", keywords: ["^v0-"] },
  { id: "vertexai", keywords: ["^veo-", "/veo-", "^veo3"] },
  { id: "google", keywords: ["google", "learnlm"] },
  { id: "zhipu", keywords: ["cogview", "zhipu"] },
  { id: "kolors", keywords: ["kolors"] },
  { id: "baiducloud", keywords: ["baidu", "qianfan"] },
  { id: "phind", keywords: ["phind"] },
  { id: "dolphin", keywords: ["dolphin"] },
  { id: "ibm", keywords: ["ibm", "granite"] },
  { id: "skywork", keywords: ["skywork"] },
  { id: "bilibiliindex", keywords: ["bilibili-index", "index-tts"] },
  { id: "bilibili", keywords: ["bilibili"] },
  { id: "lg", keywords: ["kmmlu", "exaone", "lgai"] },
  { id: "tii", keywords: ["falcon"] },
  { id: "menlo", keywords: ["menlo", "(?:^|[^a-z0-9])lucy(?:[^a-z0-9]|$)", "jan-nano"] },
  { id: "longcat", keywords: ["longcat"] },
  { id: "kwaipilot", keywords: ["kat-"] },
  { id: "nova", keywords: ["^nova-", "/nova-", "(?:^|[^a-z0-9])nova(?:[^a-z]|$)"] },
  { id: "xiaomimimo", keywords: ["^mimo-", "/mimo-", "mimo"] },
  { id: "baai", keywords: ["^baai", "^bge-", "/bge-", "touchd", "robobrain"] },
  { id: "cursor", keywords: ["^composer", "/composer", "-composer"] },
  { id: "typesafeai", keywords: ["(^|/)jev($|-)", "typesafe"] },
];

const REGEX_KEYWORD = /[\\^$()[\]|+*?]/;

interface CompiledRule {
  id: ModelIconId;
  tests: readonly ((value: string) => boolean)[];
}

function compileKeyword(keyword: string): (value: string) => boolean {
  if (!REGEX_KEYWORD.test(keyword)) {
    const needle = keyword.toLowerCase();
    return (value) => value.toLowerCase().includes(needle);
  }
  const expression = new RegExp(keyword, "i");
  if (!keyword.startsWith("^")) {
    return (value) => expression.test(value);
  }
  return (value) => {
    if (expression.test(value)) return true;
    const segments = value.split(/[\s/]+/);
    for (const segment of segments) {
      if (expression.test(segment)) return true;
    }
    return false;
  };
}

const COMPILED_RULES: readonly CompiledRule[] = MODEL_ICON_RULES.map((rule) => ({
  id: rule.id,
  tests: rule.keywords.map(compileKeyword),
}));

export interface ModelIconChoice {
  id: ModelIconId;
  label: string;
}

export function isModelIconId(value: string): value is ModelIconId {
  return Object.hasOwn(MODEL_ICON_SVGS, value);
}

export function listModelIcons(): ModelIconChoice[] {
  const icons = Object.keys(MODEL_ICON_SVGS)
    .filter(isModelIconId)
    .map((id) => ({
      id,
      label: MODEL_ICON_LABELS[id],
    }));
  icons.sort(
    (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  );
  return icons;
}

function matchRule(rule: CompiledRule, haystack: string): boolean {
  for (const test of rule.tests) {
    if (test(haystack)) return true;
  }
  return false;
}

/** Brand mark for a model id and label. Null when the catalog has no family for it. */
export function resolveModelIconId(input: {
  id: string;
  label?: string | null;
}): ModelIconId | null {
  const id = input.id.trim();
  const label = input.label?.trim() ?? "";
  const haystack = label.length > 0 && label !== id ? `${id} ${label}` : id;
  if (!haystack) return null;
  for (const rule of COMPILED_RULES) {
    if (matchRule(rule, haystack)) return rule.id;
  }
  return null;
}

type RouterIconSource = Pick<ModelRouter, "name" | "targets"> & { icon?: string | null };

/** Stored router mark, or the mark of its name and targets when the router leaves it unset. */
export function resolveRouterIconId(router: RouterIconSource): ModelIconId | null {
  if (router.icon && isModelIconId(router.icon)) return router.icon;
  const fromName = resolveModelIconId({ id: router.name });
  if (fromName) return fromName;
  for (const target of router.targets) {
    const fromTarget = resolveModelIconId({ id: target.model ?? "" });
    if (fromTarget) return fromTarget;
  }
  return null;
}

/** Router mark while a router is selected, otherwise the selected model's mark. */
export function resolveChoiceIconId(input: {
  modelId: string;
  modelLabel?: string | null;
  router?: RouterIconSource | null;
}): ModelIconId | null {
  if (input.router) {
    const routerIcon = resolveRouterIconId(input.router);
    if (routerIcon) return routerIcon;
  }
  return resolveModelIconId({ id: input.modelId, label: input.modelLabel });
}

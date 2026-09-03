// ─── Model Catalog ─────────────────────────────────────────
// A curated database of known models with their full capabilities,
// so users don't have to look up context window / max tokens / reasoning / vision / cost
// every time they add a model to a custom provider.
//
// Costs are in USD per 1M tokens. For providers whose pricing differs
// from the vendor (e.g. resellers), users can override cost in the form.

/**
 * 本机 Pi 供应商面板的模型目录(移植自 pi-web-switch `src/data/model-catalog.ts`,
 * 2026-09-03 快照,主体与上游逐字节对齐 —— 上游加模型时整个文件再同步一次即可,
 * 仅本头注与下方内联类型是 Cindy 侧的适配)。
 *
 * 用途:「快捷添加」输入一个模型 id 时自动识别参数 —— 目录精确/家族匹配 →
 * id 关键字启发式 → 调用方兜底。用户不用再查上下文窗口 / 最大输出 / 推理 /
 * 视觉 / 价格。
 *
 * 渲染层纯数据模块:不 import 任何 Cindy 模块,类型内联,方便与 pws 同步。
 */

/** pi models.json 的模型元数据形状(只列目录用到的字段)。 */
interface Model {
  id?: string;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image' | 'audio')[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}


export interface CatalogEntry {
  // Match patterns: tried in order, first match wins on id (case-insensitive)
  patterns: string[];
  // Real, callable API model id used when prefilling the form. Patterns are
  // match prefixes/aliases and are not always a usable id (e.g. "qwen3-"), so
  // entries whose first pattern is not callable must set this explicitly.
  apiId?: string;
  // Filled-in model meta
  name?: string;
  reasoning?: boolean;
  input?: Model["input"];
  contextWindow: number;
  maxTokens: number;
  cost?: Model["cost"];
  // Optional tag shown in the catalog picker
  family?: string;
}

// ─── Helpers ────────────────────────────────────────────────

const P = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
});

// ─── Catalog ────────────────────────────────────────────────
// Ordered roughly by popularity; more specific patterns first.

export const MODEL_CATALOG: CatalogEntry[] = [
  // ── Anthropic Claude ────────────────────────────────────
  // Source: platform.claude.com/docs/en/about-claude/pricing +
  // .../models/overview. cacheWrite = 5-minute cache write price.
  {
    patterns: ["claude-fable-5"],
    name: "Claude Fable 5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(10, 50, 1, 12.5),
    family: "Anthropic",
  },
  {
    patterns: ["claude-opus-5"],
    name: "Claude Opus 5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(5, 25, 0.5, 6.25),
    family: "Anthropic",
  },
  {
    patterns: ["claude-sonnet-5"],
    name: "Claude Sonnet 5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(2, 10, 0.2, 2.5),
    family: "Anthropic",
  },
  {
    patterns: ["claude-opus-4-8", "claude-4-8-opus"],
    name: "Claude Opus 4.8",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(5, 25, 0.5, 6.25),
    family: "Anthropic",
  },
  {
    patterns: ["claude-opus-4-7", "claude-4-7-opus"],
    name: "Claude Opus 4.7",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(5, 25, 0.5, 6.25),
    family: "Anthropic",
  },
  {
    patterns: ["claude-opus-4-6", "claude-4-6-opus"],
    name: "Claude Opus 4.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(5, 25, 0.5, 6.25),
    family: "Anthropic",
  },
  {
    patterns: ["claude-sonnet-4-6", "claude-4-6-sonnet"],
    name: "Claude Sonnet 4.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-opus-4-5", "claude-4-5-opus"],
    name: "Claude Opus 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 65_536,
    cost: P(5, 25, 0.5, 6.25),
    family: "Anthropic",
  },
  {
    patterns: ["claude-sonnet-4-5", "claude-4-5-sonnet"],
    name: "Claude Sonnet 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 65_536,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-haiku-4-5", "claude-4-5-haiku"],
    name: "Claude Haiku 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 65_536,
    cost: P(1, 5, 0.1, 1.25),
    family: "Anthropic",
  },
  // Retired on the first-party API, still reachable on Bedrock / Google Cloud.
  {
    patterns: ["claude-opus-4-1", "claude-opus-4", "claude-4-opus"],
    apiId: "claude-opus-4-1",
    name: "Claude Opus 4.1",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_000,
    cost: P(15, 75, 1.5, 18.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-sonnet-4", "claude-4-sonnet"],
    name: "Claude Sonnet 4",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 65_536,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-3-7-sonnet", "claude-3.7-sonnet"],
    name: "Claude Sonnet 3.7",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 65_536,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-haiku-3-5", "claude-3-5-haiku", "claude-3.5-haiku"],
    apiId: "claude-3-5-haiku-latest",
    name: "Claude Haiku 3.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: P(0.8, 4, 0.08, 1),
    family: "Anthropic",
  },

  // ── OpenAI / GPT ────────────────────────────────────────
  // Source: developers.openai.com/api/docs/pricing (short-context column)
  // and the per-model doc pages for context / max output.
  {
    patterns: ["gpt-5.6-sol", "gpt-5.6"],
    apiId: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: P(4, 20, 0.4, 5),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-5.6-terra"],
    name: "GPT-5.6 Terra",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: P(2, 12, 0.2, 2.5),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-5.6-luna"],
    name: "GPT-5.6 Luna",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: P(0.2, 1.2, 0.02, 0.25),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-5.1", "gpt-5-1"],
    name: "GPT-5.1",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 128_000,
    cost: P(1.25, 10, 0.125, 0),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-5", "gpt5"],
    name: "GPT-5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 128_000,
    cost: P(1.25, 10, 0.125, 0),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4.1-mini", "gpt-4-1-mini"],
    name: "GPT-4.1 Mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_047_576,
    maxTokens: 32_768,
    cost: P(0.4, 1.6, 0.1, 0),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4.1", "gpt-4-1"],
    name: "GPT-4.1",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_047_576,
    maxTokens: 32_768,
    cost: P(2, 8, 0.5, 0),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4o-mini"],
    name: "GPT-4o Mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: P(0.15, 0.6, 0.075, 0),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4o"],
    name: "GPT-4o",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: P(2.5, 10, 1.25, 0),
    family: "OpenAI",
  },
  {
    patterns: ["o3-pro"],
    name: "o3-pro",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(20, 80),
    family: "OpenAI",
  },
  {
    patterns: ["o3-mini"],
    name: "o3-mini",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(1.1, 4.4, 0.55, 0),
    family: "OpenAI",
  },
  {
    patterns: ["o3"],
    name: "o3",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(2, 8, 0.5, 0),
    family: "OpenAI",
  },
  {
    patterns: ["o4-mini"],
    name: "o4-mini",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(1.1, 4.4, 0.275, 0),
    family: "OpenAI",
  },
  {
    patterns: ["o1"],
    name: "o1",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(15, 60),
    family: "OpenAI",
  },

  // ── DeepSeek ────────────────────────────────────────────
  // Source: api-docs.deepseek.com/quick_start/pricing (PEAK rates;
  // off-peak is 50% off). Context 1M, max output 384K for all V4 models.
  {
    patterns: ["deepseek-v4-flash-vision-exp"],
    name: "DeepSeek V4 Flash Vision (Exp)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(0.44, 1.32, 0.014, 0),
    family: "DeepSeek",
  },
  {
    patterns: ["deepseek-v4-flash", "deepseek-v4-chat", "deepseek-v4"],
    apiId: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(0.44, 1.32, 0.014, 0),
    family: "DeepSeek",
  },
  {
    patterns: ["deepseek-v4-pro"],
    name: "DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(1.32, 3.96, 0.044, 0),
    family: "DeepSeek",
  },
  // deepseek-chat / deepseek-reasoner were retired 2026-07-24; kept so an
  // existing config that still references them shows correct metadata.
  {
    patterns: ["deepseek-reasoner", "deepseek-r1"],
    name: "DeepSeek R1 (retired)",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 8192,
    cost: P(0.55, 2.19, 0.14, 0),
    family: "DeepSeek",
  },
  {
    patterns: ["deepseek-chat", "deepseek-v3"],
    name: "DeepSeek V3 (retired)",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 8192,
    cost: P(0.27, 1.1, 0.07, 0),
    family: "DeepSeek",
  },

  // ── Google Gemini ───────────────────────────────────────
  // Source: ai.google.dev/gemini-api/docs/pricing (paid tier, standard,
  // <=200k prompt tier where tiered). Output price includes thinking tokens.
  {
    patterns: ["gemini-3.1-pro"],
    name: "Gemini 3.1 Pro",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(2, 12, 0.2, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-3.7-flash"],
    name: "Gemini 3.7 Flash",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.75, 3.75, 0, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-3.6-flash"],
    name: "Gemini 3.6 Flash",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.75, 3.75, 0, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-3.5-flash-lite"],
    name: "Gemini 3.5 Flash-Lite",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.3, 2.5, 0, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-3.5-flash"],
    name: "Gemini 3.5 Flash",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(1.5, 9, 0, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-3.1-flash-lite"],
    name: "Gemini 3.1 Flash-Lite",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.25, 1.5, 0, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-3-flash"],
    name: "Gemini 3 Flash",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.5, 3, 0, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-2.5-pro"],
    name: "Gemini 2.5 Pro",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(1.25, 10, 0.125, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-2.5-flash"],
    name: "Gemini 2.5 Flash",
    reasoning: true,
    input: ["text", "image", "audio"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.3, 2.5, 0.03, 0),
    family: "Google",
  },
  {
    patterns: ["gemini-2.0-flash"],
    name: "Gemini 2.0 Flash",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 8192,
    cost: P(0.1, 0.4, 0.025, 0),
    family: "Google",
  },

  // ── Alibaba Qwen ────────────────────────────────────────
  // Source: alibabacloud.com/help/en/model-studio/model-pricing
  // (international endpoint, USD list price) + per-model context pages.
  // Entries without `cost` have no published international list price we
  // could verify — fill the price in the form.
  {
    patterns: ["qwen3.8-max", "qwen-3.8-max"],
    name: "Qwen3.8 Max",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    cost: P(2, 6, 0.25, 2.5),
    family: "Qwen",
  },
  {
    patterns: ["qwen3.7-max", "qwen-3.7-max"],
    name: "Qwen3.7 Max",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 65_536,
    cost: P(2.5, 7.5, 0, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen3-max", "qwen-3-max"],
    name: "Qwen3 Max",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 65_536,
    cost: P(1.2, 6, 0.24, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen3-coder-plus", "qwen3-coder"],
    apiId: "qwen3-coder-plus",
    name: "Qwen3 Coder Plus",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    cost: P(1, 5, 0.1, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen3.7-plus", "qwen-3.7-plus"],
    name: "Qwen3.7 Plus",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    cost: P(0.4, 1.6, 0, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen3-vl-plus", "qwen3-vl"],
    apiId: "qwen3-vl-plus",
    name: "Qwen3 VL Plus",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 131_072,
    maxTokens: 32_768,
    cost: P(0.14, 1.43, 0, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen-plus"],
    name: "Qwen Plus",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    cost: P(0.4, 1.2, 0, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen-turbo"],
    name: "Qwen Turbo",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 16_384,
    cost: P(0.05, 0.2, 0, 0),
    family: "Qwen",
  },
  {
    patterns: ["qwen-max"],
    name: "Qwen Max",
    reasoning: false,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 8192,
    cost: P(1.6, 6.4, 0, 0),
    family: "Qwen",
  },

  // ── Zhipu GLM ───────────────────────────────────────────
  // Source: docs.z.ai/guides/overview/pricing (USD) and
  // docs.z.ai/guides/overview/concept-param (max_tokens ceilings).
  {
    patterns: ["glm-5.3"],
    name: "GLM-5.3",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(1.4, 4.4, 0.26, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-5.2"],
    name: "GLM-5.2",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(1.4, 4.4, 0.26, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-5.1"],
    name: "GLM-5.1",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(1.4, 4.4, 0.26, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-5-turbo"],
    name: "GLM-5-Turbo",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(1.2, 4, 0.24, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-5v-turbo"],
    name: "GLM-5V-Turbo",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(1.2, 4, 0.24, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-5"],
    name: "GLM-5",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(1, 3.2, 0.2, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.7-flashx"],
    name: "GLM-4.7-FlashX",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(0.07, 0.4, 0.01, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.7-flash"],
    name: "GLM-4.7-Flash (Free)",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(0, 0, 0, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.7"],
    name: "GLM-4.7",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(0.6, 2.2, 0.11, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.6v"],
    name: "GLM-4.6V (Vision)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 65_536,
    maxTokens: 32_768,
    cost: P(0.3, 0.9, 0.05, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.6"],
    name: "GLM-4.6",
    reasoning: true,
    input: ["text"],
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: P(0.6, 2.2, 0.11, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.5-airx"],
    name: "GLM-4.5-AirX",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(1.1, 4.5, 0.22, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.5-air"],
    name: "GLM-4.5-Air",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(0.2, 1.1, 0.03, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.5-x"],
    name: "GLM-4.5-X",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(2.2, 8.9, 0.45, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.5-flash"],
    name: "GLM-4.5-Flash (Free)",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(0, 0, 0, 0),
    family: "GLM",
  },
  {
    patterns: ["glm-4.5", "glm-z1"],
    apiId: "glm-4.5",
    name: "GLM-4.5",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(0.6, 2.2, 0.11, 0),
    family: "GLM",
  },

  // ── Moonshot Kimi ───────────────────────────────────────
  // Source: platform.kimi.com/docs/models + /docs/pricing/chat. USD figures
  // follow the vendor's own CNY→USD ratio for K2.6 (¥6.5→$0.95, ¥27→$4.00).
  // kimi-latest retired 2026-01-28; moonshot-v1-* retires 2026-08-31.
  {
    patterns: ["kimi-k3"],
    name: "Kimi K3",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    cost: P(2.92, 14.8, 0.29, 0),
    family: "Moonshot",
  },
  {
    patterns: ["kimi-k2.7-code-highspeed"],
    name: "Kimi K2.7 Code Highspeed",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 98_304,
    cost: P(0.95, 4, 0.19, 0),
    family: "Moonshot",
  },
  {
    patterns: ["kimi-k2.7-code"],
    name: "Kimi K2.7 Code",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 98_304,
    cost: P(0.95, 4, 0.19, 0),
    family: "Moonshot",
  },
  {
    patterns: ["kimi-k2.6-thinking"],
    name: "Kimi K2.6 Thinking",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262_144,
    maxTokens: 98_304,
    cost: P(0.95, 4, 0.16, 0),
    family: "Moonshot",
  },
  {
    patterns: ["kimi-k2.6", "kimi-k2-6"],
    apiId: "kimi-k2.6",
    name: "Kimi K2.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262_144,
    maxTokens: 98_304,
    cost: P(0.95, 4, 0.16, 0),
    family: "Moonshot",
  },

  // ── xAI Grok ────────────────────────────────────────────
  // Source: docs.x.ai/developers/models (<200k prompt tier).
  {
    patterns: ["grok-4.6"],
    name: "Grok 4.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 500_000,
    maxTokens: 131_072,
    cost: P(2, 6, 0.5, 0),
    family: "Grok",
  },
  {
    patterns: ["grok-4.5"],
    name: "Grok 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 500_000,
    maxTokens: 131_072,
    cost: P(2, 6, 0.3, 0),
    family: "Grok",
  },
  {
    patterns: ["grok-4.3"],
    name: "Grok 4.3",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    cost: P(1.25, 2.5, 0.2, 0),
    family: "Grok",
  },

  // ── MiniMax ─────────────────────────────────────────────
  // Source: platform.minimax.io docs (context) + published USD rates.
  {
    patterns: ["minimax-m3", "MiniMax-M3"],
    apiId: "MiniMax-M3",
    name: "MiniMax M3",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(0.3, 1.2, 0.06, 0),
    family: "MiniMax",
  },
  {
    patterns: ["minimax-m2.7", "MiniMax-M2.7"],
    apiId: "MiniMax-M2.7",
    name: "MiniMax M2.7",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 131_072,
    cost: P(0.3, 1.2, 0.06, 0),
    family: "MiniMax",
  },
  {
    patterns: ["minimax-m2.5", "MiniMax-M2.5"],
    apiId: "MiniMax-M2.5",
    name: "MiniMax M2.5",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 131_072,
    cost: P(0.3, 1.2, 0.06, 0),
    family: "MiniMax",
  },
  {
    patterns: ["minimax-m2", "MiniMax-M2"],
    apiId: "MiniMax-M2",
    name: "MiniMax M2",
    reasoning: true,
    input: ["text"],
    contextWindow: 196_608,
    maxTokens: 131_072,
    cost: P(0.3, 1.2, 0.06, 0),
    family: "MiniMax",
  },

  // ── ByteDance Doubao ────────────────────────────────────
  // Volcengine Ark. Prices vary by input-length tier; these are the
  // entry-tier rates. Verify in the Ark console for your account.
  {
    patterns: ["doubao-seed-1-6", "doubao-seed-1.6", "doubao-seed"],
    apiId: "doubao-seed-1-6",
    name: "Doubao Seed 1.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262_144,
    maxTokens: 32_768,
    cost: P(0.113, 1.13, 0.023, 0),
    family: "Doubao",
  },

  // ── Baidu ERNIE ─────────────────────────────────────────
  // Source: cloud.baidu.com/doc/qianfan-docs (CNY per 1K tokens,
  // converted at 7.1 CNY/USD; entry input tier <=32K).
  {
    patterns: ["ernie-5.1", "ernie-5-1"],
    name: "ERNIE 5.1",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(0.85, 3.38, 0, 0),
    family: "ERNIE",
  },
  {
    patterns: ["ernie-5.0", "ernie-5"],
    apiId: "ernie-5.0",
    name: "ERNIE 5.0",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 131_072,
    maxTokens: 65_536,
    cost: P(0.85, 3.38, 0, 0),
    family: "ERNIE",
  },
  {
    patterns: ["ernie-4.5-turbo-128k", "ernie-4.5-turbo", "ernie-4.5"],
    apiId: "ernie-4.5-turbo-128k",
    name: "ERNIE 4.5 Turbo 128K",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 16_384,
    cost: P(0.11, 0.45, 0.028, 0),
    family: "ERNIE",
  },

  // ── Mistral ─────────────────────────────────────────────
  // Source: docs.mistral.ai/inference/pricing.
  {
    patterns: ["mistral-large-3", "mistral-large"],
    apiId: "mistral-large-latest",
    name: "Mistral Large 3",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 32_768,
    cost: P(0.5, 1.5, 0.05, 0),
    family: "Mistral",
  },
  {
    patterns: ["mistral-medium-3.5", "mistral-medium"],
    apiId: "mistral-medium-latest",
    name: "Mistral Medium 3.5",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 32_768,
    cost: P(1.5, 7.5, 0.15, 0),
    family: "Mistral",
  },
  {
    patterns: ["mistral-small-4", "mistral-small"],
    apiId: "mistral-small-latest",
    name: "Mistral Small 4",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 32_768,
    cost: P(0.15, 0.6, 0.015, 0),
    family: "Mistral",
  },
  {
    patterns: ["ministral-3-14b"],
    name: "Ministral 3 14B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 32_768,
    cost: P(0.2, 0.2, 0.02, 0),
    family: "Mistral",
  },
  {
    patterns: ["ministral-3-8b"],
    name: "Ministral 3 8B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 32_768,
    cost: P(0.15, 0.15, 0.015, 0),
    family: "Mistral",
  },

  // ── Meta Llama (open weights) ───────────────────────────
  // Prices are a third-party host's serverless list rate (DeepInfra /
  // Groq) because Meta does not sell tokens directly. Adjust for your host.
  {
    patterns: ["llama-4-maverick"],
    name: "Llama 4 Maverick",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 16_384,
    cost: P(0.17, 0.6, 0, 0),
    family: "Llama",
  },
  {
    patterns: ["llama-4-scout"],
    name: "Llama 4 Scout",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 16_384,
    cost: P(0.08, 0.3, 0, 0),
    family: "Llama",
  },
  {
    patterns: ["llama-3.3-70b", "llama-3-3-70b"],
    name: "Llama 3.3 70B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 8192,
    cost: P(0.59, 0.79, 0, 0),
    family: "Llama",
  },

  // ── 01.AI Yi ────────────────────────────────────────────
  {
    patterns: ["yi-lightning"],
    name: "Yi Lightning",
    reasoning: false,
    input: ["text"],
    contextWindow: 16_384,
    maxTokens: 4096,
    cost: P(0.14, 0.14, 0, 0),
    family: "Yi",
  },

  // ── OpenCode / free providers ───────────────────────────
  {
    patterns: ["deepseek-v4-flash-free"],
    name: "DeepSeek V4 Flash (Free)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: P(0, 0, 0, 0),
    family: "OpenCode",
  },
];

// ─── Heuristic guess by id (pattern + keyword matching) ────
// Used as a last-resort fallthrough for unknown model IDs.

const KW_REASONING = /\b(r1|o1|o3|o4|z1|reasoner|reasoning|think\b|deepseek-r|qwq)\b/i;
const KW_VISION = /\b(vision|vl|multimodal|4o|gpt-4o|gemini-.*-vision|claude-.*opu|claude-.*sonnet|claude-.*haiku|llama-.*vision|qwen-.*vl|glm-.*v\b)\b/i;
const KW_CONTEXT_8K = /[-_](8k)\b/i;
const KW_CONTEXT_16K = /[-_](16k)\b/i;
const KW_CONTEXT_32K = /[-_](32k)\b/i;
const KW_CONTEXT_64K = /[-_](64k)\b/i;
const KW_CONTEXT_128K = /[-_](128k)\b/i;
const KW_CONTEXT_256K = /[-_](256k)\b/i;
const KW_CONTEXT_1M = /[-_](1m|1024k|1048576)\b/i;
const KW_AUDIO = /\b(audio|whisper|tts|speech)\b/i;

export interface GuessResult {
  reasoning?: boolean;
  input?: Model["input"];
  contextWindow?: number;
  maxTokens?: number;
  source: "catalog" | "heuristic" | "default";
  matched?: string; // pattern that matched
}

function catalogPatternScore(id: string, pattern: string): number {
  const key = id.trim().toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (!key || !pat) return 0;
  const tail = key.split("/").pop() ?? key;

  // Exact matches must always beat a broader family prefix. For example,
  // deepseek-v4-flash-free must match its own entry rather than deepseek-v4.
  if (key === pat) return 10_000 + pat.length;
  if (tail === pat) return 9_500 + pat.length;
  if (key.endsWith("/" + pat)) return 9_000 + pat.length;
  if (tail.startsWith(pat + "-") || tail.startsWith(pat + ":")) return 7_000 + pat.length;
  if (key.startsWith(pat + "-") || key.startsWith(pat + ":")) return 6_500 + pat.length;
  if (key.includes("/" + pat + "-") || key.includes("/" + pat + ":")) return 6_000 + pat.length;
  return 0;
}

/** Resolve the single best catalog entry for a full model id. */
export function findCatalogEntry(id: string): CatalogEntry | undefined {
  let best: { entry: CatalogEntry; score: number } | undefined;
  for (const entry of MODEL_CATALOG) {
    for (const pattern of entry.patterns) {
      const score = catalogPatternScore(id, pattern);
      if (score > 0 && (!best || score > best.score)) best = { entry, score };
    }
  }
  return best?.entry;
}

export function guessModelMeta(id: string): GuessResult {
  const key = (id ?? "").toLowerCase();

  // 1. Best exact/alias/family catalog match.
  const entry = findCatalogEntry(key);
  if (entry) {
    return {
      reasoning: entry.reasoning,
      input: entry.input,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      source: "catalog",
      matched: entry.name ?? entry.patterns[0],
    };
  }

  // 2. Heuristic keyword match
  const reasoning = KW_REASONING.test(key);
  const input: Model["input"] = ["text"];
  if (KW_VISION.test(key)) input.push("image");
  if (KW_AUDIO.test(key)) input.push("audio");

  let contextWindow: number | undefined;
  if (KW_CONTEXT_1M.test(key)) contextWindow = 1_048_576;
  else if (KW_CONTEXT_256K.test(key)) contextWindow = 262_144;
  else if (KW_CONTEXT_128K.test(key)) contextWindow = 131_072;
  else if (KW_CONTEXT_64K.test(key)) contextWindow = 65_536;
  else if (KW_CONTEXT_32K.test(key)) contextWindow = 32_768;
  else if (KW_CONTEXT_16K.test(key)) contextWindow = 16_384;
  else if (KW_CONTEXT_8K.test(key)) contextWindow = 8192;

  if (reasoning || input.length > 1 || contextWindow) {
    return { reasoning, input, contextWindow, source: "heuristic" };
  }

  // 3. Nothing matched — caller falls back to defaults
  return { source: "default" };
}

// ─── Search the catalog for the picker UI ───────────────────

/** The id to prefill / display for a catalog entry. */
export function catalogEntryId(e: CatalogEntry): string {
  return e.apiId ?? e.patterns[0] ?? "";
}

export function searchCatalog(query: string, limit = 40): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODEL_CATALOG.slice(0, limit);
  return MODEL_CATALOG
    .map((entry, index) => {
      const patternScore = Math.max(0, ...entry.patterns.map((pattern) => catalogPatternScore(q, pattern)));
      const hay = [entry.name ?? "", entry.family ?? "", ...entry.patterns].join(" ").toLowerCase();
      const textScore = hay.includes(q) ? 1_000 - index : 0;
      return { entry, score: Math.max(patternScore, textScore) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

// ─── Convert a catalog entry to a Partial<Model> for prefill ─

export function catalogToModel(e: CatalogEntry, idOverride?: string): Partial<Model> {
  return {
    id: idOverride ?? catalogEntryId(e),
    name: e.name,
    reasoning: e.reasoning ?? false,
    input: e.input ?? ["text"],
    contextWindow: e.contextWindow,
    maxTokens: e.maxTokens,
    cost: e.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

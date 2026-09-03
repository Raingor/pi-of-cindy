import { describe, expect, it } from 'vitest';
import {
  MODEL_CATALOG,
  catalogEntryId,
  catalogToModel,
  findCatalogEntry,
  searchCatalog,
} from '../modelCatalog';

describe("model catalog integrity", () => {
  it("every entry exposes a callable api id", () => {
    for (const entry of MODEL_CATALOG) {
      const id = catalogEntryId(entry);
      expect(id, `${entry.name} has no id`).toBeTruthy();
      // A trailing separator means the value is a match prefix, not a model id.
      expect(id, `${entry.name} -> "${id}" is a prefix, not an id`).not.toMatch(/[-_.:]$/);
    }
  });

  it("api ids are unique", () => {
    const ids = MODEL_CATALOG.map(catalogEntryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("picking a preset and re-detecting its id resolves to the same entry", () => {
    for (const entry of MODEL_CATALOG) {
      const id = catalogEntryId(entry);
      expect(findCatalogEntry(id), `${id} round-trips to the wrong entry`).toBe(entry);
    }
  });

  it("maxTokens never exceeds contextWindow", () => {
    for (const entry of MODEL_CATALOG) {
      expect(entry.maxTokens, `${entry.name}`).toBeLessThanOrEqual(entry.contextWindow);
    }
  });

  it("every entry has a cost so usage stats are not silently free", () => {
    const missing = MODEL_CATALOG.filter((e) => !e.cost).map((e) => e.name);
    expect(missing).toEqual([]);
  });

  it("catalogToModel prefills the entry's api id", () => {
    for (const entry of MODEL_CATALOG) {
      expect(catalogToModel(entry).id).toBe(catalogEntryId(entry));
    }
  });

  it("an empty query lists the whole catalog", () => {
    expect(searchCatalog("", MODEL_CATALOG.length)).toHaveLength(MODEL_CATALOG.length);
  });
});

describe("findCatalogEntry resolution", () => {
  // Exact ids must beat broader family prefixes.
  const cases: [string, string][] = [
    ["claude-opus-4-5-20251101", "Claude Opus 4.5"],
    ["claude-sonnet-4-5", "Claude Sonnet 4.5"],
    ["claude-haiku-4-5", "Claude Haiku 4.5"],
    ["anthropic/claude-sonnet-5", "Claude Sonnet 5"],
    ["gpt-5", "GPT-5"],
    ["gpt-5.1", "GPT-5.1"],
    ["gpt-5.6-sol", "GPT-5.6 Sol"],
    ["gpt-4o-mini", "GPT-4o Mini"],
    ["o3", "o3"],
    ["o3-mini", "o3-mini"],
    ["o3-pro", "o3-pro"],
    ["deepseek-v4-flash", "DeepSeek V4 Flash"],
    ["deepseek-v4-flash-free", "DeepSeek V4 Flash (Free)"],
    ["deepseek-v4-pro", "DeepSeek V4 Pro"],
    ["glm-4.5", "GLM-4.5"],
    ["glm-4.5-air", "GLM-4.5-Air"],
    ["glm-5", "GLM-5"],
    ["glm-5.2", "GLM-5.2"],
    ["kimi-k2.6", "Kimi K2.6"],
    ["kimi-k2.6-thinking", "Kimi K2.6 Thinking"],
    ["kimi-k2.7-code", "Kimi K2.7 Code"],
    ["qwen3-max", "Qwen3 Max"],
    ["qwen3-coder-plus", "Qwen3 Coder Plus"],
    ["qwen3-vl-plus", "Qwen3 VL Plus"],
    ["grok-4.6", "Grok 4.6"],
    ["gemini-2.5-flash", "Gemini 2.5 Flash"],
    ["gemini-2.5-pro", "Gemini 2.5 Pro"],
    ["mistral-large-latest", "Mistral Large 3"],
  ];

  it.each(cases)("%s resolves to %s", (id, name) => {
    expect(findCatalogEntry(id)?.name).toBe(name);
  });

  it("returns undefined for an unknown id", () => {
    expect(findCatalogEntry("totally-made-up-model-xyz")).toBeUndefined();
  });
});

describe("vendor-documented values", () => {
  // Regression guards for the values that were previously wrong. Each is
  // sourced from the vendor's own pricing / model docs.
  const expected: Record<string, { ctx: number; max: number; in: number; out: number }> = {
    "claude-opus-4-5": { ctx: 200_000, max: 65_536, in: 5, out: 25 },
    "claude-sonnet-4-5": { ctx: 200_000, max: 65_536, in: 3, out: 15 },
    "gpt-5.1": { ctx: 400_000, max: 128_000, in: 1.25, out: 10 },
    "o3-pro": { ctx: 200_000, max: 100_000, in: 20, out: 80 },
    "gemini-2.5-flash": { ctx: 1_048_576, max: 65_536, in: 0.3, out: 2.5 },
    "deepseek-v4-pro": { ctx: 1_048_576, max: 131_072, in: 1.32, out: 3.96 },
    "glm-5.1": { ctx: 204_800, max: 131_072, in: 1.4, out: 4.4 },
    "qwen3-max": { ctx: 262_144, max: 65_536, in: 1.2, out: 6 },
  };

  it.each(Object.entries(expected))("%s matches vendor docs", (id, want) => {
    const entry = findCatalogEntry(id);
    expect(entry).toBeDefined();
    expect(entry!.contextWindow).toBe(want.ctx);
    expect(entry!.maxTokens).toBe(want.max);
    expect(entry!.cost?.input).toBe(want.in);
    expect(entry!.cost?.output).toBe(want.out);
  });

  it("glm-5.2 is a Zhipu model, not SenseNova", () => {
    expect(findCatalogEntry("glm-5.2")?.family).toBe("GLM");
  });
});

/**
 * Pi 会话用量解析的字段契约。
 *
 * 这个解析器是从 pi-web-switch 移植的，字段名沿用了 Anthropic 风格的
 * `input_tokens` / `output_tokens`，但 pi 会话 JSONL 实际写的是
 * `input` / `output` / `cacheRead` / `cacheWrite`，而且 `model_change` 用
 * `modelId` 不是 `model`。字段名对不上的后果不是报错而是**静默归零**——仪表盘
 * 全空、供应商维度全落到默认模型名上，所以这些字段名必须被测试钉住。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PiUsageRecord } from '../piTypes.js';

let tempRoot: string;
let sessionsDir: string;
let readPiUsageRecords: () => PiUsageRecord[];

/** 一行 assistant 消息，用现行 pi 会话格式。 */
function assistantLine(opts: {
  timestamp: number;
  provider: string;
  model: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}): string {
  const usage: Record<string, unknown> = {
    input: opts.input ?? 0,
    output: opts.output ?? 0,
    cacheRead: opts.cacheRead ?? 0,
    cacheWrite: opts.cacheWrite ?? 0,
  };
  if (opts.cost !== undefined) {
    usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: opts.cost };
  }
  return JSON.stringify({
    type: 'message',
    timestamp: new Date(opts.timestamp).toISOString(),
    message: {
      role: 'assistant',
      provider: opts.provider,
      model: opts.model,
      timestamp: opts.timestamp,
      usage,
    },
  });
}

function writeSession(name: string, lines: string[]): void {
  writeFileSync(join(sessionsDir, name), `${lines.join('\n')}\n`, 'utf-8');
}

beforeEach(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'pi-usage-'));
  sessionsDir = join(tempRoot, '.pi', 'agent', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  // 解析器在模块加载期就把 sessions 目录算成常量，所以先 mock homedir 再动态 import。
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return { ...actual, homedir: () => tempRoot, default: { ...actual, homedir: () => tempRoot } };
  });
  vi.resetModules();
  ({ readPiUsageRecords } = await import('../piUsageParser.js'));
});

afterEach(() => {
  vi.doUnmock('node:os');
  vi.resetModules();
  rmSync(tempRoot, { recursive: true, force: true });
});

const AUG_24_1641_CST = Date.UTC(2026, 7, 24, 8, 41, 0);

describe('pi usage token fields', () => {
  it('reads the field names pi actually writes', () => {
    writeSession('a.jsonl', [
      assistantLine({
        timestamp: AUG_24_1641_CST,
        provider: 'opencode-go',
        model: 'ox-alpha-free',
        input: 31745,
        output: 72,
        cacheRead: 10,
        cacheWrite: 5,
      }),
    ]);
    const records = readPiUsageRecords();
    expect(records).toHaveLength(1);
    const r = records[0]!;
    // 若解析器只认 `input_tokens`，这四项会全是 0——那就是仪表盘空白的成因。
    expect(r.inputTokens).toBe(31745);
    expect(r.outputTokens).toBe(72);
    expect(r.cacheReadTokens).toBe(10);
    expect(r.cacheWriteTokens).toBe(5);
  });

  it('still reads legacy underscore field names', () => {
    writeSession('legacy.jsonl', [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          timestamp: AUG_24_1641_CST,
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 1,
          },
        },
      }),
    ]);
    const r = readPiUsageRecords()[0]!;
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(20);
    expect(r.cacheReadTokens).toBe(3);
    expect(r.cacheWriteTokens).toBe(1);
  });
});

describe('pi usage provider and model attribution', () => {
  it('prefers per-message provider and model over the running model_change state', () => {
    writeSession('b.jsonl', [
      JSON.stringify({ type: 'model_change', provider: 'agentrouter-a1', modelId: 'glm-5.3' }),
      // 子代理临时换模型时不发 model_change，只有消息自己带真相。
      assistantLine({
        timestamp: AUG_24_1641_CST,
        provider: 'kktoken',
        model: 'claude-opus-5-thinking',
        input: 10,
      }),
    ]);
    const r = readPiUsageRecords()[0]!;
    expect(r.providerId).toBe('kktoken');
    expect(r.modelId).toBe('claude-opus-5-thinking');
  });

  it('falls back to model_change modelId when a message omits its model', () => {
    writeSession('c.jsonl', [
      // 现行格式是 `modelId`；读 `model` 会让所有记录停在默认的 claude-sonnet-4。
      JSON.stringify({ type: 'model_change', provider: 'agentrouter-a1', modelId: 'glm-5.3' }),
      JSON.stringify({
        type: 'message',
        message: { role: 'assistant', timestamp: AUG_24_1641_CST, usage: { input: 7, output: 1 } },
      }),
    ]);
    const r = readPiUsageRecords()[0]!;
    expect(r.providerId).toBe('agentrouter-a1');
    expect(r.modelId).toBe('glm-5.3');
  });
});

describe('pi usage cost', () => {
  it('uses the cost the provider reported', () => {
    writeSession('d.jsonl', [
      assistantLine({
        timestamp: AUG_24_1641_CST,
        provider: 'p',
        model: 'claude-opus-5',
        input: 1000,
        output: 1000,
        cost: 0.0425,
      }),
    ]);
    // 按模型名猜会得出 0.15；真实计费在文件里，不该被估算值覆盖。
    expect(readPiUsageRecords()[0]!.cost).toBe(0.0425);
  });

  it('reports zero cost as zero rather than re-estimating it', () => {
    writeSession('e.jsonl', [
      assistantLine({
        timestamp: AUG_24_1641_CST,
        provider: 'p',
        model: 'claude-opus-5',
        input: 1000,
        output: 1000,
        cost: 0,
      }),
    ]);
    // 免费额度供应商真的是 0 成本，落回估算会凭空造出费用。
    expect(readPiUsageRecords()[0]!.cost).toBe(0);
  });

  it('estimates only when the cost field is absent entirely', () => {
    writeSession('f.jsonl', [
      assistantLine({
        timestamp: AUG_24_1641_CST,
        provider: 'p',
        model: 'claude-3-5-sonnet',
        input: 1_000_000,
        output: 0,
      }),
    ]);
    expect(readPiUsageRecords()[0]!.cost).toBeCloseTo(3, 5);
  });
});

describe('pi usage time bucketing', () => {
  it('buckets by China-timezone date and hour', () => {
    // UTC 2026-08-24T16:30Z → CST 2026-08-25 00:30，日期要跨到次日。
    writeSession('g.jsonl', [
      assistantLine({
        timestamp: Date.UTC(2026, 7, 24, 16, 30, 0),
        provider: 'p',
        model: 'm',
        input: 1,
      }),
    ]);
    const r = readPiUsageRecords()[0]!;
    expect(r.date).toBe('2026-08-25');
    expect(r.hour).toBe(0);
  });

  it('uses the message timestamp, not the envelope timestamp', () => {
    // 外层 timestamp 是 ISO 串、内层是毫秒数；两者偶有偏差，内层才是消息自身时间。
    writeSession('h.jsonl', [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-08-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          provider: 'p',
          model: 'm',
          timestamp: AUG_24_1641_CST,
          usage: { input: 1, output: 1 },
        },
      }),
    ]);
    expect(readPiUsageRecords()[0]!.date).toBe('2026-08-24');
  });
});

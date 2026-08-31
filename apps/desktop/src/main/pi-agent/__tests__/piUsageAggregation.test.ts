/**
 * 仪表盘用量聚合的呈现契约。
 *
 * 面板直接把 `cacheHitRate` 当百分比数字渲染（`${value}%` 和进度条宽度），
 * 「今天」视图只读 `hourlyBreakdown`。这两处出错都不会报错，只会让面板显示
 * 一个错得很像对的数字或一张空图，所以在这里钉住。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PiUsageByRangeResult, PiUsageRecord } from '../piTypes.js';

function record(patch: Partial<PiUsageRecord>): PiUsageRecord {
  return {
    date: '2026-08-24',
    hour: 10,
    providerId: 'p',
    modelId: 'm',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 1,
    cost: 0,
    ...patch,
  };
}

let records: PiUsageRecord[] = [];
let getUsageByRange: (from: string, to: string) => PiUsageByRangeResult;

beforeEach(async () => {
  vi.doMock('../piUsageParser.js', () => ({
    readPiUsageRecords: () => records,
    readCindyPiUsageRecords: () => [],
    aggregateUsageByDate: () => new Map(),
  }));
  vi.resetModules();
  const mod = await import('../piReader.js');
  mod.clearUsageCache();
  getUsageByRange = mod.getUsageByRange;
});

afterEach(async () => {
  const mod = await import('../piReader.js');
  mod.clearUsageCache();
  vi.doUnmock('../piUsageParser.js');
  vi.resetModules();
  records = [];
});

describe('cache hit rate', () => {
  it('reports a 0-100 percentage, not a 0-1 ratio', () => {
    // 面板渲染 `${cacheHitRate}%`：返回 0.999 会显示成「1%」而真实值是 99.9%。
    records = [record({ inputTokens: 1, cacheReadTokens: 999 })];
    expect(getUsageByRange('2026-08-24', '2026-08-24').cacheHitRate).toBe(99.9);
  });

  it('counts cache tokens against all processed tokens', () => {
    // 口径是「缓存 token / 全部处理 token」，分母含 input+output。
    records = [record({ inputTokens: 250, outputTokens: 250, cacheReadTokens: 500 })];
    expect(getUsageByRange('2026-08-24', '2026-08-24').cacheHitRate).toBe(50);
  });

  it('is zero when nothing was processed', () => {
    records = [];
    expect(getUsageByRange('2026-08-24', '2026-08-24').cacheHitRate).toBe(0);
  });
});

describe('hourly breakdown', () => {
  it('buckets records by hour instead of returning an empty list', () => {
    // 面板默认就是「今天」视图，只读 hourlyBreakdown；这张表空了整页图就是空的。
    records = [
      record({ hour: 9, inputTokens: 10, cost: 1 }),
      record({ hour: 9, inputTokens: 5, cost: 2 }),
      record({ hour: 14, outputTokens: 7, cost: 4 }),
    ];
    const { hourlyBreakdown } = getUsageByRange('2026-08-24', '2026-08-24');
    expect(hourlyBreakdown).toHaveLength(2);
    expect(hourlyBreakdown[0]).toMatchObject({ hour: 9, totalTokens: 15, totalCost: 3, totalRequests: 2 });
    expect(hourlyBreakdown[1]).toMatchObject({ hour: 14, totalTokens: 7, totalCost: 4, totalRequests: 1 });
  });

  it('orders buckets by date then hour across a multi-day range', () => {
    records = [
      record({ date: '2026-08-25', hour: 1, inputTokens: 1 }),
      record({ date: '2026-08-24', hour: 23, inputTokens: 1 }),
      record({ date: '2026-08-24', hour: 2, inputTokens: 1 }),
    ];
    const { hourlyBreakdown } = getUsageByRange('2026-08-24', '2026-08-25');
    expect(hourlyBreakdown.map((h) => `${h.date}:${h.hour}`)).toEqual([
      '2026-08-24:2',
      '2026-08-24:23',
      '2026-08-25:1',
    ]);
  });
});

describe('request totals', () => {
  it('keeps totalRequests as the real request count, not the grouped log length', () => {
    // requestLog 按 (日期, 供应商, 模型) 分组，长度远小于请求数；标题栏用它会自相矛盾。
    records = [
      record({ providerId: 'a', modelId: 'x' }),
      record({ providerId: 'a', modelId: 'x' }),
      record({ providerId: 'b', modelId: 'y' }),
    ];
    const result = getUsageByRange('2026-08-24', '2026-08-24');
    expect(result.totalRequests).toBe(3);
    expect(result.requestLog).toHaveLength(2);
  });
});

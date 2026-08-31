/**
 * JSONL session parser for pi-agent usage data.
 * Ported from pi-web-switch/server/pi-reader.ts usage parsing logic.
 *
 * Parses ~/.pi/agent/sessions/*.jsonl files to extract token usage,
 * cost, and request counts per provider/model per day.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { PiUsageRecord } from './piTypes.js';

const PI_SESSIONS_DIR = join(homedir(), '.pi', 'agent', 'sessions');
const CINDY_PI_SESSIONS_DIR =
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Cindy', 'pi-agent-home', 'sessions')
    : join(homedir(), '.config', 'cindy', 'pi-agent-home', 'sessions');

const CN_TZ = 'Asia/Shanghai';

function cnDateParts(date: Date): { year: string; month: string; day: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return { year, month, day };
}

function cnDateKey(date: Date): string {
  const { year, month, day } = cnDateParts(date);
  return `${year}-${month}-${day}`;
}

function cnHour(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return parseInt(hour, 10) % 24;
}

interface ParsedUsageLine {
  date: string;
  /** 中国时区小时（0-23），供仪表盘"今天"视图按小时聚合。 */
  hour: number;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

/**
 * 兜底成本估算。仅在会话行没带 `usage.cost` 时使用 —— 现行 pi 会话格式里
 * `usage.cost.total` 是供应商真实计费，优先取它，不要用模型名猜。
 */
function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = modelId.toLowerCase();
  if (model.includes('opus')) return (inputTokens * 75 + outputTokens * 75) / 1_000_000;
  if (model.includes('sonnet')) return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  if (model.includes('haiku')) return (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
  if (model.includes('gpt-4o')) return (inputTokens * 2.5 + outputTokens * 10) / 1_000_000;
  if (model.includes('gpt-4o-mini')) return (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000;
  if (model.includes('deepseek')) return (inputTokens * 0.27 + outputTokens * 1.1) / 1_000_000;
  return 0;
}

function parseSessionFile(filePath: string): ParsedUsageLine[] {
  const results: ParsedUsageLine[] = [];
  let currentProvider = 'anthropic';
  let currentModel = 'claude-sonnet-4-20250514';

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);

        if (obj.type === 'model_change') {
          if (obj.provider) currentProvider = obj.provider;
          // 现行格式用 `modelId`；`model` 是旧字段，留作兼容。
          if (obj.modelId) currentModel = obj.modelId;
          else if (obj.model) currentModel = obj.model;
          continue;
        }

        if (obj.type === 'message' && obj.message?.role === 'assistant') {
          const usage = obj.message.usage;
          if (!usage) continue;

          const ts = obj.message.timestamp ?? obj.timestamp;
          const date = ts ? cnDateKey(new Date(ts)) : cnDateKey(new Date());
          const hour = ts ? cnHour(new Date(ts)) : 0;

          // 现行格式：`input` / `output` / `cacheRead` / `cacheWrite`。
          // 后面那组下划线名是旧格式，保留兼容，别删。
          const inputTokens = usage.input ?? usage.input_tokens ?? 0;
          const outputTokens = usage.output ?? usage.output_tokens ?? 0;
          const cacheReadTokens =
            usage.cacheRead ?? usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? 0;
          const cacheWriteTokens =
            usage.cacheWrite ?? usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0;

          // 每条 assistant 消息自带 provider/model，比顺序推断的 model_change 更准
          // （同一会话里子代理会临时换模型，不发 model_change）。
          const providerId = obj.message.provider ?? currentProvider;
          const modelId = obj.message.model ?? currentModel;

          // 供应商真实计费优先；只有整个 cost 字段缺失才回落到按模型名估算。
          const reportedCost = usage.cost?.total;
          const cost =
            typeof reportedCost === 'number'
              ? reportedCost
              : estimateCost(modelId, inputTokens, outputTokens);

          results.push({
            date,
            hour,
            providerId,
            modelId,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            cost,
          });
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return results;
}

function collectJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        files.push(join(dir, entry));
      } else if (entry.startsWith('--')) {
        const subDir = join(dir, entry);
        try {
          const subEntries = readdirSync(subDir);
          for (const subEntry of subEntries) {
            if (subEntry.endsWith('.jsonl')) {
              files.push(join(subDir, subEntry));
            }
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    return [];
  }
  return files;
}

export function readPiUsageRecords(): PiUsageRecord[] {
  const records: PiUsageRecord[] = [];
  const files = collectJsonlFiles(PI_SESSIONS_DIR);

  for (const file of files) {
    const lines = parseSessionFile(file);
    for (const line of lines) {
      records.push({
        date: line.date,
        hour: line.hour,
        providerId: line.providerId,
        modelId: line.modelId,
        inputTokens: line.inputTokens,
        outputTokens: line.outputTokens,
        cacheReadTokens: line.cacheReadTokens,
        cacheWriteTokens: line.cacheWriteTokens,
        requests: 1,
        cost: line.cost,
      });
    }
  }

  return records.sort((a, b) => a.date.localeCompare(b.date));
}

export function readCindyPiUsageRecords(): PiUsageRecord[] {
  const records: PiUsageRecord[] = [];
  const files = collectJsonlFiles(CINDY_PI_SESSIONS_DIR);

  for (const file of files) {
    const lines = parseSessionFile(file);
    for (const line of lines) {
      records.push({
        date: line.date,
        hour: line.hour,
        providerId: line.providerId,
        modelId: line.modelId,
        inputTokens: line.inputTokens,
        outputTokens: line.outputTokens,
        cacheReadTokens: line.cacheReadTokens,
        cacheWriteTokens: line.cacheWriteTokens,
        requests: 1,
        cost: line.cost,
      });
    }
  }

  return records.sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateUsageByDate(records: PiUsageRecord[]): Map<string, PiUsageRecord> {
  const map = new Map<string, PiUsageRecord>();
  for (const r of records) {
    const key = `${r.date}|${r.providerId}|${r.modelId}`;
    const existing = map.get(key);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.cacheReadTokens += r.cacheReadTokens;
      existing.cacheWriteTokens += r.cacheWriteTokens;
      existing.requests += r.requests;
      existing.cost += r.cost;
    } else {
      map.set(key, { ...r });
    }
  }
  return map;
}

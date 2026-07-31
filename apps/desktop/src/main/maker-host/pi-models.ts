/**
 * pi-models — 向本地 pi 查询它自管的完整模型目录。
 *
 * pi 自管 provider/model：内置默认 + `~/.pi/agent/models.json` 自定义供应商 +
 * auth.json 已配供应商，最终的合并目录只有 pi 自己知道。`~/.pi/agent/models.json`
 * 只含自定义/覆写项，不含内置模型，直接解析文件拿不全。因此走 pi RPC
 * `get_available_models`：短暂 spawn `pi --mode rpc`，发一条命令拿回完整清单再关。
 *
 * 结果做进程内缓存（模型目录在一次 app 生命周期内基本稳定）；`refreshPiAvailableModels`
 * 使缓存失效，供用户在 pi 中改配置后手动刷新。
 */

import { spawn } from 'node:child_process';

import { createLogger } from '../logger.js';

const log = createLogger('maker-host:pi-models');

/** pi RPC Model 对象（见 pi docs/rpc.md「Model」）。 */
export interface PiModel {
  id: string;
  name: string;
  api?: string;
  provider: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

const QUERY_TIMEOUT_MS = 5000;

let cache: PiModel[] | null = null;
let inflight: Promise<PiModel[]> | null = null;

/** 使缓存失效，下次 read 重新向 pi 查询。 */
export function refreshPiAvailableModels(): void {
  cache = null;
  inflight = null;
}

/**
 * 向本地 pi 查询完整可用模型清单。失败/超时兜底返回 `[]`。
 * 同一进程内缓存；并发调用共享同一次查询。
 */
export function readPiAvailableModels(binaryPath: string): Promise<PiModel[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = queryPiModels(binaryPath)
    .then((models) => {
      cache = models;
      return models;
    })
    .catch((err: unknown) => {
      log.warn('pi get_available_models failed', { error: String(err) });
      cache = [];
      return [];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function queryPiModels(binaryPath: string): Promise<PiModel[]> {
  if (!binaryPath) return Promise.resolve([]);
  return new Promise<PiModel[]>((resolve) => {
    let settled = false;
    const child = spawn(binaryPath, ['--mode', 'rpc'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: false,
    });

    const finish = (models: PiModel[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        /* swallow */
      }
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* swallow */
        }
      }
      resolve(models);
    };

    const timer = setTimeout(() => finish([]), QUERY_TIMEOUT_MS);

    child.on('error', (err) => {
      log.warn('pi spawn error', { error: err.message });
      finish([]);
    });
    child.on('exit', () => finish([]));

    // 严格按 \n 切分（pi rpc.md 合规要求，不用 readline）。
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let parsed: { type?: string; command?: string; data?: { models?: PiModel[] } } | null = null;
        try {
          parsed = JSON.parse(line) as { type?: string; command?: string; data?: { models?: PiModel[] } };
        } catch {
          continue;
        }
        if (parsed?.type === 'response' && parsed.command === 'get_available_models') {
          finish(Array.isArray(parsed.data?.models) ? parsed.data.models : []);
          return;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', () => {
      /* diagnostics only; ignore */
    });

    try {
      child.stdin.write(`${JSON.stringify({ id: 'm1', type: 'get_available_models' })}\n`, 'utf8');
    } catch (err) {
      log.warn('pi stdin write failed', { error: String(err) });
      finish([]);
    }
  });
}

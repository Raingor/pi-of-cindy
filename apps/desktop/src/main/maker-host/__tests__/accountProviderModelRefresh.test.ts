import { describe, expect, it, vi } from 'vitest';

import {
  discoverAccountProviderModels,
  refreshProviderModelsAfterAccountReady,
  resetAccountProviderRuntimes,
} from '../account-provider-model-refresh.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// pi-only 改造后 resetAccountProviderRuntimes 退化为 no-op(原 codex 重启 /
// bridge shutdown 收口已随 CodexAgent 装配摘除),保留入口维持调用面形状。
describe('resetAccountProviderRuntimes', () => {
  it('is a no-op that never throws after the pi-only harness change', async () => {
    await expect(
      resetAccountProviderRuntimes({ log: { warn: vi.fn() } }, () => true),
    ).resolves.toBeUndefined();
  });
});

describe('discoverAccountProviderModels', () => {
  it('does not start provider refresh after shouldContinue flips', async () => {
    const refreshProviderModels = vi.fn(async () => {});
    let allow = true;
    await discoverAccountProviderModels(
      {
        loadXaiLkg: async () => {
          allow = false;
          return true;
        },
        refreshProviderModels,
        log: { warn: vi.fn() },
      },
      () => allow,
    );
    expect(refreshProviderModels).not.toHaveBeenCalled();
  });
});

describe('refreshProviderModelsAfterAccountReady', () => {
  it('keeps all account-scoped provider refreshes inside readiness', async () => {
    const anthropicRefresh = deferred();
    const backgroundRefresh = deferred();
    const events: string[] = [];
    const operation = refreshProviderModelsAfterAccountReady({
      loadXaiLkg: async () => {
        events.push('xai-lkg');
        return true;
      },
      refreshProviderModels: async (trigger, providerIds) => {
        events.push(`refresh:${trigger}:${providerIds?.join(',')}`);
        await (providerIds?.includes('anthropic')
          ? anthropicRefresh.promise
          : backgroundRefresh.promise);
      },
      log: { warn: vi.fn() },
    });

    let settled = false;
    void operation.then(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(events).toEqual([
        'xai-lkg',
        'refresh:startup:xd,openai,xai',
        'refresh:startup:anthropic',
      ]),
    );
    expect(settled).toBe(false);

    anthropicRefresh.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    backgroundRefresh.resolve();
    await operation;
    expect(settled).toBe(true);
  });

  it('keeps account readiness best-effort when discovery itself fails', async () => {
    const warn = vi.fn();
    await expect(
      refreshProviderModelsAfterAccountReady({
        loadXaiLkg: vi.fn(async () => false),
        refreshProviderModels: async () => {
          throw new Error('discovery unavailable');
        },
        log: { warn },
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('background provider model startup refresh failed', {
      error: 'discovery unavailable',
    });
    expect(warn).toHaveBeenCalledWith('Anthropic model startup refresh failed', {
      error: 'discovery unavailable',
    });
  });

  it('loads the current owner xAI LKG before starting account refreshes', async () => {
    const releaseLkg = deferred();
    const events: string[] = [];
    const operation = refreshProviderModelsAfterAccountReady({
      loadXaiLkg: async () => {
        events.push('lkg:start');
        await releaseLkg.promise;
        events.push('lkg:end');
        return true;
      },
      refreshProviderModels: async () => {
        events.push('refresh');
      },
      log: { warn: vi.fn() },
    });
    await vi.waitFor(() => expect(events).toEqual(['lkg:start']));
    releaseLkg.resolve();
    await operation;
    expect(events).toEqual(['lkg:start', 'lkg:end', 'refresh', 'refresh']);
  });
});

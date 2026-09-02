// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderView } from '@cindy/model-providers';

beforeEach(() => {
  vi.resetModules();
});

function setElectronApi(value: unknown): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value,
  });
}

function capabilities(label: string) {
  return {
    availableModels: [
      {
        id: `${label}-model`,
        displayName: label,
        contextWindow: 1,
        efforts: [],
        defaultEffort: null,
      },
    ],
    hasFastMode: false,
    effortLevels: [],
    permissionModes: [],
  };
}

function provider(id: string): ProviderView {
  return {
    id,
    name: id,
    source: 'builtin',
    agents: ['claude-code'],
    auth: { method: 'none' },
    routing: {
      'claude-code': { upstream: 'https://example.invalid', authStrategy: 'none' },
    },
    models: { 'claude-code': [] },
    connected: true,
  };
}

describe('remote model hook device ownership', () => {
  it('pi-only 下 Pi 变为不可用时刷新拒绝,挂载中的 hook 保留 last-valid 能力', async () => {
    let piAvailable = true;
    const getCapabilities = vi.fn(async (agentKind: string) => {
      if (agentKind === 'pi' && !piAvailable) {
        throw new Error("Agent 'pi' is not registered");
      }
      return capabilities(`local:${agentKind}`);
    });
    setElectronApi({ maker: { getCapabilities } });
    const mod = await import('@/hooks/useAgentCapabilities');
    await mod.preloadAllCapabilities();

    const frames: Array<ReturnType<typeof mod.useAgentCapabilities>> = [];
    function Probe() {
      frames.push(mod.useAgentCapabilities('pi'));
      return null;
    }

    const view = render(<Probe />);
    await waitFor(() =>
      expect(frames.at(-1)?.capabilities?.availableModels[0]?.displayName).toBe('local:pi'),
    );

    piAvailable = false;
    const generation = mod.beginLocalCapabilitiesRefresh();
    // pi 是唯一注册 agent:不可用 = 联合快照失败,loadLocalCapabilitiesSnapshot 直接 reject。
    await expect(mod.loadLocalCapabilitiesSnapshot()).rejects.toThrow(
      "Agent 'pi' is not registered",
    );
    // 失败不提交:缓存与挂载中的 hook 都保留 last-valid 能力。
    expect(mod.getCachedCapabilities('pi')?.availableModels[0]?.displayName).toBe('local:pi');
    expect(frames.at(-1)?.capabilities?.availableModels[0]?.displayName).toBe('local:pi');
    view.unmount();
  });

  it('does not let a pre-refresh request revive a committed missing snapshot (optional codex)', async () => {
    let codexUnavailable = false;
    let resolveStaleCodex!: (value: ReturnType<typeof capabilities>) => void;
    const staleCodex = new Promise<ReturnType<typeof capabilities>>((resolve) => {
      resolveStaleCodex = resolve;
    });
    const getCapabilities = vi.fn((agentKind: string) => {
      if (agentKind === 'codex') {
        if (codexUnavailable) return Promise.reject(new Error("Agent 'codex' is not registered"));
        return staleCodex;
      }
      return Promise.resolve(capabilities(`local:${agentKind}`));
    });
    setElectronApi({ maker: { getCapabilities } });
    const mod = await import('@/hooks/useAgentCapabilities');

    const frames: Array<ReturnType<typeof mod.useAgentCapabilities>> = [];
    function Probe() {
      frames.push(mod.useAgentCapabilities('codex'));
      return null;
    }

    const view = render(<Probe />);
    await waitFor(() => expect(getCapabilities).toHaveBeenCalledWith('codex'));

    codexUnavailable = true;
    const generation = mod.beginLocalCapabilitiesRefresh();
    const entries = await mod.loadLocalCapabilitiesSnapshot();
    await act(async () => {
      expect(mod.commitLocalCapabilitiesSnapshot(generation, entries)).toBe(true);
    });
    await waitFor(() => {
      expect(frames.at(-1)?.capabilities).toBeNull();
      expect(frames.at(-1)?.loading).toBe(false);
    });

    await act(async () => {
      resolveStaleCodex(capabilities('stale:codex'));
      await staleCodex;
      await Promise.resolve();
    });

    expect(frames.at(-1)?.capabilities).toBeNull();
    expect(mod.getCachedCapabilities('codex')).toBeNull();
    view.unmount();
  });

  it('keeps a successful cache-miss result when a newer local refresh fails before commit', async () => {
    let resolveInitialPi!: (value: ReturnType<typeof capabilities>) => void;
    const initialPi = new Promise<ReturnType<typeof capabilities>>((resolve) => {
      resolveInitialPi = resolve;
    });
    let piRequests = 0;
    let failRefresh = false;
    const getCapabilities = vi.fn((agentKind: string) => {
      if (agentKind === 'pi' && piRequests++ === 0) return initialPi;
      if (agentKind === 'claude-code' && failRefresh) {
        return Promise.reject(new Error('temporary capability IPC failure'));
      }
      return Promise.resolve(capabilities(`refresh:${agentKind}`));
    });
    setElectronApi({ maker: { getCapabilities } });
    const mod = await import('@/hooks/useAgentCapabilities');

    const frames: Array<ReturnType<typeof mod.useAgentCapabilities>> = [];
    function Probe() {
      frames.push(mod.useAgentCapabilities('pi'));
      return null;
    }

    const view = render(<Probe />);
    await waitFor(() => expect(getCapabilities).toHaveBeenCalledWith('pi'));

    failRefresh = true;
    await act(async () => {
      await mod.refreshLocalCapabilities();
    });
    await act(async () => {
      resolveInitialPi(capabilities('initial:pi'));
      await initialPi;
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(frames.at(-1)?.capabilities?.availableModels[0]?.displayName).toBe('initial:pi');
      expect(frames.at(-1)?.loading).toBe(false);
      expect(frames.at(-1)?.error).toBeNull();
    });
    expect(mod.getCachedCapabilities('pi')?.availableModels[0]?.displayName).toBe('initial:pi');
    view.unmount();
  });

  it('never renders the previous device capabilities under a newly selected device', async () => {
    const invoke = vi.fn((deviceId: string) => {
      if (deviceId === 'dev-a') return Promise.resolve(capabilities('Mac A'));
      return new Promise(() => {});
    });
    setElectronApi({ deviceLink: { invoke } });
    const mod = await import('@/hooks/useAgentCapabilities');
    await mod.prefetchDeviceCapabilities('dev-a');

    const frames: Array<{ deviceId: string; label: string | null; loading: boolean }> = [];
    function Probe({ deviceId }: { deviceId: string }) {
      const state = mod.useAgentCapabilities('codex', deviceId);
      frames.push({
        deviceId,
        label: state.capabilities?.availableModels[0]?.displayName ?? null,
        loading: state.loading,
      });
      return null;
    }

    const view = render(<Probe deviceId="dev-a" />);
    await waitFor(() =>
      expect(frames.at(-1)).toEqual({
        deviceId: 'dev-a',
        label: 'Mac A',
        loading: false,
      }),
    );

    frames.length = 0;
    view.rerender(<Probe deviceId="dev-b" />);
    expect(frames[0]).toEqual({ deviceId: 'dev-b', label: null, loading: true });
  });

  it('never renders the previous device providers under a newly selected device', async () => {
    const invoke = vi.fn((deviceId: string) => {
      if (deviceId === 'dev-a') {
        return Promise.resolve({ providers: [provider('provider-a')] });
      }
      return new Promise(() => {});
    });
    setElectronApi({ deviceLink: { invoke } });
    const mod = await import('@/hooks/useDeviceProviders');
    await mod.prefetchDeviceProviders('dev-a');

    const frames: Array<{ deviceId: string; providerIds: string[]; loading: boolean }> = [];
    function Probe({ deviceId }: { deviceId: string }) {
      const state = mod.useDeviceProviders(deviceId);
      frames.push({
        deviceId,
        providerIds: state.providers.map((provider) => provider.id),
        loading: state.loading,
      });
      return null;
    }

    const view = render(<Probe deviceId="dev-a" />);
    await waitFor(() =>
      expect(frames.at(-1)).toEqual({
        deviceId: 'dev-a',
        providerIds: ['provider-a'],
        loading: false,
      }),
    );

    frames.length = 0;
    view.rerender(<Probe deviceId="dev-b" />);
    expect(frames[0]).toEqual({ deviceId: 'dev-b', providerIds: [], loading: true });
  });

  it('clears a stale provider catalog when an upgraded controller reaches an old unsupported device', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ providers: [provider('stale-provider')] })
      .mockRejectedValueOnce(
        new Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] channel not allowed remotely'),
      );
    setElectronApi({ deviceLink: { invoke } });
    const mod = await import('@/hooks/useDeviceProviders');
    await mod.prefetchDeviceProviders('dev-old');

    const frames: Array<ReturnType<typeof mod.useDeviceProviders>> = [];
    function Probe() {
      const state = mod.useDeviceProviders('dev-old');
      frames.push(state);
      return null;
    }

    render(<Probe />);
    await waitFor(() => expect(frames.at(-1)?.providers).toHaveLength(1));
    await act(async () => {
      mod.evictDeviceProviders('dev-old');
      await mod.prefetchDeviceProviders('dev-old');
    });

    await waitFor(() => expect(frames.at(-1)?.unsupported).toBe(true));
    expect(frames.at(-1)?.providers).toEqual([]);
    expect(frames.at(-1)?.error).toContain('CHANNEL_NOT_ALLOWED');
  });
});

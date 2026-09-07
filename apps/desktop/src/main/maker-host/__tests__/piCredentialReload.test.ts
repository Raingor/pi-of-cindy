/**
 * piCredentialReload 单测 —— 方案 B 的登记 / 拦截语义。
 * 纯内存 deps(fake maker + fake db),不触 Electron / SQLite。
 */
import { describe, expect, it } from 'vitest';

import {
  createPiCredentialReloadTracker,
  type PiCredentialReloadDeps,
} from '../piCredentialReload.js';

interface FakeSession {
  id: string;
  agentKind: string;
  remoteHostId: string | null;
  running: boolean;
  isTurnRunning(): boolean;
}

function fakeSession(init: Omit<FakeSession, 'isTurnRunning'>): FakeSession {
  const session = { ...init } as FakeSession;
  session.isTurnRunning = () => session.running;
  return session;
}

function makeDeps(rows: Array<{ id: string; providerId: string | null }>) {
  const live = new Map<string, FakeSession>();
  const closed: string[] = [];
  const broadcasts: { affectedProviderIds: string[] }[] = [];
  const deps: PiCredentialReloadDeps = {
    getSession: (id) => live.get(id) ?? null,
    closeSession: async (id) => {
      closed.push(id);
      live.delete(id);
    },
    queryLocalPiSessionsByProviderIds: async (providerIds) =>
      rows.filter((row) => row.providerId != null && providerIds.includes(row.providerId)),
    broadcastProviderChanged: (payload) => {
      broadcasts.push(payload);
    },
  };
  return { deps, live, closed, broadcasts };
}

function addLive(
  live: Map<string, FakeSession>,
  init: Omit<FakeSession, 'isTurnRunning'>,
): void {
  live.set(init.id, fakeSession(init));
}

describe('createPiCredentialReloadTracker', () => {
  it('marks live local pi sessions and broadcasts affected provider ids', async () => {
    const { deps, live, broadcasts } = makeDeps([
      { id: 's-live', providerId: 'pi-cli-deepseek' },
      { id: 's-gone', providerId: 'pi-cli-deepseek' }, // DB 有行但 live 已关
      { id: 's-remote', providerId: 'pi-cli-deepseek' }, // live 但 SSH 远程
      { id: 's-cc', providerId: 'pi-cli-deepseek' }, // live 但 agentKind 非 pi
    ]);
    addLive(live, { id: 's-live', agentKind: 'pi', remoteHostId: null, running: false });
    addLive(live, { id: 's-remote', agentKind: 'pi', remoteHostId: 'host-1', running: false });
    addLive(live, { id: 's-cc', agentKind: 'cc', remoteHostId: null, running: false });
    const tracker = createPiCredentialReloadTracker(deps);

    await tracker.notifyCredentialsChanged(['pi-cli-deepseek']);

    expect(tracker.hasPendingReload('s-live')).toBe(true);
    expect(tracker.hasPendingReload('s-gone')).toBe(false);
    expect(tracker.hasPendingReload('s-remote')).toBe(false);
    expect(tracker.hasPendingReload('s-cc')).toBe(false);
    expect(broadcasts).toEqual([{ affectedProviderIds: ['pi-cli-deepseek'] }]);
  });

  it('broadcasts nothing when no live local pi session is affected', async () => {
    const { deps, broadcasts } = makeDeps([{ id: 's-x', providerId: 'p1' }]);
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);
    expect(broadcasts).toEqual([]);
    expect(tracker.hasPendingReload('s-x')).toBe(false);
  });

  it('skips empty / blank provider ids', async () => {
    const { deps, broadcasts } = makeDeps([]);
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['', '  ', 'p1']);
    // 'p1' 仍会走查询;这里只验证空 id 不进查询。
    expect(broadcasts).toEqual([]);
  });

  it('survives db query failure without throwing', async () => {
    const deps: PiCredentialReloadDeps = {
      getSession: () => null,
      closeSession: async () => {},
      queryLocalPiSessionsByProviderIds: async () => {
        throw new Error('db down');
      },
      broadcastProviderChanged: () => {},
    };
    const tracker = createPiCredentialReloadTracker(deps);
    await expect(tracker.notifyCredentialsChanged(['p1'])).resolves.toBeUndefined();
  });

  it('closes an idle stale session exactly once and drops the marker', async () => {
    const { deps, live, closed } = makeDeps([{ id: 's1', providerId: 'p1' }]);
    addLive(live, { id: 's1', agentKind: 'pi', remoteHostId: null, running: false });
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);

    await tracker.applyPendingReload('s1');
    await tracker.applyPendingReload('s1'); // 幂等:标记已删,不再 close
    await tracker.applyPendingReload('s1');

    expect(closed).toEqual(['s1']);
    expect(tracker.hasPendingReload('s1')).toBe(false);
  });

  it('keeps the marker while the turn is running and reloads at the next idle boundary', async () => {
    const { deps, live, closed } = makeDeps([{ id: 's1', providerId: 'p1' }]);
    addLive(live, { id: 's1', agentKind: 'pi', remoteHostId: null, running: true });
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);

    await tracker.applyPendingReload('s1');
    expect(closed).toEqual([]);
    expect(tracker.hasPendingReload('s1')).toBe(true);

    // 回合结束(空闲)后队列 drain 重入 → 此时重载。
    live.get('s1')!.running = false;
    await tracker.applyPendingReload('s1');
    expect(closed).toEqual(['s1']);
  });

  it('drops the marker when the session is already closed elsewhere', async () => {
    const { deps, live, closed } = makeDeps([{ id: 's1', providerId: 'p1' }]);
    addLive(live, { id: 's1', agentKind: 'pi', remoteHostId: null, running: false });
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);

    live.delete('s1'); // 其它路径先关了
    await tracker.applyPendingReload('s1');
    expect(closed).toEqual([]);
    expect(tracker.hasPendingReload('s1')).toBe(false);
  });

  it('drops the marker defensively if the session became remote', async () => {
    const { deps, live, closed } = makeDeps([{ id: 's1', providerId: 'p1' }]);
    addLive(live, { id: 's1', agentKind: 'pi', remoteHostId: null, running: false });
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);

    live.get('s1')!.remoteHostId = 'host-9';
    await tracker.applyPendingReload('s1');
    expect(closed).toEqual([]);
    expect(tracker.hasPendingReload('s1')).toBe(false);
  });

  it('continues past close failure so the send is not blocked', async () => {
    const deps: PiCredentialReloadDeps = {
      getSession: () => ({ id: 's1', agentKind: 'pi', remoteHostId: null, isTurnRunning: () => false }),
      closeSession: async () => {
        throw new Error('close hung');
      },
      queryLocalPiSessionsByProviderIds: async () => [{ id: 's1', providerId: 'p1' }],
      broadcastProviderChanged: () => {},
    };
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);
    await expect(tracker.applyPendingReload('s1')).resolves.toBeUndefined();
    expect(tracker.hasPendingReload('s1')).toBe(false);
  });

  it('repeated notifications are idempotent (last one wins, single close)', async () => {
    const { deps, live, closed } = makeDeps([{ id: 's1', providerId: 'p1' }]);
    addLive(live, { id: 's1', agentKind: 'pi', remoteHostId: null, running: false });
    const tracker = createPiCredentialReloadTracker(deps);
    await tracker.notifyCredentialsChanged(['p1']);
    await tracker.notifyCredentialsChanged(['p1']);
    await tracker.applyPendingReload('s1');
    expect(closed).toEqual(['s1']);
  });
});

describe('module-level holder', () => {
  it('notifyPiCredentialsChanged routes through the installed tracker (and no-ops without one)', async () => {
    const { setPiCredentialReloadTracker, notifyPiCredentialsChanged } = await import(
      '../piCredentialReload.js',
    );
    // 未装配时不得抛。
    expect(() => notifyPiCredentialsChanged(['p1'])).not.toThrow();

    const { deps, live, closed } = makeDeps([{ id: 's1', providerId: 'p1' }]);
    addLive(live, { id: 's1', agentKind: 'pi', remoteHostId: null, running: false });
    const tracker = createPiCredentialReloadTracker(deps);
    setPiCredentialReloadTracker(tracker);
    try {
      notifyPiCredentialsChanged(['p1']);
      // notify 是 fire-and-forget 异步;等微任务 flushing 后再验证标记。
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(tracker.hasPendingReload('s1')).toBe(true);
      await tracker.applyPendingReload('s1');
      expect(closed).toEqual(['s1']);
    } finally {
      setPiCredentialReloadTracker(null);
    }
  });
});

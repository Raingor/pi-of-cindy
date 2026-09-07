// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AuthContext initialize 链 .catch 回归(implementation-plan Step 3b WHAT2 v6.3)。
 *
 * pi-only 分支没有 /login；真实 reject 不能落 signed-out，否则 Splash 完成后
 * ProtectedRoute 返回空树而整窗白屏。因此 .catch 必须统一 logger 记录 + 落 local
 * snapshot,再 .finally。本单测**必须真实 mock service.initialize reject**。
 */

const mocks = vi.hoisted(() => ({
  service: {
    initialize: vi.fn<() => Promise<unknown>>(),
    onAuthStateChange: vi.fn(() => () => {}),
    dispose: vi.fn(),
    getLoginState: vi.fn(async () => ({ ok: true, state: null })),
    dispatchLoginAction: vi.fn(async () => ({ ok: true, state: null })),
    logout: vi.fn(async () => {}),
  },
  logError: vi.fn(),
  unhandled: [] as unknown[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/authService', () => ({ createAuthService: () => mocks.service }));
vi.mock('@/lib/makerChatStore', () => ({
  cancelRemoteOptimisticSendsForDataOwnerBoundary: vi.fn(),
  setCurrentUserName: vi.fn(),
}));
vi.mock('@/lib/sessionsStore', () => ({ sessionsStore: { reset: vi.fn() } }));
vi.mock('@/features/cc-agent/hooks/useWorkers', () => ({ clearWorkersCache: vi.fn() }));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => {}) }),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.logError,
    fatal: vi.fn(),
  }),
}));

import { AuthProvider, useAuth } from '../AuthContext';

function AuthProbe() {
  const { isInitializing, isAuthenticated, user, loginState, mode, dataOwnerId, canEnterApp } =
    useAuth();
  return (
    <div data-testid="auth-probe">
      {`init=${isInitializing};authed=${isAuthenticated};mode=${mode};owner=${
        dataOwnerId ?? 'null'
      };canEnter=${canEnterApp};user=${user ? user.id : 'null'};login=${
        loginState ? 'set' : 'null'
      }`}
    </div>
  );
}

const onUnhandled = (reason: unknown) => {
  mocks.unhandled.push(reason);
};

beforeEach(() => {
  mocks.service.initialize.mockReset();
  mocks.logError.mockClear();
  mocks.unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    onAuthSessionExpired: () => () => {},
  };
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  cleanup();
  vi.clearAllMocks();
});

describe('AuthContext initialize .catch 归一本地模式', () => {
  it('service.initialize 真实 reject → 无 unhandled rejection,统一 logger 记录,落 local snapshot', async () => {
    const boom = new Error('main auth channel exploded');
    mocks.service.initialize.mockRejectedValue(boom);

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    // 冲刷 initialize reject → catch → finally 微任务链 + 潜在的延迟 unhandled 通知
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // pi-only 归一本地模式:isInitializing=false、可进工作台、local owner、无用户
    expect(screen.getByTestId('auth-probe').textContent).toBe(
      'init=false;authed=false;mode=local;owner=local-v1;canEnter=true;user=null;login=null',
    );
    // 统一 logger 记录(不新增视觉分支)
    expect(mocks.logError).toHaveBeenCalled();
    expect(mocks.logError.mock.calls[0].some((arg) => arg === boom)).toBe(true);
    // 无 unhandled rejection
    expect(mocks.unhandled).toEqual([]);
  });

  it('initialize resolve 正常路径不受影响(catch 不吞正常快照)', async () => {
    mocks.service.initialize.mockResolvedValue({
      isAuthenticated: true,
      mode: 'cloud',
      dataOwnerId: 'owner-1',
      ownerGeneration: 1,
      canEnterApp: true,
      isCanary: false,
      deviceId: 'd1',
      hasAccountDeletionReceipt: false,
      accountDeletionRestored: false,
      credentialStoreUnavailable: false,
      user: { id: 'u1', name: 'Tester' },
    });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('auth-probe').textContent).toBe(
      'init=false;authed=true;mode=cloud;owner=owner-1;canEnter=true;user=u1;login=null',
    );
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

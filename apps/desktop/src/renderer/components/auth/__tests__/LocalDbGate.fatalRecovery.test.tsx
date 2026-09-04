// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LocalDbGate 的 fatal 恢复面。
 *
 * 这份文件原来守的是「返回登录」逃生口:localDb 起不来时 exitLocalMode() / logout()
 * 再跳 /login,连 teardown 失败也要保证跳得走。2026-09-03 用户指令移除登录后那条路
 * 不存在了 —— 再跳就是从一个有恢复按钮的错误页掉进彻底的空白页,比困在错误页更糟。
 *
 * 所以现在守反过来:LocalDbGate **不得**再传 onBackToLogin(于是 fatal 弹框不出
 * cancel 按钮),也不得再引用 exitLocalMode / logout / '/login'。主恢复路径
 * (重启装更新 / 检查更新)在 LocalDbFatalScreen 自己身上,不受影响。
 */

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ dataOwnerId: 'local-v1' }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: mocks.warn,
    error: vi.fn(),
  }),
}));

vi.mock('@/components/error/LocalDbFatalScreen', () => ({
  LocalDbFatalScreen: ({ onBackToLogin }: { onBackToLogin?: () => void }) => (
    <div data-testid="fatal-screen" data-has-back-to-login={String(onBackToLogin !== undefined)} />
  ),
}));

import { LocalDbGate } from '../LocalDbGate';

describe('LocalDbGate fatal recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      localDb: {
        ensureReady: vi.fn().mockResolvedValue({
          ready: false,
          error: { code: 'DB_INIT_FAILED', message: 'broken database' },
        }),
      },
      appReadyForBot: vi.fn(),
    };
  });

  it('shows the fatal screen without a back-to-login escape hatch', async () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<LocalDbGate />}>
            <Route index element={<div>main</div>} />
          </Route>
          <Route path="*" element={<div data-testid="no-match" />} />
        </Routes>
      </MemoryRouter>,
    );

    const screenEl = await screen.findByTestId('fatal-screen');
    expect(screenEl.getAttribute('data-has-back-to-login')).toBe('false');
    expect(screen.queryByTestId('no-match')).toBeNull();
  });
});

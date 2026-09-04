// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  current: {
    mode: 'cloud' as 'signed-out' | 'local' | 'cloud',
    isInitializing: false,
    dataOwnerId: 'user-1' as string | null,
    canEnterApp: true,
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.current,
}));

import { ProtectedRoute } from '../ProtectedRoute';

/**
 * 2026-09-03 移除登录后 ProtectedRoute 不再是「未登录赶去登录页」的鲁你,而只是
 * 一扇「等 owner 过渡完成」的等待态门:进不去时渲染 null 等,不能再 Navigate 到
 * /login —— 那条路由已随登录线一起下架,跳过去就是一片空白。
 *
 * 路由表里故意不再注册 /login:真跳了会落到 NoMatch,断言能直接看出来。
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div data-testid="app-shell" />} />
        </Route>
        <Route path="*" element={<div data-testid="no-match" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    cleanup();
    authState.current = {
      mode: 'cloud',
      isInitializing: false,
      dataOwnerId: 'user-1',
      canEnterApp: true,
    };
  });

  it('keeps the shell mounted while same-owner refresh still allows entry', () => {
    authState.current = {
      mode: 'cloud',
      isInitializing: false,
      dataOwnerId: 'user-1',
      canEnterApp: true,
    };
    renderAt('/');
    expect(screen.getByTestId('app-shell')).toBeTruthy();
  });

  it('renders nothing (does not redirect) during a real owner-change window', () => {
    authState.current = {
      mode: 'cloud',
      isInitializing: false,
      dataOwnerId: 'user-1',
      canEnterApp: false,
    };
    renderAt('/');
    expect(screen.queryByTestId('app-shell')).toBeNull();
    expect(screen.queryByTestId('no-match')).toBeNull();
  });

  it('renders nothing while still initializing', () => {
    authState.current = {
      mode: 'local',
      isInitializing: true,
      dataOwnerId: null,
      canEnterApp: false,
    };
    renderAt('/');
    expect(screen.queryByTestId('app-shell')).toBeNull();
    expect(screen.queryByTestId('no-match')).toBeNull();
  });

  it('never sends a signed-out session anywhere — main commits local mode instead', () => {
    // 这一态在本 fork 里只是瞬时:authManager.initialize() 的单一收口会把它提交成
    // local。门这边只要保证不跳走(跳去 //login 会落 no-match = 空白页)。
    authState.current = {
      mode: 'signed-out',
      isInitializing: false,
      dataOwnerId: null,
      canEnterApp: false,
    };
    renderAt('/');
    expect(screen.queryByTestId('app-shell')).toBeNull();
    expect(screen.queryByTestId('no-match')).toBeNull();
  });

  it('lets local mode enter the app without a Cindy account', () => {
    authState.current = {
      mode: 'local',
      isInitializing: false,
      dataOwnerId: 'local-v1',
      canEnterApp: true,
    };
    renderAt('/');
    expect(screen.getByTestId('app-shell')).toBeTruthy();
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UserInfoSection 的行为测试(挂载渲染)。
 *
 * 这份文件原来守的是「移动端下载」入口 + 它拉起的 MobileDownloadDialog。2026-09-03
 * 用户指令移除登录后,底部这一格只剩「打开设置」按钮与版本行,移动端下载(依赖 Cindy
 * 云端账号)与更新历史火焰一起撤掉了 —— 现在守的是设置按钮在两态下都能点、以及
 * Beta 标仍跟在版本号旁边。
 */

const { betaChannelState, navigate, pathname } = vi.hoisted(() => ({
  betaChannelState: { enableBeta: false, isCustomized: false, loading: false },
  navigate: vi.fn(),
  pathname: { value: '/' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: pathname.value }),
  useNavigate: () => navigate,
}));

vi.mock('@/hooks/useBetaChannelSettings', () => ({
  useBetaChannelSettings: () => ({ state: betaChannelState }),
}));

import { UserInfoSection } from '@/components/sidebar/UserInfoSection';

beforeEach(() => {
  navigate.mockClear();
  betaChannelState.enableBeta = false;
  betaChannelState.loading = false;
  pathname.value = '/';
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      appDisplayVersion: '1.0.0',
      appDisplayVersionDetail: '1.0.0-test',
    },
  });
});

afterEach(cleanup);

describe('UserInfoSection 底部设置入口', () => {
  it('shows the Beta label beside the expanded app version when the channel is enabled', () => {
    betaChannelState.enableBeta = true;
    render(<UserInfoSection isCollapsed={false} />);

    expect(screen.getByTestId('sidebar-beta-channel-label').textContent).toBe(
      'settings.betaChannel.badge',
    );
    expect(screen.getByRole('button', { name: 'sidebar.user.openSettings' })).toBeTruthy();
  });

  it('版本号 loading 未完成时不显示 Beta 标', () => {
    betaChannelState.enableBeta = true;
    betaChannelState.loading = true;
    render(<UserInfoSection isCollapsed={false} />);

    expect(screen.queryByTestId('sidebar-beta-channel-label')).toBeNull();
  });

  it.each([
    ['expanded', false],
    ['collapsed', true],
  ])('%s 态点设置按钮进 /settings', (_label, isCollapsed) => {
    render(<UserInfoSection isCollapsed={isCollapsed} />);

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.user.openSettings' }));

    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('已经在设置页时不再重复 navigate', () => {
    pathname.value = '/settings';
    render(<UserInfoSection isCollapsed={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.user.openSettings' }));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('展开态版本行显示短版本号(完整版本号在 Tip 里,不走原生 title)', () => {
    render(<UserInfoSection isCollapsed={false} />);

    const button = screen.getByRole('button', { name: 'sidebar.user.openSettings' });
    expect(button.textContent).toContain('1.0.0');
    expect(button.getAttribute('title')).toBeNull();
  });
});

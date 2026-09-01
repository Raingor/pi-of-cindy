// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TAB_IDS } from '@/lib/tabLabels';
import { SettingsSidebarNav } from '../SettingsSidebarNav';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.title': 'Settings',
        'settings.tabs.general': 'General',
        'settings.tabs.billing': 'Billing',
      })[key] ?? key,
  }),
}));

describe('SettingsSidebarNav', () => {
  it('selects a visible settings tab in-panel', () => {
    const onSelectTab = vi.fn();

    render(<SettingsSidebarNav tabIds={TAB_IDS} activeTab="general" onSelectTab={onSelectTab} />);

    // 计费 tab 已随 pi-only 下架(tabLabels.ts 注释),改用常驻「模型供应商」验证选中态。
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.providers' }));

    expect(onSelectTab).toHaveBeenCalledWith('providers');
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'settings.tabs.providers' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  // Pi-first 改造下架的入口(后端保留),侧栏不再渲染。计费(billing)与
  // 工具密钥(api-keys)、第三方平台(connections)同批下架;task-import/
  // plugins(ghosts)/builtin-tools 于 09-01 重新上栏,已从本清单移除。
  it('does not render the retired Usage / Voice Input / IM Bot / Billing / Import entries', () => {
    render(<SettingsSidebarNav tabIds={TAB_IDS} activeTab="general" onSelectTab={vi.fn()} />);

    const tabIds = screen.getAllByRole('tab').map((tab) => tab.id);
    for (const retired of ['usage', 'voice-input', 'im-bot', 'billing', 'api-keys', 'connections']) {
      expect(tabIds).not.toContain(`settings-tab-${retired}`);
    }
  });

  it('renders a leading icon for every settings tab', () => {
    render(<SettingsSidebarNav tabIds={TAB_IDS} activeTab="general" onSelectTab={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(TAB_IDS.length);
    for (const tab of tabs) {
      expect(tab.querySelector('svg')).not.toBeNull();
    }
  });
});

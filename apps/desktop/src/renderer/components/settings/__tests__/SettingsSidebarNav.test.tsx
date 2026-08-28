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

    fireEvent.click(screen.getByRole('tab', { name: 'Billing' }));

    expect(onSelectTab).toHaveBeenCalledWith('billing');
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Billing' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  // 2026-08-29 Pi-first 改造:六个入口下架(后端保留),侧栏不再渲染。
  it('does not render the retired Usage / Voice Input / IM Bot / Import / Plugins / Tools entries', () => {
    render(<SettingsSidebarNav tabIds={TAB_IDS} activeTab="general" onSelectTab={vi.fn()} />);

    const tabIds = screen.getAllByRole('tab').map((tab) => tab.id);
    for (const retired of ['usage', 'voice-input', 'im-bot', 'import', 'ghosts', 'builtin-tools']) {
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

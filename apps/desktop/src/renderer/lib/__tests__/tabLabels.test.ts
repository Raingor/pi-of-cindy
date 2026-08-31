import { describe, expect, it } from 'vitest';

import { isSettingsTab, TAB_IDS } from '@/lib/tabLabels';

describe('Settings tab order', () => {
  it('places Pi dashboard immediately after computer use', () => {
    const computerUseIndex = TAB_IDS.indexOf('computer-use');

    expect(TAB_IDS.slice(computerUseIndex, computerUseIndex + 2)).toEqual([
      'computer-use',
      'pi-dashboard',
    ]);
  });

  it('keeps the Pi tool tabs together in dashboard-first order', () => {
    const dashboardIndex = TAB_IDS.indexOf('pi-dashboard');

    expect(TAB_IDS.slice(dashboardIndex, dashboardIndex + 6)).toEqual([
      'pi-dashboard',
      'pi-sessions',
      'pi-memory',
      'pi-subagents',
      'pi-speedtest',
      'pi-packages',
    ]);
  });

  it('keeps Pi extensions inside General instead of exposing a top-level tab', () => {
    expect(TAB_IDS).not.toContain('pi-extensions');
    expect(isSettingsTab('pi-extensions')).toBe(false);
  });

  it('places Plugins immediately before builtin tools', () => {
    const toolsIndex = TAB_IDS.indexOf('builtin-tools');

    expect(TAB_IDS.slice(toolsIndex - 1, toolsIndex + 1)).toEqual(['ghosts', 'builtin-tools']);
  });

  // 计费、用量历史、语音输入与 IM 机器人已从可路由 tab 下架:本分支只跑本机 Pi
  // harness,用量口径由 Pi 仪表盘承担。id 仍留在 SettingsTab 类型里供旧深链回落。
  it('drops the cloud-only tabs from the routable set', () => {
    for (const retired of ['billing', 'usage', 'voice-input', 'im-bot'] as const) {
      expect(TAB_IDS as readonly string[]).not.toContain(retired);
      expect(isSettingsTab(retired)).toBe(false);
    }
  });
});

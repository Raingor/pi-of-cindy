import { describe, expect, it } from 'vitest';

import { isSettingsTab, TAB_IDS } from '@/lib/tabLabels';

describe('Settings tab order', () => {
  // 2026-09-02 用户指令:Pi 是本分支的主工作台,整块紧跟「模型供应商」,
  // 不再排在常规设置尾部。
  it('places the Pi tool block immediately after providers', () => {
    const providersIndex = TAB_IDS.indexOf('providers');

    expect(TAB_IDS.slice(providersIndex, providersIndex + 2)).toEqual([
      'providers',
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

  // 2026-09-03 用户指令:灵动岛 / 插件 / 帮助 / 关于 四项从设置下架。
  // 插件目录仍在主侧栏 /plugins;灵动岛服务与后端模块全部保留,只是没有设置入口。
  it('drops the retired island / plugins / help / about tabs from the routable set', () => {
    for (const retired of ['agent-island', 'ghosts', 'help', 'about'] as const) {
      expect(TAB_IDS as readonly string[]).not.toContain(retired);
      expect(isSettingsTab(retired)).toBe(false);
    }
  });

  it('keeps builtin tools between remote control and computer use', () => {
    const toolsIndex = TAB_IDS.indexOf('builtin-tools');

    expect(TAB_IDS.slice(toolsIndex - 1, toolsIndex + 2)).toEqual([
      'remote-control',
      'builtin-tools',
      'computer-use',
    ]);
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

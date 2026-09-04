/**
 * userInfoSectionHover.test.ts
 * ---------------------------------------------------------------------------
 * UserInfoSection 的源码契约测试(静态扫描,不挂载组件)。
 *
 * 2026-09-03 用户指令移除登录后,这一格从「账号胶囊」变成单一的「打开设置」入口:
 * 头像 / 昵称 / 账号切换 / 退出 / 移动端下载 / 更新历史火焰全部撤掉,只留设置按钮
 * 与版本行。原来这份文件守的是方案 D 的三层 hover 叠色契约(胶囊承载 hover +
 * .flame-btn / .mobile-download-btn 两个 :has() 例外),内嵌次级按钮没了,那套契约
 * 也随之作废 —— 现在守的是新形态:
 *
 * 1. 底部 footer slot 与胶囊尺寸不变(展开 h-10 胶囊 / rail 66px 居中),换皮不换位;
 * 2. 颜色仍走 --sidebar-user-card-* 语义 token(浅/深色双模式同源,不得硬编码);
 * 3. 版本行的区域标注仍来自 shared 单点,不在组件里另写映射;
 * 4. 账号相关的一切(useAuth / 头像 / 账号切换 / 退出 / 移动端下载 / 火焰)不得回流。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = resolve(__dirname, '..', 'components', 'sidebar', 'UserInfoSection.tsx');
const source = readFileSync(sourcePath, 'utf8');
const localePath = resolve(__dirname, '..', 'i18n', 'locales', 'zh-CN', 'common.json');
const locale = JSON.parse(readFileSync(localePath, 'utf8')) as {
  sidebar: { user: { openSettings: string } };
};

// ── 形态 1: footer slot + tokenized 胶囊 ────────────────────────────────

describe('UserInfoSection — 底部 footer slot 与胶囊形态', () => {
  it('outer div keeps the sidebar footer slot', () => {
    expect(source).toContain('mt-auto px-3 pb-3 pt-2');
  });

  it('展开态是与旧账号胶囊同尺寸的整行按钮(h-10 / rounded-full / px-[7px])', () => {
    expect(source).toContain(
      "'flex h-10 w-full items-center gap-[10px] rounded-full px-[7px] text-left'",
    );
  });

  it('沿用 CREATE AGENT 侧栏的 user card 语义 token', () => {
    expect(source).toContain('border-[var(--sidebar-user-card-border)]');
    expect(source).toContain('bg-[var(--sidebar-user-card-bg)]');
    expect(source).toContain('text-[var(--sidebar-user-card-text)]');
  });

  it('按钮自己承载 hover(不再有内嵌次级按钮需要 :has() 还原底色)', () => {
    expect(source).toContain("'transition-colors hover:bg-[var(--sidebar-user-card-bg-hover)]'");
    expect(source).not.toContain('has-[.flame-btn:hover]');
    expect(source).not.toContain('has-[.mobile-download-btn:hover]');
  });

  it('rail 态保留 66px 居中槽位', () => {
    expect(source).toContain(
      'className="mt-auto flex h-[66px] flex-col items-center justify-center px-3"',
    );
  });

  it('两态都有可见的键盘焦点环', () => {
    expect(
      source.match(
        /focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-\[var\(--focus-ring\)\]/g,
      ),
    ).toHaveLength(2);
  });
});

// ── 形态 2: 打开设置 ────────────────────────────────────────────────────

describe('UserInfoSection — 打开设置入口', () => {
  it('两态都是同一个设置按钮,点了进 /settings', () => {
    expect(source).toContain("import { Settings } from 'lucide-react';");
    expect(source).toContain("const settingsLabel = t('sidebar.user.openSettings');");
    expect(source).toContain("const isOnSettings = location.pathname === '/settings';");
    expect(source).toContain("if (!isOnSettings) navigate('/settings');");
    expect(source.match(/onClick=\{openSettings\}/g)).toHaveLength(2);
    expect(source.match(/aria-label=\{settingsLabel\}/g)).toHaveLength(2);
    expect(locale.sidebar.user.openSettings).toBe('设置');
  });

  it('两态都把完整版本号放在托管 Tip 里(不用原生 title)', () => {
    // 图标按铮不得靠原生 title 做提示,契约见 iconButtonTooltips.test.ts。
    expect(source).not.toContain('title={appVersionLabelDetail}');
    // rail 态没有可见文字,Tip 里要带上按铮名;展开态按铮自带文字,只需版本号。
    expect(source).toContain('text={`${settingsLabel} · ${appVersionLabelDetail}`}');
    expect(source).toContain('<Tip text={appVersionLabelDetail} side="right">');
  });
});

// ── 形态 3: 版本行 ──────────────────────────────────────────────────────

describe('UserInfoSection — version label', () => {
  it('labels only the non-global builds alongside the app version', () => {
    expect(source).toContain("import { CURRENT_CINDY_REGION } from '../../../shared/brandRegion';");
    // 「哪些区域要标」必须来自 shared 单点,不得在组件里再写一份映射
    // (issue 反馈链路同源;口径见 DESIGN.md §16.3 / region-and-editions §2.3)。
    expect(source).toContain("import { shouldLabelRegion } from '../../../shared/regionCode';");
    expect(source).not.toMatch(/const REGION_LABEL/);
    // global 故意不贴标签,落到 null 分支只显示版本号。
    expect(source).toMatch(
      /const appRegionLabel = !shouldLabelRegion\(CURRENT_CINDY_REGION\)\s*\n\s*\? null\s*\n\s*: CURRENT_CINDY_REGION === 'cn'/,
    );
    // 展示文案走 i18n,且 key 为字面量分支(check:i18n 静态提取要看得到)。
    expect(source).toContain("t('sidebar.user.regionCodeCn')");
    expect(source).toContain("t('sidebar.user.regionCodeDev')");
    expect(source).not.toContain("'Global'");
    expect(source).not.toMatch(/'CN'|'Dev'/);
    expect(source).toMatch(
      /const appVersionLabel = appRegionLabel\s*\n\s*\? `\$\{appRegionLabel\} · \$\{appDisplayVersion\}`\s*\n\s*: appDisplayVersion;/,
    );
    expect(source).not.toContain('XD.Inc');
    expect(source).toContain('{appVersionLabel}');
  });

  it('shows the Beta label only after the persisted channel state has loaded', () => {
    expect(source).toContain(
      "import { useBetaChannelSettings } from '@/hooks/useBetaChannelSettings';",
    );
    expect(source).toContain(
      'const showBetaLabel = !betaChannelState.loading && betaChannelState.enableBeta;',
    );
    expect(source).toContain('data-testid="sidebar-beta-channel-label"');
    expect(source).not.toContain('beta-channel-badge');
    expect(source).toContain("t('settings.betaChannel.badge')");
  });
});

// ── 形态 4: 账号概念不得回流 ────────────────────────────────────────────

describe('UserInfoSection — 账号入口已随登录一起下架', () => {
  it('不再读 auth 状态', () => {
    expect(source).not.toContain('useAuth');
    expect(source).not.toContain('isCanary');
    expect(source).not.toContain('displayName');
    expect(source).not.toContain('avatar');
  });

  it('不再有账号切换 / 退出 / 添加账号', () => {
    expect(source).not.toContain('AccountSwitcherDialog');
    expect(source).not.toContain('beginAddAccount');
    expect(source).not.toContain('useLogout');
    expect(source).not.toContain('DropdownMenu');
    expect(source).not.toContain("t('sidebar.user.menuLogout')");
    expect(source).not.toContain("t('sidebar.user.moreLabel'");
  });

  it('不再有移动端下载与更新历史火焰(两者各自另有去处,见组件头注释)', () => {
    expect(source).not.toContain('MobileDownloadDialog');
    expect(source).not.toContain('Smartphone');
    expect(source).not.toContain('Flame');
    expect(source).not.toContain('flame-btn');
    expect(source).not.toContain('onOpenUpdateNotice');
    expect(source).not.toContain('useUpdateStatus');
    expect(source).not.toContain('useUpdateBannerDismiss');
  });

  it('不再引用已下架的「远程连接」设置分区', () => {
    expect(source).not.toContain('remote-control');
  });
});

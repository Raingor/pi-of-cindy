import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useBetaChannelSettings } from '@/hooks/useBetaChannelSettings';
import { Tip } from '@/components/ui/tooltip';
import { CURRENT_CINDY_REGION } from '../../../shared/brandRegion';
import { shouldLabelRegion } from '../../../shared/regionCode';

interface UserInfoSectionProps {
  isCollapsed: boolean;
}

/**
 * 侧栏底部区 F3 —— 一个「打开设置」按钮 + 版本行。
 *
 * 2026-09-03 用户指令:本 fork 移除登录,底部原来的账号胶囊(头像 / 昵称 /
 * 账号切换 / 退出 / 移动端下载 / 更新历史火焰)整块换成单一的设置入口。account
 * 概念在 pi-only 分支已不存在(应用常驻本地会话,见 authManager 的自动本地模式),
 * 那些入口留着只会指向不可达的登录线。
 *
 * 版本行留在这里:「关于」分区已下架,这是构建版本在 UI 上唯一的落点(hover 看
 * 完整的 version · commit)。
 *
 * 被撤掉的两个入口各自另有去处,不是唯一路径:
 *   - 更新历史 → 原生菜单「查看版本日志」(`open-release-notes`);
 *   - 移动端下载 → 依赖 Cindy 云端账号,本分支不适用。
 * 唯一真实损失是「唤回被关掉的更新横幅」(原火焰按钮的第二职责),版本无关的
 * 本地构建收不到更新,对本分支无影响。
 */
export function UserInfoSection({ isCollapsed }: UserInfoSectionProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { state: betaChannelState } = useBetaChannelSettings();
  const showBetaLabel = !betaChannelState.loading && betaChannelState.enableBeta;

  const appDisplayVersion = window.electronAPI.appDisplayVersion;
  const appDisplayVersionDetail = window.electronAPI.appDisplayVersionDetail;
  // 版本行的区域前缀。「哪些区域要标」只有 CINDY_REGION_CODE 一个事实源(issue
  // 反馈链路同源),口径见 DESIGN.md §16.3 与 region-and-editions.md §2.3:
  // cn → CN、dev → Dev、**global 不标**——Cindy 默认版本不给自己贴标签自证是全球版,
  // global 构建这一行只剩版本号。展示文案走 i18n(同 login.regionPill.* 的做法),
  // 便于日后改判为「中国大陆版」这类可译文案时不必回改组件;key 写成字面量分支而非
  // 动态拼接,保证 pnpm check:i18n 的静态提取能看到全部 key。一致性由
  // __tests__/regionCode.consistency.test.ts 逐区域逐语言断言。
  const appRegionLabel = !shouldLabelRegion(CURRENT_CINDY_REGION)
    ? null
    : CURRENT_CINDY_REGION === 'cn'
      ? t('sidebar.user.regionCodeCn')
      : t('sidebar.user.regionCodeDev');
  const appVersionLabel = appRegionLabel
    ? `${appRegionLabel} · ${appDisplayVersion}`
    : appDisplayVersion;
  const appVersionLabelDetail = appRegionLabel
    ? `${appRegionLabel} · ${appDisplayVersionDetail}`
    : appDisplayVersionDetail;

  const settingsLabel = t('sidebar.user.openSettings');
  const isOnSettings = location.pathname === '/settings';
  const openSettings = () => {
    if (!isOnSettings) navigate('/settings');
  };

  if (isCollapsed) {
    return (
      <div className="mt-auto flex h-[66px] flex-col items-center justify-center px-3">
        <Tip text={`${settingsLabel} · ${appVersionLabelDetail}`} side="right">
          <button
            type="button"
            onClick={openSettings}
            aria-label={settingsLabel}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full',
              'border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)]',
              'text-[var(--sidebar-user-card-text)] transition-colors',
              'hover:bg-[var(--sidebar-user-card-bg-hover)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
            )}
          >
            <Settings aria-hidden="true" size={17} strokeWidth={1.75} />
          </button>
        </Tip>
      </div>
    );
  }

  return (
    <div className="mt-auto px-3 pb-3 pt-2">
      {/* 胶囊沿用原账号卡的 --sidebar-user-card-* 语义 token(浅/深色双模式同源),
        整体承载 hover,不再有内嵌的次级按钮需要 :has() 还原底色。
        完整版本号走 Tip 而非原生 title:图标按钮的提示必须是可见的托管 Tip
        (契约由 __tests__/iconButtonTooltips.test.ts 全局扫描守住)。 */}
      <Tip text={appVersionLabelDetail} side="right">
        <button
          type="button"
          onClick={openSettings}
          aria-label={settingsLabel}
          className={cn(
            'flex h-10 w-full items-center gap-[10px] rounded-full px-[7px] text-left',
            'border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)]',
            'transition-colors hover:bg-[var(--sidebar-user-card-bg-hover)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
          )}
        >
          {/* 27px 圆形图标槽 —— 沿用原头像位的尺寸,底部区高度不变。 */}
          <span
            className={cn(
              'flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full',
              'border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)]',
              'text-[var(--sidebar-user-card-text)]',
            )}
          >
            <Settings aria-hidden="true" size={15} strokeWidth={1.75} />
          </span>

          <span className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-14 font-semibold leading-[1.286] text-[var(--sidebar-user-card-text)]">
              {settingsLabel}
            </span>
            {/* 2px gap 与同栏 userNameContainer 保持一致。 */}
            <span className="flex min-w-0 items-center gap-1 text-10 leading-[1.3] text-[var(--sidebar-user-card-text)]">
              <span className="truncate opacity-80">{appVersionLabel}</span>
              {showBetaLabel ? (
                <span
                  className="shrink-0 select-none opacity-80"
                  data-testid="sidebar-beta-channel-label"
                >
                  {t('settings.betaChannel.badge')}
                </span>
              ) : null}
            </span>
          </span>
        </button>
      </Tip>
    </div>
  );
}

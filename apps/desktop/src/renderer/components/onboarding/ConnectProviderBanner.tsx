/**
 * ConnectProviderBanner — 零可用模型时已有会话顶部的「连接供应商」引导条。
 *
 * 与首屏 ConnectProviderCard 共享同一判定与 dismiss key(useProviderOnboarding):
 * 任一处 dismiss,两处一起消失。骨架对齐 UpgradeBanner(自判 visible、不可见渲染
 * null、挂载处零开销),但这是引导不是告警——用中性 token,不用 amber。
 *
 * 2026-09-03 pi-only fork 移除登录后,CTA 不再按登录态分岸:永远直跳供应商
 * 设置页。原来的非 cloud 分支走 useSignInToCindy(),它会 exitLocalMode() 再跳
 * /login —— 在本 fork 里等于把会话推回 signed-out 后卡在空白页。
 */

import { Unplug, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import { useProviderOnboarding } from '@/hooks/useProviderOnboarding';

export function ConnectProviderBanner({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onboarding = useProviderOnboarding();

  if (!onboarding.visible) return null;

  return (
    <div
      data-testid="connect-provider-banner"
      className={cn(
        'mx-auto flex select-none items-center gap-2 rounded-md px-3 py-2',
        'border border-[var(--border-default)] bg-[var(--surface-elevated)]',
        className,
      )}
      style={style}
    >
      <Unplug size={14} className="shrink-0 text-[var(--text-secondary)]" />
      <span className="flex-1 text-xs text-[var(--text-secondary)]">
        {t('onboarding.connectProvider.banner.text')}
      </span>
      <button
        type="button"
        onClick={() => navigate('/settings?tab=providers')}
        className="shrink-0 text-xs font-medium text-[var(--text-primary)] transition-opacity hover:opacity-70"
      >
        {t('onboarding.connectProvider.banner.connectCta')}
      </button>
      <button
        type="button"
        onClick={onboarding.dismiss}
        aria-label={t('onboarding.connectProvider.banner.dismissAria')}
        className="shrink-0 text-[var(--text-tertiary)] transition-opacity hover:opacity-70"
      >
        <X size={12} />
      </button>
    </div>
  );
}

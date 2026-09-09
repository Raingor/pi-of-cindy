import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCompactTokens } from '@cindy/maker-shared/usage-format';

import { Tip } from '@/components/ui/tooltip';
import type { ChatMessage } from '@/lib/makerChatStore';
import { findLatestTurnUsageDetails } from './sessionUsageStats';

export function SessionUsageStats({
  messages,
  contextWindow,
}: {
  messages: readonly Pick<ChatMessage, 'role' | 'turnUsageDetails'>[];
  contextWindow: number;
}) {
  const { t } = useTranslation();
  const details = useMemo(() => findLatestTurnUsageDetails(messages), [messages]);
  const input = details ? formatCompactTokens(details.inputTokens) : '—';
  const output = details ? formatCompactTokens(details.outputTokens) : '—';
  const cacheHitRate =
    details?.cacheHitRate == null ? '—' : `${Math.round(details.cacheHitRate * 100)}%`;
  const windowSize = contextWindow > 0 ? formatCompactTokens(contextWindow) : '—';
  const metrics = [
    [t('ccAgent.layout.usageStats.input'), input],
    [t('ccAgent.layout.usageStats.output'), output],
    [t('ccAgent.layout.usageStats.cacheHitRate'), cacheHitRate],
    [t('ccAgent.layout.usageStats.contextWindow'), windowSize],
  ];

  return (
    <Tip text={t('ccAgent.layout.usageStats.tooltip')} side="top">
      <div
        aria-label={t('ccAgent.layout.usageStats.ariaLabel', {
          input,
          output,
          cacheHitRate,
          contextWindow: windowSize,
        })}
        className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-[var(--status-bar-meta)]"
      >
        {metrics.map(([label, value], index) => (
          <span key={label} className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            {index > 0 ? <span aria-hidden className="opacity-45">·</span> : null}
            <span>{label}</span>
            <span className="font-medium text-foreground/80">{value}</span>
          </span>
        ))}
      </div>
    </Tip>
  );
}

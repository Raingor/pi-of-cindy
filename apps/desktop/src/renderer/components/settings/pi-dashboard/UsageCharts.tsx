import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

import type {
  PiUsageByRangeResult,
  PiDailyAggregate,
  PiHourlyAggregate,
  PiProviderUsageSummary,
} from '@/../main/pi-agent/piTypes';
import { cn } from '@/lib/utils';

const CHART_COLORS: Record<string, string> = {
  input: '#3b82f6',
  output: '#10b981',
  cacheRead: '#8b5cf6',
  cacheWrite: '#f59e0b',
  cost: '#ef4444',
};

const PIE_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];
const BAR_COLORS = ['#00d8ff', '#9ef01a', '#ffb84d', '#9f8cff', '#ff5c7a'];

const USD_TO_CNY = 7.25;

function formatTokensShort(n: number, lang: string): string {
  if (lang.startsWith('zh')) {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
    return n.toLocaleString('zh-CN');
  }
  if (lang.startsWith('ja')) {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
    return n.toLocaleString('ja-JP');
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatCostShort(v: number, currency: 'USD' | 'CNY'): string {
  if (currency === 'CNY') return `¥${(v * USD_TO_CNY).toFixed(4)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `¢${(v * 100).toFixed(1)}`;
  return `$${v.toFixed(4)}`;
}

// ─── Usage Trend Area Chart ────────────────────────────────────────────────

interface TrendChartProps {
  data: PiUsageByRangeResult;
  range: string;
  className?: string;
}

export function UsageTrendChart({ data, range, className }: TrendChartProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const chartData = useMemo(() => {
    const isHourly = range === 'today';
    const source = isHourly ? data.hourlyBreakdown : data.dailyBreakdown;
    return source.map((d: PiDailyAggregate | PiHourlyAggregate) => {
      const hourly = d as PiHourlyAggregate;
      const daily = d as PiDailyAggregate;
      const dateLabel = isHourly
        ? String(hourly.hour ?? '').slice(-5)
        : formatDateShort(daily.date || '');

      const input = 'inputTokens' in daily ? daily.inputTokens : 0;
      const output = 'outputTokens' in daily ? daily.outputTokens : 0;

      return {
        date: dateLabel,
        rawDate: daily.date || hourly.date || '',
        input: Math.round(input / 1000),
        output: Math.round(output / 1000),
        cost: parseFloat(daily.totalCost.toFixed(4)),
        requests: daily.totalRequests,
      };
    });
  }, [data, range]);

  const tooltipStyle = {
    backgroundColor: 'var(--settings-theme-card-bg)',
    border: '1px solid var(--settings-theme-card-border)',
    borderRadius: '8px',
    color: 'var(--settings-section-title)',
    fontSize: '12px',
  };

  return (
    <div className={cn('rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5', className)}>
      <h3 className="text-14 font-medium text-[var(--settings-section-title)]">
        {t('settings.piDashboard.usageTrend')}
      </h3>
      <p className="mb-4 text-12 text-[var(--settings-section-sublabel)]">
        {range === 'today'
          ? t('settings.piDashboard.rangeToday')
          : chartData.length > 0
            ? `${formatDateShort(chartData[0]?.rawDate ?? '')} – ${formatDateShort(chartData[chartData.length - 1]?.rawDate ?? '')}`
            : ''}
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--settings-theme-card-border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'var(--settings-section-sublabel)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="tokens"
            tick={{ fontSize: 11, fill: 'var(--settings-section-sublabel)' }}
            axisLine={false}
            tickLine={false}
            label={{
              value: t('settings.piDashboard.tokensK'),
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'var(--settings-section-sublabel)', fontSize: 11 },
            }}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={{ fontSize: 11, fill: 'var(--settings-section-sublabel)' }}
            axisLine={false}
            tickLine={false}
            label={{
              value: t('settings.piDashboard.costLabel'),
              angle: 90,
              position: 'insideRight',
              style: { fill: 'var(--settings-section-sublabel)', fontSize: 11 },
            }}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Area
            yAxisId="tokens"
            type="monotone"
            dataKey="input"
            stroke={CHART_COLORS.input}
            fill="none"
            strokeWidth={2}
            dot={false}
            name={t('settings.piDashboard.input')}
          />
          <Area
            yAxisId="tokens"
            type="monotone"
            dataKey="output"
            stroke={CHART_COLORS.output}
            fill="none"
            strokeWidth={2}
            dot={false}
            name={t('settings.piDashboard.output')}
          />
          <Area
            yAxisId="cost"
            type="monotone"
            dataKey="cost"
            stroke={CHART_COLORS.cost}
            fill="none"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            name={t('settings.piDashboard.cost')}
          />
          <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Token Composition Pie Chart ───────────────────────────────────────────

interface CompositionChartProps {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  className?: string;
}

export function TokenCompositionChart({
  totalInput,
  totalOutput,
  totalCacheRead,
  totalCacheWrite,
  totalTokens,
  className,
}: CompositionChartProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const composition = useMemo(
    () => [
      { key: 'input', value: totalInput, color: PIE_COLORS[0]! },
      { key: 'output', value: totalOutput, color: PIE_COLORS[1]! },
      { key: 'cacheRead', value: totalCacheRead, color: PIE_COLORS[2]! },
      { key: 'cacheWrite', value: totalCacheWrite, color: PIE_COLORS[3]! },
    ],
    [totalInput, totalOutput, totalCacheRead, totalCacheWrite],
  );

  const labels: Record<string, string> = {
    input: t('settings.piDashboard.input'),
    output: t('settings.piDashboard.output'),
    cacheRead: t('settings.piDashboard.cacheHit'),
    cacheWrite: t('settings.piDashboard.cacheCreate'),
  };

  const cacheTokens = totalCacheRead + totalCacheWrite;

  return (
    <div className={cn('rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5', className)}>
      <h3 className="mb-4 text-14 font-medium text-[var(--settings-section-title)]">
        {t('settings.piDashboard.tokenComposition')}
      </h3>
      <div className="flex items-center gap-6">
        <div className="relative h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={composition}
                dataKey="value"
                nameKey="key"
                innerRadius="60%"
                outerRadius="85%"
                paddingAngle={3}
                stroke="none"
              >
                {composition.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: unknown) =>
                  formatTokensShort(Number(Array.isArray(value) ? value[0] : value ?? 0), lang)
                }
                contentStyle={{
                  backgroundColor: 'var(--settings-theme-card-bg)',
                  border: '1px solid var(--settings-theme-card-border)',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <strong className="text-14 text-[var(--settings-section-title)]">
              {formatTokensShort(cacheTokens, lang)}
            </strong>
            <span className="text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piDashboard.cacheTotal')}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {composition.map((entry) => {
            const pct = totalTokens > 0 ? (entry.value / totalTokens) * 100 : 0;
            return (
              <div key={entry.key} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="text-12 text-[var(--settings-section-desc)]">{labels[entry.key]}</span>
                </div>
                <span className="text-12 font-medium text-[var(--settings-section-title)]">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Request Activity Bar Chart ────────────────────────────────────────────

interface ActivityChartProps {
  data: PiUsageByRangeResult;
  range: string;
  className?: string;
}

export function RequestActivityChart({ data, range, className }: ActivityChartProps) {
  const { t } = useTranslation();

  const activityData = useMemo(() => {
    const source = range === 'today' ? data.hourlyBreakdown : data.dailyBreakdown;
    return source.map((d: PiDailyAggregate | PiHourlyAggregate) => {
      const hourly = d as PiHourlyAggregate;
      const daily = d as PiDailyAggregate;
      const label =
        range === 'today'
          ? String(hourly.hour ?? '').slice(-5)
          : formatDateShort(daily.date || '');
      return {
        label,
        requests: daily.totalRequests ?? hourly.totalRequests ?? 0,
      };
    });
  }, [data, range]);

  return (
    <div className={cn('rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5', className)}>
      <h3 className="mb-4 text-14 font-medium text-[var(--settings-section-title)]">
        {t('settings.piDashboard.requestActivity')}
      </h3>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={activityData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--settings-theme-card-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: 'var(--settings-section-sublabel)' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 9, fill: 'var(--settings-section-sublabel)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(59,130,246,0.06)' }}
              contentStyle={{
                backgroundColor: 'var(--settings-theme-card-bg)',
                border: '1px solid var(--settings-theme-card-border)',
                borderRadius: '8px',
                fontSize: '11px',
              }}
            />
            <Bar dataKey="requests" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-between text-12">
        <span className="text-[var(--settings-section-sublabel)]">{t('settings.piDashboard.totalRequests')}</span>
        <strong className="text-[var(--settings-section-title)]">{data.totalRequests.toLocaleString()}</strong>
      </div>
    </div>
  );
}

// ─── Provider Distribution ─────────────────────────────────────────────────

interface ProviderDistributionProps {
  providers: PiProviderUsageSummary[];
  className?: string;
}

export function ProviderDistribution({ providers, className }: ProviderDistributionProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const sorted = useMemo(
    () => [...providers].filter((p) => p.totalRequests > 0).sort((a, b) => b.totalTokens - a.totalTokens),
    [providers],
  );
  const totalTokens = sorted.reduce((sum, p) => sum + p.totalTokens, 0);

  return (
    <div className={cn('rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5', className)}>
      <h3 className="mb-4 text-14 font-medium text-[var(--settings-section-title)]">
        {t('settings.piDashboard.providerMix')}
      </h3>
      <div className="flex flex-col gap-3">
        {sorted.length === 0 ? (
          <p className="text-12 text-[var(--settings-section-sublabel)]">
            {t('settings.piDashboard.noData')}
          </p>
        ) : (
          sorted.slice(0, 5).map((provider, index) => {
            const pct = totalTokens > 0 ? (provider.totalTokens / totalTokens) * 100 : 0;
            return (
              <div key={provider.providerId}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-12 font-medium text-[var(--settings-section-title)]">
                      {provider.providerName || provider.providerId}
                    </span>
                    <span className="ml-2 text-11 text-[var(--settings-section-sublabel)]">
                      {provider.modelCount} {t('settings.piDashboard.models')}
                    </span>
                  </div>
                  <span className="text-12 font-medium text-[var(--settings-section-title)]">
                    {formatTokensShort(provider.totalTokens, lang)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--settings-theme-card-border)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`,
                      backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                    }}
                  />
                </div>
                <span className="mt-0.5 text-11 text-[var(--settings-section-sublabel)]">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

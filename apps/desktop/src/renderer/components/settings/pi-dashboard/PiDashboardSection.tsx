import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Database,
  DollarSign,
  Download,
  RefreshCw,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { usePiUsage } from '@/hooks/usePiUsage';
import type {
  PiModelUsageSummary,
  PiProviderUsageSummary,
  PiRequestLogEntry,
} from '@/../main/pi-agent/piTypes';
import {
  UsageTrendChart,
  TokenCompositionChart,
  RequestActivityChart,
  ProviderDistribution,
  formatCostShort,
} from './UsageCharts';

type RangeKey = 'today' | '7d' | '30d' | 'custom';
type TabKey = 'log' | 'provider' | 'model';
type SortDir = 'asc' | 'desc';

const RANGE_KEYS: RangeKey[] = ['today', '7d', '30d', 'custom'];
const LOG_PAGE_SIZE = 20;

function cnTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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

function sortRows<T>(rows: T[], key: string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = Number((a as Record<string, unknown>)[key] ?? 0);
    const bv = Number((b as Record<string, unknown>)[key] ?? 0);
    return dir === 'desc' ? bv - av : av - bv;
  });
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  progress,
  children,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: number;
  progress?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-4">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-11 font-medium uppercase tracking-wider text-[var(--settings-section-sublabel)]">
          {title}
        </p>
        <div className="rounded-lg bg-[var(--surface)] p-1.5">{icon}</div>
      </div>
      <p className="text-20 font-semibold tracking-tight text-[var(--settings-section-title)]">{value}</p>
      {subtitle && (
        <p className="mt-0.5 text-11 text-[var(--settings-section-sublabel)]">{subtitle}</p>
      )}
      {trend !== undefined && (
        <div className="mt-1.5 flex items-center gap-1">
          {trend >= 0 ? (
            <ArrowUp className="h-3 w-3 text-emerald-500" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-500" />
          )}
          <span className={cn('text-11 font-medium', trend >= 0 ? 'text-emerald-500' : 'text-red-500')}>
            {Math.abs(trend).toFixed(1)}%
          </span>
          <span className="text-11 text-[var(--settings-section-sublabel)]">
            vs prev
          </span>
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--settings-theme-card-border)]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(progress, 100)}%`,
              backgroundColor: progress > 90 ? '#10b981' : '#3b82f6',
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Breakdown Row ──────────────────────────────────────────────────────────

function BreakdownRow({
  label,
  value,
  total,
  color,
  lang,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  lang: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-11 text-[var(--settings-section-desc)]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-11 font-medium text-[var(--settings-section-title)]">
          {formatTokensShort(value, lang)}
        </span>
        <span className="text-11 text-[var(--settings-section-sublabel)]">({pct.toFixed(1)}%)</span>
      </div>
    </div>
  );
}

// ─── Sortable Table Header ──────────────────────────────────────────────────

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: { key: string; dir: SortDir };
  onSort: (key: string) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className="cursor-pointer select-none px-4 py-2.5 text-right text-11 font-medium"
      style={{ color: active ? '#3b82f6' : 'var(--settings-section-sublabel)' }}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </span>
    </th>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function PiDashboardSection() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [range, setRange] = useState<RangeKey>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CNY'>('USD');
  const [tab, setTab] = useState<TabKey>('log');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [logPage, setLogPage] = useState(1);
  const [providerSort, setProviderSort] = useState<{ key: string; dir: SortDir }>({
    key: 'totalCost',
    dir: 'desc',
  });
  const [modelSort, setModelSort] = useState<{ key: string; dir: SortDir }>({
    key: 'totalCost',
    dir: 'desc',
  });

  const customInvalid = range === 'custom' && !!customFrom && !!customTo && customFrom > customTo;

  const { data, prevData, loading, refreshing, lastUpdated, error, refresh } = usePiUsage(
    range,
    customFrom,
    customTo,
    autoRefresh,
    refreshInterval,
  );

  const today = cnTodayStr();

  const tokenTrend =
    data && prevData && prevData.totalTokens > 0
      ? ((data.totalTokens - prevData.totalTokens) / prevData.totalTokens) * 100
      : undefined;
  const costTrend =
    data && prevData && prevData.totalCost > 0
      ? ((data.totalCost - prevData.totalCost) / prevData.totalCost) * 100
      : undefined;

  const sortedProviders = sortRows(
    data?.providerStats ?? [],
    providerSort.key,
    providerSort.dir,
  );
  const sortedModels = sortRows(
    data?.modelStats ?? [],
    modelSort.key,
    modelSort.dir,
  );
  const providerTotalCost = (data?.providerStats ?? []).reduce((s, p) => s + p.totalCost, 0);
  const totalLogPages = Math.max(1, Math.ceil((data?.requestLog.length ?? 0) / LOG_PAGE_SIZE));
  const currentLogPage = Math.min(logPage, totalLogPages);
  const pagedLog = (data?.requestLog ?? []).slice(
    (currentLogPage - 1) * LOG_PAGE_SIZE,
    currentLogPage * LOG_PAGE_SIZE,
  );

  const fmtCost = useCallback(
    (v: number) => formatCostShort(v, currency),
    [currency],
  );

  const toggleSort =
    (setter: React.Dispatch<React.SetStateAction<{ key: string; dir: SortDir }>>) =>
    (key: string) =>
      setter((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const handleExport = useCallback(() => {
    if (!data) return;
    if (tab === 'log') {
      downloadCsv(
        `pi-usage-log-${range}.csv`,
        ['date', 'provider', 'model', 'input', 'output', 'cost_usd', 'requests'],
        data.requestLog.map((r: PiRequestLogEntry) => [
          r.date,
          r.providerId,
          r.modelId,
          r.inputTokens,
          r.outputTokens,
          r.cost,
          r.requests,
        ]),
      );
    } else if (tab === 'provider') {
      downloadCsv(
        `pi-usage-provider-${range}.csv`,
        ['provider', 'tokens', 'cost_usd', 'requests', 'models'],
        sortedProviders.map((p) => [p.providerId, p.totalTokens, p.totalCost, p.totalRequests, p.modelCount]),
      );
    } else {
      downloadCsv(
        `pi-usage-model-${range}.csv`,
        ['model', 'provider', 'tokens', 'cost_usd', 'requests'],
        sortedModels.map((m) => [m.modelId, m.providerId, m.totalTokens, m.totalCost, m.totalRequests]),
      );
    }
  }, [data, tab, range, sortedProviders, sortedModels]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
          {t('settings.piDashboard.title')}
        </h2>
        <p className="mt-0.5 text-13 text-[var(--settings-section-desc)]">
          {data
            ? t('settings.piDashboard.subtitle', {
                // requestLog 按 (日期, 供应商, 模型) 分组后只剩十几行，用它的长度会跟
                // 下方「总请求数」卡片当场矛盾。计数要用真正的请求总数。
                count: data.totalRequests,
                cost: fmtCost(data.totalCost),
              })
            : t('settings.piDashboard.loading')}
          {lastUpdated && ` · ${t('settings.piDashboard.lastUpdated', { time: lastUpdated })}`}
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Date range selector */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--surface)] p-0.5">
          {RANGE_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-12 font-medium transition-colors',
                range === key
                  ? 'bg-[#3b82f6] text-white'
                  : 'text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
              )}
            >
              {t(`settings.piDashboard.range.${key}`)}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom || today}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] px-3 py-1.5 text-12 text-[var(--settings-input-text)]"
            />
            <span className="text-12 text-[var(--settings-section-sublabel)]">
              {t('settings.piDashboard.to')}
            </span>
            <input
              type="date"
              value={customTo || today}
              onChange={(e) => setCustomTo(e.target.value)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-12',
                customInvalid
                  ? 'border-red-500'
                  : 'border-[var(--settings-input-border)]',
                'bg-[var(--settings-input-bg)] text-[var(--settings-input-text)]',
              )}
            />
            {customInvalid && (
              <span className="text-12 text-red-500">{t('settings.piDashboard.invalidRange')}</span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Currency toggle */}
          <button
            onClick={() => setCurrency((c) => (c === 'USD' ? 'CNY' : 'USD'))}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-3 py-1.5 text-12 font-medium text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
          >
            <DollarSign className="h-3.5 w-3.5" />
            {currency}
          </button>

          {/* Refresh */}
          <button
            onClick={() => refresh(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-3 py-1.5 text-12 font-medium text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-12 font-medium transition-colors',
              'border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]',
              autoRefresh ? 'text-emerald-500' : 'text-[var(--settings-section-desc)]',
            )}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: autoRefresh ? '#10b981' : 'var(--settings-section-sublabel)' }}
            />
            {autoRefresh ? `${refreshInterval}s` : t('settings.piDashboard.off')}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-12 text-red-500">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--settings-theme-card-border)] border-t-[#3b82f6]" />
        </div>
      )}

      {/* Data content */}
      {!loading && data && (
        <div className={cn('flex flex-col gap-5 transition-opacity', refreshing && 'opacity-60')}>
          {/* Stat cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t('settings.piDashboard.totalTokens')}
              value={data.totalTokens.toLocaleString('en-US')}
              subtitle={`≈ ${formatTokensShort(data.totalTokens, lang)}`}
              icon={<Activity className="h-4 w-4 text-[#3b82f6]" />}
              trend={tokenTrend}
            >
              <div className="mt-2 space-y-0 border-t border-[var(--settings-theme-card-border)] pt-2">
                <BreakdownRow
                  label={t('settings.piDashboard.input')}
                  value={data.totalInput}
                  total={data.totalTokens}
                  color="#3b82f6"
                  lang={lang}
                />
                <BreakdownRow
                  label={t('settings.piDashboard.output')}
                  value={data.totalOutput}
                  total={data.totalTokens}
                  color="#10b981"
                  lang={lang}
                />
                <BreakdownRow
                  label={t('settings.piDashboard.cacheCreate')}
                  value={data.totalCacheWrite}
                  total={data.totalTokens}
                  color="#f59e0b"
                  lang={lang}
                />
                <BreakdownRow
                  label={t('settings.piDashboard.cacheHit')}
                  value={data.totalCacheRead}
                  total={data.totalTokens}
                  color="#8b5cf6"
                  lang={lang}
                />
              </div>
            </StatCard>

            <StatCard
              title={t('settings.piDashboard.totalRequests')}
              value={data.totalRequests.toLocaleString()}
              subtitle={t('settings.piDashboard.apiCalls')}
              icon={<BarChart3 className="h-4 w-4 text-[#10b981]" />}
            />

            <StatCard
              title={t('settings.piDashboard.totalCost')}
              value={fmtCost(data.totalCost)}
              subtitle={`${currency === 'CNY' ? `¥${(data.totalCost * 7.25).toFixed(4)}` : `$${data.totalCost.toFixed(4)}`} ${currency}`}
              icon={<DollarSign className="h-4 w-4 text-[#f59e0b]" />}
              trend={costTrend}
            />

            <StatCard
              title={t('settings.piDashboard.cacheHitRate')}
              value={`${data.cacheHitRate}%`}
              icon={<Database className="h-4 w-4 text-[#8b5cf6]" />}
              progress={data.cacheHitRate}
            />
          </div>

          {/* Charts grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            <UsageTrendChart data={data} range={range} className="lg:col-span-2" />
            <TokenCompositionChart
              totalInput={data.totalInput}
              totalOutput={data.totalOutput}
              totalCacheRead={data.totalCacheRead}
              totalCacheWrite={data.totalCacheWrite}
              totalTokens={data.totalTokens}
            />
            <RequestActivityChart data={data} range={range} />
          </div>

          {/* Provider distribution */}
          <ProviderDistribution providers={data.providerStats} />

          {/* Data tables */}
          <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
            {/* Tab header */}
            <div className="flex items-center border-b border-[var(--settings-theme-card-border)]">
              {(
                [
                  { key: 'log' as TabKey, label: t('settings.piDashboard.requestLog') },
                  { key: 'provider' as TabKey, label: t('settings.piDashboard.providerStats') },
                  { key: 'model' as TabKey, label: t('settings.piDashboard.modelStats') },
                ] as const
              ).map((tabItem) => (
                <button
                  key={tabItem.key}
                  onClick={() => {
                    setTab(tabItem.key);
                    setLogPage(1);
                  }}
                  className={cn(
                    'border-b-2 px-5 py-2.5 text-12 font-medium transition-colors',
                    tab === tabItem.key
                      ? 'border-[#3b82f6] text-[#3b82f6]'
                      : 'border-transparent text-[var(--settings-section-desc)] hover:text-[var(--settings-section-title)]',
                  )}
                >
                  {tabItem.label}
                </button>
              ))}
              <button
                onClick={handleExport}
                className="ml-auto mr-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-12 font-medium text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
              >
                <Download className="h-3.5 w-3.5" />
                {t('settings.piDashboard.exportCsv')}
              </button>
            </div>

            {/* Tab content */}
            <div className="overflow-x-auto">
              {tab === 'log' && (
                <>
                  <table className="w-full text-12">
                    <thead>
                      <tr className="border-b border-[var(--settings-theme-card-border)]">
                        <th className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.date')}
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.provider')}
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.model')}
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.input')}
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.output')}
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.cost')}
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium text-[var(--settings-section-sublabel)]">
                          {t('settings.piDashboard.requests')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedLog.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-8 text-center text-[var(--settings-section-sublabel)]"
                          >
                            {t('settings.piDashboard.noData')}
                          </td>
                        </tr>
                      ) : (
                        pagedLog.map((r, i) => (
                          <tr
                            key={i}
                            className="border-b border-[var(--settings-theme-card-border)]"
                          >
                            <td className="whitespace-nowrap px-4 py-2 text-[var(--settings-section-title)]">
                              {r.date}
                            </td>
                            <td className="px-4 py-2 text-[var(--settings-section-title)]">
                              {r.providerId}
                            </td>
                            <td className="px-4 py-2 text-[var(--settings-section-title)]">
                              {r.modelId}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {formatTokensShort(r.inputTokens, lang)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {formatTokensShort(r.outputTokens, lang)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {fmtCost(r.cost)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {r.requests}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {data.requestLog.length > LOG_PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-12 text-[var(--settings-section-sublabel)]">
                        {t('settings.piDashboard.totalItems', { count: data.requestLog.length })}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                          disabled={currentLogPage <= 1}
                          className="rounded-lg border border-[var(--settings-theme-card-border)] px-3 py-1 text-12 text-[var(--settings-section-desc)] disabled:opacity-40"
                        >
                          {t('settings.piDashboard.prevPage')}
                        </button>
                        <span className="text-12 text-[var(--settings-section-sublabel)]">
                          {currentLogPage} / {totalLogPages}
                        </span>
                        <button
                          onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                          disabled={currentLogPage >= totalLogPages}
                          className="rounded-lg border border-[var(--settings-theme-card-border)] px-3 py-1 text-12 text-[var(--settings-section-desc)] disabled:opacity-40"
                        >
                          {t('settings.piDashboard.nextPage')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === 'provider' && (
                <table className="w-full text-12">
                  <thead>
                    <tr className="border-b border-[var(--settings-theme-card-border)]">
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]">
                        {t('settings.piDashboard.provider')}
                      </th>
                      <SortableTh
                        label={t('settings.piDashboard.tokens')}
                        sortKey="totalTokens"
                        sort={providerSort}
                        onSort={toggleSort(setProviderSort)}
                      />
                      <SortableTh
                        label={t('settings.piDashboard.cost')}
                        sortKey="totalCost"
                        sort={providerSort}
                        onSort={toggleSort(setProviderSort)}
                      />
                      <SortableTh
                        label={t('settings.piDashboard.requests')}
                        sortKey="totalRequests"
                        sort={providerSort}
                        onSort={toggleSort(setProviderSort)}
                      />
                      <SortableTh
                        label={t('settings.piDashboard.models')}
                        sortKey="modelCount"
                        sort={providerSort}
                        onSort={toggleSort(setProviderSort)}
                      />
                      <th
                        className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]"
                        style={{ width: '140px' }}
                      >
                        {t('settings.piDashboard.costShare')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProviders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-[var(--settings-section-sublabel)]"
                        >
                          {t('settings.piDashboard.noData')}
                        </td>
                      </tr>
                    ) : (
                      sortedProviders.map((p, i) => {
                        const pct = providerTotalCost > 0 ? (p.totalCost / providerTotalCost) * 100 : 0;
                        return (
                          <tr
                            key={p.providerId}
                            className="border-b border-[var(--settings-theme-card-border)]"
                          >
                            <td className="px-4 py-2 font-medium text-[var(--settings-section-title)]">
                              {p.providerName || p.providerId}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {formatTokensShort(p.totalTokens, lang)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {fmtCost(p.totalCost)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {p.totalRequests}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                              {p.modelCount}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded-full bg-[var(--settings-theme-card-border)]">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'][i % 5],
                                    }}
                                  />
                                </div>
                                <span className="w-11 text-right text-11 text-[var(--settings-section-sublabel)]">
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {tab === 'model' && (
                <table className="w-full text-12">
                  <thead>
                    <tr className="border-b border-[var(--settings-theme-card-border)]">
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]">
                        {t('settings.piDashboard.model')}
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--settings-section-sublabel)]">
                        {t('settings.piDashboard.provider')}
                      </th>
                      <SortableTh
                        label={t('settings.piDashboard.tokens')}
                        sortKey="totalTokens"
                        sort={modelSort}
                        onSort={toggleSort(setModelSort)}
                      />
                      <SortableTh
                        label={t('settings.piDashboard.cost')}
                        sortKey="totalCost"
                        sort={modelSort}
                        onSort={toggleSort(setModelSort)}
                      />
                      <SortableTh
                        label={t('settings.piDashboard.requests')}
                        sortKey="totalRequests"
                        sort={modelSort}
                        onSort={toggleSort(setModelSort)}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-[var(--settings-section-sublabel)]"
                        >
                          {t('settings.piDashboard.noData')}
                        </td>
                      </tr>
                    ) : (
                      sortedModels.map((m) => (
                        <tr
                          key={`${m.providerId}/${m.modelId}`}
                          className="border-b border-[var(--settings-theme-card-border)]"
                        >
                          <td className="px-4 py-2 font-medium text-[var(--settings-section-title)]">
                            {m.modelName || m.modelId}
                          </td>
                          <td className="px-4 py-2 text-[var(--settings-section-title)]">
                            {m.providerId}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                            {formatTokensShort(m.totalTokens, lang)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                            {fmtCost(m.totalCost)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[var(--settings-section-title)]">
                            {m.totalRequests}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

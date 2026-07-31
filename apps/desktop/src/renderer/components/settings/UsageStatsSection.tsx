/**
 * UsageStatsSection — 设置 → 使用统计面板。
 *
 * 复用 useUsageHistory hook 拉取 main 侧聚合数据 (daily_spend + daily_model_usage)，
 * 展示: 概览卡片 (今日/30天 tokens + 花费) + 模型拆分表格 + CSV 导出。
 *
 * 借鉴 pi-web-switch DashboardPage 的视觉布局, 但:
 *  - 数据走 Cindy IPC (非 HTTP API)
 *  - 样式走 Cindy semantic tokens (非硬编码颜色, 自动适配 Light/Dark)
 *  - 图表复用已有 UsageDailyBars SVG 组件 (非 recharts)
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, Activity, BarChart3, DollarSign, Database } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useUsageHistory } from '@/hooks/useUsageHistory';
import {
  formatCompactTokens,
  formatMoney,
  formatUsd,
} from '@/lib/usageFormat';
import { UsageDailyBars } from '@/components/new-chat/UsageDailyBars';
import { UsageHeatmap } from '@/components/new-chat/UsageHeatmap';
import { usageModelKey, usageRankColor, usageRankOf } from '@/components/new-chat/usagePalette';
import { useAuth } from '@/contexts/AuthContext';
import {
  DEFAULT_USAGE_CURRENCY,
  type RegionalMoney,
} from '../../../shared/regionalMoney';

const HEATMAP_WINDOW_DAYS = 140;
const USAGE_TOP_MODELS = 8;

type SortKey = 'tokens' | 'cost' | 'inputTokens' | 'outputTokens';
type SortDir = 'asc' | 'desc';

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

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5">
      <div className="mb-3 flex items-start justify-between">
        <p className="text-11 font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
          {title}
        </p>
        <div className="rounded-lg bg-[var(--surface-chip)] p-2">{icon}</div>
      </div>
      <p className="text-24 font-bold tracking-tight text-[var(--text-primary)] tabular-nums">
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-11 text-[var(--text-tertiary)]">{subtitle}</p>
      )}
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-11 text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-11 font-medium tabular-nums text-[var(--text-primary)]">
          {formatCompactTokens(value)}
        </span>
        <span className="text-11 text-[var(--text-tertiary)]">({pct.toFixed(1)}%)</span>
      </div>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className="cursor-pointer select-none px-4 py-3 text-right font-medium"
      style={{ color: active ? 'var(--accent-emphasis)' : 'var(--text-tertiary)' }}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (sort.dir === 'desc' ? ' ↓' : ' ↑')}
      </span>
    </th>
  );
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

export function UsageStatsSection() {
  const { t } = useTranslation();
  const { dataOwnerId } = useAuth();
  const { history, refreshing } = useUsageHistory({ userId: dataOwnerId });
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'cost', dir: 'desc' });

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const sortedModels = useMemo(() => {
    if (!history?.models) return [];
    const getVal = (m: (typeof history.models)[number], key: SortKey): number => {
      switch (key) {
        case 'tokens':
          return m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreateTokens;
        case 'cost':
          return m.money.amount;
        case 'inputTokens':
          return m.inputTokens;
        case 'outputTokens':
          return m.outputTokens;
      }
    };
    return [...history.models].sort((a, b) => {
      const diff = getVal(b, sort.key) - getVal(a, sort.key);
      return sort.dir === 'desc' ? diff : -diff;
    });
  }, [history?.models, sort]);

  const handleExport = () => {
    if (!history) return;
    downloadCsv(
      `cindy-usage-models-${new Date().toISOString().split('T')[0]}.csv`,
      ['model', 'agent', 'tokens', 'input', 'output', 'cacheRead', 'cacheCreate', 'cost'],
      sortedModels.map((m) => [
        m.model,
        m.agentKind,
        m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreateTokens,
        m.inputTokens,
        m.outputTokens,
        m.cacheReadTokens,
        m.cacheCreateTokens,
        m.money.amount,
      ]),
    );
  };

  const handleRefresh = () => {
    // useUsageHistory 会在 forceRefresh 时重拉
    window.electronAPI.maker.usage.getHistory({ forceRefresh: true });
  };

  if (!history) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-emphasis)]" />
      </div>
    );
  }

  const todayTokens = history.totals.todayTokens;
  const last30Tokens = history.totals.last30DaysTokens;
  const todayCost = history.totals.today;
  const last30Cost = history.totals.last30DaysWithEstimatedValue;
  const totalTokens = last30Tokens;
  const totalInput = sortedModels.reduce((s, m) => s + m.inputTokens, 0);
  const totalOutput = sortedModels.reduce((s, m) => s + m.outputTokens, 0);
  const totalCacheRead = sortedModels.reduce((s, m) => s + m.cacheReadTokens, 0);
  const totalCacheCreate = sortedModels.reduce((s, m) => s + m.cacheCreateTokens, 0);
  const cacheHitRate = totalTokens > 0 ? ((totalCacheRead + totalCacheCreate) / totalTokens) * 100 : 0;

  const colorOrder = history.models
    .slice(0, USAGE_TOP_MODELS)
    .map((m) => usageModelKey(m.agentKind, m.model));

  return (
    <div className="space-y-5">
      {/* Title + Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('settings.usageStats.title')}
          </h2>
          <p className="mt-0.5 text-12 text-[var(--text-tertiary)]">
            {t('settings.usageStats.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-12 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-chip)]"
            title={t('settings.usageStats.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-12 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-chip)]"
          >
            <Download className="h-3.5 w-3.5" />
            {t('settings.usageStats.exportCsv')}
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('settings.usageStats.todayTokens')}
          value={formatCompactTokens(todayTokens)}
          subtitle={`${t('settings.usageStats.last30Days')}: ${formatCompactTokens(last30Tokens)}`}
          icon={<Activity className="h-4 w-4 text-[var(--accent-emphasis)]" />}
        />
        <StatCard
          title={t('settings.usageStats.todayCost')}
          value={formatMoney(todayCost)}
          subtitle={`${t('settings.usageStats.last30Days')}: ${formatMoney(last30Cost)}`}
          icon={<DollarSign className="h-4 w-4 text-amber-500" />}
        />
        <StatCard
          title={t('settings.usageStats.totalRequests')}
          value={String(history.streak.current)}
          subtitle={t('settings.usageStats.streakDays')}
          icon={<BarChart3 className="h-4 w-4 text-emerald-500" />}
        />
        <StatCard
          title={t('settings.usageStats.cacheHitRate')}
          value={`${cacheHitRate.toFixed(1)}%`}
          icon={<Database className="h-4 w-4 text-violet-500" />}
        />
      </div>

      {/* Token Breakdown */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
          {t('settings.usageStats.tokenBreakdown')}
        </h3>
        <div className="space-y-0.5">
          <BreakdownRow label={t('settings.usageStats.input')} value={totalInput} total={totalTokens} color="#3b82f6" />
          <BreakdownRow label={t('settings.usageStats.output')} value={totalOutput} total={totalTokens} color="#10b981" />
          <BreakdownRow label={t('settings.usageStats.cacheCreate')} value={totalCacheCreate} total={totalTokens} color="#f59e0b" />
          <BreakdownRow label={t('settings.usageStats.cacheHit')} value={totalCacheRead} total={totalTokens} color="#8b5cf6" />
        </div>
      </div>

      {/* Heatmap + Daily Bars */}
      <div className="flex items-start gap-5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5">
        <UsageHeatmap
          days={history.days}
          todayKey={history.todayKey}
          windowDays={HEATMAP_WINDOW_DAYS}
        />
        <div className="min-w-0 flex-1 self-stretch border-l border-[var(--border-default)] pl-5">
          <div className="mb-1.5 text-11 text-[var(--text-tertiary)]">
            {t('settings.usageStats.dailyTotals')}
          </div>
          <UsageDailyBars
            days={history.days}
            modelDaily={history.modelDaily}
            colorOrder={colorOrder}
            todayKey={history.todayKey}
          />
        </div>
      </div>

      {/* Model Breakdown Table */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)]">
        <div className="border-b border-[var(--border-default)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('settings.usageStats.modelBreakdown')}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-12">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--text-tertiary)]">
                  {t('settings.usageStats.model')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-tertiary)]">
                  {t('settings.usageStats.agent')}
                </th>
                <SortableTh label={t('settings.usageStats.tokens')} sortKey="tokens" sort={sort} onSort={toggleSort} />
                <SortableTh label={t('settings.usageStats.input')} sortKey="inputTokens" sort={sort} onSort={toggleSort} />
                <SortableTh label={t('settings.usageStats.output')} sortKey="outputTokens" sort={sort} onSort={toggleSort} />
                <SortableTh label={t('settings.usageStats.cost')} sortKey="cost" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedModels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]">
                    {t('settings.usageStats.noData')}
                  </td>
                </tr>
              ) : (
                sortedModels.map((m, i) => {
                  const tokens = m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreateTokens;
                  const color = CHART_COLORS[i % CHART_COLORS.length];
                  return (
                    <tr key={`${m.agentKind}/${m.model}`} className="border-b border-[var(--border-default)] last:border-b-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className="truncate font-medium text-[var(--text-primary)]">{m.model}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{m.agentKind}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                        {formatCompactTokens(tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                        {formatCompactTokens(m.inputTokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                        {formatCompactTokens(m.outputTokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                        {formatMoney(m.money)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

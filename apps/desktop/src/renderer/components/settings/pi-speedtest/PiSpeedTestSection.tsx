import { useEffect, useMemo, useState } from 'react';

import {
  Check,
  Download,
  Gauge,
  Loader2,
  ListPlus,
  Plus,
  RotateCcw,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePiSpeedTest } from '@/hooks/usePiSpeedTest';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Pi 测速面板 —— 数据与交互对齐 pi-web-switch ModelSpeedTestPage（双速度档/
 * 持久化/一键添加），视觉走 Cindy 设置页统一语言：CARD 容器、pill 按钮体系、
 * 语义 token（DESIGN.md §10 token-only），状态色与兄弟面板（供应商/会话页）
 * 同一套 emerald/amber/red 工具类。
 */
const CARD_CLASS = cn(
  'overflow-hidden rounded-xl',
  'bg-[var(--settings-theme-card-bg)]',
  'border border-[var(--settings-theme-card-border)]',
);

const ACTION_CLASS = cn(
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-12 font-medium',
  'border border-[var(--settings-theme-card-border)]',
  'text-[var(--settings-section-sublabel)] transition-colors hover:bg-sidebar-item-hover',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

const BADGE_CLASS = cn(
  'shrink-0 rounded-md px-2 py-0.5 text-11',
  'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
  'text-[var(--settings-section-desc)]',
);

/** 状态胶囊：成功/警示/失败三态（与兄弟面板同款工具类）。 */
function StatusPill({
  tone,
  children,
  title,
}: {
  tone: 'success' | 'warning' | 'error';
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-11',
        tone === 'success' && 'bg-emerald-500/10 text-emerald-500',
        tone === 'warning' && 'bg-amber-500/10 text-amber-500',
        tone === 'error' && 'bg-red-500/10 text-red-500',
      )}
    >
      {children}
    </span>
  );
}

export function PiSpeedTestSection() {
  const { t } = useTranslation();
  const {
    providers,
    catalog,
    providerModels,
    models,
    results,
    speedMode,
    setSpeedMode,
    running,
    fetching,
    fetchError,
    fetchInfo,
    selectedId,
    setSelectedId,
    loadProviders,
    fetchModelsForProvider,
    clearModels,
    addModelToProvider,
    runAll,
    resetResults,
    avg,
    RUNS_PER_MODEL,
  } = usePiSpeedTest();

  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? providers[0] ?? null,
    [providers, selectedId],
  );

  // 初始无选中时选第一家（listCliProviders 返回后）。
  useEffect(() => {
    if (providers.length > 0 && !selectedId) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId, setSelectedId]);

  // 已在正式配置里的模型(供应商配置清单)不再提供「添加」;添加成功后重拉清单
  // 让「已存在」状态与供应商页保持同步。
  const configuredIds = useMemo(
    () => new Set([...(selectedId ? (providerModels[selectedId] ?? []) : []), ...addedIds]),
    [selectedId, providerModels, addedIds],
  );

  const handleAdd = async (modelId: string) => {
    if (!selected || addingId) return;
    const model = models.find((m) => m.id === modelId);
    if (!model) return;
    setAddingId(modelId);
    try {
      const added = await addModelToProvider(selected.id, model);
      if (added) {
        setAddedIds((prev) => new Set(prev).add(modelId));
        await loadProviders();
      }
    } finally {
      setAddingId(null);
    }
  };

  const addAllPassed = async () => {
    if (!selected || running || fetching) return;
    const passed = models.filter((m) => {
      const r = results.get(m.id);
      return r && r.runs > 0 && r.success === r.runs && !configuredIds.has(m.id);
    });
    for (const m of passed) {
      // 顺序添加,主进程整文档写回,避免并发写。
      await handleAdd(m.id);
    }
  };

  const passedCount = models.filter((m) => {
    const r = results.get(m.id);
    return r && r.runs > 0 && r.success === r.runs && !configuredIds.has(m.id);
  }).length;

  if (providers.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
              {t('settings.piSpeedtest.title')}
            </h2>
            <p className="mt-1 text-13 text-[var(--settings-section-desc)]">
              {t('settings.piSpeedtest.subtitle')}
            </p>
          </div>
          <span className={BADGE_CLASS}>
            {t('settings.piSpeedtest.runsNote', { count: RUNS_PER_MODEL })}
          </span>
        </div>
        <div
          className="flex flex-col items-center gap-3 rounded-xl border py-12 text-center"
          style={{ borderColor: 'var(--settings-theme-card-border)' }}
        >
          <Gauge size={28} className="text-[var(--settings-section-sublabel)]" />
          <h3 className="text-14 font-semibold text-[var(--settings-section-title)]">
            {t('settings.piSpeedtest.noProvider')}
          </h3>
          <p className="max-w-sm text-12 text-[var(--settings-section-desc)]">
            {t('settings.piSpeedtest.noProviderDesc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header —— 设置页统一标题规格；右侧 runs 徽章。 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
            {t('settings.piSpeedtest.title')}
          </h2>
          <p className="mt-1 text-13 text-[var(--settings-section-desc)]">
            {t('settings.piSpeedtest.subtitle')}
          </p>
        </div>
        <span className={cn(BADGE_CLASS, 'shrink-0')}>
          {t('settings.piSpeedtest.runsNote', { count: RUNS_PER_MODEL })}
        </span>
      </div>

      {/* 左导轨 + 右结果表,与供应商面板同构。 */}
      <div className={cn(CARD_CLASS, 'flex flex-col md:flex-row')}>
        {/* Provider rail */}
        <div
          className="shrink-0 border-b p-3 md:w-56 md:border-b-0 md:border-r"
          style={{ borderColor: 'var(--settings-theme-card-border)' }}
        >
          <p className="px-2 pb-2 pt-1 text-11 font-medium uppercase tracking-wider text-[var(--settings-section-sublabel)]">
            {t('settings.piSpeedtest.providers')} ({providers.length})
          </p>
          <div className="flex flex-col gap-0.5">
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={running || fetching}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-12 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  selected?.id === p.id
                    ? 'border-[var(--settings-theme-card-border)] bg-[var(--settings-menu-bg-hover)] text-[var(--settings-section-title)]'
                    : 'border-transparent text-[var(--settings-section-sublabel)] hover:bg-[var(--settings-menu-bg-hover)]',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className={BADGE_CLASS}>{catalog[p.id]?.length ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-4 p-4">
          {selected && (
            <>
              {/* Toolbar —— 全部走 ACTION pill 体系;主操作为 accent 填充 pill。 */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-15 font-semibold text-[var(--settings-section-title)]">
                    {selected.name}
                  </h3>
                  <p className="text-11 text-[var(--settings-section-sublabel)]">
                    {models.length} {t('settings.piSpeedtest.models')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* slow 档:拉长间隔 + 429 退避重试,防上游限流(pws 同款)。 */}
                  <label
                    className={cn(ACTION_CLASS, 'cursor-pointer select-none')}
                  >
                    <input
                      type="checkbox"
                      checked={speedMode === 'slow'}
                      disabled={running || fetching}
                      onChange={(e) => setSpeedMode(e.target.checked ? 'slow' : 'normal')}
                      className="h-3.5 w-3.5 rounded"
                      style={{ accentColor: 'var(--focus-ring)' }}
                    />
                    {t('settings.piSpeedtest.slowMode')}
                  </label>
                  <button
                    type="button"
                    onClick={() => fetchModelsForProvider(selected)}
                    disabled={fetching || running}
                    className={cn(ACTION_CLASS)}
                  >
                    {fetching ? <Spinner size={14} /> : <Download size={14} />}
                    {fetching
                      ? t('settings.piSpeedtest.fetching')
                      : t('settings.piSpeedtest.fetchModels')}
                  </button>
                  <button
                    type="button"
                    onClick={resetResults}
                    disabled={running || fetching || results.size === 0}
                    className={cn(ACTION_CLASS)}
                  >
                    <RotateCcw size={14} />
                    {t('settings.piSpeedtest.reset')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void addAllPassed()}
                    disabled={running || fetching || passedCount === 0}
                    title={t('settings.piSpeedtest.addAllPassedDesc')}
                    className={cn(
                      ACTION_CLASS,
                      'border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10',
                    )}
                  >
                    <ListPlus size={14} />
                    {t('settings.piSpeedtest.addAllPassed')} ({passedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => runAll(selected, models)}
                    disabled={running || fetching || models.length === 0}
                    className={cn(
                      ACTION_CLASS,
                      'h-8 border-transparent px-4 text-white',
                      'bg-[var(--accent, var(--text-link))] hover:opacity-90',
                    )}
                  >
                    {running ? <Spinner size={14} /> : <Zap size={14} />}
                    {running ? t('settings.piSpeedtest.testing') : t('settings.piSpeedtest.runAll')}
                  </button>
                </div>
              </div>

              {/* 拉取结果条:成功(绿)+ 清空;失败(红)。 */}
              {fetchError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-12 text-red-500"
                >
                  <X size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1 break-words">{fetchError}</span>
                </div>
              )}

              {fetchInfo && !fetchError && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-12 text-emerald-500"
                >
                  <Check size={14} className="shrink-0" />
                  {t('settings.piSpeedtest.fetchedCount', { count: fetchInfo })}
                  <button
                    type="button"
                    onClick={clearModels}
                    className="ml-auto shrink-0 text-11 underline underline-offset-2 hover:opacity-80"
                  >
                    {t('settings.piSpeedtest.clear')}
                  </button>
                </div>
              )}

              {models.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center"
                  style={{ borderColor: 'var(--settings-theme-card-border)' }}
                >
                  <Download size={22} className="text-[var(--settings-section-sublabel)]" />
                  <p className="text-12 text-[var(--settings-section-desc)]">
                    {t('settings.piSpeedtest.emptyCatalog')}
                  </p>
                  <p className="text-11 text-[var(--settings-section-sublabel)]">
                    {t('settings.piSpeedtest.emptyCatalogDesc')}
                  </p>
                </div>
              ) : (
                <div
                  className="overflow-hidden rounded-lg border"
                  style={{ borderColor: 'var(--settings-theme-card-border)' }}
                >
                  <table className="w-full text-12">
                    <thead>
                      <tr
                        className="border-b text-left text-10 uppercase tracking-wider"
                        style={{
                          borderColor: 'var(--settings-theme-card-border)',
                          color: 'var(--settings-section-sublabel)',
                        }}
                      >
                        <th className="px-3 py-2 font-medium">
                          {t('settings.piSpeedtest.colModel')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('settings.piSpeedtest.colSuccessRate')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('settings.piSpeedtest.colAvgLatency')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('settings.piSpeedtest.colRange')}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t('settings.piSpeedtest.colStatus')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('settings.piSpeedtest.colAction')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((m) => {
                        const r = results.get(m.id);
                        const rate =
                          r && r.runs > 0 ? Math.round((r.success / r.runs) * 100) : null;
                        const avgMs = r ? avg(r.latencies) : 0;
                        const minMs = r && r.latencies.length ? Math.min(...r.latencies) : 0;
                        const maxMs = r && r.latencies.length ? Math.max(...r.latencies) : 0;
                        return (
                          <tr
                            key={m.id}
                            className="border-b transition-colors last:border-0 hover:bg-sidebar-item-hover"
                            style={{ borderColor: 'var(--settings-theme-card-border)' }}
                          >
                            <td className="px-3 py-2">
                              <span
                                className="font-mono"
                                style={{ color: 'var(--settings-section-title)' }}
                              >
                                {m.id}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {rate === null ? (
                                <span className="text-[var(--settings-section-sublabel)]">—</span>
                              ) : (
                                <StatusPill
                                  tone={rate >= 100 ? 'success' : rate > 0 ? 'warning' : 'error'}
                                >
                                  <span className="font-mono">
                                    {rate}% ({r!.success}/{r!.runs})
                                  </span>
                                </StatusPill>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--settings-section-desc)]">
                              {avgMs > 0 ? (
                                `${avgMs} ms`
                              ) : (
                                <span className="text-[var(--settings-section-sublabel)]">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-11 text-[var(--settings-section-sublabel)]">
                              {minMs > 0 ? `${minMs}–${maxMs}` : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {!r || r.status === 'idle' ? (
                                <span
                                  className="text-11 text-[var(--settings-section-sublabel)]"
                                >
                                  {t('settings.piSpeedtest.pending')}
                                </span>
                              ) : r.status === 'testing' ? (
                                <span
                                  className="flex items-center gap-1 text-11 text-[var(--settings-section-desc)]"
                                >
                                  <Loader2 size={12} className="animate-spin" />
                                  {t('settings.piSpeedtest.testing')} {r.runs}/{RUNS_PER_MODEL}
                                </span>
                              ) : r.success === r.runs ? (
                                <StatusPill tone="success">
                                  <Check size={11} />
                                  {t('settings.piSpeedtest.ok')}
                                </StatusPill>
                              ) : r.success > 0 ? (
                                <StatusPill tone="warning">
                                  <Check size={11} />
                                  {t('settings.piSpeedtest.partial')}
                                </StatusPill>
                              ) : (
                                <span
                                  className="flex items-center gap-1 text-11 text-red-500"
                                  title={r.lastMessage}
                                >
                                  <X size={11} />
                                  {r.lastMessage
                                    ? r.lastMessage.slice(0, 40)
                                    : t('settings.piSpeedtest.fail')}
                                </span>
                              )}
                            </td>
                            {/* 操作列:100% 通过且不在正式配置的模型提供一键加入。 */}
                            <td className="px-3 py-2 text-right">
                              {rate === 100 &&
                                (configuredIds.has(m.id) ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-11 text-[var(--settings-section-sublabel)]"
                                  >
                                    <Check size={11} />
                                    {t('settings.piSpeedtest.added')}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleAdd(m.id)}
                                    disabled={running || fetching || addingId !== null}
                                    className={cn(
                                      ACTION_CLASS,
                                      'h-6 px-2 text-11',
                                      'border-[var(--focus-ring)]/50 text-[var(--focus-ring)] hover:bg-[var(--focus-ring)]/10',
                                    )}
                                  >
                                    {addingId === m.id ? (
                                      <Spinner size={11} />
                                    ) : (
                                      <Plus size={11} />
                                    )}
                                    {t('settings.piSpeedtest.addToProvider')}
                                  </button>
                                ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

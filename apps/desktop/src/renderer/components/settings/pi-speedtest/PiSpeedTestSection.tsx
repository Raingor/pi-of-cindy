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

/**
 * Pi 测速面板 —— 排版与信息密度对齐 pi-web-switch ModelSpeedTestPage:
 * kicker 头 + 右上 runs 徽标、左导轨(带模型计数)、双速度档、拉取成功条 +
 * 清空、结果表(成功率/均延迟/区间/状态) + 「添加到正式配置」操作列。
 * 颜色走 Cindy 语义 token(Light/Dark 双模式),不逐色复制 pws 的深色硬编码。
 */
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
        <div className="flex items-center justify-between">
          <div>
            <div className="page-kicker flex items-center gap-2 text-11 uppercase tracking-widest text-[var(--settings-section-sublabel)]">
              <span /> MODEL BENCHMARK // LATENCY MATRIX
            </div>
            <h2
              className="text-lg font-semibold"
              style={{ color: 'var(--settings-text-primary)' }}
            >
              {t('settings.piSpeedtest.title')}
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
              {t('settings.piSpeedtest.subtitle')}
            </p>
          </div>
          <span className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
            {t('settings.piSpeedtest.runsNote', { count: RUNS_PER_MODEL })}
          </span>
        </div>
        <div
          className="flex flex-col items-center gap-3 rounded-xl border py-12 text-center"
          style={{ borderColor: 'var(--settings-border)' }}
        >
          <Gauge className="h-8 w-8" style={{ color: 'var(--settings-text-tertiary)' }} />
          <h3
            className="text-base font-semibold"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {t('settings.piSpeedtest.noProvider')}
          </h3>
          <p
            className="max-w-sm text-sm"
            style={{ color: 'var(--settings-text-secondary)' }}
          >
            {t('settings.piSpeedtest.noProviderDesc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="page-kicker flex items-center gap-2 text-11 uppercase tracking-widest text-[var(--settings-section-sublabel)]">
            <span /> MODEL BENCHMARK // LATENCY MATRIX
          </div>
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {t('settings.piSpeedtest.title')}
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
            {t('settings.piSpeedtest.subtitle')}
          </p>
        </div>
        <span className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
          {t('settings.piSpeedtest.runsNote', { count: RUNS_PER_MODEL })}
        </span>
      </div>

      <div
        className="flex overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--settings-border)' }}
      >
        {/* Provider rail */}
        <div
          className="w-60 shrink-0 space-y-0.5 border-r p-3"
          style={{ borderColor: 'var(--settings-border)' }}
        >
          <p
            className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSpeedtest.providers')} ({providers.length})
          </p>
          {providers.map((p) => (
            <button
              key={p.id}
              disabled={running || fetching}
              onClick={() => setSelectedId(p.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
              style={{
                borderColor:
                  selected?.id === p.id ? 'var(--accent, var(--text-link))' : 'transparent',
                backgroundColor:
                  selected?.id === p.id
                    ? 'var(--accent-muted, rgba(59,130,246,0.1))'
                    : 'transparent',
                color: 'var(--settings-text-primary)',
              }}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span
                className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-11"
                style={{
                  borderColor: 'var(--settings-border)',
                  color: 'var(--settings-text-tertiary)',
                }}
              >
                {catalog[p.id]?.length ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-4 p-4">
          {selected && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3
                    className="text-base font-semibold"
                    style={{ color: 'var(--settings-text-primary)' }}
                  >
                    {selected.name}
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
                    {models.length} {t('settings.piSpeedtest.models')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* slow 档:拉长间隔 + 429 退避重试,防上游限流(pws 同款)。 */}
                  <label
                    className="flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs"
                    style={{
                      borderColor: 'var(--settings-border)',
                      color: 'var(--settings-text-secondary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={speedMode === 'slow'}
                      disabled={running || fetching}
                      onChange={(e) => setSpeedMode(e.target.checked ? 'slow' : 'normal')}
                      className="rounded"
                      style={{ accentColor: 'var(--accent, var(--text-link))' }}
                    />
                    {t('settings.piSpeedtest.slowMode')}
                  </label>
                  <button
                    onClick={() => fetchModelsForProvider(selected)}
                    disabled={fetching || running}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      borderColor: 'var(--settings-border)',
                      color: 'var(--settings-text-secondary)',
                    }}
                  >
                    {fetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {fetching
                      ? t('settings.piSpeedtest.fetching')
                      : t('settings.piSpeedtest.fetchModels')}
                  </button>
                  <button
                    onClick={resetResults}
                    disabled={running || fetching || results.size === 0}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      borderColor: 'var(--settings-border)',
                      color: 'var(--settings-text-secondary)',
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t('settings.piSpeedtest.reset')}
                  </button>
                  <button
                    onClick={() => void addAllPassed()}
                    disabled={running || fetching || passedCount === 0}
                    title={t('settings.piSpeedtest.addAllPassedDesc')}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--success) 40%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)',
                      color: 'var(--success)',
                    }}
                  >
                    <ListPlus className="h-4 w-4" />
                    {t('settings.piSpeedtest.addAllPassed')} ({passedCount})
                  </button>
                  <button
                    onClick={() => runAll(selected, models)}
                    disabled={running || fetching || models.length === 0}
                    className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent, var(--text-link))' }}
                  >
                    {running ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {running ? t('settings.piSpeedtest.testing') : t('settings.piSpeedtest.runAll')}
                  </button>
                </div>
              </div>

              {fetchError && (
                <div
                  className="flex items-start gap-2 rounded-lg border p-3 text-sm"
                  style={{
                    borderColor: 'var(--danger)',
                    backgroundColor: 'rgba(239,68,68,0.1)',
                    color: 'var(--danger)',
                  }}
                >
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                  {fetchError}
                </div>
              )}

              {fetchInfo && !fetchError && (
                <div
                  className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)',
                    color: 'var(--success)',
                  }}
                >
                  <Check className="h-4 w-4 shrink-0" />
                  {t('settings.piSpeedtest.fetchedCount', { count: fetchInfo })}
                  <button
                    onClick={clearModels}
                    className="ml-auto text-xs underline"
                    style={{ color: 'var(--settings-text-tertiary)' }}
                  >
                    {t('settings.piSpeedtest.clear')}
                  </button>
                </div>
              )}

              {models.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center"
                  style={{ borderColor: 'var(--settings-border)' }}
                >
                  <Download
                    className="h-7 w-7"
                    style={{ color: 'var(--settings-text-tertiary)' }}
                  />
                  <p className="text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
                    {t('settings.piSpeedtest.emptyCatalog')}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
                    {t('settings.piSpeedtest.emptyCatalogDesc')}
                  </p>
                </div>
              ) : (
                <div
                  className="overflow-hidden rounded-lg border"
                  style={{ borderColor: 'var(--settings-border)' }}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="border-b text-left text-xs uppercase tracking-wider"
                        style={{
                          borderColor: 'var(--settings-border)',
                          color: 'var(--settings-text-tertiary)',
                        }}
                      >
                        <th className="px-3 py-2 font-medium">{t('settings.piSpeedtest.colModel')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('settings.piSpeedtest.colSuccessRate')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('settings.piSpeedtest.colAvgLatency')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('settings.piSpeedtest.colRange')}</th>
                        <th className="px-3 py-2 font-medium">{t('settings.piSpeedtest.colStatus')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('settings.piSpeedtest.colAction')}</th>
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
                            className="border-b last:border-0 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                            style={{ borderColor: 'var(--settings-border)' }}
                          >
                            <td className="px-3 py-2">
                              <span
                                className="font-mono"
                                style={{ color: 'var(--settings-text-primary)' }}
                              >
                                {m.id}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {rate === null ? (
                                <span style={{ color: 'var(--settings-text-tertiary)' }}>—</span>
                              ) : (
                                <span
                                  className="font-mono"
                                  style={{
                                    color:
                                      rate >= 100
                                        ? 'var(--success)'
                                        : rate > 0
                                          ? 'var(--warning, #f59e0b)'
                                          : 'var(--danger)',
                                  }}
                                >
                                  {rate}% ({r!.success}/{r!.runs})
                                </span>
                              )}
                            </td>
                            <td
                              className="px-3 py-2 text-right font-mono"
                              style={{ color: 'var(--settings-text-secondary)' }}
                            >
                              {avgMs > 0 ? `${avgMs} ms` : <span style={{ color: 'var(--settings-text-tertiary)' }}>—</span>}
                            </td>
                            <td
                              className="px-3 py-2 text-right font-mono text-xs"
                              style={{ color: 'var(--settings-text-tertiary)' }}
                            >
                              {minMs > 0 ? `${minMs}–${maxMs}` : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {!r || r.status === 'idle' ? (
                                <span className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
                                  {t('settings.piSpeedtest.pending')}
                                </span>
                              ) : r.status === 'testing' ? (
                                <span
                                  className="flex items-center gap-1 text-xs"
                                  style={{ color: 'var(--settings-text-secondary)' }}
                                >
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {t('settings.piSpeedtest.testing')} {r.runs}/{RUNS_PER_MODEL}
                                </span>
                              ) : r.success === r.runs ? (
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
                                  <Check className="h-3.5 w-3.5" />
                                  {t('settings.piSpeedtest.ok')}
                                </span>
                              ) : r.success > 0 ? (
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--warning, #f59e0b)' }}>
                                  <Check className="h-3.5 w-3.5" />
                                  {t('settings.piSpeedtest.partial')}
                                </span>
                              ) : (
                                <span
                                  className="flex items-center gap-1 text-xs"
                                  style={{ color: 'var(--danger)' }}
                                  title={r.lastMessage}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  {r.lastMessage ? r.lastMessage.slice(0, 40) : t('settings.piSpeedtest.fail')}
                                </span>
                              )}
                            </td>
                            {/* 操作列:100% 通过且不在正式配置的模型提供一键加入。 */}
                            <td className="px-3 py-2 text-right">
                              {rate === 100 &&
                                (configuredIds.has(m.id) ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs"
                                    style={{ color: 'var(--settings-text-tertiary)' }}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    {t('settings.piSpeedtest.added')}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => void handleAdd(m.id)}
                                    disabled={running || fetching || addingId !== null}
                                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                    style={{
                                      borderColor:
                                        'color-mix(in srgb, var(--accent, var(--text-link)) 50%, transparent)',
                                      backgroundColor:
                                        'color-mix(in srgb, var(--accent, var(--text-link)) 10%, transparent)',
                                      color: 'var(--accent, var(--text-link))',
                                    }}
                                  >
                                    {addingId === m.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Plus className="h-3.5 w-3.5" />
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

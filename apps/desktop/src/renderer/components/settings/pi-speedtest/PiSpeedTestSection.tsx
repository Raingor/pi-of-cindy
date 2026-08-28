import { useEffect, useMemo, useState } from 'react';

import {
  Check,
  Download,
  Gauge,
  Loader2,
  RotateCcw,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePiSpeedTest } from '@/hooks/usePiSpeedTest';

export function PiSpeedTestSection() {
  const { t } = useTranslation();
  const {
    providers,
    models,
    results,
    running,
    fetching,
    fetchError,
    loadProviders,
    fetchModelsForProvider,
    runAll,
    resetResults,
    avg,
    RUNS_PER_MODEL,
  } = usePiSpeedTest();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? providers[0] ?? null,
    [providers, selectedId],
  );

  useEffect(() => {
    if (providers.length > 0 && !selectedId) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  if (providers.length === 0) {
    return (
      <div className="space-y-5">
        <h2
          className="text-lg font-semibold"
          style={{ color: 'var(--settings-text-primary)' }}
        >
          {t('piSpeedtest.title')}
        </h2>
        <div
          className="flex flex-col items-center gap-3 rounded-xl border py-12 text-center"
          style={{ borderColor: 'var(--settings-border)' }}
        >
          <Gauge className="h-8 w-8" style={{ color: 'var(--settings-text-tertiary)' }} />
          <h3
            className="text-base font-semibold"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {t('piSpeedtest.noProvider')}
          </h3>
          <p
            className="max-w-sm text-sm"
            style={{ color: 'var(--settings-text-secondary)' }}
          >
            {t('piSpeedtest.noProviderDesc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {t('piSpeedtest.title')}
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
            {t('piSpeedtest.subtitle')}
          </p>
        </div>
        <span className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
          {t('piSpeedtest.runsNote', { count: RUNS_PER_MODEL })}
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
            {t('piSpeedtest.providers')} ({providers.length})
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
                  selected?.id === p.id ? 'var(--accent-muted, rgba(59,130,246,0.1))' : 'transparent',
                color: 'var(--settings-text-primary)',
              }}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
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
                    {models.length} {t('piSpeedtest.models')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                    {fetching ? t('piSpeedtest.fetching') : t('piSpeedtest.fetchModels')}
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
                    {t('piSpeedtest.reset')}
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
                    {running ? t('piSpeedtest.testing') : t('piSpeedtest.runAll')}
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

              {models.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center"
                  style={{ borderColor: 'var(--settings-border)' }}
                >
                  <Download className="h-7 w-7" style={{ color: 'var(--settings-text-tertiary)' }} />
                  <p className="text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
                    {t('piSpeedtest.emptyCatalog')}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
                    {t('piSpeedtest.emptyCatalogDesc')}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--settings-border)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="border-b text-left text-xs uppercase tracking-wider"
                        style={{
                          borderColor: 'var(--settings-border)',
                          color: 'var(--settings-text-tertiary)',
                        }}
                      >
                        <th className="px-3 py-2 font-medium">{t('piSpeedtest.colModel')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('piSpeedtest.colSuccessRate')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('piSpeedtest.colAvgLatency')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('piSpeedtest.colRange')}</th>
                        <th className="px-3 py-2 font-medium">{t('piSpeedtest.colStatus')}</th>
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
                                  {t('piSpeedtest.pending')}
                                </span>
                              ) : r.status === 'testing' ? (
                                <span
                                  className="flex items-center gap-1 text-xs"
                                  style={{ color: 'var(--settings-text-secondary)' }}
                                >
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {t('piSpeedtest.testing')} {r.runs}/{RUNS_PER_MODEL}
                                </span>
                              ) : r.success === r.runs ? (
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
                                  <Check className="h-3.5 w-3.5" />
                                  {t('piSpeedtest.ok')}
                                </span>
                              ) : r.success > 0 ? (
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--warning, #f59e0b)' }}>
                                  <Check className="h-3.5 w-3.5" />
                                  {t('piSpeedtest.partial')}
                                </span>
                              ) : (
                                <span
                                  className="flex items-center gap-1 text-xs"
                                  style={{ color: 'var(--danger)' }}
                                  title={r.lastMessage}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  {r.lastMessage ? r.lastMessage.slice(0, 40) : t('piSpeedtest.fail')}
                                </span>
                              )}
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

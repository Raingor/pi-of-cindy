/**
 * PiSettingsSection — 设置 → Pi 配置面板。
 *
 * 借鉴 pi-web-switch SettingsPage 的 Advanced tab, 包含:
 *  - 更新检测: 检查 pi core + 扩展是否有新版本 (npm registry)
 *  - 拓展与包: 列出/添加/删除 ~/.pi/agent/npm/ 下的 npm 扩展
 *  - 导入与导出: 导出/导入 pi 配置 (settings + auth + models)
 *
 * 数据走 Cindy IPC (maker:pi:*), 样式走 semantic tokens (Light/Dark 双模式)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CloudDownload,
  RefreshCw,
  Package,
  Plus,
  X,
  Download,
  Upload,
  RotateCcw,
  Check,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

interface PiPackage {
  name: string;
  version: string;
}

interface UpdateItem {
  name: string;
  installed: string;
  latest: string | null;
  hasUpdate: boolean;
}

interface UpdateCheckResult {
  pi: UpdateItem | null;
  extensions: UpdateItem[];
  checkedAt: number;
}

interface ApplyResult {
  name: string;
  success: boolean;
  message?: string;
}

function SettingsCard({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Package;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)]">
      <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-6 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-chip)]">
          <Icon className="h-4 w-4 text-[var(--accent-emphasis)]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {desc && <p className="text-11 text-[var(--text-tertiary)]">{desc}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

export function PiSettingsSection() {
  const { t } = useTranslation();
  const [packages, setPackages] = useState<PiPackage[]>([]);
  const [newPackage, setNewPackage] = useState('');
  const [loadingPackages, setLoadingPackages] = useState(true);

  // Update check state
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ ok: number; failNames: string[] } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPackages = useCallback(async () => {
    try {
      const result = await window.electronAPI.maker.pi.listPackages();
      setPackages(result as PiPackage[]);
    } catch {
      // ignore — packages dir may not exist
    } finally {
      setLoadingPackages(false);
    }
  }, []);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  // ── Update Check ──────────────────────────────────────

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateError(false);
    setApplyMessage(null);
    try {
      const result = await window.electronAPI.maker.pi.checkUpdates();
      setUpdateResult(result as UpdateCheckResult);
    } catch {
      setUpdateError(true);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleApplyUpdates = async () => {
    const names = (updateResult?.extensions ?? []).filter((e) => e.hasUpdate).map((e) => e.name);
    if (names.length === 0) return;
    setApplying(true);
    setApplyMessage(null);
    try {
      const results = await window.electronAPI.maker.pi.applyUpdates(names);
      const typed = results as ApplyResult[];
      const failNames = typed.filter((r) => !r.success).map((r) => r.name);
      setApplyMessage({ ok: typed.length - failNames.length, failNames });
      // Re-check after update
      const check = await window.electronAPI.maker.pi.checkUpdates();
      setUpdateResult(check as UpdateCheckResult);
      void loadPackages();
    } catch {
      setUpdateError(true);
    } finally {
      setApplying(false);
    }
  };

  // ── Package Management ────────────────────────────────

  const handleAddPackage = async () => {
    const name = newPackage.trim();
    if (!name) return;
    try {
      const ok = await window.electronAPI.maker.pi.addPackage(name);
      if (ok) {
        setNewPackage('');
        await loadPackages();
        toast.success(t('settings.pi.packageAdded'));
      } else {
        toast.error(t('settings.pi.packageAddFailed'));
      }
    } catch {
      toast.error(t('settings.pi.packageAddFailed'));
    }
  };

  const handleRemovePackage = async (name: string) => {
    try {
      const ok = await window.electronAPI.maker.pi.removePackage(name);
      if (ok) {
        await loadPackages();
        toast.success(t('settings.pi.packageRemoved'));
      } else {
        toast.error(t('settings.pi.packageRemoveFailed'));
      }
    } catch {
      toast.error(t('settings.pi.packageRemoveFailed'));
    }
  };

  // ── Import / Export ───────────────────────────────────

  const handleExport = async () => {
    try {
      const payload = await window.electronAPI.maker.pi.exportConfig();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pi-config-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(t('settings.pi.exportSuccess'));
    } catch {
      toast.error(t('settings.pi.exportFailed'));
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const ok = await window.electronAPI.maker.pi.importConfig(payload);
      if (ok) {
        toast.success(t('settings.pi.importSuccess'));
      } else {
        toast.error(t('settings.pi.importFailed'));
      }
    } catch {
      toast.error(t('settings.pi.importFailed'));
    }
    e.target.value = '';
  };

  const btnCls =
    'flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-chip)] px-4 py-2 text-13 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]';

  return (
    <div className="space-y-6">
      {/* Hero */}
      <header>
        <div className="text-11 font-semibold uppercase tracking-widest text-[var(--accent-emphasis)]">
          pi · harness
        </div>
        <h1 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
          {t('settings.pi.title')}
        </h1>
        <p className="mt-1 text-13 text-[var(--text-tertiary)]">{t('settings.pi.subtitle')}</p>
      </header>

      {/* ── Update Detection ─────────────────────────────── */}
      <SettingsCard
        icon={CloudDownload}
        title={t('settings.pi.updatesTitle')}
        desc={t('settings.pi.updatesDesc')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCheckUpdates}
            disabled={checkingUpdates || applying}
            className={cn(btnCls, 'disabled:opacity-60')}
          >
            <RefreshCw className={cn('h-4 w-4', checkingUpdates && 'animate-spin')} />
            {t('settings.pi.checkUpdates')}
          </button>
          {(updateResult?.extensions ?? []).some((e) => e.hasUpdate) && (
            <button
              onClick={handleApplyUpdates}
              disabled={applying || checkingUpdates}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-500/10 px-4 py-2 text-13 font-medium text-amber-500 transition-colors hover:bg-amber-500/20 disabled:opacity-60',
              )}
            >
              <CloudDownload className={cn('h-4 w-4', applying && 'animate-pulse')} />
              {applying ? t('settings.pi.updating') : t('settings.pi.updateAll')}
            </button>
          )}
        </div>

        {updateError && (
          <p className="mt-3 text-12 text-red-500">{t('settings.pi.updatesFailed')}</p>
        )}

        {applyMessage && (
          <div className="mt-3 space-y-1">
            {applyMessage.ok > 0 && (
              <p className="text-12 text-emerald-500">
                {t('settings.pi.updateSuccess', { count: applyMessage.ok })}
              </p>
            )}
            {applyMessage.failNames.length > 0 && (
              <p className="text-12 text-red-500">
                {t('settings.pi.updateFailedNames', {
                  count: applyMessage.failNames.length,
                  names: applyMessage.failNames.join(', '),
                })}
              </p>
            )}
          </div>
        )}

        {updateResult && (() => {
          const rows = [...(updateResult.pi ? [updateResult.pi] : []), ...updateResult.extensions];
          const updatable = rows.filter((r) => r.hasUpdate).length;
          return (
            <div className="mt-4 space-y-1.5">
              <p
                className={cn(
                  'text-11 font-semibold',
                  updatable > 0 ? 'text-amber-500' : 'text-emerald-500',
                )}
              >
                {updatable > 0
                  ? t('settings.pi.updatesSummary', { count: updatable })
                  : t('settings.pi.updatesAllLatest')}
              </p>
              {rows.map((r) => (
                <div
                  key={r.name}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border bg-[var(--surface-chip)] px-3 py-2',
                    r.hasUpdate ? 'border-amber-500/60' : 'border-[var(--border-default)]',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-11 text-[var(--text-primary)]">
                      {r.name}
                    </span>
                    {updateResult.pi && r.name === updateResult.pi.name && (
                      <span className="rounded border border-[var(--border-default)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-10 text-[var(--text-tertiary)]">
                        core
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-10 text-[var(--text-tertiary)]">
                      {r.latest === null
                        ? `${r.installed} → ?`
                        : r.hasUpdate
                          ? `${r.installed} → ${r.latest}`
                          : r.installed}
                    </span>
                    {r.latest === null ? (
                      <span className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-10 text-[var(--text-tertiary)]">
                        {t('settings.pi.updatesLookupFailed')}
                      </span>
                    ) : r.hasUpdate ? (
                      <span className="rounded border border-amber-500 bg-amber-500/10 px-1.5 py-0.5 text-10 font-medium text-amber-500">
                        {t('settings.pi.updateAvailable')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 rounded border border-emerald-500/60 px-1.5 py-0.5 text-10 text-emerald-500">
                        <Check className="h-2.5 w-2.5" />
                        {t('settings.pi.updatesUpToDate')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </SettingsCard>

      {/* ── Extensions & Packages ────────────────────────── */}
      <SettingsCard icon={Package} title={t('settings.pi.packages')}>
        {packages.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {packages.map((pkg) => (
              <span
                key={pkg.name}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-chip)] px-2.5 py-1 text-11 text-[var(--text-secondary)]"
              >
                <span className="font-mono">{pkg.name}</span>
                <span className="text-10 text-[var(--text-tertiary)]">@{pkg.version}</span>
                <button
                  onClick={() => handleRemovePackage(pkg.name)}
                  className="text-[var(--text-tertiary)] transition-colors hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {packages.length === 0 && !loadingPackages && (
          <p className="mb-4 text-12 text-[var(--text-tertiary)]">{t('settings.pi.noPackages')}</p>
        )}
        {loadingPackages && (
          <p className="mb-4 text-12 text-[var(--text-tertiary)]">{t('settings.pi.loading')}</p>
        )}
        <div className="flex max-w-md gap-2">
          <input
            type="text"
            value={newPackage}
            onChange={(e) => setNewPackage(e.target.value)}
            placeholder={t('settings.pi.packagePlaceholder')}
            className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-chip)] px-3 py-1.5 text-13 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPackage.trim()) {
                void handleAddPackage();
              }
            }}
          />
          <button onClick={handleAddPackage} className={btnCls}>
            <Plus className="h-3.5 w-3.5" />
            {t('settings.pi.add')}
          </button>
        </div>
      </SettingsCard>

      {/* ── Import & Export ──────────────────────────────── */}
      <SettingsCard icon={Download} title={t('settings.pi.importExport')}>
        <div className="flex flex-wrap gap-3">
          <button onClick={handleExport} className={btnCls}>
            <Download className="h-4 w-4" />
            {t('settings.pi.export')}
          </button>
          <button onClick={handleImportClick} className={btnCls}>
            <Upload className="h-4 w-4" />
            {t('settings.pi.import')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
        <p className="mt-3 text-11 text-[var(--text-tertiary)]">
          {t('settings.pi.importExportHint')}
        </p>
      </SettingsCard>
    </div>
  );
}

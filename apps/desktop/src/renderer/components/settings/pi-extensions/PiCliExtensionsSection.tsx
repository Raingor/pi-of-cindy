/**
 * PiCliExtensionsSection — 本机 Pi CLI(`~/.pi/agent/settings.json` 的 `packages`)
 * 扩展面板。
 *
 * 与 Cindy 自己的「Pi 扩展」(`PiPackagesSection`)是两套数据:那页管 Cindy 的
 * `<userData>/pi-package-home`,带批准状态、指纹校验与逐项权限确认;本页管用户自己的
 * Pi CLI 安装 —— 按维护者裁决权限放开,装 / 卸直接跑 CLI,不引入 Cindy 侧批准态,
 * 也不提供启用开关(启用与否由 Pi CLI 自己的配置决定)。
 *
 * 装 / 卸按钮与在终端里手敲 `pi install|remove` 等效,会真实修改
 * `~/.pi/agent/settings.json` 与 `~/.pi/agent/npm/`。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Spinner } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { createLogger } from '@/lib/logger';
import { extractIpcError } from '@/utils/ipcError';
import { SettingsTextInput } from '../SettingsTextInput';

const log = createLogger('PiCliExtensionsSection');

type PiCliExtensions = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['maker']['piAgent']['listCliExtensions']>
>;

const CARD_CLASS = cn(
  'flex items-center justify-between gap-3 rounded-xl px-4 py-3',
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

const ICON_ACTION_CLASS = cn(
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
  'text-[var(--settings-section-desc)] transition-colors hover:bg-sidebar-item-hover',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

type LoadState = 'loading' | 'ready' | 'error';

export function PiCliExtensionsSection() {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const [state, setState] = useState<LoadState>('loading');
  const [result, setResult] = useState<PiCliExtensions | null>(null);
  const [source, setSource] = useState('');
  /** 单飞:CLI 命令会改盘上配置,不允许并发装卸。 */
  const [busy, setBusy] = useState<{ action: 'install' | 'remove'; source: string } | null>(null);

  const load = useCallback(async () => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api?.listCliExtensions) {
      setState('error');
      return;
    }
    try {
      setResult(await api.listCliExtensions());
      setState('ready');
    } catch (err: unknown) {
      log.warn('listCliExtensions failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = useCallback(
    async (action: 'install' | 'remove', target: string) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api?.mutateCliPackage || busy) return;
      setBusy({ action, source: target });
      try {
        await api.mutateCliPackage({ action, source: target });
        toast.success(
          t(
            action === 'install'
              ? 'settings.piCliExtensions.installSuccess'
              : 'settings.piCliExtensions.removeSuccess',
            { name: target },
          ),
        );
        if (action === 'install') setSource('');
        await load();
      } catch (err: unknown) {
        // extractIpcError 对非 IPC 错误返回 null;回落到通用文案。
        const ipcError = extractIpcError(err);
        toast.error(
          ipcError?.message ||
            t(
              action === 'install'
                ? 'settings.piCliExtensions.installFailed'
                : 'settings.piCliExtensions.removeFailed',
              { name: target },
            ),
        );
      } finally {
        setBusy(null);
      }
    },
    [busy, load, t],
  );

  const handleRemove = useCallback(
    async (target: string) => {
      const accepted = await confirmDialog.confirm({
        title: t('settings.piCliExtensions.removeConfirmTitle'),
        description: t('settings.piCliExtensions.removeConfirmBody', { name: target }),
        confirmText: t('settings.piCliExtensions.remove'),
        cancelText: t('commonUi.confirmDialog.cancel'),
      });
      if (!accepted) return;
      await runMutation('remove', target);
    },
    [confirmDialog, runMutation, t],
  );

  const trimmedSource = source.trim();
  const installDisabled = busy !== null || trimmedSource.length === 0;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="pi-cli-extensions-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="pi-cli-extensions-title"
            className="text-16 font-medium text-[var(--settings-section-title)]"
          >
            {t('settings.piCliExtensions.title')}
          </h3>
          <p className="mt-1 text-13 leading-relaxed text-[var(--settings-section-desc)]">
            {t('settings.piCliExtensions.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === 'loading' || busy !== null}
          className={cn(ACTION_CLASS, 'shrink-0')}
        >
          {state === 'loading' ? <Spinner size={14} /> : <RefreshCw size={14} />}
          {t('settings.piCliExtensions.refresh')}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <SettingsTextInput
          value={source}
          onChange={setSource}
          placeholder={t('settings.piCliExtensions.sourcePlaceholder')}
          size="sm"
          mono
        />
        <button
          type="button"
          onClick={() => void runMutation('install', trimmedSource)}
          disabled={installDisabled}
          className={cn(ACTION_CLASS, 'shrink-0')}
        >
          {busy?.action === 'install' ? <Spinner size={14} /> : <Plus size={14} />}
          {t('settings.piCliExtensions.install')}
        </button>
      </div>

      {state === 'loading' && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-8 text-12 text-[var(--settings-section-desc)]"
        >
          <Spinner size={15} />
          {t('settings.piCliExtensions.loading')}
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 text-[var(--settings-section-desc)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t('settings.piCliExtensions.loadFailed')}
        </div>
      )}

      {state === 'ready' && result && !result.installed && (
        <p className="rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 leading-relaxed text-[var(--settings-section-desc)]">
          {t('settings.piCliExtensions.notInstalled')}
        </p>
      )}

      {state === 'ready' && result?.installed && result.extensions.length === 0 && !result.error && (
        <p className="rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 text-[var(--settings-section-desc)]">
          {t('settings.piCliExtensions.empty')}
        </p>
      )}

      {state === 'ready' &&
        result?.installed &&
        result.extensions.map((extension) => (
          <div key={extension.source} className={CARD_CLASS}>
            <div className="flex min-w-0 items-center gap-2.5">
              <Package size={16} className="shrink-0 text-[var(--settings-section-desc)]" />
              <div className="min-w-0">
                <p className="truncate text-13 font-medium text-[var(--settings-section-title)]">
                  {extension.name}
                </p>
                <p className="truncate font-mono text-11 text-[var(--settings-section-desc)]">
                  {extension.source}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRemove(extension.source)}
              disabled={busy !== null}
              aria-label={t('settings.piCliExtensions.removeAria', { name: extension.name })}
              className={ICON_ACTION_CLASS}
            >
              {busy?.action === 'remove' && busy.source === extension.source ? (
                <Spinner size={14} />
              ) : (
                <Trash2 size={14} />
              )}
            </button>
          </div>
        ))}
    </section>
  );
}

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';

const CARD_CLASS =
  'rounded-[10px] border px-3.5 py-3 transition-colors';

export function PiConfigImportExport() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; key: string } | null>(null);

  const api = window.electronAPI?.maker?.piAgent;

  const showToast = useCallback((type: 'success' | 'error', key: string) => {
    setToast({ type, key });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleExport = useCallback(async () => {
    if (!api) return;
    setExporting(true);
    try {
      const config = await api.exportConfig();
      const payload = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        config,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `pi-config-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('success', t('settings.piConfig.exportSuccess'));
    } catch {
      showToast('error', t('settings.piConfig.exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [api, t, showToast]);

  const handleImport = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !api) return;
    setImporting(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const config = payload.config ?? payload;
      const ok = await api.importConfig(config);
      if (ok) {
        showToast('success', t('settings.piConfig.importSuccess'));
      } else {
        showToast('error', t('settings.piConfig.importFailed'));
      }
    } catch {
      showToast('error', t('settings.piConfig.importInvalid'));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [api, t, showToast]);

  const handleReset = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    if (!api) return;
    setResetting(true);
    setConfirmReset(false);
    try {
      const emptyConfig = { settings: {}, auth: {}, modelsJson: null };
      const ok = await api.importConfig(emptyConfig);
      if (ok) {
        showToast('success', t('settings.piConfig.resetSuccess'));
      } else {
        showToast('error', t('settings.piConfig.resetFailed'));
      }
    } catch {
      showToast('error', t('settings.piConfig.resetFailed'));
    } finally {
      setResetting(false);
    }
  }, [api, confirmReset, t, showToast]);

  return (
    <div
      className={CARD_CLASS}
      style={{
        borderColor: 'var(--settings-theme-card-border)',
        background: 'var(--settings-theme-card-bg)',
      }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className="text-[13px] font-medium"
          style={{ color: 'var(--settings-section-title)' }}
        >
          {t('settings.piConfig.title')}
        </span>
      </div>
      <p
        className="mb-3 text-[12px] leading-[1.5]"
        style={{ color: 'var(--settings-section-sublabel)' }}
      >
        {t('settings.piConfig.description')}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
          style={{
            background: 'var(--accent-color)',
            color: '#fff',
          }}
        >
          <Download size={13} />
          {exporting ? t('settings.piConfig.exporting') : t('settings.piConfig.export')}
        </button>

        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
          style={{
            borderColor: 'var(--settings-theme-card-border)',
            color: 'var(--settings-section-title)',
            background: 'transparent',
          }}
        >
          <Upload size={13} />
          {importing ? t('settings.piConfig.importing') : t('settings.piConfig.import')}
        </button>

        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
          style={{
            borderColor: confirmReset ? 'var(--danger, #e5484d)' : 'var(--settings-theme-card-border)',
            color: confirmReset ? 'var(--danger, #e5484d)' : 'var(--settings-section-sublabel)',
            background: 'transparent',
          }}
        >
          <RotateCcw size={13} />
          {confirmReset
            ? t('settings.piConfig.confirmReset')
            : resetting
              ? t('settings.piConfig.resetting')
              : t('settings.piConfig.reset')}
        </button>
      </div>

      {confirmReset && (
        <p
          className="mt-2 text-[11px] leading-[1.5]"
          style={{ color: 'var(--danger, #e5484d)' }}
        >
          {t('settings.piConfig.resetWarning')}
        </p>
      )}

      {toast && (
        <div
          className="mt-2.5 flex items-center gap-1.5 text-[11px]"
          style={{ color: toast.type === 'success' ? 'var(--success, #30a46c)' : 'var(--danger, #e5484d)' }}
        >
          {toast.type === 'success' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          <span>{toast.key}</span>
        </div>
      )}
    </div>
  );
}

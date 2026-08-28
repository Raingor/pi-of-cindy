import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, X, ChevronDown, ChevronRight } from 'lucide-react';

interface EnabledModelEntry {
  ref: string;
  providerId: string;
  modelId: string;
}

interface PiSettingsLike {
  enabledModels?: string[];
  [key: string]: unknown;
}

export function EnabledModelsPanel() {
  const { t } = useTranslation();
  const [enabledModels, setEnabledModels] = useState<EnabledModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const api = window.electronAPI?.maker?.piAgent;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const raw = (await api.readSettings()) as PiSettingsLike | null;
      const refs = raw?.enabledModels ?? [];
      const entries: EnabledModelEntry[] = refs.map((ref: string) => {
        const [providerId, ...rest] = ref.split('/');
        return { ref, providerId, modelId: rest.join('/') };
      });
      setEnabledModels(entries);
    } catch {
      setEnabledModels([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeModel = useCallback(async (ref: string) => {
    if (!api) return;
    try {
      const settings = (await api.readSettings()) as PiSettingsLike | null;
      const current = settings?.enabledModels ?? [];
      const next = current.filter((m: string) => m !== ref);
      await api.writeSettings({ ...settings, enabledModels: next });
      setEnabledModels((prev) => prev.filter((e) => e.ref !== ref));
    } catch {
      // silent
    }
  }, [api]);

  const disableAll = useCallback(async () => {
    if (!api) return;
    try {
      const settings = (await api.readSettings()) as PiSettingsLike | null;
      await api.writeSettings({ ...settings, enabledModels: [] });
      setEnabledModels([]);
    } catch {
      // silent
    }
  }, [api]);

  if (loading) return null;

  return (
    <div
      className="rounded-[10px] border transition-colors"
      style={{
        borderColor: 'var(--settings-theme-card-border)',
        background: 'var(--settings-theme-card-bg)',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight size={14} className="text-[var(--settings-section-sublabel)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--settings-section-sublabel)]" />
          )}
          <Zap size={14} className="text-[var(--success, #30a46c)]" />
          <span
            className="text-[13px] font-medium"
            style={{ color: 'var(--settings-section-title)' }}
          >
            {t('settings.providers.enabledModels.title')}
          </span>
          <span
            className="rounded-full border px-1.5 py-0.5 text-[11px]"
            style={{
              borderColor: 'var(--settings-theme-card-border)',
              color: 'var(--settings-section-sublabel)',
            }}
          >
            {enabledModels.length}
          </span>
        </button>

        {enabledModels.length > 0 && !collapsed && (
          <button
            type="button"
            onClick={disableAll}
            className="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-80"
            style={{
              borderColor: 'var(--settings-theme-card-border)',
              color: 'var(--danger, #e5484d)',
            }}
          >
            {t('settings.providers.enabledModels.disableAll')}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-3.5 pb-3">
          {enabledModels.length === 0 ? (
            <p
              className="text-[12px] leading-[1.5]"
              style={{ color: 'var(--settings-section-sublabel)', opacity: 0.7 }}
            >
              {t('settings.providers.enabledModels.empty')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {enabledModels.map((entry) => (
                <span
                  key={entry.ref}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
                  style={{
                    borderColor: 'var(--settings-theme-card-border)',
                    background: 'var(--surface-subtle, rgba(0,0,0,0.03))',
                    color: 'var(--settings-section-title)',
                  }}
                >
                  <span className="truncate font-mono" title={entry.modelId}>
                    {entry.modelId}
                  </span>
                  <span
                    className="shrink-0 rounded px-1 py-0.5 text-[10px]"
                    style={{
                      background: 'var(--settings-theme-card-bg)',
                      color: 'var(--settings-section-sublabel)',
                    }}
                  >
                    {entry.providerId}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeModel(entry.ref)}
                    className="ml-0.5 shrink-0 rounded p-0.5 transition-colors hover:opacity-70"
                    title={t('settings.providers.enabledModels.remove')}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

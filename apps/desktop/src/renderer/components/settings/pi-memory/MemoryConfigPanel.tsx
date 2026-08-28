import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, RotateCcw } from 'lucide-react';

import type { PiHermesMemoryConfig } from '@/../main/pi-agent/piTypes';
import { cn } from '@/lib/utils';

interface MemoryConfigPanelProps {
  config: PiHermesMemoryConfig | null;
  onSave: (config: PiHermesMemoryConfig) => Promise<boolean>;
}

const OVERFLOW_STRATEGIES: Array<{
  value: NonNullable<PiHermesMemoryConfig['memoryOverflowStrategy']>;
  labelKey: string;
}> = [
  { value: 'auto-consolidate', labelKey: 'settings.piMemory.overflowAuto' },
  { value: 'reject', labelKey: 'settings.piMemory.overflowReject' },
  { value: 'fifo-evict', labelKey: 'settings.piMemory.overflowFifo' },
];

export function MemoryConfigPanel({ config, onSave }: MemoryConfigPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PiHermesMemoryConfig>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setDraft({ ...config });
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleReset = () => {
    if (config) setDraft({ ...config });
  };

  const update = <K extends keyof PiHermesMemoryConfig>(key: K, value: PiHermesMemoryConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  return (
    <div className="rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-4">
      <h3 className="mb-3 text-13 font-medium text-[var(--settings-section-title)]">
        {t('settings.piMemory.configTitle')}
      </h3>

      <div className="flex flex-col gap-3">
        {/* Model Override */}
        <div>
          <label className="mb-1 block text-11 text-[var(--settings-section-sublabel)]">
            {t('settings.piMemory.modelOverride')}
          </label>
          <input
            type="text"
            value={draft.llmModelOverride || ''}
            onChange={(e) => update('llmModelOverride', e.target.value || undefined)}
            placeholder={t('settings.piMemory.modelOverridePlaceholder')}
            className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] px-3 py-1.5 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
          />
        </div>

        {/* Thinking Override */}
        <div>
          <label className="mb-1 block text-11 text-[var(--settings-section-sublabel)]">
            {t('settings.piMemory.thinkingOverride')}
          </label>
          <input
            type="text"
            value={draft.llmThinkingOverride || ''}
            onChange={(e) => update('llmThinkingOverride', e.target.value || undefined)}
            placeholder={t('settings.piMemory.thinkingOverridePlaceholder')}
            className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] px-3 py-1.5 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
          />
        </div>

        {/* Consolidation Timeout */}
        <div>
          <label className="mb-1 block text-11 text-[var(--settings-section-sublabel)]">
            {t('settings.piMemory.consolidationTimeout')}
          </label>
          <input
            type="number"
            value={draft.consolidationTimeoutMs ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              update('consolidationTimeoutMs', v ? Number(v) : undefined);
            }}
            placeholder="30000"
            className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] px-3 py-1.5 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
          />
        </div>

        {/* Memory Char Limit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piMemory.memoryCharLimit')}
            </label>
            <input
              type="number"
              value={draft.memoryCharLimit ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                update('memoryCharLimit', v ? Number(v) : undefined);
              }}
              placeholder="50000"
              className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] px-3 py-1.5 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piMemory.userCharLimit')}
            </label>
            <input
              type="number"
              value={draft.userCharLimit ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                update('userCharLimit', v ? Number(v) : undefined);
              }}
              placeholder="10000"
              className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] px-3 py-1.5 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
            />
          </div>
        </div>

        {/* Overflow Strategy */}
        <div>
          <label className="mb-1 block text-11 text-[var(--settings-section-sublabel)]">
            {t('settings.piMemory.overflowStrategy')}
          </label>
          <div className="flex gap-1">
            {OVERFLOW_STRATEGIES.map((s) => (
              <button
                key={s.value}
                onClick={() => update('memoryOverflowStrategy', s.value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-11 font-medium transition-colors',
                  draft.memoryOverflowStrategy === s.value
                    ? 'bg-[#3b82f6] text-white'
                    : 'bg-[var(--surface)] text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
                )}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Save / Reset */}
        <div className="flex items-center gap-2 border-t border-[var(--settings-theme-card-border)] pt-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-12 font-medium text-white transition-colors hover:bg-[#2563eb] disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saved ? t('settings.piMemory.saved') : t('settings.piMemory.save')}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] px-3 py-1.5 text-12 text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('settings.piMemory.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}

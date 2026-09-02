import { useEffect, useState } from 'react';

import type { PiAgentDef } from '@/../main/pi-agent/piTypes';
import { Check, Loader2, Pencil, X } from 'lucide-react';

import { useTranslation } from 'react-i18next';

interface AgentCardProps {
  agent: PiAgentDef;
  onSave: (
    fileName: string,
    patch: { model?: string; thinking?: string },
  ) => Promise<boolean>;
  onSaved: () => void;
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export function AgentCard({ agent, onSave, onSaved }: AgentCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState(agent.model ?? '');
  const [thinking, setThinking] = useState(agent.thinking ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 可选模型清单(本机 pi 已配置供应商下的全部模型,pws eligibleModels 同口径)。
  const [eligibleModels, setEligibleModels] = useState<string[]>([]);

  // 进入编辑态时拉一次本机模型清单(剥密视图,模型引用 = provider/model)。
  const beginEdit = async () => {
    setMsg(null);
    setEditing(true);
    try {
      const snapshot = await window.electronAPI?.maker?.piAgent?.listCliProviders?.();
      if (snapshot?.installed && !snapshot.error) {
        const refs: string[] = [];
        for (const p of snapshot.providers) {
          for (const m of p.models) refs.push(`${p.id}/${m.id}`);
        }
        setEligibleModels(refs);
      }
    } catch {
      setEligibleModels([]);
    }
  };

  useEffect(() => {
    setModel(agent.model ?? '');
    setThinking(agent.thinking ?? '');
    setEditing(false);
    setMsg(null);
  }, [agent.fileName, agent.model, agent.thinking]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    const ok = await onSave(agent.fileName, {
      model: model.trim() || undefined,
      thinking: thinking.trim() || undefined,
    });
    if (ok) {
      setMsg({ ok: true, text: t('settings.piSubagents.saved') });
      setEditing(false);
      onSaved();
    } else {
      setMsg({ ok: false, text: t('settings.piSubagents.saveFailed') });
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setEditing(false);
    setModel(agent.model ?? '');
    setThinking(agent.thinking ?? '');
    setMsg(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2
          className="text-base font-semibold"
          style={{ color: 'var(--settings-text-primary)' }}
        >
          {agent.name}
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor:
              agent.package === 'custom'
                ? 'var(--accent-muted, rgba(59,130,246,0.15))'
                : 'var(--settings-bg-tertiary)',
            color:
              agent.package === 'custom'
                ? 'var(--accent-emphasis)'
                : 'var(--settings-text-secondary)',
          }}
        >
          {agent.package}
        </span>
        {agent.package === 'custom' && !editing && (
          <button
            onClick={() => {
              void beginEdit();
            }}
            className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors"
            style={{
              borderColor: 'var(--settings-border)',
              color: 'var(--settings-text-secondary)',
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('settings.piSubagents.edit')}
          </button>
        )}
      </div>

      <p className="text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
        {agent.description}
      </p>

      <div
        className="grid grid-cols-2 gap-4 rounded-lg border p-4"
        style={{
          borderColor: 'var(--settings-border)',
          backgroundColor: 'var(--settings-bg-secondary)',
        }}
      >
        <div className={editing ? 'col-span-2' : ''}>
          <span
            className="text-xs"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.model')}
          </span>
          {editing ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-1.5 font-mono text-sm outline-none focus:ring-1"
              style={{
                borderColor: 'var(--settings-border)',
                backgroundColor: 'var(--settings-bg-primary)',
                color: 'var(--settings-text-primary)',
              }}
            >
              <option value="">{t('settings.piSubagents.modelDefault')}</option>
              {/* 已保存但当前清单里没有的模型保持可选,避免保存时意外丢失。 */}
              {model && !eligibleModels.includes(model) && (
                <option value={model}>{model}</option>
              )}
              {eligibleModels.map((ref) => (
                <option key={ref} value={ref}>
                  {ref}
                </option>
              ))}
            </select>
          ) : (
            <p
              className="mt-0.5 font-mono text-sm"
              style={{ color: 'var(--settings-text-primary)' }}
            >
              {agent.model || t('settings.piSubagents.modelDefault')}
            </p>
          )}
        </div>

        <div>
          <span
            className="text-xs"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.thinking')}
          </span>
          {editing ? (
            <select
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-1"
              style={{
                borderColor: 'var(--settings-border)',
                backgroundColor: 'var(--settings-bg-primary)',
                color: 'var(--settings-text-primary)',
              }}
            >
              <option value="">{t('settings.piSubagents.thinkingDefault')}</option>
              {THINKING_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
                </option>
              ))}
            </select>
          ) : (
            <p
              className="mt-0.5 text-sm"
              style={{ color: 'var(--settings-text-primary)' }}
            >
              {agent.thinking || t('settings.piSubagents.thinkingDefault')}
            </p>
          )}
        </div>

        {editing && (
          <div className="col-span-2 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-cta-bg)' }}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {saving
                ? t('settings.piSubagents.saving')
                : t('settings.piSubagents.save')}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
              style={{
                borderColor: 'var(--settings-border)',
                color: 'var(--settings-text-secondary)',
              }}
            >
              <X className="h-3.5 w-3.5" />
              {t('settings.piSubagents.cancel')}
            </button>
            {msg && (
              <span
                className="text-xs"
                style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)' }}
              >
                {msg.text}
              </span>
            )}
          </div>
        )}
        {!editing && msg && (
          <div className="col-span-2">
            <span
              className="text-xs"
              style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)' }}
            >
              {msg.text}
            </span>
          </div>
        )}

        {/* Array.isArray 兜底:frontmatter 写法不受控(逗号分隔字符串等),
            主进程 splitMaybe 已归一,这里再挡一道避免整页渲染崩溃。 */}
        {Array.isArray(agent.tools) && agent.tools.length > 0 && (
          <div className="col-span-2">
            <span
              className="text-xs"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {t('settings.piSubagents.tools')}
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {agent.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-md border px-2 py-0.5 font-mono text-xs"
                  style={{
                    borderColor: 'var(--settings-border)',
                    backgroundColor: 'var(--settings-bg-tertiary)',
                    color: 'var(--settings-text-secondary)',
                  }}
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <span
            className="text-xs"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.systemPromptMode')}
          </span>
          <p
            className="mt-0.5 text-sm"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {agent.systemPromptMode || 'replace'}
          </p>
        </div>
        <div>
          <span
            className="text-xs"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.input')}
          </span>
          <p
            className="mt-0.5 text-sm"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {(Array.isArray(agent.input) ? agent.input : ['text']).join(', ')}
          </p>
        </div>
      </div>

      <div>
        <span
          className="text-xs"
          style={{ color: 'var(--settings-text-tertiary)' }}
        >
          {t('settings.piSubagents.systemPrompt')}
        </span>
        <pre
          className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border p-3 whitespace-pre-wrap font-mono text-xs"
          style={{
            borderColor: 'var(--settings-border)',
            backgroundColor: 'var(--settings-bg-tertiary)',
            color: 'var(--settings-text-secondary)',
          }}
        >
          {agent.body || t('settings.piSubagents.emptyPrompt')}
        </pre>
      </div>
    </div>
  );
}

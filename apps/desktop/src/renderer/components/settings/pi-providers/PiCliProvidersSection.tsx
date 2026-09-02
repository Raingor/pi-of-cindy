/**
 * PiCliProvidersSection — 本机 Pi CLI(`~/.pi/agent/models.json`)的供应商与模型面板。
 *
 * 排版与功能对齐 pi-web-switch 的 ProvidersModelsPage:页头 kicker、跨供应商
 * 「已启用模型」汇总面板、左导轨(供应商 + 添加/导入入口)、右详情(可编辑
 * 名称/端点/接口形态/兼容开关、密钥池的增删与切换、供应商级 停用/复制/删除、
 * 模型行的启用开关与快捷添加)。
 *
 * 数据与写入:列表来自本机剥密视图(listCliProviders);写路径走语义化
 * mutateCli 通道(upsert/rename/remove/disable/model/enabled,字段白名单),
 * 真值 key 只从用户输入流入 main 落盘,响应不回传。**密钥明文显形刻意不做**
 * —— Renderer 是不可信环境,见 docs/dev-rules/electron-security-and-process-
 * boundaries.md(pi-web-switch 有显形,这是两产品唯一的功能性差异)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Brain,
  Check,
  ClipboardPaste,
  Copy,
  Image as ImageIcon,
  KeyRound,
  ListPlus,
  Lock,
  LockOpen,
  Mic,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  isValidHttpUrl,
  parseProviderImport,
  PI_API_TYPES,
} from '@/lib/piProviderImport';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('PiCliProvidersSection');

type PiCliProviders = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['maker']['piAgent']['listCliProviders']>
>;
type PiCliProvider = PiCliProviders['providers'][number];
type PiCliModel = PiCliProvider['models'][number];

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

const INPUT_CLASS = cn(
  'w-full rounded-lg px-3 py-2 text-12 outline-none',
  'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
  'text-[var(--settings-section-title)]',
  'focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
);

const BADGE_CLASS = cn(
  'shrink-0 rounded-md px-2 py-0.5 text-11',
  'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
  'text-[var(--settings-section-desc)]',
);

/** pws DEFAULT_CONTEXT_WINDOW / DEFAULT_MAX_TOKENS。 */
const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 32768;

type LoadState = 'loading' | 'ready' | 'error';

type ProviderTestResult = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['maker']['piAgent']['testCliProvider']>
>;
type ProviderFetchResult = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['maker']['piAgent']['fetchCliProviderModels']>
>;

/** 详情面板一次最多展示的拉取模型条数,超出折叠为「还有 N 个」。 */
const FETCHED_MODELS_DISPLAY_CAP = 40;

/** 与 pi-web-switch `formatTokens` 一致:1.05M / 262.1K / 999。 */
function formatTokens(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return '—';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

/** 与 pi-web-switch `formatCost` 一致(USD):$1.23 / ¢12.3 / $0.0004。 */
function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(2)}`;
  if (cost >= 1) return `$${cost.toFixed(3)}`;
  if (cost >= 0.01) return `¢${(cost * 100).toFixed(1)}`;
  return `$${cost.toFixed(4)}`;
}

// ─── EnabledModelsPanel(跨供应商已启用汇总)───────────────────────────────

function EnabledModelsPanel({
  providers,
  onChanged,
}: {
  providers: PiCliProvider[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const api = window.electronAPI?.maker?.piAgent;
  const enabled = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models
          .filter((m) => m.enabled)
          .map((m) => ({ ref: `${p.id}/${m.id}`, name: m.name || m.id, providerName: p.name })),
      ),
    [providers],
  );
  const [busy, setBusy] = useState(false);

  const remove = async (ref: string) => {
    if (!api?.mutateCli || busy) return;
    setBusy(true);
    try {
      await api.mutateCli({ action: 'update-enabled', change: { disable: [ref] } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  // pws 同款:清空整个名单(pi 对空名单/缺省同样不过滤,写空数组语义一致)。
  const disableAll = async () => {
    if (!api?.mutateCli || busy) return;
    setBusy(true);
    try {
      await api.mutateCli({ action: 'update-enabled', change: { replaceAll: [] } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(CARD_CLASS, 'p-4')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap size={14} className="shrink-0 text-emerald-500" />
          <h3 className="text-13 font-semibold text-[var(--settings-section-title)]">
            {t('settings.piCliProviders.enabledModelsTitle')}
          </h3>
          <span className={BADGE_CLASS}>{enabled.length}</span>
        </div>
        {enabled.length > 0 && (
          <button
            type="button"
            onClick={() => void disableAll()}
            disabled={busy}
            className={cn(ACTION_CLASS, 'h-7 text-11')}
          >
            {t('settings.piCliProviders.disableAll')}
          </button>
        )}
      </div>
      {enabled.length === 0 ? (
        <p className="mt-3 text-12 text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.noEnabledModels')}
        </p>
      ) : (
        <div className="mt-3 grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-1 lg:grid-cols-2">
          {enabled.map((m) => (
            <div
              key={m.ref}
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--settings-theme-card-border)' }}
            >
              {/* 开关即停用该模型(主进程按白名单语义计算,其余模型保持不变)。 */}
              <button
                type="button"
                onClick={() => void remove(m.ref)}
                disabled={busy}
                title={t('settings.piCliProviders.model.enabled')}
                className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-emerald-500 transition-colors disabled:opacity-50"
              >
                <span className="inline-block h-3 w-3 translate-x-3.5 rounded-full bg-white" />
              </button>
              <Box size={14} className="shrink-0 text-[var(--text-tertiary)]" />
              <span className="min-w-0 flex-1 truncate font-mono text-12 text-[var(--settings-section-title)]">
                {m.name}
              </span>
              <span className={BADGE_CLASS}>{m.providerName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 模型行 ─────────────────────────────────────────────────────────────

function ModelRow({
  model,
  onToggleEnabled,
}: {
  model: PiCliModel;
  onToggleEnabled?: (modelId: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const cost = model.cost;
  const priced = !!cost && !!(cost.input || cost.output);
  const priceTitle = cost
    ? `In ${formatCost(cost.input ?? 0)} / Out ${formatCost(cost.output ?? 0)} · CacheR ${formatCost(
        cost.cacheRead ?? 0,
      )} / CacheW ${formatCost(cost.cacheWrite ?? 0)}`
    : undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2.5',
        'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
      )}
    >
      {/* 启用开关:写 settings.enabledModels(pi 的可用性白名单)。 */}
      {onToggleEnabled ? (
        <button
          type="button"
          onClick={() => onToggleEnabled(model.id, !model.enabled)}
          title={
            model.enabled
              ? t('settings.piCliProviders.model.enabled')
              : t('settings.piCliProviders.model.disabled')
          }
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
            model.enabled ? 'bg-emerald-500' : 'bg-[var(--settings-theme-card-border)]',
          )}
        >
          <span
            className={cn(
              'inline-block h-3 w-3 rounded-full bg-white transition-transform',
              model.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </button>
      ) : (
        <span
          title={
            model.enabled
              ? t('settings.piCliProviders.model.enabled')
              : t('settings.piCliProviders.model.disabled')
          }
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full',
            model.enabled ? 'bg-emerald-500' : 'bg-[var(--settings-theme-card-border)]',
          )}
        >
          <span
            className={cn(
              'inline-block h-3 w-3 rounded-full bg-white transition-transform',
              model.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </span>
      )}
      <Box size={14} className="shrink-0 text-[var(--text-tertiary)]" />
      <span className="min-w-0 flex-1 truncate font-mono text-12 text-[var(--settings-section-title)]">
        {model.id}
      </span>
      {model.reasoning && (
        <span title={t('settings.piCliProviders.model.reasoning')} className="flex shrink-0">
          <Brain size={13} className="text-purple-400" />
        </span>
      )}
      {model.input.includes('image') && (
        <span title={t('settings.piCliProviders.model.imageInput')} className="flex shrink-0">
          <ImageIcon size={13} className="text-blue-400" />
        </span>
      )}
      {model.input.includes('audio') && (
        <span title={t('settings.piCliProviders.model.audioInput')} className="flex shrink-0">
          <Mic size={13} className="text-emerald-400" />
        </span>
      )}
      <span className={BADGE_CLASS} {...(priceTitle ? { title: priceTitle } : {})}>
        {priced
          ? `${formatCost(cost?.input ?? 0)}/${formatCost(cost?.output ?? 0)}`
          : t('settings.piCliProviders.model.free')}
      </span>
      <span className={BADGE_CLASS} title={t('settings.piCliProviders.model.contextWindow')}>
        {formatTokens(model.contextWindow)}
      </span>
      <span className={BADGE_CLASS} title={t('settings.piCliProviders.model.maxTokens')}>
        ↑{formatTokens(model.maxTokens)}
      </span>
    </div>
  );
}

// ─── 添加供应商表单(pws AddProviderForm 同字段)──────────────────────────

function deriveProviderId(
  name: string,
  baseUrl: string,
  sanitize: (s: string) => string,
): string {
  const fromName = sanitize(name);
  if (fromName || !name.trim()) return fromName;
  try {
    const host = new URL(baseUrl.trim()).hostname;
    const skip = new Set(['api', 'www', 'app', 'gateway', 'open', 'openapi', 'platform']);
    const part = host.split('.').find((p) => p && !skip.has(p.toLowerCase()));
    return sanitize(part ?? '');
  } catch {
    return '';
  }
}

function AddProviderForm({
  existingIds,
  onDone,
  onCancel,
  reload,
}: {
  existingIds: Set<string>;
  onDone: (id: string) => void;
  onCancel: () => void;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = window.electronAPI?.maker?.piAgent;
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiType, setApiType] = useState('openai-completions');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const id = deriveProviderId(name, baseUrl, (s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  );
  const idExists = !!id && existingIds.has(id);
  const urlInvalid = baseUrl.trim() !== '' && !isValidHttpUrl(baseUrl.trim());
  const canSubmit = !!id && !!baseUrl.trim() && !idExists && !urlInvalid && !submitting;

  const handleSubmit = async () => {
    if (!api?.mutateCli || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      await api.mutateCli({
        action: 'upsert-provider',
        id,
        patch: {
          ...(name.trim() ? { name: name.trim() } : {}),
          baseUrl: baseUrl.trim(),
          api: apiType,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      });
      await reload();
      onDone(id);
    } catch (err) {
      log.warn('add provider failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-15 font-semibold text-[var(--settings-section-title)]">
          {t('settings.piCliProviders.addProviderTitle')}
        </h3>
        <p className="mt-1 text-12 text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.addProviderDesc')}
        </p>
      </div>
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.name')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.piCliProviders.namePlaceholder')}
          className={cn(INPUT_CLASS, 'mt-1.5', idExists && 'border-red-500')}
        />
        {idExists ? (
          <p className="mt-1 text-11 text-red-500">
            {t('settings.piCliProviders.idExists', { id })}
          </p>
        ) : id ? (
          <p className="mt-1 text-11 text-[var(--settings-section-desc)]">
            {t('settings.piCliProviders.idPreview', { id })}
          </p>
        ) : name.trim() ? (
          <p className="mt-1 text-11 text-red-500">{t('settings.piCliProviders.idInvalid')}</p>
        ) : null}
      </div>
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.baseUrl')}
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={cn(INPUT_CLASS, 'mt-1.5', urlInvalid && 'border-red-500')}
        />
        {urlInvalid && (
          <p className="mt-1 text-11 text-red-500">{t('settings.piCliProviders.invalidUrl')}</p>
        )}
      </div>
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.apiKey')}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-... or $MY_API_KEY"
          className={cn(INPUT_CLASS, 'mt-1.5')}
        />
        {apiKey.trim().startsWith('$') && (
          <p className="mt-1 text-11 text-sky-500">
            {t('settings.piCliProviders.apiKeyEnv', { ref: apiKey.trim() })}
          </p>
        )}
      </div>
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.apiType')}
        </label>
        <select
          value={apiType}
          onChange={(e) => setApiType(e.target.value)}
          className={cn(INPUT_CLASS, 'mt-1.5')}
        >
          {PI_API_TYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} className={cn(ACTION_CLASS)}>
          {t('settings.piCliProviders.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-4 text-12 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent, var(--text-link))' }}
        >
          {submitting ? <Spinner size={13} /> : <Check size={13} />}
          {t('settings.piCliProviders.save')}
        </button>
        {submitError && (
          <span className="text-11 text-red-500">{t('settings.piCliProviders.saveFailed')}</span>
        )}
      </div>
    </div>
  );
}

// ─── 导入弹窗(pws ImportProviderModal 同流程)──────────────────────────

function ImportProviderModal({
  open,
  onClose,
  onImported,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = window.electronAPI?.maker?.piAgent;
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  /** 整池密钥（key-1/key-2/… 多把导入支持）。 */
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [newKeyValue, setNewKeyValue] = useState('');
  const [apiType, setApiType] = useState('openai-completions');
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<
    Array<{ id: string; name?: string; reasoning?: boolean; vision?: boolean; audio?: boolean; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }>
  >([]);
  const [fetchSel, setFetchSel] = useState<Set<string>>(new Set());

  if (!open) return null;

  const handleText = (value: string) => {
    setText(value);
    const parsed = parseProviderImport(value);
    setName(parsed.name);
    setBaseUrl(parsed.baseUrl);
    setApiKeys(parsed.apiKeys);
    setModelIds(parsed.modelIds);
  };

  const reset = () => {
    setText('');
    setName('');
    setBaseUrl('');
    setApiKeys([]);
    setNewKeyValue('');
    setApiType('openai-completions');
    setModelIds([]);
    setSubmitting(false);
    setSubmitError(false);
    setFetching(false);
    setFetchErr(null);
    setFetchedModels([]);
    setFetchSel(new Set());
  };

  const id = deriveProviderId(name, baseUrl, (s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  );
  const urlInvalid = baseUrl.trim() !== '' && !isValidHttpUrl(baseUrl.trim());
  const parsedEmpty =
    text.trim() !== '' && !name && !baseUrl && apiKeys.length === 0 && modelIds.length === 0;
  const canSubmit = !!id && !!baseUrl.trim() && !urlInvalid && !submitting;

  const handleFetchModels = async () => {
    if (!api?.fetchCliModelsAdhoc || !isValidHttpUrl(baseUrl.trim()) || fetching) return;
    setFetching(true);
    setFetchErr(null);
    try {
      const data = await api.fetchCliModelsAdhoc(baseUrl.trim(), apiKeys[0] || undefined, apiType);
      if (data.error) {
        setFetchErr(data.error);
      } else {
        setFetchedModels(data.models ?? []);
        setFetchSel(new Set((data.models ?? []).map((m) => m.id)));
      }
    } catch {
      setFetchErr('network error');
    } finally {
      setFetching(false);
    }
  };

  const availableFetched = fetchedModels.filter((m) => !modelIds.includes(m.id));
  const toggleFetched = (mid: string) => {
    setFetchSel((prev) => {
      const next = new Set(prev);
      next.has(mid) ? next.delete(mid) : next.add(mid);
      return next;
    });
  };
  const allFetchedSelected =
    availableFetched.length > 0 && availableFetched.every((m) => fetchSel.has(m.id));
  const toggleAllFetched = () => {
    setFetchSel(allFetchedSelected ? new Set() : new Set(availableFetched.map((m) => m.id)));
  };

  // 手动追加一把 key(与详情面板的添加密钥同交互)。
  const addKeyValue = () => {
    const v = newKeyValue.trim();
    if (!v || apiKeys.includes(v)) return;
    setApiKeys((prev) => [...prev, v]);
    setNewKeyValue('');
  };

  const handleImport = async () => {
    if (!api?.mutateCli || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const selectedFetched = availableFetched.filter((m) => fetchSel.has(m.id));
      const newModels = [
        ...modelIds.map((mid) => ({
          id: mid,
          name: mid.split('/').pop() || mid,
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          maxTokens: DEFAULT_MAX_TOKENS,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
        ...selectedFetched.map((m) => ({
          id: m.id,
          name: m.name ?? (m.id.split('/').pop() || m.id),
          reasoning: m.reasoning === true,
          input: ['text', ...(m.vision ? ['image'] : []), ...(m.audio ? ['audio'] : [])],
          contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          maxTokens: m.maxTokens ?? DEFAULT_MAX_TOKENS,
          cost: {
            input: m.cost?.input ?? 0,
            output: m.cost?.output ?? 0,
            cacheRead: m.cost?.cacheRead ?? 0,
            cacheWrite: m.cost?.cacheWrite ?? 0,
          },
        })),
      ];
      // 整池密钥入配置:key-1/key-2/… 全部导入,首把默认生效(主进程镜像 apiKey)。
      const pool = apiKeys
        .filter((k) => k.trim())
        .map((k) => ({
          id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          key: k.trim(),
        }));
      await api.mutateCli({
        action: 'upsert-provider',
        id,
        patch: {
          ...(name.trim() ? { name: name.trim() } : {}),
          baseUrl: baseUrl.trim(),
          api: apiType,
          ...(pool.length > 0
            ? { apiKeys: pool, activeKeyId: pool[0]!.id, apiKey: pool[0]!.key }
            : {}),
          models: newModels,
        },
      });
      // 导入的模型默认启用(pws 语义:enabledModels 引用一并写入)。
      if (newModels.length > 0) {
        await api.mutateCli({
          action: 'update-enabled',
          change: { add: newModels.map((m) => `${id}/${m.id}`) },
        });
      }
      await reload();
      reset();
      onImported(id);
    } catch (err) {
      log.warn('import provider failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn(CARD_CLASS, 'max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-15 font-semibold text-[var(--settings-section-title)]">
            {t('settings.piCliProviders.importTitle')}
          </h3>
          <button type="button" onClick={onClose} className={cn(ACTION_CLASS)}>
            <X size={14} />
          </button>
        </div>
        <p className="mt-1 text-12 text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.importDesc')}
        </p>

        <textarea
          value={text}
          onChange={(e) => handleText(e.target.value)}
          rows={4}
          placeholder="tokenrouter baseurl：https://api.example.com/v1 key：sk-xxx modelid：vendor/model-a"
          className={cn(INPUT_CLASS, 'mt-3 font-mono')}
        />
        {parsedEmpty && (
          <p className="mt-1 text-11 text-amber-500">
            {t('settings.piCliProviders.importEmpty')}
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="block text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piCliProviders.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(INPUT_CLASS, 'mt-1')}
            />
          </div>
          <div>
            <label className="block text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piCliProviders.baseUrl')}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className={cn(INPUT_CLASS, 'mt-1', urlInvalid && 'border-red-500')}
            />
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="block text-11 text-[var(--settings-section-sublabel)]">
                {t('settings.piCliProviders.apiKey')}
              </label>
              {apiKeys.length > 1 && (
                <span className="text-11 text-[var(--settings-section-desc)]">
                  {t('settings.piCliProviders.keyCount', { count: apiKeys.length })}
                </span>
              )}
            </div>
            {/* 密钥池:key-1/key-2/… 粘贴时全部解析;每把可单独编辑/移除。 */}
            <div className="mt-1 flex flex-col gap-1.5">
              {apiKeys.map((key, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-10 text-[var(--settings-section-sublabel)]">
                    key-{i + 1}
                  </span>
                  <input
                    type="password"
                    value={key}
                    onChange={(e) =>
                      setApiKeys((prev) =>
                        prev.map((k, idx) => (idx === i ? e.target.value : k)),
                      )
                    }
                    className={cn(INPUT_CLASS, 'min-w-0 flex-1')}
                  />
                  <button
                    type="button"
                    onClick={() => setApiKeys((prev) => prev.filter((_, idx) => idx !== i))}
                    title={t('settings.piCliProviders.keyRemove')}
                    className="shrink-0 rounded-md p-1 text-[var(--settings-section-desc)] transition-colors hover:text-red-400"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-10 text-transparent" aria-hidden>
                  key-N
                </span>
                <input
                  type="password"
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addKeyValue();
                  }}
                  placeholder="sk-... or $MY_API_KEY"
                  className={cn(INPUT_CLASS, 'min-w-0 flex-1')}
                />
                <button
                  type="button"
                  onClick={addKeyValue}
                  disabled={!newKeyValue.trim()}
                  className="shrink-0 rounded-full border border-[var(--settings-theme-card-border)] px-2.5 py-1 text-11 text-[var(--settings-section-sublabel)] disabled:opacity-40"
                >
                  {t('settings.piCliProviders.keyAdd')}
                </button>
              </div>
            </div>
            {apiKeys[0]?.trim().startsWith('$') && (
              <p className="mt-1 text-11 text-sky-500">
                {t('settings.piCliProviders.apiKeyEnv', { ref: apiKeys[0]!.trim() })}
              </p>
            )}
          </div>
          <div>
            <label className="block text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piCliProviders.apiType')}
            </label>
            <select
              value={apiType}
              onChange={(e) => setApiType(e.target.value)}
              className={cn(INPUT_CLASS, 'mt-1')}
            >
              {PI_API_TYPES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {modelIds.length > 0 && (
          <div className="mt-3">
            <label className="block text-11 text-[var(--settings-section-sublabel)]">
              {t('settings.piCliProviders.importModels', { count: modelIds.length })}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {modelIds.map((mid) => (
                <span key={mid} className={BADGE_CLASS}>
                  {mid}
                  <button
                    type="button"
                    className="ml-1 text-red-400"
                    onClick={() => setModelIds((prev) => prev.filter((x) => x !== mid))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleFetchModels()}
            disabled={!isValidHttpUrl(baseUrl.trim()) || fetching}
            className={cn(ACTION_CLASS)}
          >
            {fetching ? <Spinner size={13} /> : <ListPlus size={13} />}
            {t('settings.piCliProviders.importFetch')}
          </button>
          {fetchErr && <span className="text-11 text-red-500">{fetchErr}</span>}
        </div>

        {availableFetched.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border p-2" style={{ borderColor: 'var(--settings-theme-card-border)' }}>
            <label className="flex items-center gap-2 px-1 pb-1.5 text-11 text-[var(--settings-section-sublabel)]">
              <input
                type="checkbox"
                checked={allFetchedSelected}
                onChange={toggleAllFetched}
                style={{ accentColor: 'var(--accent, var(--text-link))' }}
              />
              {t('settings.piCliProviders.importSelectAll')}
            </label>
            {availableFetched.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 rounded px-1 py-0.5 font-mono text-11 hover:bg-sidebar-item-hover"
              >
                <input
                  type="checkbox"
                  checked={fetchSel.has(m.id)}
                  onChange={() => toggleFetched(m.id)}
                  style={{ accentColor: 'var(--accent, var(--text-link))' }}
                />
                <span className="truncate text-[var(--settings-section-title)]">{m.id}</span>
                <span className="ml-auto shrink-0 text-[var(--settings-section-desc)]">
                  {formatTokens(m.contextWindow)}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className={cn(ACTION_CLASS)}
          >
            {t('settings.piCliProviders.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={!canSubmit}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-4 text-12 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent, var(--text-link))' }}
          >
            {submitting ? <Spinner size={13} /> : <Check size={13} />}
            {t('settings.piCliProviders.importSubmit')}
          </button>
        </div>
        {submitError && (
          <p className="mt-2 text-11 text-red-500">{t('settings.piCliProviders.saveFailed')}</p>
        )}
      </div>
    </div>
  );
}

// ─── 详情面板 ───────────────────────────────────────────────────────────

function ProviderDetail({
  provider,
  onReload,
  onDeleted,
  onRenamed,
}: {
  provider: PiCliProvider;
  onReload: () => Promise<void> | void;
  onDeleted: () => void;
  onRenamed: (newId: string) => void;
}) {
  const { t } = useTranslation();
  const api = window.electronAPI?.maker?.piAgent;
  const enabledCount = useMemo(
    () => provider.models.filter((m) => m.enabled).length,
    [provider.models],
  );

  // 测连接 / 拉取模型:providerId 交给主进程,真 key 由主进程现取,这里只收结果。
  const [testState, setTestState] = useState<'idle' | 'testing'>('idle');
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<'idle' | 'fetching'>('idle');
  const [fetchResult, setFetchResult] = useState<ProviderFetchResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 可编辑字段(自定义语义:所有 models.json 里的 provider 均可编辑)。
  const [name, setName] = useState(provider.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [apiType, setApiType] = useState(provider.api ?? 'openai-completions');
  const [compatDev, setCompatDev] = useState(provider.compat?.supportsDeveloperRole ?? false);
  const [compatFinish, setCompatFinish] = useState(provider.compat?.supportsFinishReason ?? true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // 密钥池:新增/移除(切换已有 radio 通道)。
  const [newKeyValue, setNewKeyValue] = useState('');
  const [switchingKeyId, setSwitchingKeyId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchOk, setSwitchOk] = useState(false);

  // 模型快捷添加 + 删除确认。
  const [quickId, setQuickId] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const runTest = useCallback(async () => {
    if (!api?.testCliProvider || testState === 'testing') return;
    setTestState('testing');
    setTestResult(null);
    setTestError(null);
    try {
      setTestResult(await api.testCliProvider(provider.id));
    } catch (err: unknown) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestState('idle');
    }
  }, [api, provider.id, testState]);

  const runFetch = useCallback(async () => {
    if (!api?.fetchCliProviderModels || fetchState === 'fetching') return;
    setFetchState('fetching');
    setFetchResult(null);
    setFetchError(null);
    try {
      setFetchResult(await api.fetchCliProviderModels(provider.id));
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchState('idle');
    }
  }, [api, provider.id, fetchState]);

  const dirty =
    name !== (provider.name ?? '') ||
    baseUrl !== (provider.baseUrl ?? '') ||
    apiType !== (provider.api ?? 'openai-completions') ||
    compatDev !== (provider.compat?.supportsDeveloperRole ?? false) ||
    compatFinish !== (provider.compat?.supportsFinishReason ?? true);
  const urlInvalid = baseUrl.trim() !== '' && !isValidHttpUrl(baseUrl.trim());

  const handleSave = async () => {
    if (!api?.mutateCli || !dirty) return;
    setSaveState('saving');
    try {
      const nameChanged = name.trim() !== '' && name !== (provider.name ?? '');
      const sanitize = (s: string) =>
        s
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\p{L}\p{N}-]/gu, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      const newId = nameChanged ? sanitize(name) : '';
      const patch = {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        api: apiType,
        compat: { supportsDeveloperRole: compatDev, supportsFinishReason: compatFinish },
      };
      // 名称变更 = id 也重命名(pi 徽标与 enabledModels 引用同步改写,主进程处理)。
      if (newId && newId !== provider.id) {
        await api.mutateCli({ action: 'rename-provider', fromId: provider.id, toId: newId, patch });
        await onReload();
        onRenamed(newId);
      } else {
        await api.mutateCli({ action: 'upsert-provider', id: provider.id, patch });
        await onReload();
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      log.warn('provider save failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setSaveState('error');
    }
  };

  const handleSwitchKey = useCallback(
    async (keyId: string) => {
      if (!api?.switchCliKey || switchingKeyId) return;
      if (provider.apiKeys.find((k) => k.id === keyId)?.active) return;
      setSwitchingKeyId(keyId);
      setSwitchError(null);
      setSwitchOk(false);
      try {
        await api.switchCliKey(provider.id, keyId);
        setSwitchOk(true);
        await onReload();
      } catch (err: unknown) {
        setSwitchError(err instanceof Error ? err.message : String(err));
      } finally {
        setSwitchingKeyId(null);
      }
    },
    [api, provider.id, provider.apiKeys, switchingKeyId, onReload],
  );

  const handleAddKey = async () => {
    if (!api?.mutateCli || !newKeyValue.trim()) return;
    setSwitchError(null);
    setSwitchOk(false);
    try {
      await api.mutateCli({
        action: 'upsert-provider',
        id: provider.id,
        patch: { apiKey: newKeyValue.trim() },
      });
      setNewKeyValue('');
      setSwitchOk(true);
      await onReload();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveKey = async (keyId: string) => {
    if (!api?.switchCliKey || !api?.mutateCli) return;
    setSwitchError(null);
    setSwitchOk(false);
    try {
      // 遮罩视图里没有真值,无法整池回写 —— 移除动作分两步:先切到别处
      // (若移除的是生效 key),再把这个 id 从池里置为无效条目让主进程清除。
      // 主进程 switch-only 无法删除条目,这里通过 upsert-provider 的 apiKeys
      // 白名单语义实现:重写池时被删条目缺失即消失。为拿到真值做整池回写,
      // 交由主进程 mutate 专用子动作完成(与 pws handleRemoveKey 同语义)。
      await api.mutateCli({ action: 'remove-key', id: provider.id, keyId });
      setSwitchOk(true);
      await onReload();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleDisabled = async () => {
    if (!api?.mutateCli) return;
    try {
      await api.mutateCli({
        action: 'set-provider-disabled',
        id: provider.id,
        disabled: !provider.disabled,
      });
      await onReload();
    } catch (err) {
      log.warn('toggle disabled failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDuplicate = async () => {
    if (!api?.mutateCli) return;
    try {
      // 副本清空凭证(pws 语义),模型与端点配置随拷。
      const sanitize = (s: string) =>
        s
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\p{L}\p{N}-]/gu, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      const baseId = sanitize(provider.name) || provider.id;
      let newId = sanitize(`${baseId}-copy`);
      let i = 2;
      // 与面板当前可见 id 集合去重（本组件拿不到全量注册表,用剥密视图即可）。
      const knownIds = new Set<string>();
      try {
        const snapshot = await window.electronAPI?.maker?.piAgent?.listCliProviders?.();
        for (const p of snapshot?.providers ?? []) knownIds.add(p.id);
      } catch {
        knownIds.add(provider.id);
      }
      while (knownIds.has(newId)) newId = sanitize(`${baseId}-copy${i++}`);
      await api.mutateCli({
        action: 'upsert-provider',
        id: newId,
        patch: {
          name: `${provider.name} (copy)`,
          ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
          ...(provider.api ? { api: provider.api } : {}),
          ...(provider.compat ? { compat: provider.compat } : {}),
          models: provider.models.map((m) => ({
            id: m.id,
            name: m.name,
            reasoning: m.reasoning,
            input: m.input,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            cost: m.cost,
          })),
        },
      });
      await onReload();
      onRenamed(newId);
    } catch (err) {
      log.warn('duplicate failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDelete = async () => {
    if (!api?.mutateCli) return;
    try {
      await api.mutateCli({ action: 'remove-provider', id: provider.id });
      await onReload();
      onDeleted();
    } catch (err) {
      log.warn('delete failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleToggleModel = async (modelId: string, enabled: boolean) => {
    if (!api?.mutateCli) return;
    try {
      await api.mutateCli({
        action: 'update-enabled',
        // 语义化启停:主进程按 pi 的白名单语义计算(空名单态停用会物化名单,
        // 其它模型保持不变)。
        change: enabled
          ? { enable: [`${provider.id}/${modelId}`] }
          : { disable: [`${provider.id}/${modelId}`] },
      });
      await onReload();
    } catch (err) {
      log.warn('toggle model failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSetAllModels = async (on: boolean) => {
    if (!api?.mutateCli) return;
    try {
      await api.mutateCli({
        action: 'update-enabled',
        change: on
          ? { enable: provider.models.map((m) => `${provider.id}/${m.id}`) }
          : { disable: provider.models.map((m) => `${provider.id}/${m.id}`) },
      });
      await onReload();
    } catch (err) {
      log.warn('set all models failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleQuickAdd = async () => {
    const id = quickId.trim();
    if (!api?.mutateCli || !id || quickBusy) return;
    setQuickBusy(true);
    try {
      await api.mutateCli({
        action: 'upsert-model',
        providerId: provider.id,
        model: {
          id,
          name: id.split('/').pop() || id,
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          maxTokens: DEFAULT_MAX_TOKENS,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      });
      // 快捷添加的模型默认启用(pws 语义)。
      await api.mutateCli({
        action: 'update-enabled',
        change: { add: [`${provider.id}/${id}`] },
      });
      setQuickId('');
      await onReload();
    } catch (err) {
      log.warn('quick add failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setQuickBusy(false);
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    if (!api?.mutateCli) return;
    try {
      await api.mutateCli({ action: 'remove-model', providerId: provider.id, modelId });
      await onReload();
    } catch (err) {
      log.warn('remove model failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-15 font-semibold text-[var(--settings-section-title)]">
          {provider.name}
        </h4>
        <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-11 text-blue-400">
          {t('settings.piCliProviders.badgeLocal')}
        </span>
        {provider.disabled && (
          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-11 text-amber-500">
            {t('settings.piCliProviders.providerDisabled')}
          </span>
        )}
        {provider.hasApiKey && (
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-11 text-emerald-500">
            {t('settings.piCliProviders.keyConfigured')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            title={t('settings.piCliProviders.duplicate')}
            className="rounded-lg p-2 text-[var(--settings-section-desc)] transition-colors hover:bg-blue-500/10 hover:text-blue-400"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => void handleToggleDisabled()}
            title={
              provider.disabled
                ? t('settings.piCliProviders.enableProvider')
                : t('settings.piCliProviders.disableProvider')
            }
            className="rounded-lg p-2 text-[var(--settings-section-desc)] transition-colors hover:bg-emerald-500/10 hover:text-emerald-500"
          >
            {provider.disabled ? <LockOpen size={14} /> : <Unlock size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title={t('settings.piCliProviders.deleteProvider')}
            className="ml-auto rounded-lg p-2 text-[var(--settings-section-desc)] transition-colors hover:bg-red-500/10 hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div
          className="flex items-start gap-3 rounded-lg border p-3"
          style={{ borderColor: 'var(--danger)' }}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-12 text-[var(--settings-section-title)]">
              {t('settings.piCliProviders.deleteConfirm', { name: provider.name })}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className={cn(ACTION_CLASS)}>
                {t('settings.piCliProviders.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-12 font-medium text-white"
                style={{ backgroundColor: 'var(--danger)' }}
              >
                <Trash2 size={13} />
                {t('settings.piCliProviders.deleteProvider')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live actions — 只读探测:测连接 / 拉取模型,真 key 全程留在主进程。 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={!provider.baseUrl || testState === 'testing'}
          title={provider.baseUrl ? undefined : t('settings.piCliProviders.testNeedBaseUrl')}
          className={cn(ACTION_CLASS)}
        >
          {testState === 'testing' ? <Spinner size={14} /> : <PlugZap size={14} />}
          {testState === 'testing'
            ? t('settings.piCliProviders.testRunning')
            : t('settings.piCliProviders.testConnection')}
        </button>
        <button
          type="button"
          onClick={() => void runFetch()}
          disabled={!provider.baseUrl || fetchState === 'fetching'}
          title={provider.baseUrl ? undefined : t('settings.piCliProviders.testNeedBaseUrl')}
          className={cn(ACTION_CLASS)}
        >
          {fetchState === 'fetching' ? <Spinner size={14} /> : <ListPlus size={14} />}
          {fetchState === 'fetching'
            ? t('settings.piCliProviders.fetchRunning')
            : t('settings.piCliProviders.fetchModels')}
        </button>

        {testResult && (
          <span
            role="status"
            className={cn(
              'rounded-md px-2 py-0.5 text-11',
              testResult.success
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-red-500/10 text-red-500',
            )}
          >
            {testResult.success
              ? t('settings.piCliProviders.testOk', {
                  latency: testResult.latencyMs ?? 0,
                })
              : `${t('settings.piCliProviders.testFailed')} · ${testResult.message ?? '—'}`}
          </span>
        )}
        {testError && (
          <span
            role="alert"
            className="max-w-full truncate rounded-md bg-red-500/10 px-2 py-0.5 text-11 text-red-500"
            title={testError}
          >
            {t('settings.piCliProviders.testFailed')} · {testError}
          </span>
        )}

        {fetchResult && !fetchResult.error && fetchResult.models.length > 0 && (
          <span
            role="status"
            className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-11 text-emerald-500"
          >
            {t('settings.piCliProviders.fetchOk', { count: fetchResult.models.length })}
          </span>
        )}
        {fetchResult?.error && (
          <span
            role="alert"
            className="max-w-full truncate rounded-md bg-red-500/10 px-2 py-0.5 text-11 text-red-500"
            title={fetchResult.error}
          >
            {t('settings.piCliProviders.fetchFailed')} · {fetchResult.error}
          </span>
        )}
        {fetchError && (
          <span
            role="alert"
            className="max-w-full truncate rounded-md bg-red-500/10 px-2 py-0.5 text-11 text-red-500"
            title={fetchError}
          >
            {t('settings.piCliProviders.fetchFailed')} · {fetchError}
          </span>
        )}
      </div>

      {/* 拉取到的远端模型清单(只展示,不写回 models.json)。 */}
      {fetchResult && !fetchResult.error && fetchResult.models.length > 0 && (
        <div>
          <div className="flex flex-col gap-1.5">
            {fetchResult.models.slice(0, FETCHED_MODELS_DISPLAY_CAP).map((m) => {
              const known = provider.models.some((local) => local.id === m.id);
              return (
                <div
                  key={m.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2',
                    'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
                    known && 'opacity-60',
                  )}
                  {...(known ? {} : { title: t('settings.piCliProviders.fetchedNotInConfig') })}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-11 text-[var(--settings-section-title)]">
                    {m.id}
                  </span>
                  {m.reasoning && (
                    <span title={t('settings.piCliProviders.model.reasoning')} className="flex shrink-0">
                      <Brain size={12} className="text-purple-400" />
                    </span>
                  )}
                  {m.vision && (
                    <span title={t('settings.piCliProviders.model.imageInput')} className="flex shrink-0">
                      <ImageIcon size={12} className="text-blue-400" />
                    </span>
                  )}
                  {m.audio && (
                    <span title={t('settings.piCliProviders.model.audioInput')} className="flex shrink-0">
                      <Mic size={12} className="text-emerald-400" />
                    </span>
                  )}
                  {m.cost && (
                    <span className={BADGE_CLASS}>
                      {formatCost(m.cost.input)}/{formatCost(m.cost.output)}
                    </span>
                  )}
                  <span className={BADGE_CLASS} title={t('settings.piCliProviders.model.contextWindow')}>
                    {formatTokens(m.contextWindow)}
                  </span>
                </div>
              );
            })}
            {fetchResult.models.length > FETCHED_MODELS_DISPLAY_CAP && (
              <span className={BADGE_CLASS}>
                {t('settings.piCliProviders.fetchMore', {
                  count: fetchResult.models.length - FETCHED_MODELS_DISPLAY_CAP,
                })}
              </span>
            )}
          </div>
        </div>
      )}
      {fetchResult && !fetchResult.error && fetchResult.models.length === 0 && (
        <p className="text-11 text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.fetchEmpty')}
        </p>
      )}

      {/* Name */}
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.name')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={cn(INPUT_CLASS, 'mt-1.5')}
        />
        <p className="mt-1 font-mono text-11 text-[var(--settings-section-desc)]">{provider.id}</p>
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.baseUrl')}
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={cn(INPUT_CLASS, 'mt-1.5', urlInvalid && 'border-red-500')}
        />
        {urlInvalid && (
          <p className="mt-1 text-11 text-red-500">{t('settings.piCliProviders.invalidUrl')}</p>
        )}
      </div>

      {/* API type */}
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.apiType')}
        </label>
        <select
          value={apiType}
          onChange={(e) => setApiType(e.target.value)}
          className={cn(INPUT_CLASS, 'mt-1.5')}
        >
          {PI_API_TYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {/* compat —— pi 的兼容开关。描述与 pws 同文案(pi-ai openai-completions 语义)。 */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-12 text-[var(--settings-section-sublabel)]">
          <input
            type="checkbox"
            checked={compatDev}
            onChange={(e) => setCompatDev(e.target.checked)}
            style={{ accentColor: 'var(--accent, var(--text-link))' }}
          />
          {t('settings.piCliProviders.compatDeveloperRole')}
        </label>
        <p className="-mt-1 text-11 leading-[1.5] text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.compatDeveloperRoleDesc')}
        </p>
        <label className="flex items-center gap-2 text-12 text-[var(--settings-section-sublabel)]">
          <input
            type="checkbox"
            checked={compatFinish}
            onChange={(e) => setCompatFinish(e.target.checked)}
            style={{ accentColor: 'var(--accent, var(--text-link))' }}
          />
          {t('settings.piCliProviders.compatFinishReason')}
        </label>
        <p className="-mt-1 text-11 leading-[1.5] text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.compatFinishReasonDesc')}
        </p>
      </div>

      {/* Save row */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saveState === 'saving'}
          className={cn(ACTION_CLASS)}
        >
          {saveState === 'saving' ? <Spinner size={13} /> : <Check size={13} />}
          {t('settings.piCliProviders.save')}
        </button>
        {saveState === 'saved' && (
          <span role="status" className="text-11 text-emerald-500">
            {t('settings.piCliProviders.saved')}
          </span>
        )}
        {saveState === 'error' && (
          <span role="alert" className="text-11 text-red-500">
            {t('settings.piCliProviders.saveFailed')}
          </span>
        )}
      </div>

      {/* API keys — 整池列出并标出生效的那把；可切换/新增/移除;真值不出主进程。 */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="block text-12 text-[var(--settings-section-sublabel)]">
            {t('settings.piCliProviders.apiKey')}
          </label>
          {provider.apiKeyCount > 1 && (
            <span className="text-11 text-[var(--settings-section-desc)]">
              {t('settings.piCliProviders.keyCount', { count: provider.apiKeyCount })}
            </span>
          )}
        </div>
        {provider.apiKeys.length === 0 ? (
          <p className="mt-1.5 text-11 text-[var(--settings-section-desc)]">
            {t('settings.piCliProviders.keyEmpty')}
          </p>
        ) : (
          <div
            className="mt-1.5 flex flex-col gap-1.5"
            {...(provider.apiKeys.length > 1 ? { role: 'radiogroup' } : {})}
          >
            {provider.apiKeys.map((key) => (
              <div
                key={key.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2',
                  key.active
                    ? 'border-blue-500/60 bg-blue-500/5'
                    : 'border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
                )}
              >
                {provider.apiKeys.length > 1 && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={key.active}
                    aria-label={t('settings.piCliProviders.keyUse')}
                    disabled={key.active || switchingKeyId !== null}
                    onClick={() => void handleSwitchKey(key.id)}
                    title={
                      key.active
                        ? t('settings.piCliProviders.keyActive')
                        : t('settings.piCliProviders.keyUse')
                    }
                    className={cn(
                      'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                      'disabled:cursor-default',
                      key.active
                        ? 'border-blue-500'
                        : 'border-[var(--settings-theme-card-border)] hover:border-blue-400 disabled:opacity-60',
                    )}
                  >
                    {switchingKeyId === key.id ? (
                      <Spinner size={10} />
                    ) : (
                      key.active && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    )}
                  </button>
                )}
                <KeyRound size={13} className="shrink-0 text-[var(--text-tertiary)]" />
                <code className="min-w-0 flex-1 truncate font-mono text-11 text-[var(--settings-section-title)]">
                  {key.maskedKey}
                </code>
                {key.active && (
                  <span className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-11 text-emerald-500">
                    {t('settings.piCliProviders.keyActive')}
                  </span>
                )}
                {provider.apiKeys.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveKey(key.id)}
                    title={t('settings.piCliProviders.keyRemove')}
                    className="shrink-0 rounded-md p-1 text-[var(--settings-section-desc)] transition-colors hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            placeholder="sk-... or $MY_API_KEY"
            className={cn(INPUT_CLASS, 'min-w-0 flex-1')}
          />
          <button
            type="button"
            onClick={() => void handleAddKey()}
            disabled={!newKeyValue.trim()}
            className={cn(ACTION_CLASS, 'shrink-0 disabled:opacity-40')}
          >
            <Plus size={13} />
            {t('settings.piCliProviders.keyAdd')}
          </button>
        </div>
        {newKeyValue.trim().startsWith('$') && (
          <p className="mt-1 text-11 text-sky-500">
            {t('settings.piCliProviders.apiKeyEnv', { ref: newKeyValue.trim() })}
          </p>
        )}
        {switchOk && !switchError && (
          <p role="status" className="mt-1.5 text-11 text-emerald-500">
            {t('settings.piCliProviders.keySwitchOk')}
          </p>
        )}
        {switchError && (
          <p role="alert" className="mt-1.5 text-11 text-red-500">
            {t('settings.piCliProviders.keySwitchFailed')} · {switchError}
          </p>
        )}
        <p className="mt-1.5 text-11 text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.keyMaskedNote')}
        </p>
      </div>

      {/* Models */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="block text-12 text-[var(--settings-section-sublabel)]">
            {t('settings.piCliProviders.models')}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-11 text-[var(--settings-section-desc)]">
              {t('settings.piCliProviders.modelCount', {
                enabled: enabledCount,
                total: provider.models.length,
              })}
            </span>
            {provider.models.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleSetAllModels(true)}
                  className={cn(ACTION_CLASS, 'h-6 px-2 text-11')}
                >
                  {t('settings.piCliProviders.enableAll')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSetAllModels(false)}
                  className={cn(ACTION_CLASS, 'h-6 px-2 text-11')}
                >
                  {t('settings.piCliProviders.disableAll')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 快捷添加(pws quick add 简版:id → 默认元数据 + 默认启用)。 */}
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={quickId}
            onChange={(e) => setQuickId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleQuickAdd();
            }}
            placeholder="vendor/model-id"
            className={cn(INPUT_CLASS, 'min-w-0 flex-1 font-mono')}
          />
          <button
            type="button"
            onClick={() => void handleQuickAdd()}
            disabled={!quickId.trim() || quickBusy}
            className={cn(ACTION_CLASS, 'shrink-0 disabled:opacity-40')}
          >
            {quickBusy ? <Spinner size={13} /> : <Plus size={13} />}
            {t('settings.piCliProviders.modelAdd')}
          </button>
        </div>

        {provider.models.length === 0 ? (
          <p className="mt-1.5 text-11 text-[var(--settings-section-desc)]">
            {t('settings.piCliProviders.noModels')}
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-col gap-1.5">
              {provider.models.map((model) => (
                <div key={model.id} className="group relative">
                  <ModelRow model={model} onToggleEnabled={(id, on) => void handleToggleModel(id, on)} />
                  <button
                    type="button"
                    onClick={() => void handleRemoveModel(model.id)}
                    title={t('settings.piCliProviders.modelRemove')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-[var(--surface)] p-1 text-[var(--settings-section-desc)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-11 text-[var(--settings-section-desc)]">
              {t('settings.piCliProviders.enabledNote')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── 主面板 ─────────────────────────────────────────────────────────────

export function PiCliProvidersSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>('loading');
  const [result, setResult] = useState<PiCliProviders | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api?.listCliProviders) {
      setState('error');
      return;
    }
    try {
      const next = await api.listCliProviders();
      setResult(next);
      setState('ready');
    } catch (err: unknown) {
      log.warn('listCliProviders failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = result?.providers ?? [];
  const selected = providers.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (state === 'ready' && !adding && !selected && providers.length > 0) {
      setSelectedId(providers[0]!.id);
    }
  }, [state, adding, selected, providers]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="pi-cli-providers-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="page-kicker flex items-center gap-2 text-11 uppercase tracking-widest text-[var(--settings-section-sublabel)]">
            <span /> ROUTING FABRIC // CONFIGURATION
          </div>
          <h3
            id="pi-cli-providers-title"
            className="text-16 font-medium text-[var(--settings-section-title)]"
          >
            {t('settings.piCliProviders.title')}
          </h3>
          <p className="mt-1 text-13 leading-relaxed text-[var(--settings-section-desc)]">
            {t('settings.piCliProviders.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === 'loading'}
          className={cn(ACTION_CLASS, 'shrink-0')}
        >
          {state === 'loading' ? <Spinner size={14} /> : <RefreshCw size={14} />}
          {t('settings.piCliProviders.refresh')}
        </button>
      </div>

      {state === 'ready' && result?.installed && !result.error && (
        <EnabledModelsPanel providers={providers} onChanged={() => void load()} />
      )}

      {state === 'loading' && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-8 text-12 text-[var(--settings-section-desc)]"
        >
          <Spinner size={15} />
          {t('settings.piCliProviders.loading')}
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 text-[var(--settings-section-desc)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t('settings.piCliProviders.loadFailed')}
        </div>
      )}

      {state === 'ready' && result && !result.installed && (
        <p className="rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 leading-relaxed text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.notInstalled')}
        </p>
      )}

      {state === 'ready' && result?.installed && result.error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 text-[var(--settings-section-desc)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t('settings.piCliProviders.parseFailed')}
        </div>
      )}

      {/* 左导轨 + 右详情,与 pi-web-switch 的 providers-console 同构。 */}
      {state === 'ready' && result?.installed && !result.error && (
        <div className={cn(CARD_CLASS, 'flex flex-col md:flex-row')}>
          <div className="shrink-0 border-b border-[var(--settings-theme-card-border)] p-3 md:w-56 md:border-b-0 md:border-r">
            <p className="px-2 pb-2 pt-1 text-11 font-medium uppercase tracking-wider text-[var(--settings-section-sublabel)]">
              {t('settings.piCliProviders.railLabel')}
            </p>
            <div className="flex flex-col gap-0.5">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setSelectedId(provider.id);
                  }}
                  aria-current={!adding && selected?.id === provider.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-12 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                    !adding && selected?.id === provider.id
                      ? 'border-[var(--settings-theme-card-border)] bg-[var(--settings-menu-bg-hover)] text-[var(--settings-section-title)]'
                      : 'border-transparent text-[var(--settings-section-sublabel)] hover:bg-[var(--settings-menu-bg-hover)]',
                    provider.disabled && 'opacity-50',
                  )}
                >
                  <Server size={14} className="shrink-0 text-blue-400" />
                  <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      provider.hasApiKey ? 'bg-emerald-400' : 'bg-[var(--settings-theme-card-border)]',
                    )}
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setSelectedId(null);
              }}
              className={cn(
                'mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-12 font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                adding
                  ? 'border-[var(--settings-theme-card-border)] bg-[var(--settings-menu-bg-hover)] text-[var(--settings-section-title)]'
                  : 'border-[var(--settings-theme-card-border)] text-[var(--settings-section-sublabel)] hover:bg-[var(--settings-menu-bg-hover)]',
              )}
            >
              <Plus size={14} />
              {t('settings.piCliProviders.addProvider')}
            </button>
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="mt-2 flex w-full items-center gap-2 rounded-lg border border-[var(--settings-theme-card-border)] px-3 py-2 text-12 font-medium text-[var(--settings-section-sublabel)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
            >
              <ClipboardPaste size={14} />
              {t('settings.piCliProviders.importProvider')}
            </button>
          </div>
          <div className="min-w-0 flex-1 p-5">
            {adding ? (
              <AddProviderForm
                existingIds={new Set(providers.map((p) => p.id))}
                onDone={(id) => {
                  setAdding(false);
                  setSelectedId(id);
                }}
                onCancel={() => setAdding(false)}
                reload={load}
              />
            ) : selected ? (
              <ProviderDetail
                key={`${selected.id}:${selected.models.length}:${selected.apiKeyCount}`}
                provider={selected}
                onReload={load}
                onDeleted={() => setSelectedId(null)}
                onRenamed={(newId) => setSelectedId(newId)}
              />
            ) : (
              <p className="text-12 text-[var(--settings-section-desc)]">
                {t('settings.piCliProviders.selectHint')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* R5 信息缺口:面板只投影 models.json 的自定义桶,内置供应商不列 — 底部一句话说明,避免与 pi 里看到的供应商数对不上。 */}
      {state === 'ready' && result?.installed && (
        <p className="px-1 text-11 leading-relaxed text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.builtinProvidersNote')}
        </p>
      )}

      <ImportProviderModal
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(id) => {
          setImporting(false);
          setAdding(false);
          setSelectedId(id);
        }}
        reload={load}
      />
    </section>
  );
}

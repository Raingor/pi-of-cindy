/**
 * PiCliProvidersSection — 本机 Pi CLI(`~/.pi/agent/models.json`)的供应商与模型面板。
 *
 * 布局还原 pi-web-switch 的 `ProvidersModelsPage`:左侧供应商导轨(带类型图标 +
 * 密钥状态圆点),右侧详情面板(名称徽标、接口地址、API 类型、密钥池、模型行)。
 * 模型行也照搬那边的信息密度:开关态、id、思考/图像/音频能力图标、价格徽标、
 * 上下文窗口徽标。
 *
 * 与 Cindy 自己的「模型供应商」页(`ProvidersSection`)是两套数据:那页读 Cindy 的
 * provider 注册表并管理 Cindy 网关凭证;本页只读用户自己的 Pi CLI 配置,面板性质,
 * 不写不改 —— 增删改走 Pi CLI。唯二的「活」动作是测连接与拉取模型:两者都是只读
 * 探测请求,providerId 交给主进程、由主进程现取真 key 发请求,结果(状态/延迟/
 * 模型清单)投影回来,配置文件不会被修改。
 *
 * 凭证:主进程已剥掉 apiKey / apiKeys 真值,这里只拿到遮罩串与 `hasApiKey`。
 * pi-web-switch 支持逐把明文显形,本面板**刻意不做**:Renderer 会渲染 agent 输出、
 * Markdown、插件面板与内置浏览器网页,是不可信环境 —— 见
 * docs/dev-rules/electron-security-and-process-boundaries.md。
 * 不要在本组件里新增任何"读取完整 key"的路径。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Brain,
  Image as ImageIcon,
  KeyRound,
  ListPlus,
  Mic,
  PlugZap,
  RefreshCw,
  Server,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

/** 详情面板里字段标签 + 只读值的统一样式。 */
const FIELD_VALUE_CLASS = cn(
  'mt-1.5 w-full truncate rounded-lg px-3 py-2 font-mono text-12',
  'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
  'text-[var(--settings-section-title)]',
);

const BADGE_CLASS = cn(
  'shrink-0 rounded-md px-2 py-0.5 text-11',
  'border border-[var(--settings-theme-card-border)] bg-[var(--surface)]',
  'text-[var(--settings-section-desc)]',
);

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

function ModelRow({ model }: { model: PiCliModel }) {
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
      {/* 只读的启用态指示。pi-web-switch 这里是可点开关,本面板不写配置。 */}
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
      {/* 最大输出与上下文窗口是两个不同的限制,pi-web-switch 只在表单里给,这里并列
          展示 —— 本面板是只读的,看不到就没有别的地方能看到。 */}
      <span className={BADGE_CLASS} title={t('settings.piCliProviders.model.maxTokens')}>
        ↑{formatTokens(model.maxTokens)}
      </span>
    </div>
  );
}

function ProviderRailItem({
  provider,
  active,
  onSelect,
}: {
  provider: PiCliProvider;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-12 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        active
          ? 'border-[var(--settings-theme-card-border)] bg-[var(--settings-menu-bg-hover)] text-[var(--settings-section-title)]'
          : 'border-transparent text-[var(--settings-section-sublabel)] hover:bg-[var(--settings-menu-bg-hover)]',
        // 已停用的供应商仍占行(不然用户以为配置丢了),但明确弱化。
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
  );
}

function ProviderDetail({ provider }: { provider: PiCliProvider }) {
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
        <span className="ml-auto font-mono text-11 text-[var(--settings-section-desc)]">
          {provider.id}
        </span>
      </div>

      {/* Live actions — 只读探测:测连接 / 拉取模型,真 key 全程留在主进程。 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={!provider.baseUrl || testState === 'testing'}
          title={
            provider.baseUrl ? undefined : t('settings.piCliProviders.testNeedBaseUrl')
          }
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
          title={
            provider.baseUrl ? undefined : t('settings.piCliProviders.testNeedBaseUrl')
          }
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

      {/* Base URL */}
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.baseUrl')}
        </label>
        <p className={FIELD_VALUE_CLASS}>
          {provider.baseUrl ?? t('settings.piCliProviders.noBaseUrl')}
        </p>
      </div>

      {/* API type */}
      <div>
        <label className="block text-12 text-[var(--settings-section-sublabel)]">
          {t('settings.piCliProviders.apiType')}
        </label>
        <p className={FIELD_VALUE_CLASS}>{provider.api ?? '—'}</p>
      </div>

      {/* compat —— pi 的兼容开关。默认值不是「都开」,配错会让请求被上游拒,
          所以即使是只读面板也要能看到当前值。 */}
      {provider.compat && (
        <div>
          <label className="block text-12 text-[var(--settings-section-sublabel)]">
            {t('settings.piCliProviders.compat')}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {provider.compat.supportsDeveloperRole !== undefined && (
              <span className={BADGE_CLASS}>
                {t('settings.piCliProviders.compatDeveloperRole')} ·{' '}
                {t(
                  provider.compat.supportsDeveloperRole
                    ? 'settings.piCliProviders.compatOn'
                    : 'settings.piCliProviders.compatOff',
                )}
              </span>
            )}
            {provider.compat.supportsFinishReason !== undefined && (
              <span className={BADGE_CLASS}>
                {t('settings.piCliProviders.compatFinishReason')} ·{' '}
                {t(
                  provider.compat.supportsFinishReason
                    ? 'settings.piCliProviders.compatOn'
                    : 'settings.piCliProviders.compatOff',
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* API keys — 整池列出并标出生效的那把；真值不出主进程，无显形入口。 */}
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
          <div className="mt-1.5 flex flex-col gap-1.5">
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
                <KeyRound size={13} className="shrink-0 text-[var(--text-tertiary)]" />
                <code className="min-w-0 flex-1 truncate font-mono text-11 text-[var(--settings-section-title)]">
                  {key.maskedKey}
                </code>
                {key.active && (
                  <span className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-11 text-emerald-500">
                    {t('settings.piCliProviders.keyActive')}
                  </span>
                )}
              </div>
            ))}
          </div>
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
          <span className="text-11 text-[var(--settings-section-desc)]">
            {t('settings.piCliProviders.modelCount', {
              enabled: enabledCount,
              total: provider.models.length,
            })}
          </span>
        </div>
        {provider.models.length === 0 ? (
          <p className="mt-1.5 text-11 text-[var(--settings-section-desc)]">
            {t('settings.piCliProviders.noModels')}
          </p>
        ) : (
          <>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {provider.models.map((model) => (
                <ModelRow key={model.id} model={model} />
              ))}
            </div>
            {/* 「可用」的判据是 settings.json 的 enabledModels 白名单,不是 models.json
                的 enabled 字段(pi 不认后者)。白名单为空时 pi 不过滤 = 全部可用。 */}
            <p className="mt-1.5 text-11 text-[var(--settings-section-desc)]">
              {t('settings.piCliProviders.enabledNote')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function PiCliProvidersSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>('loading');
  const [result, setResult] = useState<PiCliProviders | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="pi-cli-providers-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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

      {state === 'ready' && result?.installed && !result.error && providers.length === 0 && (
        <p className="rounded-xl border border-[var(--settings-theme-card-border)] px-5 py-4 text-12 text-[var(--settings-section-desc)]">
          {t('settings.piCliProviders.empty')}
        </p>
      )}

      {/* 左导轨 + 右详情，与 pi-web-switch 的 providers-console 同构。 */}
      {state === 'ready' && result?.installed && providers.length > 0 && (
        <div className={cn(CARD_CLASS, 'flex flex-col md:flex-row')}>
          <div className="shrink-0 border-b border-[var(--settings-theme-card-border)] p-3 md:w-56 md:border-b-0 md:border-r">
            <p className="px-2 pb-2 pt-1 text-11 font-medium uppercase tracking-wider text-[var(--settings-section-sublabel)]">
              {t('settings.piCliProviders.railLabel')}
            </p>
            <div className="flex flex-col gap-0.5">
              {providers.map((provider) => (
                <ProviderRailItem
                  key={provider.id}
                  provider={provider}
                  active={selected?.id === provider.id}
                  onSelect={() => setSelectedId(provider.id)}
                />
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1 p-5">
            {selected ? (
              <ProviderDetail key={selected.id} provider={selected} />
            ) : (
              <p className="text-12 text-[var(--settings-section-desc)]">
                {t('settings.piCliProviders.selectHint')}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

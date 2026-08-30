/**
 * ProvidersSection —— 设置 → 模型供应商页(2026-08-30 Phase 6:pi-web-switch 数据层)。
 *
 * 数据层是 ~/.pi/agent 的真实文件:models.json(自定义供应商 + builtin override)、
 * auth.json(api_key 凭证)、settings.json(enabledModels 引用 "providerId/modelId")。
 * 内置目录从本机安装的 pi 自带的 @earendil-works/pi-ai 读取(main 侧 readBuiltinCatalog),
 * 与用户本机 pi 版本保持同步。Cindy 自有的 model-providers 注册表 / safeStorage 体系
 * 不再进本页(用户已确认的数据层替换,见 task_plan.md Phase 6)。
 *
 * 密钥安全:list 投影只含打码值(main 侧 maskProviderKey);明文只经
 * setAuth / add / update 的写参数进入 main,Renderer 永不回写打码值。
 *
 * 布局沿用 2026-07 的双栏卡片:左栏供应商列表,右栏详情(鉴权头部 + 模型列表),
 * 顶部保留 EnabledModelsPanel(同一份 settings.enabledModels 的全局视图)。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { extractIpcError } from '@/utils/ipcError';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { toast } from '@/lib/toast';
import { Switch } from '@/components/ui/switch';
import { SettingsTextInput } from './SettingsTextInput';
import { EnabledModelsPanel } from './EnabledModelsPanel';
import type { PiProviderModelView, PiProviderView } from '../../../shared/piProviderTypes';

// ─── 常量 ──────────────────────────────────────────────────────────────────

/** 自定义供应商可选的 pi API 形态(pi-web-switch 同款 9 种;pi-messages 是 pi 内部形态,不外露)。 */
const PI_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-vertex',
  'bedrock-converse-stream',
  'mistral-conversations',
] as const;

const API_TYPE_LABEL_KEY: Record<string, string> = {
  'openai-completions': 'settings.providers.pi.apiTypes.openaiCompletions',
  'openai-responses': 'settings.providers.pi.apiTypes.openaiResponses',
  'openai-codex-responses': 'settings.providers.pi.apiTypes.openaiCodexResponses',
  'azure-openai-responses': 'settings.providers.pi.apiTypes.azureOpenaiResponses',
  'anthropic-messages': 'settings.providers.pi.apiTypes.anthropicMessages',
  'google-generative-ai': 'settings.providers.pi.apiTypes.googleGenerativeAi',
  'google-vertex': 'settings.providers.pi.apiTypes.googleVertex',
  'bedrock-converse-stream': 'settings.providers.pi.apiTypes.bedrock',
  'mistral-conversations': 'settings.providers.pi.apiTypes.mistral',
};

function apiTypeLabel(t: (key: string) => string, api: string | undefined): string {
  if (!api) return '';
  const key = API_TYPE_LABEL_KEY[api];
  return key ? t(key) : api;
}

/** id 只保留可读字符(pi 会把它原样显示在模型选择器徽标里)。 */
function sanitizeProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** IPC 错误 → 用户可见文案:命中统一错误协议时用服务端 message,否则回落 i18n。 */
function ipcErrorText(err: unknown, fallback: string): string {
  return extractIpcError(err)?.message || fallback;
}

function formatTokens(n: number | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ─── 小组件(样式沿用本页 2026-07 双栏定稿的 token 用法)────────────────────

function PillButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-8 shrink-0 items-center justify-center rounded-full px-6 text-13 font-medium transition-colors',
        'border',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      style={{
        backgroundColor: 'var(--settings-btn-secondary-bg)',
        borderColor: 'var(--settings-btn-secondary-border)',
        color: 'var(--settings-btn-secondary-text)',
      }}
    >
      {label}
    </button>
  );
}

function TypeBadge({ label }: { label: string }) {
  return (
    <span
      className="flex h-5 items-center rounded-full px-2 text-11 font-medium"
      style={{ backgroundColor: 'var(--surface-chip)', color: 'var(--text-secondary)' }}
    >
      {label}
    </span>
  );
}

function MetaChip({ children }: { children: string }) {
  return (
    <span className="text-12" style={{ color: 'var(--text-tertiary)' }}>
      {children}
    </span>
  );
}

// ─── 密钥行 ────────────────────────────────────────────────────────────────

function ApiKeyRow({
  provider,
  onChanged,
}: {
  provider: PiProviderView;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await window.electronAPI.maker.piProviders.setAuth(provider.id, draft.trim());
      toast.success(t('settings.providers.pi.key.toast.saved'));
      setEditing(false);
      setDraft('');
      onChanged();
    } catch (err) {
      toast.error(ipcErrorText(err, t('settings.providers.pi.key.toast.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await window.electronAPI.maker.piProviders.removeAuth(provider.id);
      toast.success(t('settings.providers.pi.key.toast.removed'));
      onChanged();
    } catch (err) {
      toast.error(ipcErrorText(err, t('settings.providers.pi.key.toast.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-t px-5 py-3"
      style={{ borderColor: 'var(--settings-theme-card-border)' }}
    >
      <div className="min-w-0">
        <p className="text-12 leading-tight" style={{ color: 'var(--text-secondary)' }}>
          {usage.planLabel ?? t('settings.providers.xai.asset.weeklyTitle')}
        </p>
        {hasWeekly && (
          <p
            className="mt-1.5 text-20 font-medium leading-[1.3] tracking-[-0.02em] tabular-nums"
            style={{ color: 'var(--text-primary)' }}
          >
            {t('settings.providers.xai.asset.weeklyUsed', {
              percent: Math.round(usage.creditUsagePercent ?? 0),
            })}
          </p>
        )}
        {hasWeekly && resetLabel && (
          <p className="mt-1 text-12 leading-tight" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.providers.xai.asset.resetsAt', { at: resetLabel })}
          </p>
        )}
        {hasWeekly && (usage.productUsage ?? []).map((product) => (
          <p
            key={product.product}
            className="mt-1 text-12 leading-tight tabular-nums"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('settings.providers.xai.asset.productLine', {
              product: formatXaiProductLabel(product.product),
              percent: Math.round(product.usagePercent),
            })}
          </p>
        ))}
      </div>
      <div className="flex shrink-0 items-center pt-3.5">
        <button
          type="button"
          onClick={() => void window.electronAPI.openExternal('https://grok.com')}
          className="text-13 transition-colors hover:text-[var(--text-primary)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('settings.providers.xai.asset.openUsage')}
        </button>
      </div>
    </div>
  );
}

function XaiHeader({ provider, onChanged }: { provider?: ProviderView; onChanged: () => void }) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const connected = provider?.connected ?? false;

  const handleLogin = useCallback(async () => {
    setLoggingIn(true);
    try {
      const r = await window.electronAPI.maker.xaiOAuthLogin();
      if (r.ok) {
        toast.success(t('settings.connections.xai.toast.loggedIn'));
        onChanged();
      } else if (r.reason === 'login_cancelled') {
        /* 用户取消,不弹错 */
      } else {
        toast.error(t('settings.connections.xai.toast.loginFailed'));
      }
    } catch {
      toast.error(t('settings.connections.xai.toast.loginFailed'));
    } finally {
      setLoggingIn(false);
    }
  }, [onChanged, t]);

  const handleLogout = useCallback(async () => {
    const confirmed = await confirm({
      title: t('settings.connections.xai.logoutConfirm.title'),
      description: t('settings.connections.xai.logoutConfirm.description'),
      confirmText: t('settings.connections.xai.logoutConfirm.confirm'),
      cancelText: t('settings.connections.xai.logoutConfirm.cancel'),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await window.electronAPI.maker.xaiOAuthLogout();
      toast.success(t('settings.connections.xai.toast.loggedOut'));
      onChanged();
    } catch {
      toast.error(t('settings.connections.xai.toast.logoutFailed'));
    } finally {
      setBusy(false);
    }
  }, [confirm, onChanged, t]);

  const trailing = connected ? (
    <div className="flex shrink-0 items-center gap-2.5">
      <ConnectedPill />
      <PillButton
        label={t('settings.providers.button.disconnect')}
        onClick={() => void handleLogout()}
        disabled={busy}
      />
    </div>
  ) : (
    <PillButton
      label={
        loggingIn ? t('settings.providers.button.cancel') : t('settings.providers.button.authorize')
      }
      onClick={() => {
        if (loggingIn) {
          void window.electronAPI.maker.xaiOAuthCancel();
          setLoggingIn(false);
        } else {
          void handleLogin();
        }
      }}
    />
  );

  return (
    <DetailHeader
      icon={<ProviderLogoMark providerId="xai" size={18} />}
      title={t('settings.providers.xai.title')}
      subtitle={providerSubtitleForDisplay(provider, t('settings.providers.xai.modelLabel'), {
        fallback: t('settings.providers.xai.subtitle'),
      })}
      trailing={trailing}
      provider={provider}
      assetModule={<XaiAssetModule connected={connected} />}
    />
  );
}

// ---------------------------------------------------------------------------
// 通用 OAuth —— 目录 auth.oauth 描述符驱动的供应商(非 bespoke 四家)。
// ---------------------------------------------------------------------------

function GenericOAuthHeader({
  provider,
  onChanged,
}: {
  provider: ProviderView;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const connected = provider.connected;
  const deviceFlow = provider.auth.oauth?.flow === 'device-code';
  const { deviceCode, clearDeviceCode, beginOwnedLogin, cancelOwnedLogin } =
    useProviderOAuthDeviceCode(provider.id, { observeProgress: deviceFlow });

  const handleLogin = useCallback(async () => {
    clearDeviceCode();
    setLoggingIn(true);
    const ownedLogin = beginOwnedLogin();
    try {
      const r = await window.electronAPI.maker.providerOAuthLogin(provider.id, {
        ownerId: ownedLogin.ownerId,
      });
      if (r.ok) {
        toast.success(t('settings.providers.genericOAuth.toast.loggedIn', { name: provider.name }));
        onChanged();
      } else if (r.reason === 'login_cancelled') {
        /* 用户取消,不弹错 */
      } else {
        toast.error(
          t('settings.providers.genericOAuth.toast.loginFailed', { name: provider.name }),
        );
      }
    } catch {
      toast.error(t('settings.providers.genericOAuth.toast.loginFailed', { name: provider.name }));
    } finally {
      ownedLogin.finish();
      setLoggingIn(false);
    }
  }, [beginOwnedLogin, clearDeviceCode, onChanged, provider.id, provider.name, t]);

  const handleLogout = useCallback(async () => {
    const confirmed = await confirm({
      title: t('settings.providers.genericOAuth.logoutConfirm.title', { name: provider.name }),
      description: t('settings.providers.genericOAuth.logoutConfirm.description', {
        name: provider.name,
      }),
      confirmText: t('settings.providers.genericOAuth.logoutConfirm.confirm'),
      cancelText: t('settings.providers.genericOAuth.logoutConfirm.cancel'),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await window.electronAPI.maker.providerOAuthLogout(provider.id);
      toast.success(t('settings.providers.genericOAuth.toast.loggedOut', { name: provider.name }));
      onChanged();
    } catch {
      toast.error(t('settings.providers.genericOAuth.toast.logoutFailed', { name: provider.name }));
    } finally {
      setBusy(false);
    }
  }, [confirm, onChanged, provider.id, provider.name, t]);

  const trailing = connected ? (
    <div className="flex shrink-0 items-center gap-2.5">
      <ConnectedPill />
      <PillButton
        label={t('settings.providers.button.disconnect')}
        onClick={() => void handleLogout()}
        disabled={busy}
      />
    </div>
  ) : (
    <PillButton
      label={
        loggingIn
          ? t('settings.providers.button.cancel')
          : t(
              deviceFlow
                ? 'settings.providers.wizard.authorizeWithDeviceCode'
                : 'settings.providers.button.authorize',
            )
      }
      onClick={() => {
        if (loggingIn) {
          cancelOwnedLogin();
          clearDeviceCode();
          setLoggingIn(false);
        } else {
          void handleLogin();
        }
      }}
    />
  );
  const detail =
    loggingIn && deviceFlow ? <OAuthDeviceCodeCard deviceCode={deviceCode} /> : undefined;

  return (
    <DetailHeader
      icon={providerIcon(provider, 18)}
      title={provider.name}
      subtitle={t('settings.providers.genericOAuth.subtitle')}
      trailing={trailing}
      provider={provider}
      detail={detail}
    />
  );
}

/**
 * 内置 API-key 供应商详情头(如 Gemini 图像来源,2026-07 图像多来源)。
 * 连接态 = key 已存(provider-service builtinApiKeyConnected);「更换」重写 key,
 * 「断开」删除 key(safeStorage),断开后左栏行按既有契约消失、重连入口回向导。
 * **已存 key 永不回显**:它是 MAIN_ONLY 键,renderer 只能查存在性/写/删(见
 * ImageApiKeyRow 注释),架构上拿不到明文。输入框的明文切换只显形用户本次输入的
 * 草稿(草稿本就在 renderer state 里),不构成凭证下放。
 */
function BuiltinApiKeyHeader({
  provider,
  onChanged,
}: {
  provider: ProviderView;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState('');

  const handleSave = useCallback(async () => {
    const key = draftKey.trim();
    if (!key) return;
    setBusy(true);
    try {
      // 失败经统一 IPC 错误协议抛出(throwIpcError),这里 catch 即失败。
      await window.electronAPI.builtinApiKeyStore(provider.id, key);
      toast.success(t('settings.providers.builtinApiKey.toast.saved', { name: provider.name }));
      setEditing(false);
      setDraftKey('');
      onChanged();
    } catch {
      toast.error(t('settings.providers.builtinApiKey.toast.saveFailed', { name: provider.name }));
    } finally {
      setBusy(false);
    }
  }, [draftKey, onChanged, provider.id, provider.name, t]);

  const handleDisconnect = useCallback(async () => {
    const confirmed = await confirm({
      title: t('settings.providers.builtinApiKey.disconnectConfirm.title', { name: provider.name }),
      description: t('settings.providers.builtinApiKey.disconnectConfirm.description', {
        name: provider.name,
      }),
      confirmText: t('settings.providers.builtinApiKey.disconnectConfirm.confirm'),
      cancelText: t('settings.providers.builtinApiKey.disconnectConfirm.cancel'),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await window.electronAPI.builtinApiKeyRemove(provider.id);
      toast.success(
        t('settings.providers.builtinApiKey.toast.disconnected', { name: provider.name }),
      );
      onChanged();
    } catch {
      toast.error(
        t('settings.providers.builtinApiKey.toast.disconnectFailed', { name: provider.name }),
      );
    } finally {
      setBusy(false);
    }
  }, [confirm, onChanged, provider.id, provider.name, t]);

  const trailing = (
    /* 三控件组自身可折行:最小窗口(内容区 ~235px)下「已连接 / 更换 key / 断开」
       放不下时组内换行,不再作为整体溢出被裁(PR #1102 review 第九轮)。 */
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5 gap-y-2">
      {provider.connected && <ConnectedPill />}
      <PillButton
        label={t(
          editing
            ? 'settings.providers.button.cancel'
            : 'settings.providers.builtinApiKey.replaceKey',
        )}
        onClick={() => {
          setDraftKey('');
          setEditing((v) => !v);
        }}
        disabled={busy}
      />
      {provider.connected && (
        <PillButton
          label={t('settings.providers.button.disconnect')}
          onClick={() => void handleDisconnect()}
          disabled={busy}
        />
      )}
    </div>
  );

  const detail = editing ? (
    <div className="flex items-center gap-2 pt-2">
      <SettingsTextInput
        value={draftKey}
        onChange={setDraftKey}
        placeholder={t('settings.providers.builtinApiKey.keyPlaceholder')}
        size="sm"
        mono
        secret
        className="min-w-0 flex-1"
      />
      <PillButton
        label={t('settings.providers.builtinApiKey.saveKey')}
        onClick={() => void handleSave()}
        disabled={busy || draftKey.trim().length === 0}
      />
    </div>
  ) : undefined;

  return (
    <DetailHeader
      icon={providerIcon(provider, 18)}
      title={provider.name}
      subtitle={t('settings.providers.builtinApiKey.subtitle')}
      trailing={trailing}
      provider={provider}
      detail={detail}
    />
  );
}

// ---------------------------------------------------------------------------
// XD 网关(Cindy AI)—— managed gateway key(useApiKey)。
//
// 版面口径(2026-08 计费引导 P0-1):xd 的 key 是登录后由服务端自动下发的**托管
// 凭证**,个人用户从不手动管理它(2026-07-17「无手填入口」定案)。所以主位不给
// 脱敏 key / 轮换 / 重新获取这三件用户几乎不碰的事,而给「我还剩多少钱、去哪充」:
//   - 标题行右端只留一个「···」溢出菜单(与所有供应商共用 DetailHeader 那一个),
//     凭证管理三项 + 只读脱敏 key 收在里面,各自保留原有的二次确认;
//   - 标题行下方是账户资产模块(1px 发丝线分隔):可用余额 + 查看用量 + 余额充值;
//   - 故障恢复(重试)只在凭据同步失败时浮现,正常态版面上没有重试按钮。
// ---------------------------------------------------------------------------

function maskKey(key: string): string {
  if (key && key.length >= 4) return `sk-••••••${key.slice(-4)}`;
  return 'sk-••••••••';
}

function XdGatewayHeader({
  provider,
  onChanged,
}: {
  provider?: ProviderView;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { confirm } = useConfirmDialog();
  const { mode, user } = useAuth();
  const { key, hasSavedKey, clearKey } = useApiKey();
  const syncStatus = useModelAccessStatus();
  const connected = provider?.connected ?? false;
  const [rotating, setRotating] = useState(false);

  // 余额 / 充值 / 用量入口一律走同一判据:cloud + personal。org 账号是**不渲染**
  // (不是灰置),与设置页「用量和计费」分区的可见性判定同源。
  const billingAccessible = canAccessBillingSettings({
    mode,
    membershipKind: user?.membershipKind ?? null,
  });
  // 余额取三池账本的 available —— 与计费页余额卡、状态栏用量 chip 同一口径同一币种
  // (见 TodaySpendChip 的「同一笔钱、必须同口径」注释)。该 hook 的防闪烁缓存按
  // accountId 绑定,切号当帧失效,不会把上一个账号的余额显示给新账号。
  const creditUsage = useModelAccessCreditUsage(billingAccessible);
  const assetState = resolveXdAssetModuleState({
    billingAccessible,
    syncState: syncStatus.state,
    available: creditUsage?.available ?? null,
  });

  // 凭据一律由服务端自动下发(个人 / 已接入企业),**无手填入口**(2026-07-17 定案)。
  const serverManaged = syncStatus.state === 'ok' && syncStatus.source === 'server';

  const prevSyncStateRef = useRef(syncStatus.state);
  useEffect(() => {
    if (prevSyncStateRef.current === syncStatus.state) return;
    prevSyncStateRef.current = syncStatus.state;
    if (syncStatus.state === 'ok') onChanged();
  }, [syncStatus.state, onChanged]);

  const handleDisconnect = useCallback(async () => {
    const confirmed = await confirm({
      title: t('settings.providers.xd.disconnectConfirm.title'),
      description: t('settings.providers.xd.disconnectConfirm.description'),
      confirmText: t('settings.providers.button.disconnect'),
      cancelText: t('settings.connections.codex.logoutConfirm.cancel'),
    });
    if (!confirmed) return;
    const ok = await clearKey();
    if (ok) onChanged();
  }, [clearKey, confirm, onChanged, t]);

  const handleRetry = useCallback(() => {
    void window.electronAPI.modelAccess
      .retry()
      .then(() => onChanged())
      .catch(() => undefined);
  }, [onChanged]);

  const handleRotate = useCallback(async () => {
    const confirmed = await confirm({
      title: t('settings.providers.xd.rotateConfirm.title'),
      description: t('settings.providers.xd.rotateConfirm.description'),
      confirmText: t('settings.providers.xd.rotateConfirm.confirm'),
      cancelText: t('settings.connections.codex.logoutConfirm.cancel'),
    });
    if (!confirmed) return;
    setRotating(true);
    try {
      await window.electronAPI.modelAccess.rotate();
      toast.success(t('settings.providers.xd.rotateSuccess'));
      onChanged();
    } catch {
      toast.error(t('settings.providers.xd.rotateFailed'));
    } finally {
      setRotating(false);
    }
  }, [confirm, onChanged, t]);

  const maskedKey = useMemo(() => maskKey(hasSavedKey ? key : ''), [hasSavedKey, key]);

  /**
   * 只读脱敏 key 的「点击复制」复制的是**明文 key**：脱敏串本身复制出去没有用途。
   * 这不构成新的凭证下放 —— gateway key 本来就在 renderer 侧可读（useApiKey，与
   * 掩码展示同一份数据），这里只是把用户已经能看到的东西按他的明确点击交给剪贴板。
   */
  const handleCopyKey = useCallback(() => {
    if (!hasSavedKey || !key) return;
    void navigator.clipboard
      .writeText(key)
      .then(() => toast.success(t('settings.providers.xd.copyKeySuccess')))
      .catch(() => toast.error(t('settings.providers.xd.copyKeyFailed')));
  }, [hasSavedKey, key, t]);

  // 标题行右端只剩状态位:「已连接」pill,或未连接/同步中的一句状态说明。凭证动作
  // 全部退进「···」菜单;故障态刻意**不显示**「已连接」—— 凭据没同步上,说已连接是假的。
  const trailing = (() => {
    switch (syncStatus.state) {
      case 'unsupported':
        return (
          <span className="shrink-0 text-12" style={{ color: 'var(--text-tertiary)' }}>
            {t('settings.providers.xd.sync.unsupported')}
          </span>
          {provider.hasAuth && provider.keyMasked && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-11"
              style={{ backgroundColor: 'var(--surface-chip)', color: 'var(--text-secondary)' }}
            >
              {t('settings.providers.xd.asset.syncFailed')}
            </p>
            <PillButton label={t('settings.providers.xd.sync.retry')} onClick={handleRetry} />
          </>
        ) : (
          <>
            <div className="min-w-[120px]">
              <p className="text-12 leading-tight" style={{ color: 'var(--text-secondary)' }}>
                {t('billing.balance.title')}
              </p>
              {/* 与计费页余额卡完全同口径:20px / 500 / tabular-nums / tracking-tight。 */}
              <p
                className="mt-1.5 text-20 font-medium leading-[1.3] tracking-[-0.02em] tabular-nums"
                style={{ color: 'var(--text-primary)' }}
              >
                {formatBillingAmount(
                  assetState.available,
                  BILLING_CURRENCY,
                  i18n.resolvedLanguage ?? i18n.language,
                )}
              </p>
            </div>
            {/* 「查看用量」与「充值」随计费页一起下架:两者都只能跳那一页,页面没了就
                不留按钮。余额数字本身仍是有效信息,继续展示。 */}
          </>
        )}
      </div>
      {editing && (
        <div className="flex items-center gap-2">
          <SettingsTextInput
            size="sm"
            type="password"
            value={draft}
            onChange={setDraft}
            placeholder={t('settings.providers.pi.key.placeholder')}
          />
          <PillButton label={t('settings.providers.custom.save')} onClick={() => void save()} disabled={saving || !draft.trim()} />
          <PillButton
            label={t('settings.providers.button.cancel')}
            onClick={() => {
              setEditing(false);
              setDraft('');
            }}
            disabled={saving}
          />
          <span className="text-11" style={{ color: 'var(--text-tertiary)' }}>
            {t('settings.providers.pi.key.plaintextHint')}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── 模型行 ────────────────────────────────────────────────────────────────

function ModelRow({
  provider,
  model,
  enabled,
  onToggle,
  onRemove,
  canRemove,
}: {
  provider: PiProviderView;
  model: PiProviderModelView;
  enabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useTranslation();
  const ctx = formatTokens(model.contextWindow);
  const max = formatTokens(model.maxTokens);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-13" style={{ color: 'var(--text-primary)' }}>
          {model.name ?? model.id}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <MetaChip>{model.id}</MetaChip>
          {ctx && <MetaChip>{t('settings.providers.pi.models.contextWindow', { tokens: ctx })}</MetaChip>}
          {max && <MetaChip>{t('settings.providers.pi.models.maxTokens', { tokens: max })}</MetaChip>}
          {model.reasoning && (
            <TypeBadge label={t('settings.providers.pi.models.reasoning')} />
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canRemove && (
          <button
            type="button"
            aria-label={t('settings.providers.pi.models.remove')}
            onClick={onRemove}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Trash2 size={14} />
          </button>
        )}
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={t('settings.providers.pi.models.toggleAria', {
            provider: provider.name,
            model: model.name ?? model.id,
          })}
        />
      </div>
    </div>
  );
}

// ─── 模型表单(手动添加)──────────────────────────────────────────────────

function AddModelForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (model: PiProviderModelView) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [reasoning, setReasoning] = useState(false);

  const valid = id.trim().length > 0;

  const submit = () => {
    const cw = Number(contextWindow);
    const mt = Number(maxTokens);
    onSubmit({
      id: id.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(Number.isFinite(cw) && cw > 0 ? { contextWindow: cw } : {}),
      ...(Number.isFinite(mt) && mt > 0 ? { maxTokens: mt } : {}),
      ...(reasoning ? { reasoning: true } : {}),
    });
  };

  return (
    <div
      className="flex flex-col gap-2 border-t px-5 py-3"
      style={{ borderColor: 'var(--settings-theme-card-border)' }}
    >
      <span className="text-13 font-medium" style={{ color: 'var(--text-secondary)' }}>
        {t('settings.providers.pi.models.addTitle')}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <SettingsTextInput size="sm" value={id} onChange={setId} placeholder={t('settings.providers.pi.models.idPlaceholder')} />
        <SettingsTextInput size="sm" value={name} onChange={setName} placeholder={t('settings.providers.pi.models.namePlaceholder')} />
        <SettingsTextInput
          size="sm"
          value={contextWindow}
          onChange={setContextWindow}
          placeholder={t('settings.providers.pi.models.contextPlaceholder')}
        />
        <SettingsTextInput
          size="sm"
          value={maxTokens}
          onChange={setMaxTokens}
          placeholder={t('settings.providers.pi.models.maxPlaceholder')}
        />
        <label className="flex items-center gap-1.5 text-12" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />
          {t('settings.providers.pi.models.reasoning')}
        </label>
      </div>
      <div className="flex items-center gap-2">
        <PillButton label={t('settings.providers.custom.save')} onClick={submit} disabled={!valid} />
        <PillButton label={t('settings.providers.button.cancel')} onClick={onCancel} />
      </div>
    </div>
  );
}

// ─── 添加供应商表单(9 种 API 形态 + 端点拉取)──────────────────────────────

interface FetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

function AddProviderForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState<string>('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<FetchedModel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const derivedId = useMemo(() => sanitizeProviderId(name), [name]);
  const valid = derivedId.length > 0 && /^https?:\/\//.test(baseUrl.trim());

  const fetchModels = async () => {
    setFetching(true);
    try {
      const result = (await window.electronAPI.maker.piAgent.fetchModels(baseUrl.trim(), apiKey.trim() || undefined)) as {
        models?: FetchedModel[];
        error?: string;
      };
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setFetched(result?.models ?? []);
      setSelected(new Set());
      if ((result?.models?.length ?? 0) === 0) {
        toast.error(t('settings.providers.pi.add.fetchEmpty'));
      }
    } catch (err) {
      toast.error(ipcErrorText(err, t('settings.providers.pi.add.fetchFailed')));
    } finally {
      setFetching(false);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      const models: PiProviderModelView[] = (fetched ?? [])
        .filter((m) => selected.has(m.id))
        .map((m) => ({
          id: m.id,
          ...(m.name ? { name: m.name } : {}),
          ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
          ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
          ...(m.reasoning ? { reasoning: true } : {}),
        }));
      await window.electronAPI.maker.piProviders.add(derivedId, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        api,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models,
      });
      // 选中的模型批量写入 settings.enabledModels(单次写入,避免逐条竞态)。
      if (models.length > 0) {
        const settings = (await window.electronAPI.maker.piAgent.readSettings()) as {
          enabledModels?: string[];
        } | null;
        const refs = models.map((m) => `${derivedId}/${m.id}`);
        const existing = settings?.enabledModels ?? [];
        await window.electronAPI.maker.piAgent.writeSettings({
          ...settings,
          enabledModels: [...existing, ...refs.filter((r) => !existing.includes(r))],
        });
      }
      toast.success(t('settings.providers.pi.add.toast.created'));
      onCreated(derivedId);
    } catch (err) {
      toast.error(ipcErrorText(err, t('settings.providers.pi.add.toast.createFailed')));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className="flex flex-col gap-2 border-t px-5 py-3"
        style={{ borderColor: 'var(--settings-theme-card-border)' }}
      >
        <span className="text-13 font-medium" style={{ color: 'var(--text-secondary)' }}>
          {t('settings.providers.pi.add.title')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <SettingsTextInput size="sm" value={name} onChange={setName} placeholder={t('settings.providers.pi.add.namePlaceholder')} />
          <span className="font-mono text-12" style={{ color: 'var(--text-tertiary)' }}>
            {t('settings.providers.pi.add.idPreview', { id: derivedId || '—' })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SettingsTextInput size="sm" value={baseUrl} onChange={setBaseUrl} placeholder={t('settings.providers.pi.add.baseUrlPlaceholder')} />
          <select
            value={api}
            onChange={(e) => setApi(e.target.value)}
            aria-label={t('settings.providers.pi.add.apiLabel')}
            className="h-8 rounded-lg border px-2 text-13"
            style={{
              backgroundColor: 'var(--settings-theme-card-bg)',
              borderColor: 'var(--settings-theme-card-border)',
              color: 'var(--text-primary)',
            }}
          >
            {PI_API_TYPES.map((a) => (
              <option key={a} value={a}>
                {apiTypeLabel(t, a)}
              </option>
            ))}
          </select>
          <SettingsTextInput
            size="sm"
            type="password"
            value={apiKey}
            onChange={setApiKey}
            placeholder={t('settings.providers.pi.key.placeholder')}
          />
        </div>
        <div className="flex items-center gap-2">
          <PillButton
            label={t(fetching ? 'settings.providers.pi.add.fetching' : 'settings.providers.pi.add.fetch')}
            onClick={() => void fetchModels()}
            disabled={fetching || !/^https?:\/\//.test(baseUrl.trim())}
          />
          {fetching && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />}
        </div>
      </div>

      {fetched && (
        <div
          className="flex flex-col gap-1 border-t px-5 py-3"
          style={{ borderColor: 'var(--settings-theme-card-border)' }}
        >
          <span className="text-13 font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.providers.pi.add.pickModels')}
          </span>
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {fetched.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)]">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(m.id);
                    else next.delete(m.id);
                    setSelected(next);
                  }}
                />
                <span className="min-w-0 truncate text-13" style={{ color: 'var(--text-primary)' }}>
                  {m.name ?? m.id}
                </span>
                <span className="ml-auto shrink-0 font-mono text-11" style={{ color: 'var(--text-tertiary)' }}>
                  {m.id}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div
        className="sticky bottom-0 flex items-center gap-2 border-t px-5 py-3"
        style={{
          borderColor: 'var(--settings-theme-card-border)',
          backgroundColor: 'var(--settings-theme-card-bg)',
        }}
      >
        <PillButton label={t('settings.providers.pi.add.create')} onClick={() => void create()} disabled={!valid || creating} />
        <PillButton label={t('settings.providers.button.cancel')} onClick={onCancel} disabled={creating} />
      </div>
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function ProvidersSection() {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();

  const [providers, setProviders] = useState<PiProviderView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApi, setEditApi] = useState('openai-completions');
  const [showAddModel, setShowAddModel] = useState(false);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const list = (await window.electronAPI.maker.piProviders.list()) as PiProviderView[];
      setProviders(list);
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // 深链兼容:?connect=<id> 命中列表时直接选中;旧向导参数一律吞掉摘除。
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const connect = searchParams.get('connect');
    if (!connect && !searchParams.get('wizard')) return;
    if (connect) setSelectedId(connect);
    const next = new URLSearchParams(searchParams);
    next.delete('connect');
    next.delete('wizard');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const list = providers ?? [];
  const selected = useMemo(
    () => list.find((p) => p.id === selectedId) ?? list[0] ?? null,
    [list, selectedId],
  );

  /** 启停一个模型 = 改 settings.enabledModels 里的 "providerId/modelId" 引用。 */
  const toggleEnabledModel = useCallback(
    async (providerId: string, modelId: string, next: boolean) => {
      const ref = `${providerId}/${modelId}`;
      try {
        const settings = (await window.electronAPI.maker.piAgent.readSettings()) as {
          enabledModels?: string[];
        } | null;
        const current = settings?.enabledModels ?? [];
        const updated = next
          ? current.includes(ref)
            ? current
            : [...current, ref]
          : current.filter((m) => m !== ref);
        await window.electronAPI.maker.piAgent.writeSettings({ ...settings, enabledModels: updated });
        await refetch();
      } catch (err) {
        toast.error(ipcErrorText(err, t('settings.providers.pi.models.toggleFailed')));
      }
    },
    [refetch, t],
  );

  const removeModel = useCallback(
    async (provider: PiProviderView, modelId: string) => {
      setBusy(true);
      try {
        await window.electronAPI.maker.piProviders.removeModel(provider.id, modelId);
        await refetch();
      } catch (err) {
        toast.error(ipcErrorText(err, t('settings.providers.pi.models.removeFailed')));
      } finally {
        setBusy(false);
      }
    },
    [refetch, t],
  );

  const removeProvider = useCallback(
    async (p: PiProviderView) => {
      const ok = await confirm({
        title: t('settings.providers.custom.deleteConfirm.title'),
        description: t('settings.providers.custom.deleteConfirm.description', { name: p.name }),
        confirmText: t('settings.providers.custom.deleteConfirm.confirm'),
        cancelText: t('settings.providers.custom.deleteConfirm.cancel'),
      });
      if (!ok) return;
      setBusy(true);
      try {
        await window.electronAPI.maker.piProviders.remove(p.id);
        toast.success(t('settings.providers.custom.toast.deleted'));
        setSelectedId(null);
        await refetch();
      } catch (err) {
        toast.error(ipcErrorText(err, t('settings.providers.custom.toast.deleteFailed')));
      } finally {
        setBusy(false);
      }
    },
    [confirm, refetch, t],
  );

  const beginEditMeta = (p: PiProviderView) => {
    setEditingMeta(true);
    setEditName(p.name);
    setEditBaseUrl(p.baseUrl ?? '');
    setEditApi(p.api ?? 'openai-completions');
  };

  const saveEditMeta = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await window.electronAPI.maker.piProviders.update(selected.id, {
        name: editName.trim() || undefined,
        baseUrl: editBaseUrl.trim() || undefined,
        api: editApi,
      });
      toast.success(t('settings.providers.pi.detail.toast.updated'));
      setEditingMeta(false);
      await refetch();
    } catch (err) {
      toast.error(ipcErrorText(err, t('settings.providers.pi.detail.toast.updateFailed')));
    } finally {
      setBusy(false);
    }
  };

  const loading = providers === null;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-1">
        <h2
          className="text-16 font-medium leading-[1.2]"
          style={{ color: 'var(--settings-section-title)' }}
        >
          {t('settings.providers.title')}
        </h2>
        <p className="text-13 leading-[1.5]" style={{ color: 'var(--settings-section-desc)' }}>
          {t('settings.providers.subtitle')}
        </p>
      </div>

      <EnabledModelsPanel />

      {!loading && (
        <div
          className="flex h-[calc(100vh-14rem)] min-h-[460px] overflow-hidden rounded-xl border"
          style={{
            backgroundColor: 'var(--settings-theme-card-bg)',
            borderColor: 'var(--settings-theme-card-border)',
          }}
        >
          {/* 左栏:供应商列表(builtin + custom,pi 数据层) */}
          <div
            className="flex w-[224px] shrink-0 flex-col border-r"
            style={{ borderColor: 'var(--settings-theme-card-border)' }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setShowAdd(false);
                    setEditingMeta(false);
                    setShowAddModel(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    selected?.id === p.id && !showAdd
                      ? 'bg-[var(--surface-hover)]'
                      : 'hover:bg-[var(--surface-hover)]',
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-13" style={{ color: 'var(--text-primary)' }}>
                      {p.name}
                    </span>
                    <span className="truncate text-11" style={{ color: 'var(--text-tertiary)' }}>
                      {p.type === 'custom'
                        ? t('settings.providers.pi.list.customBadge')
                        : apiTypeLabel(t, p.api) || t('settings.providers.pi.list.builtinBadge')}
                      {' · '}
                      {t('settings.providers.models.modelCount', { count: p.models.length })}
                    </span>
                  </div>
                  {p.hasAuth && (
                    <KeyRound size={13} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                  )}
                </button>
              ))}
            </div>
            <div
              className="border-t p-2"
              style={{ borderColor: 'var(--settings-theme-card-border)' }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowAdd(true);
                  setSelectedId(null);
                }}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-dashed text-13 font-medium transition-colors hover:bg-[var(--surface-hover)]"
                style={{
                  borderColor: 'var(--settings-btn-secondary-border)',
                  color: 'var(--settings-section-desc)',
                }}
              >
                <Plus size={15} />
                {t('settings.providers.addProvider')}
              </button>
            </div>
          </div>

          {/* 右栏:详情或添加表单 */}
          <div className="flex min-w-0 flex-1 flex-col">
            {showAdd ? (
              <>
                <div className="flex shrink-0 items-center justify-between px-5 py-3">
                  <span className="text-16 font-medium" style={{ color: 'var(--settings-section-title)' }}>
                    {t('settings.providers.pi.add.title')}
                  </span>
                  <PillButton label={t('settings.providers.button.cancel')} onClick={() => setShowAdd(false)} />
                </div>
                <AddProviderForm
                  onCreated={(id) => {
                    setShowAdd(false);
                    setSelectedId(id);
                    void refetch();
                  }}
                  onCancel={() => setShowAdd(false)}
                />
              </>
            ) : selected ? (
              <>
                {/* 详情头:名称 / id / 类型 + 自定义供应商的编辑删除 */}
                <div className="flex shrink-0 flex-col gap-1 px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-16 font-medium" style={{ color: 'var(--settings-section-title)' }}>
                        {selected.name}
                      </span>
                      <TypeBadge
                        label={
                          selected.type === 'custom'
                            ? t('settings.providers.pi.list.customBadge')
                            : t('settings.providers.pi.list.builtinBadge')
                        }
                      />
                      {selected.isOverride && (
                        <TypeBadge label={t('settings.providers.pi.list.overrideBadge')} />
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {selected.type === 'custom' && (
                        <>
                          <button
                            type="button"
                            aria-label={t('settings.providers.pi.detail.edit')}
                            onClick={() => beginEditMeta(selected)}
                            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label={t('settings.providers.pi.detail.delete')}
                            onClick={() => void removeProvider(selected)}
                            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MetaChip>{`id: ${selected.id}`}</MetaChip>
                    {selected.baseUrl && <MetaChip>{selected.baseUrl}</MetaChip>}
                    {selected.api && <TypeBadge label={apiTypeLabel(t, selected.api)} />}
                  </div>
                  {editingMeta && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SettingsTextInput size="sm" value={editName} onChange={setEditName} placeholder={t('settings.providers.pi.add.namePlaceholder')} />
                      <SettingsTextInput size="sm" value={editBaseUrl} onChange={setEditBaseUrl} placeholder={t('settings.providers.pi.add.baseUrlPlaceholder')} />
                      <select
                        value={editApi}
                        onChange={(e) => setEditApi(e.target.value)}
                        aria-label={t('settings.providers.pi.add.apiLabel')}
                        className="h-8 rounded-lg border px-2 text-13"
                        style={{
                          backgroundColor: 'var(--settings-theme-card-bg)',
                          borderColor: 'var(--settings-theme-card-border)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {PI_API_TYPES.map((a) => (
                          <option key={a} value={a}>
                            {apiTypeLabel(t, a)}
                          </option>
                        ))}
                      </select>
                      <PillButton label={t('settings.providers.custom.save')} onClick={() => void saveEditMeta()} disabled={busy} />
                      <PillButton label={t('settings.providers.button.cancel')} onClick={() => setEditingMeta(false)} />
                    </div>
                  )}
                </div>

                <ApiKeyRow provider={selected} onChanged={() => void refetch()} />

                {/* 模型列表:启用 = settings.enabledModels 引用;删除 = models.json */}
                <div className="flex shrink-0 items-center justify-between border-t px-5 py-2" style={{ borderColor: 'var(--settings-theme-card-border)' }}>
                  <span className="text-13 font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {t('settings.providers.pi.models.title')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddModel((v) => !v)}
                    className="flex items-center gap-1 text-12 font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Plus size={13} />
                    {t('settings.providers.pi.models.add')}
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {selected.models.length === 0 && !showAddModel ? (
                    <div className="flex h-full items-center justify-center px-8 text-center">
                      <span className="text-13" style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.providers.pi.models.empty')}
                      </span>
                    </div>
                  ) : (
                    selected.models.map((m) => (
                      <ModelRow
                        key={m.id}
                        provider={selected}
                        model={m}
                        enabled={selected.enabledModels.includes(`${selected.id}/${m.id}`)}
                        onToggle={() =>
                          void toggleEnabledModel(
                            selected.id,
                            m.id,
                            !selected.enabledModels.includes(`${selected.id}/${m.id}`),
                          )
                        }
                        onRemove={() => void removeModel(selected, m.id)}
                        canRemove={selected.isOverride || selected.type === 'custom'}
                      />
                    ))
                  )}
                  {showAddModel && (
                    <AddModelForm
                      onSubmit={(model) => {
                        void (async () => {
                          try {
                            await window.electronAPI.maker.piProviders.saveModel(selected.id, model);
                            setShowAddModel(false);
                            await refetch();
                          } catch (err) {
                            toast.error(ipcErrorText(err, t('settings.providers.pi.models.saveFailed')));
                          }
                        })();
                      }}
                      onCancel={() => setShowAddModel(false)}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
                <RefreshCw size={20} style={{ color: 'var(--text-tertiary)' }} />
                <span className="mt-3 text-13" style={{ color: 'var(--text-tertiary)' }}>
                  {t('settings.providers.pi.empty')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

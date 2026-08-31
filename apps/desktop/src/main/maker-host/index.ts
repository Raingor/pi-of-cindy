/**
 * apps/desktop/src/main/maker-host
 *
 * Desktop 端 Maker Core host 层。
 * 把所有 Electron 适配器组装好，构造 Maker 单例供 IPC bridge 使用。
 *
 * 注意：Maker 单例是 lazy-init 的 —— 第一次调用 getMaker() 时才构造。
 * 这样可以确保 localDb.ensureReady(userId) 已经完成才能用 SessionStorage。
 */

import { app, BrowserWindow } from 'electron';

import {
  Maker,
  configureDefaultImageResizer,
} from '@cindy/maker-core';
import {
  getActiveCatalog,
  getLocalCatalogOverridesSnapshot,
  setActiveCatalogChangedListener,
} from './active-catalog.js';
import { createOrcaWorkerBridgeMcpProvider, type OrcaBridgeMcpDeps } from '@cindy/orca-workflow';
import { LspServerPool, type IOSSimulatorMcpCallContext } from '@cindy/mcps';
import { effectiveXdGatewayBaseUrl } from '../model-access/effectiveEndpoint.js';

import { createMessage } from '../localDb/ipc/messages.js';
import { getMessagesForHistory } from '../localDb/chatHistoryReader.js';
import { getWorkerLink, updateWorkerStatus } from '../localDb/orcaTeamStore.js';
import { cleanupSessionTempAttachments } from '../maker-ipc/normalizeAttachments.js';
import { markKnownOrcaWorkerSession } from '../maker-ipc/orcaManualInterrupt.js';
import { markOrcaMcpHydratedIfNeeded } from '../maker-ipc/orcaMcpHydrationCache.js';
import { preparePersistedOrcaSessionStart } from '../maker-ipc/orcaSessionStartOptions.js';
import type { MakerSessionCreateOpts } from '../maker-ipc/sessionRequest.js';
import {
  dispatchInterAgentMessage,
  wireSessionToIpc,
} from '../maker-ipc/register.js';
import { MAKER_PUSH } from '../maker-ipc/channels.js';
import { tapWindowBroadcast } from '../device-link/broadcast-tap.js';
import { remoteInvoke } from '../device-link/index.js';
import { WorktreePool } from '../worktree/index.js';
import { getIOSSimulatorPluginAccessDecision } from '../cindy-brain/index.js';
import { readClaudeApiKey } from './auth-adapters.js';
import { desktopSessionStorage } from './session-storage.js';
import { desktopMakerLogger } from './logger-adapter.js';
import { outboundFetch } from './outbound-fetch.js';
import { readCustomProviderKey } from '../secrets/providerSecretStore.js';
import { createVisionBridge } from '../vision-bridge/vision-bridge.js';
import {
  setVisionBridgeController,
} from '../vision-bridge/vision-bridge-controller.js';
import { buildPiVisionBridgeEnv } from '../vision-bridge/pi-vision-bridge-env.js';
import { resolveVisionBackendRoute, setVisionGatewayKeyReader } from './provider-route.js';
import { resetProviderModelAutoRefreshCooldowns } from './provider-model-auto-refresh.js';
import { getThinkingEnabledFromMemory } from './newMakerDefaultsCache.js';
import { getSessionFastMode } from './session-effort-store.js';
import {
  getRemoteAgentProxyEnv,
} from '../remote-ssh/agent-proxy.js';
import {
  createSshPiDaemonTransport,
  createRemotePiFileOps,
  resolveRemotePiBinaryPath,
} from './pi-remote-transport.js';
import { ensurePiManagerInstalled } from './pi-manager-client.js';
import { createPiRemoteProviderForwardLease } from './pi-remote-provider-forward.js';
import {
  setClaudeProxyGatewayKeyReader,
  setClaudeProxyOAuthSpawnChecker,
} from './anthropic-compat-proxy-host.js';
import { createAutoPermissionReviewer } from './auto-permission-reviewer.js';
import {
  AUTO_REVIEW_ROUTER_GUARD_TIMEOUT_MS,
  createAutoReviewModelRouter,
} from './auto-review-model-router.js';
import { ensureCurrentAccountProviderReadiness } from './account-provider-readiness-ensure.js';
import { hasClaudeAiOAuth } from './claude-credentials-store.js';
import { ensureBundledRipgrepReady } from './runtime-configs.js';
import { createDesktopMcpProviders } from '../mcp-integrations/mcp-providers.js';
import { getGhostRosterPrompt } from '../mcp-integrations/ghost.js';
import { invalidatePiEnvironment } from '../mcp-integrations/piEnvironment.js';
import { getIOSSimulatorMcpDeps } from '../mcp-integrations/ios-simulator.js';
import { captureKnownFileBefore, noteOpaqueTurnChange } from '../turn-change-set/store.js';
import {
  registerAgentProcess,
} from '../process-monitor/codex-process-registry.js';
import { getRemoteSshPool, broadcastSilentInstallStatus } from '../remote-ssh/index.js';
import {
  registerCustomMcpArrays,
  refreshCustomMcpProviders,
  resetCustomMcpRegistry,
} from '../mcp-integrations/custom-mcp-registry.js';
import { cleanupComputerDriverSession } from '../mcp-integrations/computer.js';
import { createPluginRegistry, resetPluginRegistry } from './plugins/index.js';
import { createDesktopMakerMemoryManager, attachAgentsToMakerMemory } from './maker-memory-host.js';
import { rehydrateCloseSuppression } from './rehydrateCloseSuppression.js';
import { hydrateSessionProvider } from './session-provider-store.js';
import { createDesktopOrcaTeamStoreAdapter } from './orcaTeamStoreAdapter.js';
import { broadcastOrcaWorkerChanged } from './orcaWorkerBroadcast.js';
import { prepareSharedProjectSkillLinks } from './shared-global-skills.js';
import {
  deriveAvailableModels,
  refreshCatalogDerivedModels,
  resolvePiRuntimeModelDescriptor,
  resolvePiGatewayDescriptorProviderId,
} from './catalog-to-descriptors.js';
import { buildPiAgent } from './pi-host.js';
import {
  getDesktopSelectableCatalog,
  reloadActiveCatalogForEndpointChange,
  setNativeProviderClaimListener,
} from './createDesktopProviderService.js';
import { setAnthropicDiscoveryFailureListener } from './model-discovery/anthropic.js';
import { getRemoteSessionStartEnsure } from './remote-session-start-ensure.js';
export { withRehydrateCloseSuppressed } from './rehydrateCloseSuppression.js';

let _maker: Maker | null = null;
/** 视觉桥实例（层 A/B/C 共用），在 resetMaker 时释放缓存。 */
let _visionBridgeInstance: ReturnType<typeof createVisionBridge> | null = null;

/**
 * Pi 远端 MCP forward 的远端端口首选基数。Pi 不写 remote-mcp-forwards.json,
 * 每次确保远程转发顺延探测,断线重连由 RemoteHost re-arm 保持。
 */
const PI_MCP_FORWARD_PORT_START = 47981;

/** getMaker() 首次构造时发起的自定义 MCP 初始加载 promise，供 bootstrap 在注册会话 IPC 前 await。 */
let _initialCustomMcpRefresh: Promise<void> | undefined;

let providerAccessRuntimeRefreshListener: (() => void) | null = null;

/** Register the bootstrap-owned runtime reconciliation that follows provider access changes. */
export function setProviderAccessRuntimeRefreshListener(listener: (() => void) | null): void {
  providerAccessRuntimeRefreshListener = listener;
}

const requestAutoReviewText = createAutoReviewModelRouter({
  logger: desktopMakerLogger,
});

const reviewAutoPermissionAction = createAutoPermissionReviewer({
  logger: desktopMakerLogger,
  managesRetries: true,
  resolveRequestTimeoutMs: () => AUTO_REVIEW_ROUTER_GUARD_TIMEOUT_MS,
  requestText: (_request, prompt, { signal }) => requestAutoReviewText(prompt, signal),
});

/** Refresh selectable model capabilities, then notify every local/remote renderer. */
function refreshSelectableModelsAndBroadcast(payload: Record<string, unknown>): void {
  if (_maker) refreshCatalogDerivedModels(_maker, getDesktopSelectableCatalog());
  try {
    providerAccessRuntimeRefreshListener?.();
  } catch (error) {
    desktopMakerLogger.warn('provider access runtime refresh listener failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(MAKER_PUSH.PROVIDER_CHANGED, payload);
    } catch {
      // Window teardown may race the broadcast; other windows still receive it.
    }
  }
  tapWindowBroadcast(MAKER_PUSH.PROVIDER_CHANGED, payload);
}

/**
 * active catalog 的唯一 desktop 收口：先原地刷新 capabilities，
 * 再广播同一 revision。这样 provider 列表先变而 backend 仍校验旧模型的窗口不会出现。
 */
setActiveCatalogChangedListener((revision) => {
  try {
    refreshSelectableModelsAndBroadcast({ revision });
  } catch (error) {
    desktopMakerLogger.warn('active catalog capabilities refresh failed', {
      revision,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
});

/**
 * anthropic 清单发现的失败态变化 → 广播 PROVIDER_CHANGED。
 *
 * 归因不进 active catalog(清单没变,没有 revision 可言),但 renderer 往往在拉取失败
 * **之前**就取走了 provider 快照(15s 超时那条路径尤其明显)。不主动通知,设置页会一直
 * 停在「正在发现」而不是讲明失败理由(PR #548 review)。
 */
setAnthropicDiscoveryFailureListener(() => {
  try {
    // 复用既有的「刷 capabilities + 广播」收口:清单确实没变,这一步只是把 provider
    // 快照重新推给 renderer,让它重取带上失败归因的 listProviders。
    refreshSelectableModelsAndBroadcast({});
  } catch (error) {
    desktopMakerLogger.warn('anthropic discovery failure broadcast failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * 本机凭证绑定自愈成功 → 广播 PROVIDER_CHANGED。
 *
 * 连接态刚从 false 翻成 true，但只有触发那次读取的调用方拿到了新快照。其它窗口留在
 * 「未连接」，配对的手机 / 控制端更是只认这条推送来失效缓存（PR #548 review）。
 * anthropic 那条链路碰巧能在清单变化时顺带广播，xAI 则完全没有出口 —— 统一在这里补。
 */
setNativeProviderClaimListener(() => {
  resetProviderModelAutoRefreshCooldowns();
  try {
    refreshSelectableModelsAndBroadcast({});
  } catch (error) {
    desktopMakerLogger.warn('native provider claim broadcast failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Re-project provider/model availability after the Cindy auth session changes. */
export function refreshProviderAccessAfterAuthChange(): void {
  resetProviderModelAutoRefreshCooldowns();
  void reloadActiveCatalogForEndpointChange()
    .then(() => {
      refreshSelectableModelsAndBroadcast({});
    })
    .catch((error) => {
      desktopMakerLogger.warn('provider catalog reload after auth realm change failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  try {
    refreshSelectableModelsAndBroadcast({});
  } catch (error) {
    desktopMakerLogger.warn('provider access refresh after auth change failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Lazy: bootstrap-electron 在 app.whenReady 前调 app.setPath('userData') 切到 dev 隔离目录,
// 但 import 是 hoist 到顶的, eager `new LspServerPool({ userDataPath: app.getPath('userData') })`
// 会拿到 setPath 之前的老路径。lazy 拖到首次使用(已过 setPath)再读路径。
let lspPool: LspServerPool | null = null;

function getLspPool(): LspServerPool {
  lspPool ??= new LspServerPool({
    userDataPath: app.getPath('userData'),
    logger: desktopMakerLogger.child('lsp-pool'),
  });
  return lspPool;
}

/** Get the plugin registry singleton (delegates to plugins/index.ts module-level cache). */
export function getPluginRegistry() {
  return createPluginRegistry();
}

/**
 * 获取 Maker 单例。第一次调用时构造（要求 localDb 已 ensureReady）。
 *
 * 2026-08-31 pi-only harness:claude/codex agent 的装配已整体摘除,agents map 只注册
 * pi(pi 不可用时为空 map)。bundled ripgrep 检查保留:真正的启动期 fail-fast 在
 * splash check-environment(缺 rg 时 splash 进失败态可重试);这里是防御性断言 ——
 * 走到本函数说明 bootstrap 已完成环境检查,缺 rg 即顺序错误,早抛比 spawn 时再炸清晰
 * (throw 会被 bootstrap 的 register catch 兜住并留 ERROR 日志)。
 */

/**
 * 视觉桥用户提示广播（层 B + 层 D 共用）。
 * renderer 仅信任 `source: 'vision-bridge'`，避免普通错误事件误触发视觉桥提示。
 */
const VISION_BRIDGE_DEDUP_MS = 2_000;
const _visionBridgeDedup = new Map<string, number>();

function broadcastVisionBridgeEvent(
  sessionId: string,
  reason: 'vision-bridge-recognizing' | 'vision-bridge-fallback' | 'vision-bridge-unavailable',
  extra: { imageCount?: number } = {},
): void {
  if (reason === 'vision-bridge-recognizing') {
    for (const key of _visionBridgeDedup.keys()) {
      if (key.startsWith(`${sessionId}|`)) _visionBridgeDedup.delete(key);
    }
  } else {
    const key = `${sessionId}|${reason}`;
    const now = Date.now();
    const last = _visionBridgeDedup.get(key);
    if (last !== undefined && now - last < VISION_BRIDGE_DEDUP_MS) return;
    _visionBridgeDedup.set(key, now);
  }

  const message = reason === 'vision-bridge-recognizing'
    ? '正在识别图片中…'
    : reason === 'vision-bridge-fallback'
      ? '视觉桥使用了备用视觉后端（主后端不可用）'
      : '视觉桥当前不可用，图片无法转成文字描述，已以文字提示代替';
  const payload = {
    sessionId,
    event: {
      type: 'error' as const,
      data: {
        message,
        isTerminal: false,
        reason,
        ...(extra.imageCount !== undefined ? { imageCount: extra.imageCount } : {}),
      },
      source: 'vision-bridge',
    },
  };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(MAKER_PUSH.EVENT, payload);
    } catch (error) {
      desktopMakerLogger.child('vision-bridge').warn('vision bridge event broadcast failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function getMaker(): Maker {
  if (!_maker) {
    ensureBundledRipgrepReady();

    // 图片送进模型前的 last-mile resize (省 vision token)。host 注入 logger
    // 让 sharp 失败 / 超时 / LRU 淘汰等告警进项目日志, 而不是默默丢黑洞。
    // 阈值/缓存策略走 image-resizer.ts 的默认 (1568px / WebP q=85 / ≤500KB
    // 跳过 / 200MB 全局 LRU / 并发 2 / 5s 超时)。
    configureDefaultImageResizer({
      logger: desktopMakerLogger.child('image-resizer'),
    });

    // Maker Memory manager — 先建 (agents={}), agents 创建后再 attach。
    // sqliteFactory + basePath 在工厂内部用 Electron API 准备好, maker-core 拿不到。
    const makerMemoryManager = createDesktopMakerMemoryManager();

    // Plugin registry — 先于 agent 构造, 让 createDesktopMcpProviders 拿 registry
    // 包进每个 MCP provider 的 isEnabled 闭包里。registry 内部读 <userData>/plugin-prefs.json
    // 和项目 .claude/settings.json, mtime-based 缓存, 只在 session start 时同步检查。
    const pluginRegistry = createPluginRegistry();

    const resolveIOSSimulatorAccess = (context?: IOSSimulatorMcpCallContext) => {
      const workingDir = context?.workingDir?.trim() || null;
      const pluginAccess = getIOSSimulatorPluginAccessDecision(workingDir);
      if (!pluginAccess.allowed) return pluginAccess;
      if (!pluginRegistry.isEnabled('ios-simulator', workingDir ?? undefined)) {
        return {
          allowed: false as const,
          errorCode: 'IOS_SIMULATOR_DISABLED' as const,
          message:
            'The embedded iOS Simulator capability is disabled for the current project. Enable it in the project plugin settings before retrying the embedded tool; other iOS workflows are unaffected.',
          data: {
            reason: 'disabled-in-workdir',
            action: 'enable-plugin',
            pluginId: 'ios-simulator',
            pluginName: 'iOS Simulator',
          },
        };
      }
      return { allowed: true as const };
    };

    const makerMemoryProviderDeps = {
      getAppVersion: () => app.getVersion(),
      getMakerMemoryManager: () => makerMemoryManager,
      lspPool: getLspPool(),
      pluginRegistry,
      resolveIOSSimulatorAccess,
      invokeRemote: remoteInvoke,
      // 只读活跃 Session 的运行时真相。权限切换是 runtime-first、DB-second，
      // 因此插件过户自动放行不得回退 sessions.permission_mode；会话不再 active
      // 时同样 fail closed。闭包在 MCP tool-call 时执行，此时 _maker 已装配完成。
      getLiveSessionGrantState: (sessionId: string, sessionInstanceId: string) => {
        if (!sessionInstanceId) return null;
        const session = _maker?.getSession(sessionId);
        if (!session || session.instanceId !== sessionInstanceId) return null;
        const permission = session.stablePermissionModeState;
        if (!permission) return null;
        return {
          permissionMode: permission.mode,
          remoteHostId: session.remoteHostId,
        };
      },
    };
    const orcaTeamStoreAdapter = createDesktopOrcaTeamStoreAdapter({
      getWorkerLink,
      updateWorkerStatus,
      markKnownOrcaWorkerSession,
      broadcastOrcaWorkerChanged,
      logger: desktopMakerLogger,
    });
    const orcaBridgeDeps = {
      getMaker: () => {
        if (!_maker) throw new Error('maker not initialized');
        return _maker;
      },
      logger: desktopMakerLogger,
      persistUserMessage: (sessionId: string, message: { clientId: string; content: string }) =>
        createMessage(sessionId, {
          clientId: message.clientId,
          role: 'user',
          content: message.content,
        }).then(() => undefined),
      wireSession: wireSessionToIpc,
      hydrateSessionRoute: (sessionId: string, providerId: string | null) =>
        hydrateSessionProvider(sessionId, providerId),
      // bridge rehydrate remote lead/worker 时经 holder 调 register.ts 的
      // ensureRemoteReadyForSessionStart (SSH 重连 / agent install) — 与 IPC
      // create/send 路径同一 preflight。holder 在 IPC 注册时填入 (晚于本 deps 构造,
      // 早于任何 bridge 回调)。
      ensureRemoteSessionStart: async (params) => {
        // ensure 会在 createOpts 上就地归一化 makerMemoryEnabled (全局设置
        // backfill + stale-bridge 钳制) — 这里是临时对象, 必须把结果读回
        // 交给 bridge 的真实 createSession (review R6 P2)。
        const createOpts: {
          id: string;
          agentKind: typeof params.agentKind;
          remoteHostId: string;
          makerMemoryEnabled?: boolean;
        } = {
          id: params.sessionId,
          agentKind: params.agentKind,
          remoteHostId: params.remoteHostId,
        };
        await getRemoteSessionStartEnsure()?.({ createOpts });
        return { makerMemoryEnabled: createOpts.makerMemoryEnabled === true };
      },
      orcaTeamStore: orcaTeamStoreAdapter,
      readLeadHistory: async ({ leadSessionId, fromMs, limit, cursor }) => {
        const page = await getMessagesForHistory({
          sessionIds: [leadSessionId],
          workdir: null,
          fromMs,
          toMs: null,
          agentKind: null,
          roles: ['user', 'assistant'],
          includeRewound: false,
          limit,
          cursor,
          order: 'asc',
        });
        return {
          items: page.items.map((item) => ({
            id: item.id,
            role: item.role === 'assistant' ? 'assistant' as const : 'user' as const,
            content: item.content,
            agentMeta: item.agentMeta,
            createdAt: item.createdAt,
          })),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        };
      },
      dispatchInterAgentMessage,
    } satisfies OrcaBridgeMcpDeps;
    const orcaWorkerBridgeProvider = createOrcaWorkerBridgeMcpProvider(orcaBridgeDeps);

    // logger 不 pre-child agent kind —— agent 内部会自己 child(this.kind),
    // host 这里再 child 一次会变成 maker/pi/pi。
    // endpoint 走 getter 注入: proxy 在 splash 期异步起, 就绪后新建 session 自动用上
    // loopback, 不需要重启 app / 重置 Maker 单例。
    // 'oauth' 模式下 provider 路由模型要把 OAuth bearer 换成 gateway key
    // 再转 gateway —— 这把 key 不进子进程 env(R4),由本地 proxy 旁路读取。注入 reader,
    // 与 pi provider 的网关路由同源(都用 readClaudeApiKey 读那把 XD gateway key)。
    setClaudeProxyGatewayKeyReader(readClaudeApiKey);
    // cc spawn 凭证形态(oauth-spawn vs gateway-spawn)由「是否连了 Claude.ai 订阅」决定;
    // proxy 的默认路由据此分流(oauth-spawn 默认换网关 key、gateway-spawn passthrough)。live 读。
    setClaudeProxyOAuthSpawnChecker(hasClaudeAiOAuth);

    // pi(实验性,个人分支):二进制在位才注册;缺失时 agents map 不含 pi,
    // 既有环境零影响。模型清单走目录 pi 投影(xd 网关模型经 active-catalog 按
    // claude-code 可达面镜像给 pi);登录后目录刷新经 refreshCatalogDerivedModels
    // 原地 splice 同步进 capabilities(PiAgent 每次 startSession 现读)。
    const piMcpProviders = [
      ...createDesktopMcpProviders(makerMemoryProviderDeps),
      orcaWorkerBridgeProvider,
    ];
    // 用户自定义 MCP:agent 必须注册其实际持有的数组引用，再统一做初始 refresh。
    // localDb onReady 可能在 Maker 构造前就已触发（此时 registry 无数组，refresh 空跑）；
    // 在此补一次 refresh，若 DB 尚未就绪则 refreshCustomMcpProviders 内部 catch 后静默跳过。
    // 此后每次 CRUD（mcpHandlers.afterChange）也会原地刷新数组；运行中会话保持启动快照。
    registerCustomMcpArrays(piMcpProviders);
    _initialCustomMcpRefresh = refreshCustomMcpProviders();

    const piAgent = buildPiAgent({
      logger: desktopMakerLogger,
      turnChangeCapture: {
        beforeKnownFileWrite: captureKnownFileBefore,
        noteOpaqueWrite: noteOpaqueTurnChange,
      },
      registerLocalAgentProcess: ({ pid, kind, role }) => registerAgentProcess(pid, kind, role),
      reviewAutoPermissionAction,
      capabilityAdditions: {
        availableModels: deriveAvailableModels(getDesktopSelectableCatalog(), 'pi'),
      },
      resolvePiRuntimeModelDescriptor: (providerId, modelId) =>
        resolvePiRuntimeModelDescriptor(getDesktopSelectableCatalog(), providerId, modelId, {
          localOverrides: getLocalCatalogOverridesSnapshot(),
        }),
      resolvePiGatewayModelDescriptor: (providerId, modelId) => {
        // `cindy` / null 是 Pi 的默认 gateway 路由；其 wire 由 v3 XD runtime plan
        // 决定，因此描述符也必须锁定 XD，不能让复合 `cindy` 按目录顺序命中同 id 订阅模型。
        return resolvePiRuntimeModelDescriptor(
          getDesktopSelectableCatalog(),
          resolvePiGatewayDescriptorProviderId(providerId),
          modelId,
          { localOverrides: getLocalCatalogOverridesSnapshot() },
        );
      },
      mcpProviders: piMcpProviders,
      makerMemory: makerMemoryManager,
      getGhostRosterPrompt,
      // 仅为命中视觉桥目标的 Pi 模型注册 Layer C 工具。
      resolvePiVisionBridgeEnv: (model) =>
        buildPiVisionBridgeEnv(
          {
            getProviderById: (providerId) =>
              getActiveCatalog().providers.find((provider) => provider.id === providerId) ?? null,
            readCustomProviderKey,
            readGatewayKey: readClaudeApiKey,
            resolveBackendRoute: (providerId, modelId) =>
              resolveVisionBackendRoute(providerId, modelId, effectiveXdGatewayBaseUrl() || null),
            fetch: outboundFetch,
          },
          model,
        ),
      // 远端 Pi:给 session 标 remoteHostId 的, PiAgent 通过这个钩子拿远端
      // transport — SSH 连接复用 ConnectionPool (remote-ssh feature 起的),
      // 这里包一层 RemoteHost + SshPiTransport (execStream 直桥远端 pi --mode rpc)。
      // 远端机器没在 pool / 未连接 → 抛错, PiAgent 把它当 startSession 失败传上去。
      getRemotePiTransport: async (
        remoteHostId,
        {
          binaryPath: _localBinaryPath,
          remoteBinaryPath: providedRemoteBinaryPath,
          args,
          cwd,
          env,
          logger,
          sessionId,
          hostProxyForwards,
        },
      ) => {
        const remoteHost = getRemoteSshPool().get(remoteHostId);
        if (!remoteHost) {
          throw new Error(`remote SSH host "${remoteHostId}" not found in pool — connect it first under Settings → Remote`);
        }
        if (remoteHost.getStatus() !== 'ready') {
          throw new Error(`remote SSH host "${remoteHostId}" is not connected (status=${remoteHost.getStatus()}) — connect it under Settings → Remote first`);
        }
        // 远端必须用远端安装的 pi 二进制(probe 出 $INSTALL_DIR/pi/pi),不能用本地
        // binaryPath —— 那是本机 userData 下的路径,远端不存在(连带 plan-mode 扩展
        // 路径与 subagent 二进制 env 都指向远端才能工作)。
        // 轮 29 MEDIUM:优先用 PiAgent startSession 已 resolve 并传入的
        // remoteBinaryPath(接口契约「host 已 probe」)—— 只在缺失时自己 probe
        // 兜底, 避免两次 resolve 语义分叉(cache 失效窗口)。
        const remoteBinaryPath = providedRemoteBinaryPath ?? await resolveRemotePiBinaryPath(remoteHost);
        // daemon 持久模式:远端 pi-manager(TS 单例 daemon)持有 pi 进程,ssh 断链后
        // 会话继续跑,重连 attach(对齐 codex app-server daemon / cc-mgr)。
        // 首次 ensure 前确保 pi-manager bundle 装好 + daemon 在跑。
        // daemon session key = maker sessionId(同一会话重连 attach 到同一 daemon 进程)。
        // onEvent(轮 15 缺口 3/6):install 进度转发 silent install toast —— 首次
        // 使用 pi remote 时 1-3s 的 bundle 上传/daemon spawn 不再静默。
        await ensurePiManagerInstalled(remoteHost, desktopMakerLogger, (event) => {
          const hostId = remoteHost.id;
          if (event.kind === 'error') {
            broadcastSilentInstallStatus({ hostId, agentKind: 'pi', phase: 'failed', message: event.message });
          } else if (event.kind === 'ready') {
            broadcastSilentInstallStatus({ hostId, agentKind: 'pi', phase: 'done' });
          } else {
            // install-upload 是 pi-manager 专属 kind, SILENT_INSTALL_STATUS 的
            // eventKind union 不含它(轮 32 MEDIUM 类型对齐) —— 归入 install-log
            // (renderer phaseText 对未知 kind 保持上次文案, 映射后走通用阶段)。
            broadcastSilentInstallStatus({
              hostId,
              agentKind: 'pi',
              phase: 'progress',
              eventKind: event.kind === 'install-upload' ? 'install-log' : event.kind,
            });
          }
        });
        const providerForwardLease = createPiRemoteProviderForwardLease(
          (spec) => remoteHost.ensureRemoteForward(spec),
        );
        try {
          for (const spec of hostProxyForwards ?? []) {
            await providerForwardLease.ensure(spec);
          }
        } catch (error) {
          await Promise.allSettled([providerForwardLease.releaseAll()]);
          throw error;
        }
        let transport;
        try {
          transport = createSshPiDaemonTransport({
            remoteHost,
            binaryPath: remoteBinaryPath,
            args,
            cwd,
            env,
            logger,
            daemonSessionId: sessionId ?? undefined,
          });
        } catch (error) {
          await providerForwardLease.releaseAll();
          throw error;
        }
        transport.ensureHostProxyForward = providerForwardLease.ensure;
        if (transport.killRemoteSession) {
          const killRemoteSession = transport.killRemoteSession.bind(transport);
          transport.killRemoteSession = async () => {
            try {
              await killRemoteSession();
            } finally {
              await providerForwardLease.releaseAll();
            }
          };
        } else {
          const close = transport.close.bind(transport);
          transport.close = async (reason?: string) => {
            try {
              await close(reason);
            } finally {
              await providerForwardLease.releaseAll();
            }
          };
        }
        return transport;
      },
      // 远端 Pi 的 agentHome 文件操作:models.json / extensions / perm / subagent 快照 /
      // resume stat 都落到远端机器(pi 进程在远端读)。经 SSH stdin 管道写文件(cat > 原子
      // 写 + chmod),stat 走 statRemotePath 同款脚本,mkdir 走 mkdir -p —— 与 cc-manager
      // bundle 上传同模式,路径绝对不拼进命令行(防 ps / 日志泄漏)。
      getRemotePiFileOps: (remoteHostId) => {
        const remoteHost = getRemoteSshPool().get(remoteHostId);
        if (!remoteHost) {
          throw new Error(`remote SSH host "${remoteHostId}" not found in pool — connect it first under Settings → Remote`);
        }
        return createRemotePiFileOps(remoteHost);
      },
      // 远端 pi 二进制路径:probe(远端 `pi --version`)+ cache。
      resolveRemotePiBinaryPath: async (remoteHostId) => {
        const remoteHost = getRemoteSshPool().get(remoteHostId);
        if (!remoteHost) {
          throw new Error(`remote SSH host "${remoteHostId}" not found in pool — connect it first under Settings → Remote`);
        }
        return resolveRemotePiBinaryPath(remoteHost);
      },
      // 远端会话:MCP bridge 经 SSH remote-forward 隧道化,远端 pi 够到本地
      // in-process MCP(cindy_orca / orca_worker_bridge / cindy_memory / ghost)。
      // 改 URL 前缀为 remote-forward 地址,identity/token 不变。
      // collab 全局禁用由 piEnvironment 按 server 名精确剥除 orca 类工具
      // (R5 配置审计 H-7);此处不整体 skip —— 整体 skip 会
      // 连 cindy_memory / ghost / 外部 HTTP MCP 一起误杀。
      remotePiSkipMcpBridge: () => false,
      // 把本地 bridge 的 loopback URL(http://127.0.0.1:<localPort>/mcp/<name>)
      // 改写为远端 remote-forward 地址(http://127.0.0.1:<remotePort>/mcp/<name>)。
      //
      // Pi 用 host.ensureRemoteForward 直接建独立 forward,远端端口从独立基数
      // (PI_MCP_FORWARD_PORT_START)顺延,与历史 codex 的单槽位 remote-mcp-forwards.json
      // 各自独立,互不踩踏。
      rewriteRemotePiMcpBridgeUrl: async (remoteHostId, localUrl) => {
        const remoteHost = getRemoteSshPool().get(remoteHostId);
        if (!remoteHost) {
          throw new Error(`remote SSH host "${remoteHostId}" not found in pool — connect it first under Settings → Remote`);
        }
        // 用 URL 解析改端口再序列化, 避免字符串 replace 误伤 query 参数
        // (R2 MCP BUG-3) 与 Number('')=0 传非法端口 (R2 MCP BUG-7)。
        const u = new URL(localUrl);
        const localPort = u.port;
        if (!localPort || Number.isNaN(Number(localPort)) || Number(localPort) <= 0) {
          throw new Error(`pi bridge URL has no usable port: ${localUrl}`);
        }
        const fwd = await remoteHost.ensureRemoteForward({
          localHost: '127.0.0.1',
          localPort: Number(localPort),
          preferredRemotePort: PI_MCP_FORWARD_PORT_START,
        });
        u.port = String(fwd.remotePort);
        // 轮 24 HIGH-2:close 由 pi-host 在会话 dispose 时调用 —— 防 forward
        // 随会话累积耗尽远端端口(fwd.close 幂等, RemoteHost 内部有 dedup)。
        return { url: u.toString(), close: () => void fwd.close() };
      },
      // 「Agent 流量走本地 Proxy」:远端 pi 的 LLM 流量经 SSH remote-forward 走本地代理
      // (与 CC 远端同机制;pref 关闭时 getRemoteAgentProxyEnv 返回 null → 直连)。
      getRemotePiAgentProxyEnv: async (remoteHostId) => {
        const remoteHost = getRemoteSshPool().get(remoteHostId);
        if (!remoteHost) {
          throw new Error(`remote SSH host "${remoteHostId}" not found in pool — connect it first under Settings → Remote`);
        }
        return getRemoteAgentProxyEnv(remoteHost);
      },
    });

    setVisionGatewayKeyReader(readClaudeApiKey);
    _visionBridgeInstance = createVisionBridge({
      getProviderById: (providerId) =>
        getActiveCatalog().providers.find((provider) => provider.id === providerId) ?? null,
      readCustomProviderKey,
      readGatewayKey: readClaudeApiKey,
      resolveGatewayEndpoint: () => effectiveXdGatewayBaseUrl() || null,
      resolveBackendRoute: (providerId, modelId) =>
        resolveVisionBackendRoute(providerId, modelId, effectiveXdGatewayBaseUrl() || null),
      fetch: outboundFetch,
      logger: desktopMakerLogger.child('vision-bridge'),
      onStart: (sessionId, imageCount) => {
        broadcastVisionBridgeEvent(sessionId, 'vision-bridge-recognizing', { imageCount });
      },
      onNote: (_note, sessionId, kind) => {
        broadcastVisionBridgeEvent(
          sessionId,
          kind === 'fallback' ? 'vision-bridge-fallback' : 'vision-bridge-unavailable',
        );
      },
    });

    // 装配第二步: 把 agents 引用挂回 manager (manager.enable() 时遍历 setMemory(false))。
    attachAgentsToMakerMemory(makerMemoryManager, piAgent ? { pi: piAgent } : {});
    if (makerMemoryManager.isEnabled()) {
      void makerMemoryManager.enable();
    }

    _maker = new Maker({
      agents: piAgent ? { pi: piAgent } : {},
      storage: desktopSessionStorage,
      logger: desktopMakerLogger,
      makerMemory: makerMemoryManager,
      visionBridge: _visionBridgeInstance.hook,
      // Desktop-specific session 生命周期副作用钩子。maker-core 不知道文件系统细节，
      // 启动前的 Skill 共享与关闭后的清理都由 desktop host 注入。
      lifecycleHooks: {
        prepareStartOptions: async (sessionId, opts) => {
          const providerReady = await ensureCurrentAccountProviderReadiness();
          if (!providerReady) {
            throw new Error('Account provider models are not ready for this app session; retry.');
          }
          await preparePersistedOrcaSessionStart(sessionId, opts as MakerSessionCreateOpts);
          if (opts.agentKind === 'pi' && opts.thinkingEnabled === undefined) {
            const thinkingEnabled = getThinkingEnabledFromMemory(
              opts.agentKind,
              opts.providerId,
              opts.model,
            );
            if (thinkingEnabled !== undefined) opts.thinkingEnabled = thinkingEnabled;
          }
          if (opts.agentKind === 'pi') {
            opts.getPriceVariant = () => (getSessionFastMode(sessionId) ? 'priority' : 'standard');
          }
        },
        onBeforeStart: async ({ workingDir, remoteHostId }) => {
          // SSH remote 的 workingDir 属于远端文件系统，本机不能为它创建兼容链接。
          if (remoteHostId || !workingDir) return;
          const result = await prepareSharedProjectSkillLinks({ workingDir });
          for (const warning of result.warnings) {
            desktopMakerLogger.warn('shared project skill link warning', {
              workingDir,
              warning,
            });
          }
        },
        onStartSucceeded: (sessionId, opts) => {
          const createOpts = opts as MakerSessionCreateOpts;
          markOrcaMcpHydratedIfNeeded(sessionId, createOpts);
          if (createOpts.orcaRole === 'worker') {
            markKnownOrcaWorkerSession(sessionId);
          }
        },
        onClose: async (sessionId) => {
          // registry 必须先清,后续 resume 会重新登记。
          void cleanupComputerDriverSession(sessionId);
          await rehydrateCloseSuppression.runOnCloseSideEffects(sessionId, async () => {
            await cleanupSessionTempAttachments(sessionId);
            // ephemeral worktree: clean → 池化复用, dirty → 保留不删(scheduler 生命周期)。
            // 非 ephemeral worktree **不再在 close 时回收**(P0 重构):close 是进程
            // 生命周期事件,不代表用户不要工作区了(/clear、重连、CLI 崩溃都会走到
            // 这)。回收只由会话显式删除/归档驱动,见 localDb/ipc/sessions.ts →
            // worktree/sessionRemovalRecycle.ts。
            await WorktreePool.releaseWorktree(sessionId).catch(() => undefined);
          });
        },
      },
    });
    setVisionBridgeController({
      shouldBridge: _visionBridgeInstance.isTargetModel,
      describeImage: _visionBridgeInstance.describeImage,
    });
  }
  return _maker;
}

/**
 * 已构造则返回 Maker 单例,未构造返回 null——**不**触发懒构造。
 * 供"顺带关会话"类调用方(如会话删除/归档触发的 worktree 回收)使用:
 * Maker 没构造过说明不存在活跃子进程,没有东西要关,不值得为此拉起全套 agent。
 */
export function getMakerIfReady(): Maker | null {
  return _maker;
}

/**
 * 重置 Maker 单例（切账号 / 测试用）。
 */
export function resetMaker(): void {
  _maker = null;
  _initialCustomMcpRefresh = undefined;
  setVisionBridgeController(null);
  _visionBridgeInstance?.dispose();
  _visionBridgeInstance = null;
  resetPluginRegistry();
  resetCustomMcpRegistry();
  // 轮 27 MEDIUM-2:resetMaker 是 account 边界收口 —— PI bridge 必须一并
  // 失效, 否则旧账号的 MCP server factories 残留(显式耦合, 防未来新调用点
  // 漏掉 teardownAuthAccountBoundary 链上的 shutdownPiEnvironment)。
  invalidatePiEnvironment();
}

/**
 * getMaker() 首次构造时会异步加载自定义 MCP 列表。
 * bootstrap 在注册会话 IPC 前 await 此函数，确保第一个会话能看到用户已保存的 MCP。
 * refresh 失败（DB 未就绪等）时内部已静默处理，不会抛错。
 */
export async function waitForInitialCustomMcpRefresh(): Promise<void> {
  await (_initialCustomMcpRefresh ?? Promise.resolve());
}

/**
 * xAI(SuperGrok)OAuth 登录 / 登出后广播 PROVIDER_CHANGED,触发所有窗口的 useProviders refetch。
 *
 * xAI 不是 maker AgentKind('pi'),无独立的 AUTH_STATE_CHANGED payload 规范;
 * 用 PROVIDER_CHANGED(无 payload)语义最准确:provider 连接态已变更,请各消费方重新拉取列表。
 * useProviders 同时订阅 AUTH_STATE_CHANGED 和 PROVIDER_CHANGED,两者都能触发 refetch。
 */
export function broadcastXaiAuthStateChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(MAKER_PUSH.PROVIDER_CHANGED, {});
    } catch {
      /* no-op */
    }
  }
}

export async function shutdownLspServerPool(): Promise<void> {
  await lspPool?.shutdown();
  lspPool = null;
}

// re-exports for IPC layer
export { desktopClaudeAuthAdapter, desktopCodexAuthAdapter } from './auth-adapters.js';

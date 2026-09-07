/**
 * piCredentialReload.ts — Pi 供应商密钥变更的「延迟重载」登记表（方案 B）。
 * ---------------------------------------------------------------------------
 * 背景:pi 会话的 BYOM / pi-cli 供应商 key 在 spawn 时经 env 注入子进程快照,
 * 运行中的会话不会重读。用户在设置里改了某个供应商的 key 后,正在运行的本地
 * pi 会话要等**下一次 spawn** 才能用上新 key。
 *
 * 语义(与用户确认的方案 B):
 *   · 改 key 时:按 providerId 找出**运行中**的本地 pi 会话,登记为 stale 并
 *     广播 PROVIDER_CHANGED(带 affectedProviderIds payload)→ 任务窗口显示
 *     非模态横幅「下次发送消息时将自动重载」;
 *   · 该会话下一次发送(sendToAgentAccepted,含输入队列 drain 重入)时:空闲则
 *     关掉旧 handle,随后 lazy-create 按 DB 行重建 —— resumeSessionId =
 *     sessions.sdk_session_id(pi 的 JSONL 绝对路径),对话记录保留,新 env 带
 *     新 key;回合运行中则不动(保留标记,下个空闲发送边界再重载),绝不打断
 *     进行中的工作。
 *   · 不覆盖:SSH 远程 pi 会话(remoteHostId 非空 —— 远端 daemon 的 envHash
 *     重启语义自理)与未运行会话(下次发送本来就 lazy-create 现读新 key)。
 *
 * 与 PendingCredentialSwitchService(会话内切模型来源的延迟生效)的区别:那边
 * 换的是 (model, providerId) 路由并带停用轴重裁决;这里路由不变、只换钥匙,
 * 不需要 DB 回写与重裁决,所以是独立的小登记表,不共用。
 */

import { createLogger } from '../logger.js';

const log = createLogger('pi-credential-reload');

/** tracker 关心的 live session 最小面(maker.Session 结构满足)。 */
export interface PiCredentialReloadSession {
  id: string;
  agentKind: string;
  remoteHostId: string | null;
  isTurnRunning(): boolean;
}

export interface PiCredentialReloadDeps {
  getSession(sessionId: string): PiCredentialReloadSession | undefined | null;
  closeSession(sessionId: string): Promise<void>;
  /**
   * DB 查询:agent_kind='pi' 且 provider_id 命中的**本地**(remote_host_id 为空)
   * 会话行。注入以便单测脱 DB。
   */
  queryLocalPiSessionsByProviderIds(
    providerIds: readonly string[],
  ): Promise<ReadonlyArray<{ id: string; providerId: string | null }>>;
  /** 广播 PROVIDER_CHANGED(带 affectedProviderIds,任务窗口据此显示横幅)。 */
  broadcastProviderChanged(payload: { affectedProviderIds: string[] }): void;
}

export interface PiCredentialReloadTracker {
  /**
   * 凭证变更通知(幂等:重复通知覆盖旧标记)。fire-and-forget 调用,内部异常
   * 只 warn —— key 已落盘,通知失败最多让横幅缺席,不能阻断设置页保存。
   */
  notifyCredentialsChanged(providerIds: readonly string[]): Promise<void>;
  /**
   * 发送事务在 getSession 之前调用:stale 且空闲 → 关旧 handle(一次性语义,
   * 先删标记再 close,防并发双杀);stale 但运行中 → 保留标记直接放行。
   */
  applyPendingReload(sessionId: string): Promise<void>;
  hasPendingReload(sessionId: string): boolean;
}

export function createPiCredentialReloadTracker(
  deps: PiCredentialReloadDeps,
): PiCredentialReloadTracker {
  /** sessionId → 命中的 providerId(仅运行中的本地 pi 会话会进表)。 */
  const staleBySessionId = new Map<string, string>();

  const notifyCredentialsChanged = async (
    providerIds: readonly string[],
  ): Promise<void> => {
    const ids = [...new Set(providerIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return;
    let rows: ReadonlyArray<{ id: string; providerId: string | null }>;
    try {
      rows = await deps.queryLocalPiSessionsByProviderIds(ids);
    } catch (err) {
      log.warn('pi credential reload: db lookup failed', {
        providerIds: ids,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const affectedProviderIds = new Set<string>();
    for (const row of rows) {
      // 只标记当前仍在内存里的会话:已关闭的会话下次发送本来就 lazy-create
      // 现读新 key,不需要横幅也不需要重载。
      const live = deps.getSession(row.id);
      if (!live || live.agentKind !== 'pi' || live.remoteHostId) continue;
      staleBySessionId.set(row.id, row.providerId ?? '');
      if (row.providerId) affectedProviderIds.add(row.providerId);
    }
    if (affectedProviderIds.size === 0) return;
    log.info('pi credential reload: marked stale sessions', {
      providerIds: [...affectedProviderIds],
      sessionCount: staleBySessionId.size,
    });
    deps.broadcastProviderChanged({ affectedProviderIds: [...affectedProviderIds] });
  };

  const applyPendingReload = async (sessionId: string): Promise<void> => {
    if (!staleBySessionId.has(sessionId)) return;
    const live = deps.getSession(sessionId);
    if (!live) {
      // 已被其它路径关闭:下次发送 lazy-create 现读新 key,标记即可撤销。
      staleBySessionId.delete(sessionId);
      return;
    }
    if (live.remoteHostId) {
      // 防御:登记时已排除远端;真出现(会话中途挂上远端)直接撤销,不碰远端。
      staleBySessionId.delete(sessionId);
      return;
    }
    if (live.isTurnRunning()) {
      // 回合运行中:不打断。标记保留,下一个空闲发送边界(含队列 drain 重入
      // sendToAgentAccepted)再重载。
      return;
    }
    // 一次性语义:先删标记再 close,并发重入不会双杀。
    staleBySessionId.delete(sessionId);
    try {
      await deps.closeSession(sessionId);
      log.info('pi credential reload: closed stale session before dispatch', { sessionId });
    } catch (err) {
      // close 失败不阻断发送:放行旧 handle(用旧 key 跑本轮),下次发送标记
      // 已删 —— 但旧 handle 的 env 里仍是旧 key。权衡:阻断发送更糟。
      log.warn('pi credential reload: close failed, dispatching on old handle', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    notifyCredentialsChanged,
    applyPendingReload,
    hasPendingReload: (sessionId) => staleBySessionId.has(sessionId),
  };
}

// ─── 进程级单例接线 ────────────────────────────────────────────────────────
// piAgentHandlers(bootstrap-electron 直调)与 register.ts(装配期)都要触达
// tracker,但装配顺序不定:模块级 holder + 空安全取用,装配前调用是 no-op。

let activeTracker: PiCredentialReloadTracker | null = null;

export function setPiCredentialReloadTracker(tracker: PiCredentialReloadTracker | null): void {
  activeTracker = tracker;
}

/** key 写入点调用;tracker 未装配(极早期 / 单测)时 no-op。异常只 warn 不上抛。 */
export function notifyPiCredentialsChanged(providerIds: readonly string[]): void {
  activeTracker
    ?.notifyCredentialsChanged(providerIds)
    .catch((err) =>
      log.warn('pi credential reload: notify failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

/** 发送事务经 register.ts 装配的 dep 调用,不走这个懒入口。 */
export function getPiCredentialReloadTracker(): PiCredentialReloadTracker | null {
  return activeTracker;
}

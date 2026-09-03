/**
 * sessionRuntimeIds —— 从会话行推导「对话框上方要展示的两个 id」的纯函数。
 *
 * 两个 id 的来源与语义不同,别混:
 *   - **任务 ID**(`session.id`):Cindy 自己的任务行主键。本机新建任务是 uuid;
 *     从本机 pi CLI 导入的任务是 `pi-<文件名 stem>`。它是 Cindy 侧的身份。
 *   - **Intercom ID**:pi 运行时的 session id(`sessionManager.getSessionId()`)。
 *     pi-intercom 的在场身份就用它 —— `resolveConfiguredIntercomSessionId()` 的
 *     取值链是 `PI_INTERCOM_STABLE_ID` → 配置 `stableId` → **pi session id**,
 *     前两者 Cindy 都不设(也没有 `~/.pi/agent/intercom/config.json`),所以等于
 *     pi session id。`intercom list` 展示的 `(01a05fc6)` 是它的前 8 位。
 *
 * 为什么能从 `sdk_session_id` 推出 pi session id:pi 的 session 文件名是
 * `${时间戳}_${sessionId}.jsonl`(session-manager.js 的 `_setSessionFile`),而
 * maker-core 落库的 `sdk_session_id` 存的正是 `get_state.sessionFile` 这个绝对
 * 路径(拿不到 sessionFile 时退化为裸 sessionId,所以两种形态都要认)。文件名
 * **只按第一个 `_` 切**:pi-web-switch 建的会话 id 形如 `web-421d852f-...`,
 * 按 uuid 正则去匹配会漏掉它们。
 */

/** 路径分隔符:Windows 下 sdk_session_id 可能是 `C:\...\x.jsonl`。 */
function baseName(value: string): string {
  const lastSlash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
}

/**
 * `sdk_session_id` → pi 运行时 session id(= Intercom ID)。
 *
 * 只接受 pi 会话的 `sdk_session_id`;claude / codex 的 id 语义不同,调用方必须
 * 先按 `agentKind` 过滤(见 `resolveSessionRuntimeIds`)。取不到返回 null。
 */
export function piSessionIdFromSdkSessionId(sdkSessionId: string | null | undefined): string | null {
  const raw = sdkSessionId?.trim();
  if (!raw) return null;
  const stem = baseName(raw).replace(/\.jsonl$/i, '');
  if (!stem) return null;
  const underscore = stem.indexOf('_');
  // 没有 `_`:sdk_session_id 是裸 sessionId(pi 拿不到 sessionFile 时的形态)。
  const id = underscore >= 0 ? stem.slice(underscore + 1) : stem;
  return id.length > 0 ? id : null;
}

export interface SessionRuntimeIds {
  /** Cindy 任务行主键;始终有值(会话已加载时)。 */
  sessionId: string;
  /** pi 运行时 session id = pi-intercom 在场身份;非 pi 任务或未启动过时为 null。 */
  intercomId: string | null;
}

/**
 * 会话行 → 待展示的两个 id。会话未加载(`sessionId` 为空)时返回 null,调用方
 * 直接不渲染。
 */
export function resolveSessionRuntimeIds(input: {
  sessionId: string | null | undefined;
  agentKind: string | null | undefined;
  sdkSessionId: string | null | undefined;
}): SessionRuntimeIds | null {
  const sessionId = input.sessionId?.trim();
  if (!sessionId) return null;
  return {
    sessionId,
    intercomId:
      input.agentKind === 'pi' ? piSessionIdFromSdkSessionId(input.sdkSessionId) : null,
  };
}

/** 展示用短形式:与 `intercom list` 的 `(01a05fc6)` 同口径(前 8 位)。 */
export function shortRuntimeId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

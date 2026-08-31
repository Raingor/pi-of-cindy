/**
 * Claude model id → SDK wire 串映射 + SDK supportedModels 捕获回调。
 *
 * pi-only 改造(2026-08-31):ClaudeCodeAgent 已删,但 host 侧仍有多处消费:
 *   - toSdkModelString:标题 oneShot / claude-local-sessions 历史导入 /
 *     anthropic-compat proxy / anthropic-responses-bridge 需要把 catalog 短 id
 *     还原成 Anthropic wire 串(含 [1m] beta 后缀口径),SSoT 单点维护在此。
 *   - setClaudeSupportedModelsListener:model-discovery/anthropic 的 SDK
 *     supportedModels 捕获通道接线点(会话 init 后上报清单)。
 * 实现自原 agents/claude-code/index.ts 原样搬出。
 */

/**
 * 公开短 ID → Claude SDK 实际接受的字符串。
 * SDK 需要 [1m] beta 通道后缀，这是 SDK 细节，不外泄给调用方。
 *
 * haiku 不再重写成日期快照 id:目录短 id(claude-haiku-4-5)就是 Anthropic 官方别名,
 * 上游(订阅直连 / 网关)均接受;带版本号的别名不存在跨代漂移,同号新快照跟随即可。
 *
 * [1m] 后缀的唯一决策依据是目录(providers.json)的 contextWindow:
 *   - 窗口已知且 ≥1M → 带 [1m];已知且 <1M → 绝不带(已带的强制剥掉)。
 *     窗口 <1M 却带 [1m] 会让 cc-code 的 has1mContext 把窗口判成 1M,撑大
 *     auto-compact 阈值 → 对话冲过上游真实上限后空转,会话"假死"(折扣 GPT 实踩)。
 *     真实窗口口径已由 catalog 经 env-builder(XDT_MAKER_MODEL_CONTEXT_WINDOWS,
 *     id 与 id[1m] 双键)注入 cc,[1m] 不再承担窗口语义,只是 wire 串的一部分。
 *   - 窗口未知(目录外模型 / 未传窗口的老调用方)→ 回落下方硬编码映射链,行为不变。
 *     这样"新增模型要不要 [1m]"只改 OSS 目录即可,不必发版。
 *
 * 一律走显式版本号,不要用 'opus' / 'sonnet' 这类别名:
 * cc-code 二进制升级后别名指针会漂移到下一代模型(例如 'opus' 从 4.6 跳到 4.7),
 * 导致调用方明明选了 4.6 却实际命中 4.7,且只有"上一代"模型踩这个坑。
 */
export function toSdkModelString(model: string, contextWindow?: number | null): string {
  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    const bare = model.endsWith('[1m]') ? model.slice(0, -'[1m]'.length) : model;
    return contextWindow >= 1_000_000 ? `${bare}[1m]` : bare;
  }
  return legacyToSdkModelString(model);
}

/** 目录窗口未知时的兜底映射链(与窗口规则引入前一致;haiku 日期重写已移除,见函数头)。 */
function legacyToSdkModelString(model: string): string {
  if (model === 'claude-opus-5') return 'claude-opus-5[1m]';
  if (model.includes('opus-4-8')) return 'claude-opus-4-8[1m]';
  if (model.includes('opus-4-7')) return 'claude-opus-4-7[1m]';
  if (model.includes('opus-4-6')) return 'claude-opus-4-6[1m]';
  // fable-5 比照 Opus 走 1M beta 通道; 显式版本号, 不用别名。
  if (model === 'claude-fable-5') return 'claude-fable-5[1m]';
  // sonnet 同样必须显式版本号:曾经的裸 'sonnet[1m]' 在 Sonnet 5 上线后仍被二进制
  // 解析成 claude-sonnet-4-6,用户选 Sonnet 5 实际命中 4.6(2026-07 实踩)。
  // 目录内 sonnet 系列均为 1M 窗口(catalog providers.json),统一走 [1m] beta 通道。
  if (model === 'claude-sonnet-5') return 'claude-sonnet-5[1m]';
  if (model === 'claude-sonnet-4-6') return 'claude-sonnet-4-6[1m]';
  // 兜底:未来新增 sonnet 型号在此映射更新前,也透传显式 id 而非裸别名。
  if (model.includes('sonnet')) return `${model}[1m]`;
  // 官方 gpt-5.5 / gpt-5.4 真实支持 1M, 走 [1m] beta 通道。
  if (model === 'gpt-5.5' || model === 'gpt-5.4') return `${model}[1m]`;
  // 折扣GPT(codex/* 经折扣网关)真实上下文上限远低于 1M(catalog cc 侧 = 272k),
  // 绝不能带 [1m]: cc-code 的 has1mContext 只要在 model 串里见到 [1m] 就把窗口判成 1M
  // (getContextWindowForModel 直接 return 1_000_000), 撑大 auto-compact 阈值 →
  // 对话冲过折扣网关真实上限(~24 万 token)后空转, 用户侧表现为会话"假死"。
  // 路由不依赖 [1m]: isAnthropicWireModel 只按 claude-/sonnet/opus/haiku/fable 前缀判定,
  // codex/ 前缀始终走 provider 网关、不命中 Anthropic wire, 去掉 [1m] 不改变路由判定;
  // 真实窗口由 catalog 经 translator 窗口口径注入(=272k)。
  if (model === 'codex/gpt-5.5' || model === 'codex/gpt-5.4') return model;
  if (model === 'codex/gpt-5.6-sol' || model === 'codex/gpt-5.6-terra') return model;
  // DeepSeek 的 [1m] 是历史兼容路由后缀; 上下文大小另走 maker capabilities。
  if (
    model === 'deepseek/deepseek-v4-pro' ||
    model === 'deepseek/deepseek-v4-flash' ||
    model === 'deepseek-v4-flash'
  ) return `${model}[1m]`;
  if (model === 'z-ai/glm-5.2') return `${model}[1m]`;
  return model;
}

/**
 * Anthropic 模型清单动态发现的 host 捕获回调(2026-07-19 模型列表统一重构)。
 * host(apps/desktop maker-host/model-discovery/anthropic)注入监听器,会话链路在
 * Query 建立后 fire-and-forget 调 SDK `supportedModels()` 上报。
 * 纯附加能力:不阻塞 send / 不进事件热路径;失败静默(发现通道有 HTTP + 磁盘缓存
 * 互补,见 host 侧)。
 */
let supportedModelsListener: ((models: unknown[]) => void) | null = null;

/** host 注入 SDK supportedModels 捕获回调;传 null 解除。 */
export function setClaudeSupportedModelsListener(
  listener: ((models: unknown[]) => void) | null,
): void {
  supportedModelsListener = listener;
}

/** fire-and-forget 捕获(宿主 Query 无 supportedModels 方法时静默跳过)。 */
export function notifyClaudeSupportedModels(q: unknown): void {
  if (!supportedModelsListener) return;
  const fn = (q as { supportedModels?: () => Promise<unknown[]> }).supportedModels;
  if (typeof fn !== 'function') return;
  void fn.call(q).then(
    (models) => {
      try {
        if (Array.isArray(models)) supportedModelsListener?.(models);
      } catch {
        /* listener 异常不得外溢成 unhandled rejection */
      }
    },
    () => {
      /* 捕获失败静默:发现是附加能力,不影响会话 */
    },
  );
}

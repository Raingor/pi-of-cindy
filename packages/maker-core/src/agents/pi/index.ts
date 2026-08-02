/**
 * PiAgent — Cindy 的第 3 个 harness，驱动本地 pi (pi.dev) CLI。
 *
 * 与 Claude Code / Codex 同型：extends BaseAgent，实现 kind / capabilities /
 * startSession。pi 自管 provider / model / usage / system prompt / memory ——
 * Cindy 只负责 spawn `pi --mode rpc` 子进程、stdin 发 command、stdout 事件经
 * translator 翻成 AgentEvent。模型路由、计费、凭证均不进 maker-core（与
 * codex 的 proxy/credential 体系正交）。
 *
 * 未经 typecheck 验证（当前工作区无 pnpm / node_modules）；import 路径、
 * Capabilities 字段、UserContentBlock shape 以 codex / events.ts 为准推断，
 * 首次 typecheck 时按报错点修正。
 *
 * 首版范围（见 plan）：
 *  - 复用本地 pi 二进制（deps.binaryPath，host 探测后注入，不在本文件下载）
 *  - --no-session（ephemeral）：pi 会话不持久化、不支持 resume；后续接
 *    --session-dir 映射 Cindy sessionId ↔ pi jsonl，再实现 switch_session resume
 *  - 不支持 fork / rewind / planMode / extraDirs / memory / effort / permissionMode
 *    （Capabilities 标 unsupported，UI 据此降级）
 *  - 支持：text/thinking 流式、tool_use/tool_result、abort、same-turn steer、
 *    extension_ui 的 select/confirm/input/editor → interaction_request
 */

import { createAsyncQueue } from '../shared/async-queue.js';
import { BaseAgent } from '../base-agent.js';
import type {
  AgentBuiltinCommand,
  ListAgentSkillsOptions,
  ListAgentSkillsResult,
} from '../../types/palette.js';
import type {
  AgentDeps,
  AgentSessionHandle,
  SendOptions,
  StartSessionOptions,
} from '../base-agent.js';
import type {
  AgentEvent,
  InteractionResolver,
  UsageSnapshot,
} from '../../types/events.js';
import type { Capabilities } from '../../types/capabilities.js';
import type { UserMessage } from '../../types/common.js';
import { createPiStdioTransport, type PiTransport } from './transport.js';
import {
  newPiRuntimeState,
  translatePiLine,
  type PiRuntimeState,
  type PiTranslateContext,
} from './translator.js';
import { scanPiCustomizations } from './pi-customizations.js';

/**
 * pi 能力声明。pi 自管 provider/model/usage/memory，所以大部分标 unsupported；
 * UI 据此降级（隐藏 model 切换 / effort / planMode / memory 入口等）。
 * abort / sameTurnSteer / text / image 走 pi 原生能力，标 supported。
 */
const PI_CAPABILITIES: Capabilities = {
  switchModel: {
    // pi RPC set_model 支持运行时切模型；availableModels 由 host 从 pi
    // get_available_models 派生后经 capabilityAdditions 注入（起始为空）。
    supported: true,
  },
  availableModels: [],
  hasFastMode: false,
  effort: {
    supported: false,
    reason: 'not-implemented',
    message: 'pi 的 thinking level 走原生 set_thinking_level，首版不映射',
  },
  effortLevels: [],
  reasoningDisplay: ['off', 'summarized'],
  permissionModes: [],
  setPermissionModeMidSession: {
    supported: false,
    reason: 'not-implemented',
  },
  turnPermissionPolicy: {
    supported: {
      supported: false,
      reason: 'not-implemented',
      message: 'pi 工具审批走 extension_ui_request(select/confirm)',
    },
    unsupportedPermissionModes: [],
  },
  planMode: { supported: false, reason: 'not-implemented' },
  multimodal: {
    text: { supported: true },
    image: { supported: true },
    file: { supported: false, reason: 'not-implemented' },
  },
  fork: { supported: false, reason: 'not-implemented' },
  rewind: { supported: false, reason: 'not-implemented' },
  abort: { supported: true },
  sameTurnSteer: { supported: true },
  memory: {
    supported: {
      supported: false,
      reason: 'not-implemented',
      message: 'pi 自管 ~/.pi memory，Cindy 侧不跟踪',
    },
  },
  extraDirs: { supported: false, reason: 'not-implemented' },
};

export class PiAgent extends BaseAgent {
  readonly kind = 'pi' as const;
  readonly capabilities: Capabilities;

  constructor(deps: AgentDeps) {
    super(deps);
    this.capabilities = this.buildCapabilities(PI_CAPABILITIES);
  }

  override listAgentCommands(): AgentBuiltinCommand[] {
    return [];
  }

  override async listAgentSkills(
    opts: ListAgentSkillsOptions,
  ): Promise<ListAgentSkillsResult> {
    const { items, errors } = await scanPiCustomizations(opts);
    return {
      skills: items
        .filter((it) => it.kind === 'skill' && it.enabled !== false)
        .map((it) => ({
          kind: 'agent-skill' as const,
          name: it.name,
          description: it.description,
          source: 'skill' as const,
          path: it.absolutePath,
          scope: (it.scope === 'repo' ? 'repo' : 'user') as 'user' | 'repo',
          enabled: it.enabled ?? true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      errors,
    };
  }

  async startSession(opts: StartSessionOptions): Promise<AgentSessionHandle> {
    const sid = opts.sessionId ?? '';
    const log = this.deps.logger.child(sid ? `s:${sid}/pi` : 'pi');
    log.info('startSession', {
      workDir: opts.workingDir,
      resume: opts.resumeSessionId ?? 'new',
      model: opts.model,
    });

    const eventQueue = createAsyncQueue<AgentEvent>();
    const rt = newPiRuntimeState();
    let interactionResolver: InteractionResolver | null = null;
    // 运行时当前模型（Cindy 侧口径，`<provider>/<modelId>` 格式）。启动时
    // 经 --model 传入首值，后续 setModel 就地去重。
    let mutableModel = opts.model ?? '';
    let usageCache: UsageSnapshot = { tokenUsage: 0, contextTokens: 0, contextWindow: 0, costUsd: 0 };

    const transport: PiTransport = createPiStdioTransport({
      binaryPath: this.deps.binaryPath,
      cwd: opts.workingDir,
      // pi 自管 provider/credentials：不注入任何凭证 env，pi 用 ~/.pi 自配。
      env: { ...process.env },
      // 首版 ephemeral：--no-session 不持久化 jsonl；resume 后续接 --session-dir。
      // opts.model 存在时用 --model 传 pi 原生 `provider/id` 格式（启动即生效）。
      extraArgs: mutableModel
        ? ['--no-session', '--model', mutableModel]
        : ['--no-session'],
    });

    // 异步获取 usage 统计（非阻塞，失败时回退到零快照）。
    void transport
      .request({ type: 'get_session_stats' })
      .then((resp) => {
        if (resp.success) {
          const data = resp.data as {
            tokens?: { input?: number; output?: number; total?: number };
            cost?: number;
          } | undefined;
          const tokens = data?.tokens ?? {};
          const tokenUsage = (tokens.input ?? 0) + (tokens.output ?? 0);
          usageCache = {
            tokenUsage,
            contextTokens: 0,
            contextWindow: 0,
            costUsd: typeof data?.cost === 'number' ? data.cost : 0,
          };
        }
      })
      .catch(() => {
        // 静默回退到零快照。
      });

    const ctx: PiTranslateContext = {
      emit: (e) => eventQueue.push(e),
      log: (level, msg, data) => log[level](msg, (data ?? {}) as Record<string, unknown>),
      resolveInteraction: async (req: Parameters<NonNullable<InteractionResolver>>[0]) => {
        if (!interactionResolver) {
          throw new Error('pi: interaction resolver not set (host 未注入 setInteractionResolver)');
        }
        return interactionResolver(req);
      },
      sendUiResponse: (payload) => {
        void transport
          .writeLine(JSON.stringify(payload))
          .catch((e) => log.warn('pi: sendUiResponse failed', { error: String(e) }));
      },
    };

    // stdout 分流：response（命令回执，带 id）单独处理；其余 event 走 translator。
    transport.onLine((line) => {
      let parsed: { type?: string; id?: string } | null = null;
      try {
        parsed = JSON.parse(line) as { type?: string; id?: string };
      } catch {
        // 非 JSON：交给 translator 记 warn 静默丢。
        translatePiLine(line, rt, ctx);
        return;
      }
      // response 不进 UI 事件流（它是 command 回执，非 agent 事件）。
      if (parsed?.type === 'response') {
        return;
      }
      translatePiLine(line, rt, ctx);
    });
    transport.onStderr((line) => log.warn('pi stderr', { line }));
    transport.onClose(({ reason }) => {
      log.info('pi transport closed', { reason });
      eventQueue.end();
    });

    const writeCommand = async (cmd: Record<string, unknown>): Promise<void> => {
      await transport.writeLine(JSON.stringify(cmd));
    };

    const handle: AgentSessionHandle = {
      id: sid,
      agentKind: 'pi',
      model: opts.model,
      async send(message: UserMessage, _sendOpts?: SendOptions): Promise<void> {
        const { text, images } = userMessageToPrompt(message);
        await writeCommand({
          type: 'prompt',
          message: text,
          ...(images.length > 0 ? { images } : {}),
        });
      },
      async steer(message: UserMessage, _sendOpts?: SendOptions): Promise<void> {
        const { text, images } = userMessageToPrompt(message);
        await writeCommand({
          type: 'steer',
          message: text,
          ...(images.length > 0 ? { images } : {}),
        });
      },
      async abort(): Promise<void> {
        await writeCommand({ type: 'abort' });
      },
      async setModel(model: string): Promise<void> {
        // renderer 单次切换会全量重调 set*；值未变不重推（与 codex 一致）。
        if (!model || model === mutableModel) return;
        mutableModel = model;
        const { provider, modelId } = parsePiModelId(model);
        if (!modelId) return;
        await writeCommand({
          type: 'set_model',
          ...(provider ? { provider } : {}),
          modelId,
        });
      },
      async close(): Promise<void> {
        await transport.close('session close');
      },
      events(): AsyncIterable<AgentEvent> {
        // AsyncQueue<AgentEvent> 自身实现 AsyncIterable<AgentEvent>。
        return eventQueue;
      },
      getUsageSnapshot(): UsageSnapshot {
        return usageCache;
      },
      setInteractionResolver(resolver: InteractionResolver): void {
        interactionResolver = resolver;
      },
    };

    return handle;
  }
}

/**
 * Cindy 侧 pi model id 统一用 pi 原生 `<provider>/<modelId>` 格式。
 * 按首个 `/` 拆回 provider + modelId（modelId 本身可能含 `/`，只拆首个）。
 * 无 `/` 时当作无 provider、整串作 modelId（交给 pi 自己解析）。
 */
function parsePiModelId(model: string): { provider: string; modelId: string } {
  const idx = model.indexOf('/');
  if (idx === -1) return { provider: '', modelId: model };
  return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) };
}

/**
 * Cindy UserMessage → pi prompt/steer command 的 message + images。
 * content 是 string 时直接用；是 block 数组时提取 text 拼接、image 收集。
 * UserContentBlock shape 以 common.ts 为准（text / image / mention 等）。
 */
interface PiImage {
  type: 'image';
  data: string;
  mimeType: string;
}

function userMessageToPrompt(message: UserMessage): {
  text: string;
  images: PiImage[];
} {
  const content = message.content;
  if (typeof content === 'string') {
    return { text: content, images: [] };
  }
  const parts: string[] = [];
  const images: PiImage[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (!block || typeof block !== 'object') continue;
    const t = block.type as string;
    if (t === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (t === 'image') {
      // pi ImageContent: { type:'image', data:base64, mimeType }
      if (typeof block.data === 'string') {
        images.push({
          type: 'image',
          data: block.data,
          mimeType: (block.mimeType as string) ?? 'image/png',
        });
      }
    } else if (t === 'mention' && typeof block.path === 'string') {
      // 提及文件/目录 → 文本路径（pi 自己用 read 工具读）
      parts.push(block.path as string);
    }
    // 其它 block 类型首版忽略（不丢已识别的 text/image/mention）
  }
  return { text: parts.join('\n'), images };
}

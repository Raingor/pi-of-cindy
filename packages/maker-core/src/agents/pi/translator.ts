/**
 * Pi translator — pi RPC events (stdout JSONL lines) → Cindy AgentEvent union。
 *
 * 映射依据：pi docs/rpc.md "Events" + "Extension UI Protocol"。
 *
 * 合规（maker-core-and-agent-behavior.md §3.3）：不吞事件、不错序、不错配
 * text / thinking / tool_use / tool_result。不识别的 event → log.warn 静默丢弃
 * （与 claude-code / codex translator 一致，见 types/events.ts 头部设计原则：
 * "vendor 不识别的 SDK message: translator 走 logger.warn 静默丢弃"），不 emit 给 UI。
 *
 * pi 自管 provider/model/usage → 本 translator 不拼 system prompt、不算 usage；
 * turn_end / agent_settled 收口 turn done，auto_retry_end 失败发 terminal error。
 *
 * 设计为纯映射：不持有 AsyncQueue，通过 ctx.emit 回调把 AgentEvent 推给调用方
 * （index.ts 持 queue）。这样 translator 可独立单测（喂合成 JSONL，断言 emit 序列）。
 */

import type {
  AgentErrorEventData,
  AgentEvent,
  InteractionDecision,
  InteractionRequest,
} from '../../types/events.js';

/** translator 跨事件维护的状态（防重复 emit，镜像 CodexRuntimeState 模式）。 */
export interface PiRuntimeState {
  /** toolCallId → 已 emit 过 tool_use start（避免 started + updated 重复）。 */
  emittedToolUseStart: Set<string>;
  /** 当前 turn 是否已 emit done（防 turn_end + agent_settled 双 done）。 */
  turnDoneEmitted: boolean;
  /** 当前 turn 是否在 retrying（agent_end 时据此决定是否发非终态 error）。 */
  retrying: boolean;
}

export function newPiRuntimeState(): PiRuntimeState {
  return {
    emittedToolUseStart: new Set(),
    turnDoneEmitted: false,
    retrying: false,
  };
}

/**
 * translator 上下文：调用方（index.ts）注入 emit / log / 交互往返。
 * 不直接依赖 AsyncQueue，保持 translator 可独立单测。
 */
export interface PiTranslateContext {
  /** 把映射出的 AgentEvent 推进 event 队列。 */
  emit: (event: AgentEvent) => void;
  /** 不识别的 event / 诊断 → 走 logger，不进 UI 流。 */
  log: (level: 'warn' | 'info' | 'debug', msg: string, data?: unknown) => void;
  /**
   * 收到 pi extension_ui_request（select/confirm/input/editor）后：
   * 1) 用 ctx.resolveInteraction(req) 拿 Cindy InteractionDecision
   * 2) 把 decision 翻译回 pi extension_ui_response
   * 3) 用 ctx.sendUiResponse(payload) 写回 pi stdin
   * translator 内 fire-and-forget 发起（不 await，不阻塞事件流）。
   * 二者任一缺失 → 退化为 log.warn（交互请求被静默丢，不卡住事件流）。
   */
  resolveInteraction?: (req: InteractionRequest) => Promise<InteractionDecision>;
  sendUiResponse?: (payload: Record<string, unknown>) => void;
}

const PI_SOURCE = 'pi' as const;

/** pi stdout 的一行 JSON → AgentEvent(s)。非 JSON / 缺 type → log.warn 静默丢。 */
export function translatePiLine(
  rawLine: string,
  rt: PiRuntimeState,
  ctx: PiTranslateContext,
): void {
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(rawLine) as Record<string, unknown>;
  } catch {
    ctx.log('warn', 'pi: non-JSON line on stdout, ignored', { line: rawLine });
    return;
  }
  if (!evt || typeof evt.type !== 'string') {
    ctx.log('warn', 'pi: line missing type, ignored', { line: rawLine });
    return;
  }
  translatePiEvent(evt, rt, ctx);
}

function emit(ctx: PiTranslateContext, event: AgentEvent): void {
  ctx.emit(event);
}

function translatePiEvent(
  evt: Record<string, unknown>,
  rt: PiRuntimeState,
  ctx: PiTranslateContext,
): void {
  const type = evt.type as string;
  const e = evt as Record<string, any>;

  switch (type) {
    // ── 消息流：message_update 带 assistantMessageEvent delta ──────────────
    case 'message_update': {
      const ame = e.assistantMessageEvent;
      if (!ame || typeof ame.type !== 'string') {
        ctx.log('debug', 'pi: message_update without assistantMessageEvent', e);
        break;
      }
      switch (ame.type) {
        case 'text_delta':
          emit(ctx, {
            type: 'text',
            data: { delta: ame.delta ?? '' },
            source: PI_SOURCE,
          });
          break;
        case 'thinking_delta':
          emit(ctx, {
            type: 'thinking',
            data: { delta: ame.delta ?? '' },
            source: PI_SOURCE,
          });
          break;
        case 'toolcall_start': {
          const tc = ame.toolCall ?? {};
          const id = tc.id ?? ame.id ?? `tc-${ame.contentIndex ?? 0}`;
          if (!rt.emittedToolUseStart.has(id)) {
            rt.emittedToolUseStart.add(id);
            emit(ctx, {
              type: 'tool_use',
              data: { id, name: tc.name ?? '', input: tc.arguments ?? {} },
              source: PI_SOURCE,
            });
          }
          break;
        }
        case 'toolcall_end':
          // tool_use 已在 toolcall_start emit；tool_result 由 tool_execution_end 承载。
          break;
        case 'done':
          // message 级 done：不直接 emit turn done（由 turn_end / agent_settled 收口）。
          break;
        case 'error':
          ctx.log('warn', 'pi: message-level error', { reason: ame.reason });
          break;
        default:
          ctx.log('debug', 'pi: unhandled assistantMessageEvent type', {
            type: ame.type,
          });
      }
      break;
    }

    // ── 工具执行（与 message_update toolcall_* 同 toolCallId；互补，防丢）────
    case 'tool_execution_start': {
      const id = e.toolCallId ?? e.id;
      if (id && !rt.emittedToolUseStart.has(id)) {
        rt.emittedToolUseStart.add(id);
        emit(ctx, {
          type: 'tool_use',
          data: { id, name: e.toolName ?? '', input: e.args ?? {} },
          source: PI_SOURCE,
        });
      }
      break;
    }
    case 'tool_execution_update': {
      const pr = e.partialResult;
      if (pr) {
        emit(ctx, {
          type: 'tool_result',
          data: { id: e.toolCallId ?? e.id ?? '', content: pr.content ?? [] },
          source: PI_SOURCE,
        });
      }
      break;
    }
    case 'tool_execution_end':
      emit(ctx, {
        type: 'tool_result_full',
        data: {
          id: e.toolCallId ?? e.id ?? '',
          content: e.result?.content ?? [],
          isError: e.isError === true,
        },
        source: PI_SOURCE,
      });
      break;

    // ── bash 直接命令输出（RPC `bash` 命令，非 LLM 工具调用）──────────────
    case 'bash_execution_update':
      emit(ctx, {
        type: 'text',
        data: { delta: e.delta ?? '' },
        source: PI_SOURCE,
      });
      break;

    // ── turn / agent 周期 ─────────────────────────────────────────────────
    case 'turn_start':
      rt.turnDoneEmitted = false;
      emit(ctx, { type: 'status', data: { isRunning: true }, source: PI_SOURCE });
      break;
    case 'turn_end':
    case 'agent_settled':
      // agent_settled 是 pi 的"彻底空闲"信号（无 retry/compaction/续跑），
      // 与 turn_end 一样作为 turn 终态收口；用 turnDoneEmitted 防双 done。
      if (!rt.turnDoneEmitted) {
        rt.turnDoneEmitted = true;
        rt.retrying = false;
        emit(ctx, {
          type: 'status',
          data: { isRunning: false },
          source: PI_SOURCE,
        });
        emit(ctx, { type: 'done', data: {}, source: PI_SOURCE });
      }
      break;
    case 'agent_start':
      emit(ctx, { type: 'status', data: { isRunning: true }, source: PI_SOURCE });
      break;
    case 'agent_end':
      // 单次 low-level run 完成；willRetry=true 时 pi 会自动续，不发终态 done。
      emit(ctx, { type: 'status', data: { isRunning: false }, source: PI_SOURCE });
      break;

    // ── compaction ───────────────────────────────────────────────────────
    case 'compaction_start':
      emit(ctx, {
        type: 'compact_boundary',
        data: { reason: e.reason ?? 'manual' },
        source: PI_SOURCE,
      });
      break;
    case 'compaction_end':
      emit(ctx, {
        type: 'status',
        data: { isCompacting: false },
        source: PI_SOURCE,
      });
      break;

    // ── 自动重试（瞬时错误）──────────────────────────────────────────────
    case 'auto_retry_start':
      rt.retrying = true;
      emit(ctx, {
        type: 'status',
        data: { isRunning: true, retrying: true, attempt: e.attempt },
        source: PI_SOURCE,
      });
      break;
    case 'auto_retry_end':
      if (e.success === false) {
        rt.retrying = false;
        const err: AgentErrorEventData = {
          message: e.finalError ?? 'pi auto-retry exhausted',
          isTerminal: true,
          willRetry: false,
        };
        emit(ctx, { type: 'error', data: err, source: PI_SOURCE });
      }
      break;

    // ── extension UI 请求 → interaction_request ─────────────────────────
    case 'extension_ui_request': {
      handleExtensionUiRequest(e, ctx);
      break;
    }

    // ── 队列 / extension_error / 其它：静默丢（不进 UI，走 log）──────────
    case 'queue_update':
      // steer/followUp 队列变化，UI 不消费；静默。
      break;
    case 'extension_error':
      ctx.log('warn', 'pi: extension error', {
        extensionPath: e.extensionPath,
        event: e.event,
        error: e.error,
      });
      break;

    // response（命令回执）由 index.ts 在 writeLine 路径单独 await，不经 translator。
    case 'response':
      break;

    default:
      ctx.log('warn', 'pi: unhandled event type, ignored', { type });
  }
}

/**
 * pi extension_ui_request（select/confirm/input/editor）→ Cindy interaction_request
 * (ask_user_question)，异步 resolve 后翻译回 pi extension_ui_response 写 stdin。
 * notify/setStatus 等_fire-and-forget_ 方法不期望响应，走 log 不进交互流。
 */
function handleExtensionUiRequest(
  e: Record<string, any>,
  ctx: PiTranslateContext,
): void {
  const id = e.id;
  const method = e.method;
  if (typeof id !== 'string' || typeof method !== 'string') {
    ctx.log('warn', 'pi: extension_ui_request missing id/method', e);
    return;
  }

  // fire-and-forget 方法（不期望响应）：仅 log，不弹交互。
  switch (method) {
    case 'notify':
    case 'setStatus':
    case 'setWidget':
    case 'setTitle':
    case 'set_editor_text':
      ctx.log('debug', `pi: extension ui ${method} (fire-and-forget)`, {
        id,
        title: e.title,
        message: e.message,
      });
      return;
  }

  // dialog 方法：映射成 ask_user_question。
  if (!ctx.resolveInteraction || !ctx.sendUiResponse) {
    ctx.log('warn', 'pi: dialog request but no resolver/sender wired; cannot prompt', {
      id,
      method,
    });
    return;
  }

  const question = e.title ?? method;
  const req: InteractionRequest = {
    kind: 'ask_user_question',
    requestId: id,
    questions: [
      {
        question,
        // select 把 options 作为可选项；confirm/input/editor 不给 options（自由文本）。
        ...(method === 'select' && Array.isArray(e.options)
          ? {
              options: (e.options as string[]).map((label) => ({
                label,
                description: undefined,
              })),
            }
          : {}),
      },
    ],
  };

  // fire-and-forget：不 await，不阻塞事件流；resolve 后回写 pi stdin。
  void ctx
    .resolveInteraction(req)
    .then((decision) => {
      const payload = decisionToPiUiResponse(decision, method, id);
      ctx.sendUiResponse?.(payload);
    })
    .catch((err) => {
      ctx.log('warn', 'pi: interaction resolve failed; cancelling', {
        id,
        error: String(err),
      });
      ctx.sendUiResponse?.({ type: 'extension_ui_response', id, cancelled: true });
    });
}

/** Cindy InteractionDecision → pi extension_ui_response payload（按 method 还原）。 */
function decisionToPiUiResponse(
  decision: InteractionDecision,
  method: string,
  id: string,
): Record<string, unknown> {
  if (decision.kind !== 'ask_user_question') {
    // pi 的 dialog 只映射成 ask_user_question；其它 decision kind 视为 cancel。
    return { type: 'extension_ui_response', id, cancelled: true };
  }
  // answers 的 key 是 question 文本；取第一个 answer。
  const answers = decision.answers ?? {};
  const first = answers[Object.keys(answers)[0] ?? ''] ?? '';

  switch (method) {
    case 'confirm':
      return {
        type: 'extension_ui_response',
        id,
        confirmed: first === 'true' || first === 'yes' || first === '允许' || first === '是',
      };
    case 'select':
    case 'input':
    case 'editor':
      return { type: 'extension_ui_response', id, value: first };
    default:
      return { type: 'extension_ui_response', id, cancelled: true };
  }
}

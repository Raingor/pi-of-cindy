/**
 * Pi translator - 喂合成 pi RPC event JSONL，断言 emit 的 AgentEvent 序列。
 *
 * 覆盖 maker-core-and-agent-behavior.md §3.3 核心不变量：
 *  - text / thinking / tool_use / tool_result_full 正确映射、不错配
 *  - turn_end + agent_settled 去重，只 emit 一次 done
 *  - toolcall_start 与 tool_execution_start 同 toolCallId 不重复 emit tool_use
 *  - auto_retry_end 失败 -> 终态 error(isTerminal:true)
 *  - extension_ui_request(select) -> interaction_request(ask_user_question)，
 *    resolve 后回写 extension_ui_response
 *  - 非 JSON / 缺 type / 未识别 type -> 静默丢（不进 UI 流）
 *
 * translator 是纯映射 + ctx.emit 同步回调，故用数组收集即可；
 * interaction 路径 fire-and-forget 异步，单独 await 微任务断言。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  newPiRuntimeState,
  translatePiLine,
  type PiRuntimeState,
  type PiTranslateContext,
} from './translator.js';
import type { AgentEvent } from '../../types/events.js';

function makeCtx(
  events: AgentEvent[],
  overrides: Partial<PiTranslateContext> = {},
): PiTranslateContext {
  return {
    emit: (e) => events.push(e),
    log: () => undefined,
    ...overrides,
  };
}

function feed(lines: string[], rt: PiRuntimeState, ctx: PiTranslateContext): void {
  for (const line of lines) translatePiLine(line, rt, ctx);
}

describe('translatePiLine - message stream', () => {
  it('maps text_delta -> text event with source=pi', () => {
    const events: AgentEvent[] = [];
    const rt = newPiRuntimeState();
    feed(
      [
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Hello', contentIndex: 0 },
        }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: ' world', contentIndex: 0 },
        }),
      ],
      rt,
      makeCtx(events),
    );
    expect(events).toEqual([
      { type: 'text', data: { delta: 'Hello' }, source: 'pi' },
      { type: 'text', data: { delta: ' world' }, source: 'pi' },
    ]);
  });

  it('maps thinking_delta -> thinking event', () => {
    const events: AgentEvent[] = [];
    feed(
      [
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm', contentIndex: 0 },
        }),
      ],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toEqual([{ type: 'thinking', data: { delta: 'hmm' }, source: 'pi' }]);
  });

  it('coalesces empty/missing delta to empty string (no undefined in data)', () => {
    const events: AgentEvent[] = [];
    feed(
      [
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0 },
        }),
      ],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toEqual([{ type: 'text', data: { delta: '' }, source: 'pi' }]);
  });
});

describe('translatePiLine - tool calls', () => {
  it('maps toolcall_start -> tool_use, dedups against tool_execution_start (same toolCallId)', () => {
    const events: AgentEvent[] = [];
    const rt = newPiRuntimeState();
    feed(
      [
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            toolCall: { id: 'tc1', name: 'read_file', arguments: { path: '/a' } },
            contentIndex: 0,
          },
        }),
        // tool_execution_start 同一 toolCallId -> 不应再 emit 第二条 tool_use
        JSON.stringify({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'read_file' }),
        // tool_execution_end -> tool_result_full
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'tc1',
          result: { content: [{ type: 'text', text: 'ok' }] },
          isError: false,
        }),
      ],
      rt,
      makeCtx(events),
    );
    expect(events).toEqual([
      {
        type: 'tool_use',
        data: { id: 'tc1', name: 'read_file', input: { path: '/a' } },
        source: 'pi',
      },
      {
        type: 'tool_result_full',
        data: {
          id: 'tc1',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        },
        source: 'pi',
      },
    ]);
  });

  it('emits tool_use from tool_execution_start when no preceding toolcall_start', () => {
    const events: AgentEvent[] = [];
    feed(
      [JSON.stringify({ type: 'tool_execution_start', id: 'tc9', toolName: 'bash', args: {} })],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toEqual([
      { type: 'tool_use', data: { id: 'tc9', name: 'bash', input: {} }, source: 'pi' },
    ]);
  });

  it('maps tool_execution_update partial -> tool_result', () => {
    const events: AgentEvent[] = [];
    feed(
      [
        JSON.stringify({
          type: 'tool_execution_update',
          toolCallId: 'tc2',
          partialResult: { content: [{ type: 'text', text: 'partial' }] },
        }),
      ],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toEqual([
      {
        type: 'tool_result',
        data: { id: 'tc2', content: [{ type: 'text', text: 'partial' }] },
        source: 'pi',
      },
    ]);
  });
});

describe('translatePiLine - turn lifecycle & dedup', () => {
  it('emits status(isRunning:false) + done once even with both turn_end and agent_settled', () => {
    const events: AgentEvent[] = [];
    feed(
      [
        JSON.stringify({ type: 'turn_start' }),
        JSON.stringify({ type: 'turn_end' }),
        // agent_settled 紧随 -> 不应再发第二份 done
        JSON.stringify({ type: 'agent_settled' }),
      ],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toEqual([
      { type: 'status', data: { isRunning: true }, source: 'pi' },
      { type: 'status', data: { isRunning: false }, source: 'pi' },
      { type: 'done', data: {}, source: 'pi' },
    ]);
  });

  it('resets turnDoneEmitted on next turn_start (second turn can emit done again)', () => {
    const events: AgentEvent[] = [];
    feed(
      [
        JSON.stringify({ type: 'turn_start' }),
        JSON.stringify({ type: 'turn_end' }),
        JSON.stringify({ type: 'turn_start' }),
        JSON.stringify({ type: 'turn_end' }),
      ],
      newPiRuntimeState(),
      makeCtx(events),
    );
    const doneCount = events.filter((e) => e.type === 'done').length;
    expect(doneCount).toBe(2);
  });
});

describe('translatePiLine - retry / compaction', () => {
  it('auto_retry_end with success:false -> terminal error', () => {
    const events: AgentEvent[] = [];
    feed(
      [
        JSON.stringify({ type: 'auto_retry_start', attempt: 1 }),
        JSON.stringify({ type: 'auto_retry_end', success: false, finalError: 'boom' }),
      ],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toContainEqual({
      type: 'error',
      data: { message: 'boom', isTerminal: true, willRetry: false },
      source: 'pi',
    });
  });

  it('auto_retry_end with success:true -> no error event', () => {
    const events: AgentEvent[] = [];
    feed(
      [JSON.stringify({ type: 'auto_retry_end', success: true })],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('compaction_start -> compact_boundary', () => {
    const events: AgentEvent[] = [];
    feed(
      [JSON.stringify({ type: 'compaction_start', reason: 'auto' })],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toEqual([
      { type: 'compact_boundary', data: { reason: 'auto' }, source: 'pi' },
    ]);
  });
});

describe('translatePiLine - extension_ui interaction', () => {
  it('select request -> interaction_request(ask_user_question), then writes back response', async () => {
    const events: AgentEvent[] = [];
    const sent: Record<string, unknown>[] = [];
    const ctx = makeCtx(events, {
      resolveInteraction: async () => ({
        kind: 'ask_user_question',
        answers: { 'Pick one': 'B' },
      }),
      sendUiResponse: (payload) => sent.push(payload),
    });
    feed(
      [
        JSON.stringify({
          type: 'extension_ui_request',
          id: 'ui1',
          method: 'select',
          title: 'Pick one',
          options: ['A', 'B', 'C'],
        }),
      ],
      newPiRuntimeState(),
      ctx,
    );

    // interaction_request emitted synchronously? No: translator fire-and-forget
    // resolves async, but the emit happens inside .then -> need microtask flush.
    // The interaction_request itself is NOT emitted to the event stream; only the
    // resolver is invoked and the response written back.
    expect(events.filter((e) => e.type === 'interaction_request')).toHaveLength(0);
    // flush the fire-and-forget promise chain
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([
      { type: 'extension_ui_response', id: 'ui1', value: 'B' },
    ]);
  });

  it('confirm request maps "是" / "允许" / "yes" -> confirmed:true', async () => {
    for (const answer of ['是', '允许', 'yes', 'true']) {
      const sent: Record<string, unknown>[] = [];
      const ctx = makeCtx([], {
        resolveInteraction: async () => ({
          kind: 'ask_user_question',
          answers: { 'Allow?': answer },
        }),
        sendUiResponse: (p) => sent.push(p),
      });
      feed(
        [
          JSON.stringify({
            type: 'extension_ui_request',
            id: 'ui2',
            method: 'confirm',
            title: 'Allow?',
          }),
        ],
        newPiRuntimeState(),
        ctx,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(sent[0]).toEqual({ type: 'extension_ui_response', id: 'ui2', confirmed: true });
    }
  });

  it('fire-and-forget methods (notify/setStatus) do not invoke resolver', async () => {
    const resolveInteraction = vi.fn();
    const sent: Record<string, unknown>[] = [];
    const ctx = makeCtx([], {
      resolveInteraction: resolveInteraction as unknown as PiTranslateContext['resolveInteraction'],
      sendUiResponse: (p) => sent.push(p),
    });
    feed(
      [
        JSON.stringify({ type: 'extension_ui_request', id: 'n1', method: 'notify', message: 'hi' }),
        JSON.stringify({ type: 'extension_ui_request', id: 's1', method: 'setStatus' }),
      ],
      newPiRuntimeState(),
      ctx,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveInteraction).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('dialog without resolver/sender -> log.warn, no throw, no emit', () => {
    const events: AgentEvent[] = [];
    const warned: string[] = [];
    const ctx: PiTranslateContext = {
      emit: (e) => events.push(e),
      log: (level, msg) => level === 'warn' && warned.push(msg),
    };
    expect(() =>
      feed(
        [JSON.stringify({ type: 'extension_ui_request', id: 'x', method: 'input', title: 'q' })],
        newPiRuntimeState(),
        ctx,
      ),
    ).not.toThrow();
    expect(events).toHaveLength(0);
    expect(warned.some((m) => m.includes('no resolver'))).toBe(true);
  });
});

describe('translatePiLine - silent drops', () => {
  it('non-JSON line is ignored (no emit)', () => {
    const events: AgentEvent[] = [];
    feed(['not-json{', '', '   '], newPiRuntimeState(), makeCtx(events));
    expect(events).toHaveLength(0);
  });

  it('line missing type is ignored', () => {
    const events: AgentEvent[] = [];
    feed([JSON.stringify({ foo: 'bar' })], newPiRuntimeState(), makeCtx(events));
    expect(events).toHaveLength(0);
  });

  it('unhandled event type is ignored', () => {
    const events: AgentEvent[] = [];
    feed([JSON.stringify({ type: 'queue_update' })], newPiRuntimeState(), makeCtx(events));
    expect(events).toHaveLength(0);
  });

  it('response (command ack) is not emitted', () => {
    const events: AgentEvent[] = [];
    feed(
      [JSON.stringify({ type: 'response', command: 'prompt', success: true })],
      newPiRuntimeState(),
      makeCtx(events),
    );
    expect(events).toHaveLength(0);
  });
});

/**
 * pi 本地会话导入的纯逻辑。
 *
 * 锁住 parsePiMessageLine 对 pi JSONL 行为的映射:user 文本 / assistant
 * text+thinking+toolCall 三段 / toolResult 文本,以及非 message 行
 * (session / model_change / thinking_level_change)一律忽略。
 * 消息行的 role 与 content 形状必须与 claude 导入路径一致 —— 两者共用
 * 同一 tx op('pi.importMessages' → claudeImportMessages),渲染层无差别消费。
 */

import { describe, expect, it } from 'vitest';

import { parsePiMessageLine } from '../pi-local-sessions.js';

describe('parsePiMessageLine (pi JSONL → imported rows)', () => {
  const FALLBACK = 'openai-codex/gpt-5.6-terra';

  it('maps a user text message to a single user row', () => {
    const rows = parsePiMessageLine(
      JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: null,
        timestamp: '2026-08-31T07:39:48.402Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '读取zcode的会话历史' }],
          timestamp: 1788161988027,
        },
      }),
      1,
      FALLBACK,
    );
    expect(rows).toEqual([
      {
        lineNo: 1,
        partIndex: 0,
        role: 'user',
        content: '读取zcode的会话历史',
        toolUseId: null,
        agentMeta: null,
        createdAt: expect.any(Number),
      },
    ]);
  });

  it('maps assistant content parts: thinking + toolCall + text in order', () => {
    const rows = parsePiMessageLine(
      JSON.stringify({
        type: 'message',
        id: 'a1',
        parentId: 'm1',
        timestamp: '2026-08-31T07:40:02.663Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I need to locate the file.' },
            {
              type: 'toolCall',
              id: 'toolu_01',
              name: 'ctx_batch_execute',
              arguments: { commands: [] },
            },
            { type: 'text', text: 'Found it.' },
          ],
        },
      }),
      2,
      FALLBACK,
    );
    expect(rows.map((r) => [r.role, r.partIndex])).toEqual([
      ['thinking', 0],
      ['tool_use', 1],
      ['assistant', 2],
    ]);
    expect(rows[0]?.content).toEqual({
      text: 'I need to locate the file.',
      durationMs: 0,
      isRedacted: false,
    });
    expect(rows[1]?.content).toMatchObject({
      toolUseId: 'toolu_01',
      toolName: 'ctx_batch_execute',
    });
    expect(rows[1]?.toolUseId).toBe('toolu_01');
    expect(rows[2]?.content).toBe('Found it.');
    // assistant 行带 model meta(渲染层模型徽标数据源)。
    expect(rows[2]?.agentMeta).toEqual({ model: FALLBACK });
  });

  it('maps a toolResult message to a tool_result row with the tool call id', () => {
    const rows = parsePiMessageLine(
      JSON.stringify({
        type: 'message',
        id: 't1',
        parentId: 'a1',
        timestamp: '2026-08-31T07:40:18.389Z',
        message: {
          role: 'toolResult',
          toolCallId: 'toolu_01',
          toolName: 'ctx_batch_execute',
          content: [{ type: 'text', text: 'Executed 3 commands.' }],
        },
      }),
      3,
      FALLBACK,
    );
    expect(rows).toEqual([
      {
        lineNo: 3,
        partIndex: 0,
        role: 'tool_result',
        content: 'Executed 3 commands.',
        toolUseId: 'toolu_01',
        agentMeta: null,
        createdAt: expect.any(Number),
      },
    ]);
  });

  it('ignores non-message lines (session / model_change / thinking_level_change)', () => {
    for (const line of [
      JSON.stringify({ type: 'session', version: 3, id: 's1', cwd: '/tmp', timestamp: '2026-08-31T07:38:59.815Z' }),
      JSON.stringify({ type: 'model_change', provider: 'openai-codex', modelId: 'gpt-5.6-terra' }),
      JSON.stringify({ type: 'thinking_level_change', thinkingLevel: 'medium' }),
      'not-json',
    ]) {
      expect(parsePiMessageLine(line, 9, FALLBACK)).toEqual([]);
    }
  });

  it('drops user messages without usable text (image-only parts)', () => {
    const rows = parsePiMessageLine(
      JSON.stringify({
        type: 'message',
        timestamp: '2026-08-31T08:00:00.000Z',
        message: { role: 'user', content: [{ type: 'image', mimeType: 'image/png' }] },
      }),
      4,
      FALLBACK,
    );
    expect(rows).toEqual([]);
  });
});

/**
 * sessionRuntimeIds 的口径锁。
 *
 * 锁两件事:
 *   1. pi 的 `sdk_session_id`(session JSONL 绝对路径)→ pi 运行时 session id
 *      的切法。文件名是 `${时间戳}_${sessionId}.jsonl`,**只按第一个 `_` 切**——
 *      pi-web-switch 建的会话 id 形如 `web-421d852f-...`,按 uuid 正则匹配会漏。
 *   2. Intercom ID 只对 `agentKind === 'pi'` 成立;claude / codex 的
 *      `sdk_session_id` 是另一套身份,不能当 intercom id 展示。
 */

import { describe, expect, it } from 'vitest';

import {
  piSessionIdFromSdkSessionId,
  resolveSessionRuntimeIds,
  shortRuntimeId,
} from '../sessionRuntimeIds';

describe('piSessionIdFromSdkSessionId', () => {
  it('extracts the pi session id from an absolute session file path', () => {
    expect(
      piSessionIdFromSdkSessionId(
        '/Users/me/.pi/agent/sessions/--Users-me-proj--/2026-09-02T01-41-08-371Z_01a05fc6-f093-79a5-9cb2-77bbd1489d19.jsonl',
      ),
    ).toBe('01a05fc6-f093-79a5-9cb2-77bbd1489d19');
  });

  it('keeps non-uuid session ids intact (pi-web-switch style `web-<uuid>`)', () => {
    expect(
      piSessionIdFromSdkSessionId(
        '/Users/me/.pi/agent/sessions/--x--/2026-09-01T06-14-12-440Z_web-421d852f-e037-4df0-8e43-c39f9c31fa6e.jsonl',
      ),
    ).toBe('web-421d852f-e037-4df0-8e43-c39f9c31fa6e');
  });

  it('handles Windows separators', () => {
    expect(
      piSessionIdFromSdkSessionId('C:\\Users\\me\\.pi\\agent\\sessions\\2026-09-02T01-41-08-371Z_abc123.jsonl'),
    ).toBe('abc123');
  });

  it('accepts a bare session id (pi could not report sessionFile)', () => {
    expect(piSessionIdFromSdkSessionId('01a05fc6-f093-79a5-9cb2-77bbd1489d19')).toBe(
      '01a05fc6-f093-79a5-9cb2-77bbd1489d19',
    );
  });

  it('returns null for empty / missing input', () => {
    expect(piSessionIdFromSdkSessionId(null)).toBeNull();
    expect(piSessionIdFromSdkSessionId(undefined)).toBeNull();
    expect(piSessionIdFromSdkSessionId('   ')).toBeNull();
  });
});

describe('resolveSessionRuntimeIds', () => {
  const piSdkId =
    '/Users/me/.pi/agent/sessions/--x--/2026-09-02T01-41-08-371Z_01a05fc6-f093-79a5-9cb2-77bbd1489d19.jsonl';

  it('reports both ids for a pi session', () => {
    expect(
      resolveSessionRuntimeIds({ sessionId: 'task-1', agentKind: 'pi', sdkSessionId: piSdkId }),
    ).toEqual({ sessionId: 'task-1', intercomId: '01a05fc6-f093-79a5-9cb2-77bbd1489d19' });
  });

  it('omits the intercom id for non-pi agents even when a sdk id exists', () => {
    for (const agentKind of ['cc', 'codex'] as const) {
      expect(
        resolveSessionRuntimeIds({ sessionId: 'task-1', agentKind, sdkSessionId: piSdkId }),
      ).toEqual({ sessionId: 'task-1', intercomId: null });
    }
  });

  it('omits the intercom id when the pi session has never started (no sdk id yet)', () => {
    expect(
      resolveSessionRuntimeIds({ sessionId: 'task-1', agentKind: 'pi', sdkSessionId: null }),
    ).toEqual({ sessionId: 'task-1', intercomId: null });
  });

  it('returns null while the session row is still loading', () => {
    expect(
      resolveSessionRuntimeIds({ sessionId: null, agentKind: 'pi', sdkSessionId: piSdkId }),
    ).toBeNull();
  });
});

describe('shortRuntimeId', () => {
  it('matches the 8-char form used by `intercom list`', () => {
    expect(shortRuntimeId('01a05fc6-f093-79a5-9cb2-77bbd1489d19')).toBe('01a05fc6');
  });

  it('leaves short ids untouched', () => {
    expect(shortRuntimeId('abc123')).toBe('abc123');
  });
});

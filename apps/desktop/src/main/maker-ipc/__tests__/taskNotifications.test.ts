import { describe, expect, it } from 'vitest';

import { parseTaskNotificationSource } from '../taskNotifications';

function contentWithSessionReference(overrides?: Record<string, unknown>): string {
  const href = 'cindy://session/target-session';
  const text = `${href} 请检查构建结果`;
  return JSON.stringify({
    text,
    quotesEncoded: false,
    agentReferences: [
      {
        kind: 'session',
        sessionId: 'target-session',
        title: '目标任务',
        href,
        start: 0,
        end: href.length,
        ...overrides,
      },
    ],
  });
}

describe('parseTaskNotificationSource', () => {
  it('extracts validated task mentions and removes the mention from notification body', () => {
    expect(parseTaskNotificationSource(contentWithSessionReference())).toEqual({
      body: '请检查构建结果',
      targetReferences: [
        expect.objectContaining({
          kind: 'session',
          sessionId: 'target-session',
          title: '目标任务',
          href: 'cindy://session/target-session',
        }),
      ],
    });
  });

  it('rejects forged reference spans that do not match persisted text', () => {
    expect(parseTaskNotificationSource(contentWithSessionReference({ start: 2 }))).toBeNull();
  });

  it('ignores non-session references', () => {
    expect(parseTaskNotificationSource(contentWithSessionReference({ kind: 'file' }))).toBeNull();
  });
});

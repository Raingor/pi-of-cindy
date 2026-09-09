import { describe, expect, it } from 'vitest';

import { findLatestTurnUsageDetails } from '../sessionUsageStats';

describe('findLatestTurnUsageDetails', () => {
  it('uses the latest assistant message with completed turn usage', () => {
    const first = {
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      totalTokens: 150,
      cacheHitRate: 0,
    };
    const latest = {
      inputTokens: 400,
      outputTokens: 50,
      cacheReadTokens: 600,
      cacheCreateTokens: 0,
      totalTokens: 1050,
      cacheHitRate: 0.6,
    };

    expect(
      findLatestTurnUsageDetails([
        { role: 'assistant', turnUsageDetails: first },
        { role: 'user', turnUsageDetails: undefined },
        { role: 'assistant', turnUsageDetails: latest },
      ]),
    ).toBe(latest);
  });

  it('returns null when the task has no completed turn usage', () => {
    expect(
      findLatestTurnUsageDetails([
        { role: 'user', turnUsageDetails: undefined },
        { role: 'assistant', turnUsageDetails: undefined },
      ]),
    ).toBeNull();
  });
});

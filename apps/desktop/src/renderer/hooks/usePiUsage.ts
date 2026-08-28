import { useCallback, useEffect, useState } from 'react';

import type { PiUsageByRangeResult } from '@/../main/pi-agent/piTypes';

type RangeKey = 'today' | '7d' | '30d' | 'custom';

function cnTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftDate(days: number): string {
  const [y, m, d] = cnTodayStr().split('-').map(Number);
  const t = Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - days);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function getRangeDates(range: RangeKey, customFrom: string, customTo: string): { from: string; to: string } {
  const today = cnTodayStr();
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: shiftDate(6), to: today };
    case '30d':
      return { from: shiftDate(29), to: today };
    case 'custom':
      return { from: customFrom || today, to: customTo || today };
  }
}

function getPrevRangeDates(range: RangeKey): { from: string; to: string } | null {
  switch (range) {
    case 'today':
      return { from: shiftDate(1), to: shiftDate(1) };
    case '7d':
      return { from: shiftDate(13), to: shiftDate(7) };
    case '30d':
      return { from: shiftDate(59), to: shiftDate(30) };
    default:
      return null;
  }
}

interface UsePiUsageResult {
  data: PiUsageByRangeResult | null;
  prevData: PiUsageByRangeResult | null;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: string | null;
  error: string | null;
  refresh: (force?: boolean) => void;
}

export function usePiUsage(
  range: RangeKey,
  customFrom: string,
  customTo: string,
  autoRefresh: boolean,
  refreshInterval: number,
): UsePiUsageResult {
  const [data, setData] = useState<PiUsageByRangeResult | null>(null);
  const [prevData, setPrevData] = useState<PiUsageByRangeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;

    const dates = getRangeDates(range, customFrom, customTo);
    setRefreshing(true);
    setError(null);

    api
      .usageByRange(dates.from, dates.to)
      .then((result: unknown) => {
        setData(result as PiUsageByRangeResult);
        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        setRefreshing(false);
      });

    const prev = getPrevRangeDates(range);
    if (prev) {
      api
        .usageByRange(prev.from, prev.to)
        .then((result: unknown) => setPrevData(result as PiUsageByRangeResult))
        .catch(() => setPrevData(null));
    } else {
      setPrevData(null);
    }
  }, [range, customFrom, customTo]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh || refreshInterval <= 0) return;
    const id = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchData]);

  return { data, prevData, loading, refreshing, lastUpdated, error, refresh: fetchData };
}

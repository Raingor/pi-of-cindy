import { useCallback, useEffect, useState } from 'react';

import type { PiSubagentsData } from '@/../main/pi-agent/piTypes';

interface UsePiSubagentsResult {
  data: PiSubagentsData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  updateAgent: (
    fileName: string,
    patch: { model?: string; thinking?: string },
  ) => Promise<boolean>;
}

export function usePiSubagents(): UsePiSubagentsResult {
  const [data, setData] = useState<PiSubagentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;

    setLoading(true);
    setError(null);

    api
      .readSubagents()
      .then((result) => {
        setData(result as PiSubagentsData);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  const updateAgent = useCallback(
    async (
      fileName: string,
      patch: { model?: string; thinking?: string },
    ): Promise<boolean> => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api) return false;

      try {
        await api.updateAgent(fileName, patch);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
    updateAgent,
  };
}

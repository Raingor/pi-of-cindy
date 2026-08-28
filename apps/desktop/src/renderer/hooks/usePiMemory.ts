import { useCallback, useEffect, useState } from 'react';

import type {
  PiMemoryFile,
  PiHermesMemoryConfig,
  PiMemoryStatus,
  PiOptimizeMemoryResult,
} from '@/../main/pi-agent/piTypes';

interface UsePiMemoryResult {
  files: PiMemoryFile[];
  config: PiHermesMemoryConfig | null;
  status: PiMemoryStatus | null;
  loading: boolean;
  error: string | null;
  optimizing: boolean;
  optimizeResult: PiOptimizeMemoryResult | null;
  refresh: () => void;
  deleteEntry: (filename: string, entryText: string) => Promise<boolean>;
  saveConfig: (config: PiHermesMemoryConfig) => Promise<boolean>;
  optimize: () => Promise<void>;
}

export function usePiMemory(): UsePiMemoryResult {
  const [files, setFiles] = useState<PiMemoryFile[]>([]);
  const [config, setConfig] = useState<PiHermesMemoryConfig | null>(null);
  const [status, setStatus] = useState<PiMemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<PiOptimizeMemoryResult | null>(null);

  const fetchData = useCallback(() => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;

    setLoading(true);
    setError(null);

    Promise.all([
      api.readMemory(),
      api.readMemoryConfig(),
      api.readMemoryStatus(),
    ])
      .then(([memResult, cfgResult, statResult]) => {
        const mem = memResult as PiMemoryFile[] | { files: PiMemoryFile[] };
        if (Array.isArray(mem)) {
          setFiles(mem);
        } else if (mem && typeof mem === 'object' && 'files' in mem) {
          setFiles(mem.files);
        } else {
          setFiles([]);
        }
        setConfig(cfgResult as PiHermesMemoryConfig);
        setStatus(statResult as PiMemoryStatus);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  const deleteEntry = useCallback(async (filename: string, entryText: string): Promise<boolean> => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return false;
    try {
      await api.deleteMemoryEntry(filename, entryText);
      fetchData();
      return true;
    } catch {
      return false;
    }
  }, [fetchData]);

  const saveConfig = useCallback(async (cfg: PiHermesMemoryConfig): Promise<boolean> => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return false;
    try {
      await api.writeMemoryConfig(cfg);
      setConfig(cfg);
      return true;
    } catch {
      return false;
    }
  }, []);

  const optimize = useCallback(async () => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;
    setOptimizing(true);
    setOptimizeResult(null);
    try {
      const result = await api.optimizeMemory() as PiOptimizeMemoryResult;
      setOptimizeResult(result);
      fetchData();
    } catch {
      // ignore
    } finally {
      setOptimizing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    files,
    config,
    status,
    loading,
    error,
    optimizing,
    optimizeResult,
    refresh: fetchData,
    deleteEntry,
    saveConfig,
    optimize,
  };
}

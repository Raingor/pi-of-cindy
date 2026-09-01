import { useCallback, useRef, useState } from 'react';

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
}

interface FetchedModel {
  id: string;
  name?: string;
}

interface ModelResult {
  status: 'idle' | 'testing' | 'done';
  runs: number;
  success: number;
  latencies: number[];
  lastMessage?: string;
}

const RUNS_PER_MODEL = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Pi 测速面板数据层 —— 全部走「只传 providerId」的 pi-cli 通道
 * (listCliProviders / fetchCliProviderModels / testCliModel)。
 * 供应商清单来自本机 ~/.pi/agent 的剥密视图;真 key 全程留在主进程。
 */
export function usePiSpeedTest() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<FetchedModel[]>([]);
  const [results, setResults] = useState<Map<string, ModelResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const loadProviders = useCallback(async () => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api?.listCliProviders) return;

    try {
      const snapshot = await api.listCliProviders();
      if (!snapshot.installed || snapshot.error) {
        setProviders([]);
        return;
      }
      const list: ProviderInfo[] = snapshot.providers
        .filter((p) => p.hasApiKey && (p.baseUrl ?? '').trim() !== '')
        .map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl ?? '',
        }));
      setProviders(list);
    } catch {
      setProviders([]);
    }
  }, []);

  const fetchModelsForProvider = useCallback(
    async (provider: ProviderInfo) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api?.fetchCliProviderModels) return;

      setFetching(true);
      setFetchError(null);
      setModels([]);
      setResults(new Map());

      try {
        const result = await api.fetchCliProviderModels(provider.id);
        if (result.error) {
          setFetchError(result.error);
          setModels([]);
          return;
        }
        setModels(result.models);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        setFetching(false);
      }
    },
    [],
  );

  const setResult = useCallback(
    (modelId: string, patch: Partial<ModelResult>) => {
      setResults((prev) => {
        const next = new Map(prev);
        const cur = next.get(modelId) ?? { status: 'idle', runs: 0, success: 0, latencies: [] };
        next.set(modelId, { ...cur, ...patch });
        return next;
      });
    },
    [],
  );

  const testOneModel = useCallback(
    async (provider: ProviderInfo, model: FetchedModel) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api?.testCliModel) return;

      setResults((prev) => {
        const next = new Map(prev);
        next.set(model.id, { status: 'testing', runs: 0, success: 0, latencies: [] });
        return next;
      });

      let success = 0;
      const latencies: number[] = [];
      let lastMessage: string | undefined;

      for (let i = 0; i < RUNS_PER_MODEL; i++) {
        if (abortRef.current) return;
        if (i > 0) await sleep(600);

        try {
          const data = await api.testCliModel(provider.id, model.id);

          if (data.success) {
            success++;
            if (typeof data.latencyMs === 'number') latencies.push(data.latencyMs);
          } else {
            lastMessage = data.message;
          }
        } catch {
          lastMessage = 'network error';
        }

        setResult(model.id, {
          status: 'testing',
          runs: i + 1,
          success,
          latencies,
          lastMessage,
        });
      }

      setResult(model.id, {
        status: 'done',
        runs: RUNS_PER_MODEL,
        success,
        latencies,
        lastMessage,
      });
    },
    [setResult],
  );

  const runAll = useCallback(
    async (provider: ProviderInfo, modelList: FetchedModel[]) => {
      if (running || modelList.length === 0) return;
      setRunning(true);
      abortRef.current = false;
      setResults(new Map());

      try {
        for (let i = 0; i < modelList.length; i++) {
          if (abortRef.current) break;
          if (i > 0) await sleep(800);
          const model = modelList[i];
          if (model) await testOneModel(provider, model);
        }
      } finally {
        setRunning(false);
      }
    },
    [running, testOneModel],
  );

  const cancel = useCallback(() => {
    abortRef.current = true;
  }, []);

  const resetResults = useCallback(() => {
    if (running) return;
    setResults(new Map());
  }, [running]);

  return {
    providers,
    models,
    results,
    running,
    fetching,
    fetchError,
    loadProviders,
    fetchModelsForProvider,
    runAll,
    cancel,
    resetResults,
    avg,
    RUNS_PER_MODEL,
  };
}

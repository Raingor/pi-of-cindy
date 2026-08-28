import { useCallback, useRef, useState } from 'react';

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
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
    if (!api) return;

    try {
      const settings = (await api.readSettings()) as {
        customProviders?: Record<string, { name?: string; baseUrl?: string; apiKey?: string }>;
      };
      const entries = Object.entries(settings?.customProviders ?? {});
      const list: ProviderInfo[] = entries
        .filter(([, v]) => (v.baseUrl ?? '').trim() !== '')
        .map(([id, v]) => ({
          id,
          name: v.name ?? id,
          baseUrl: v.baseUrl ?? '',
          apiKey: v.apiKey,
        }));
      setProviders(list);
    } catch {
      setProviders([]);
    }
  }, []);

  const fetchModelsForProvider = useCallback(
    async (provider: ProviderInfo) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api) return;

      setFetching(true);
      setFetchError(null);
      setModels([]);
      setResults(new Map());

      try {
        const raw = await api.fetchModels(provider.baseUrl, provider.apiKey);
        const fetched = (raw as FetchedModel[]) ?? [];
        setModels(fetched);
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
      if (!api) return;

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
          const data = (await api.testModel(
            provider.baseUrl,
            model.id,
            provider.apiKey,
          )) as { success: boolean; latencyMs?: number; message?: string };

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

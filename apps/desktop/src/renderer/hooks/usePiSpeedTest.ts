import { useCallback, useEffect, useRef, useState } from 'react';

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
}

interface FetchedModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

interface ModelResult {
  status: 'idle' | 'testing' | 'done';
  runs: number;
  success: number;
  latencies: number[];
  lastMessage?: string;
}

/**
 * Pi 测速面板数据层 —— 与 pi-web-switch 的 ModelSpeedTestPage 逐项对齐:
 *
 * - 双速度档 normal/slow（slow 拉长间隔 + 429 指数退避重试,防上游限流）;
 * - 模型目录与结果都持久化在 localStorage（key 与 pws 相同:
 *   speedtest:model-catalog / speedtest:model-results / speedtest:last-provider）,
 *   与正式模型配置完全隔离,切页往返不丢;
 * - 「添加到正式配置」走 addCliModel IPC,主进程写 ~/.pi/agent/models.json,
 *   payload 不含任何凭证字段;
 * - 探测请求本身只传 providerId（testCliModel,真 key 全程在主进程）。
 */

const RUNS_PER_MODEL = 3;
/** 与 pi-web-switch SPEED_PROFILES 一致。 */
const SPEED_PROFILES = {
  normal: { betweenCalls: 600, betweenModels: 800, maxRetries: 2, backoff: 3000 },
  slow: { betweenCalls: 2000, betweenModels: 4000, maxRetries: 4, backoff: 6000 },
} as const;
export type SpeedMode = keyof typeof SPEED_PROFILES;

const STORE_KEY = 'speedtest:model-catalog';
const RESULTS_KEY = 'speedtest:model-results';
const LAST_PROVIDER_KEY = 'speedtest:last-provider';

type AllResults = Record<string, Record<string, ModelResult>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function loadCatalog(): Record<string, FetchedModel[]> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FetchedModel[]>) : {};
  } catch {
    return {};
  }
}

function saveCatalog(catalog: Record<string, FetchedModel[]>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(catalog));
  } catch {
    /* quota errors are non-fatal */
  }
}

function loadResults(): AllResults {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as AllResults;
    // 中途离开页面留下的 testing 态永远不会结束,读入时丢弃。
    for (const pid of Object.keys(all)) {
      const kept = Object.fromEntries(
        Object.entries(all[pid] ?? {}).filter(([, r]) => r.status === 'done'),
      );
      if (Object.keys(kept).length === 0) delete all[pid];
      else all[pid] = kept;
    }
    return all;
  } catch {
    return {};
  }
}

function saveResults(all: AllResults) {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** 429 判定：状态码或错误文案。与 pws isRateLimited 同口径。 */
function isRateLimited(r: { status?: number; message?: string }): boolean {
  return r.status === 429 || /\b429\b|rate.?limit|too many/i.test(r.message ?? '');
}

export function usePiSpeedTest() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [catalog, setCatalog] = useState<Record<string, FetchedModel[]>>(() => loadCatalog());
  /** 各供应商已在正式配置里的模型 id（来自 listCliProviders 的剥密视图）。 */
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Map<string, ModelResult>>(new Map());
  const [speedMode, setSpeedMode] = useState<SpeedMode>('normal');
  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem(LAST_PROVIDER_KEY),
  );
  const [running, setRunning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
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
      // 与 pws 的 testableProviders 同口径:有 endpoint 即列出（key 缺失时
      // 测速会以 HTTP 错误呈现,不隐藏条目）。
      const list: ProviderInfo[] = [];
      const modelIds: Record<string, string[]> = {};
      for (const p of snapshot.providers) {
        if ((p.baseUrl ?? '').trim() === '') continue;
        list.push({ id: p.id, name: p.name, baseUrl: p.baseUrl ?? '' });
        modelIds[p.id] = p.models.map((m) => m.id);
      }
      setProviders(list);
      setProviderModels(modelIds);
    } catch {
      setProviders([]);
    }
  }, []);

  // 选中供应商变化:切换结果集 + 持久化 last provider。
  useEffect(() => {
    if (!selectedId) {
      setResults(new Map());
      return;
    }
    localStorage.setItem(LAST_PROVIDER_KEY, selectedId);
    const stored = loadResults()[selectedId] ?? {};
    setResults(new Map(Object.entries(stored)));
  }, [selectedId]);

  const persistResults = useCallback(
    (map: Map<string, ModelResult>) => {
      if (!selectedId) return;
      const all = loadResults();
      const next: Record<string, ModelResult> = Object.fromEntries(map);
      if (Object.keys(next).length === 0) delete all[selectedId];
      else all[selectedId] = next;
      saveResults(all);
    },
    [selectedId],
  );

  const models = selectedId ? (catalog[selectedId] ?? []) : [];

  const fetchModelsForProvider = useCallback(
    async (provider: ProviderInfo) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api?.fetchCliProviderModels) return;

      setFetching(true);
      setFetchError(null);
      setFetchInfo(null);

      try {
        const result = await api.fetchCliProviderModels(provider.id);
        if (result.error) {
          setFetchError(result.error);
          return;
        }
        const next = { ...loadCatalog(), [provider.id]: result.models };
        saveCatalog(next);
        setCatalog(next);
        setResults(new Map()); // 旧结果与新目录不再对应,与 pws 同口径清空
        setFetchInfo(String(result.models.length));
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        setFetching(false);
      }
    },
    [],
  );

  const clearModels = useCallback(() => {
    if (!selectedId || fetching || running) return;
    const next = { ...loadCatalog() };
    delete next[selectedId];
    saveCatalog(next);
    setCatalog(next);
    setResults(new Map());
    setFetchInfo(null);
  }, [selectedId, fetching, running]);

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

  const addModelToProvider = useCallback(
    async (providerId: string, model: FetchedModel): Promise<boolean> => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api?.addCliModel) return false;
      try {
        const res = await api.addCliModel(providerId, {
          id: model.id,
          ...(model.name ? { name: model.name } : {}),
          ...(model.reasoning === true ? { reasoning: true } : {}),
          ...(model.vision || model.audio
            ? { input: ['text', ...(model.vision ? ['image'] : []), ...(model.audio ? ['audio'] : [])] }
            : {}),
          // pws toModelDef 同款默认:未知上下文/输出上限不落 0,给保守默认值。
          contextWindow: model.contextWindow ?? 262144,
          maxTokens: model.maxTokens ?? 32768,
          cost: {
            input: model.cost?.input ?? 0,
            output: model.cost?.output ?? 0,
            cacheRead: model.cost?.cacheRead ?? 0,
            cacheWrite: model.cost?.cacheWrite ?? 0,
          },
        });
        return res.added;
      } catch {
        return false;
      }
    },
    [],
  );

  const testOneModel = useCallback(
    async (provider: ProviderInfo, model: FetchedModel) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api?.testCliModel) return;
      const profile = SPEED_PROFILES[speedMode];

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
        if (i > 0) await sleep(profile.betweenCalls);

        let data: { success: boolean; latencyMs?: number; message?: string; status?: number };
        let attempt = 0;
        // 429 专用退避重试,突发限流可自行恢复（与 pws 同口径）。
        for (;;) {
          try {
            data = await api.testCliModel(provider.id, model.id);
          } catch {
            data = { success: false, message: 'network error' };
          }
          if (data.success || !isRateLimited(data) || attempt >= profile.maxRetries) break;
          attempt++;
          await sleep(profile.backoff * attempt);
        }

        if (abortRef.current) return;

        if (data.success) {
          success++;
          if (typeof data.latencyMs === 'number') latencies.push(data.latencyMs);
        } else {
          lastMessage = data.message;
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
    [setResult, speedMode],
  );

  const runAll = useCallback(
    async (provider: ProviderInfo, modelList: FetchedModel[]) => {
      if (running || modelList.length === 0) return;
      const profile = SPEED_PROFILES[speedMode];
      setRunning(true);
      abortRef.current = false;
      setResults(new Map());

      try {
        for (let i = 0; i < modelList.length; i++) {
          if (abortRef.current) break;
          if (i > 0) await sleep(profile.betweenModels);
          const model = modelList[i];
          if (model) await testOneModel(provider, model);
        }
      } finally {
        setRunning(false);
        persistResults(resultsRef.current);
      }
    },
    // resultsRef 让收尾持久化拿到最新结果集。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, speedMode, testOneModel, persistResults],
  );

  // 结果每次变化都同步进 ref,runAll 结束时统一落盘（与 pws 的 saveResults 时机对齐）。
  const resultsRef = useRef<Map<string, ModelResult>>(results);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const resetResults = useCallback(() => {
    if (running) return;
    setResults(new Map());
    if (selectedId) {
      const all = loadResults();
      delete all[selectedId];
      saveResults(all);
    }
  }, [running, selectedId]);

  return {
    providers,
    catalog,
    providerModels,
    models,
    results,
    speedMode,
    setSpeedMode,
    running,
    fetching,
    fetchError,
    fetchInfo,
    selectedId,
    setSelectedId,
    loadProviders,
    fetchModelsForProvider,
    clearModels,
    addModelToProvider,
    runAll,
    resetResults,
    avg,
    RUNS_PER_MODEL,
  };
}

import { useCallback, useEffect, useState } from 'react';

import type {
  PiProjectGroup,
  PiSessionPreviewResult,
  PiTrashEntry,
} from '@/../main/pi-agent/piTypes';

interface UsePiSessionsResult {
  projects: PiProjectGroup[];
  trash: PiTrashEntry[];
  /** 本次加载自动移入回收站的超期会话数(pws auto_trashed 横幅数据源)。 */
  autoTrashed: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  preview: PiSessionPreviewResult | null;
  previewLoading: boolean;
  loadPreview: (filePath: string, limit?: number) => void;
}

export function usePiSessions(): UsePiSessionsResult {
  const [projects, setProjects] = useState<PiProjectGroup[]>([]);
  const [trash, setTrash] = useState<PiTrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PiSessionPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [autoTrashed, setAutoTrashed] = useState(0);

  const fetchData = useCallback(() => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;

    setLoading(true);
    setError(null);

    // pws loadAll 同顺序:先自动清理超期会话,再列会话与回收站。
    const autoCleanup = api.autoTrashSessions
      ? api.autoTrashSessions().catch(() => ({ moved: 0 }))
      : Promise.resolve({ moved: 0 });
    autoCleanup
      .then((cleanup) => {
        setAutoTrashed(cleanup.moved);
        return Promise.all([api.listSessions(), api.listTrash()]);
      })
      .then(([sessionsResult, trashResult]) => {
        setProjects(sessionsResult as PiProjectGroup[]);
        setTrash(trashResult as PiTrashEntry[]);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  const loadPreview = useCallback((filePath: string, limit = 20) => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;

    setPreviewLoading(true);
    setPreview(null);

    api
      .sessionPreview(filePath, limit)
      .then((result) => {
        setPreview(result as PiSessionPreviewResult);
        setPreviewLoading(false);
      })
      .catch(() => {
        setPreview(null);
        setPreviewLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    projects,
    trash,
    autoTrashed,
    loading,
    error,
    refresh: fetchData,
    preview,
    previewLoading,
    loadPreview,
  };
}

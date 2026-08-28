import { useCallback, useEffect, useState } from 'react';

import type {
  PiProjectGroup,
  PiSessionPreviewResult,
  PiTrashEntry,
} from '@/../main/pi-agent/piTypes';

interface UsePiSessionsResult {
  projects: PiProjectGroup[];
  trash: PiTrashEntry[];
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

  const fetchData = useCallback(() => {
    const api = window.electronAPI?.maker?.piAgent;
    if (!api) return;

    setLoading(true);
    setError(null);

    Promise.all([api.listSessions(), api.listTrash()])
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
    loading,
    error,
    refresh: fetchData,
    preview,
    previewLoading,
    loadPreview,
  };
}

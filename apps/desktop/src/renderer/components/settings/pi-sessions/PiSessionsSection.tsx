import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderOpen,
  MessageSquare,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  Eye,
  AlertTriangle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { usePiSessions } from '@/hooks/usePiSessions';
import type { PiSessionFileInfo, PiProjectGroup } from '@/../main/pi-agent/piTypes';
import { SessionPreviewModal } from './SessionPreviewModal';

type ViewMode = 'sessions' | 'trash';

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

export function PiSessionsSection() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const { projects, trash, loading, error, refresh, preview, previewLoading, loadPreview } =
    usePiSessions();

  const [viewMode, setViewMode] = useState<ViewMode>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProject, setExpandedProject] = useState<Set<string>>(new Set());
  const [previewSession, setPreviewSession] = useState<{
    name: string;
    filePath: string;
  } | null>(null);

  const totalSessions = useMemo(
    () => projects.reduce((sum, p) => sum + p.totalSessions, 0),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        sessions: p.sessions.filter(
          (s) =>
            s.name?.toLowerCase().includes(q) ||
            s.model?.toLowerCase().includes(q) ||
            s.provider?.toLowerCase().includes(q) ||
            p.projectName.toLowerCase().includes(q),
        ),
      }))
      .filter((p) => p.sessions.length > 0);
  }, [projects, searchQuery]);

  const filteredTrash = useMemo(() => {
    if (!searchQuery.trim()) return trash;
    const q = searchQuery.toLowerCase();
    return trash.filter(
      (t) =>
        t.sessionName.toLowerCase().includes(q) ||
        t.fileName.toLowerCase().includes(q),
    );
  }, [trash, searchQuery]);

  const toggleProject = useCallback((projectPath: string) => {
    setExpandedProject((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedProject(new Set(projects.map((p) => p.projectPath)));
  }, [projects]);

  const collapseAll = useCallback(() => {
    setExpandedProject(new Set());
  }, []);

  const handlePreview = useCallback(
    (session: PiSessionFileInfo) => {
      setPreviewSession({ name: session.name || session.id, filePath: session.filePath });
      loadPreview(session.filePath, 20);
    },
    [loadPreview],
  );

  const handleTrash = useCallback(
    (session: PiSessionFileInfo) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api) return;
      if (!confirm(t('settings.piSessions.confirmDelete'))) return;
      api.trashSession(session.filePath).then(() => refresh());
    },
    [refresh, t],
  );

  const handleRestore = useCallback(
    (trashPath: string) => {
      const api = window.electronAPI?.maker?.piAgent;
      if (!api) return;
      api.restoreTrash(trashPath).then(() => refresh());
    },
    [refresh],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
          {t('settings.piSessions.title')}
        </h2>
        <p className="mt-0.5 text-13 text-[var(--settings-section-desc)]">
          {t('settings.piSessions.subtitle', {
            count: totalSessions,
            projects: projects.length,
          })}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--surface)] p-0.5">
          <button
            onClick={() => setViewMode('sessions')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-12 font-medium transition-colors',
              viewMode === 'sessions'
                ? 'bg-[#3b82f6] text-white'
                : 'text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t('settings.piSessions.sessions')}
          </button>
          <button
            onClick={() => setViewMode('trash')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-12 font-medium transition-colors',
              viewMode === 'trash'
                ? 'bg-[#3b82f6] text-white'
                : 'text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('settings.piSessions.trash')}
            {trash.length > 0 && (
              <span className="ml-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-10 text-red-500">
                {trash.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--settings-section-sublabel)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('settings.piSessions.searchPlaceholder')}
            className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] py-1.5 pl-9 pr-3 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-3 py-1.5 text-12 font-medium text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-12 text-red-500">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--settings-theme-card-border)] border-t-[#3b82f6]" />
        </div>
      )}

      {/* Sessions view */}
      {!loading && viewMode === 'sessions' && (
        <div className="flex flex-col gap-3">
          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FolderOpen className="mb-3 h-10 w-10 text-[var(--settings-section-sublabel)]" />
              <p className="text-13 text-[var(--settings-section-desc)]">
                {t('settings.piSessions.noSessions')}
              </p>
            </div>
          ) : (
            <>
              {/* Expand/Collapse all */}
              {filteredProjects.length > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={expandAll}
                    className="text-11 text-[#3b82f6] hover:underline"
                  >
                    {t('settings.piSessions.expandAll')}
                  </button>
                  <span className="text-11 text-[var(--settings-section-sublabel)]">|</span>
                  <button
                    onClick={collapseAll}
                    className="text-11 text-[#3b82f6] hover:underline"
                  >
                    {t('settings.piSessions.collapseAll')}
                  </button>
                </div>
              )}

              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.projectPath}
                  project={project}
                  expanded={expandedProject.has(project.projectPath)}
                  onToggle={() => toggleProject(project.projectPath)}
                  onPreview={handlePreview}
                  onTrash={handleTrash}
                  lang={lang}
                  t={t}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Trash view */}
      {!loading && viewMode === 'trash' && (
        <div className="flex flex-col gap-2">
          {filteredTrash.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Trash2 className="mb-3 h-10 w-10 text-[var(--settings-section-sublabel)]" />
              <p className="text-13 text-[var(--settings-section-desc)]">
                {t('settings.piSessions.trashEmpty')}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-11 text-amber-600 dark:text-amber-400">
                  {t('settings.piSessions.trashWarning')}
                </p>
              </div>
              {filteredTrash.map((entry) => (
                <div
                  key={entry.trashPath}
                  className="flex items-center justify-between rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-medium text-[var(--settings-section-title)]">
                      {entry.sessionName || entry.fileName}
                    </p>
                    <p className="mt-0.5 text-11 text-[var(--settings-section-sublabel)]">
                      {entry.messageCount} {t('settings.piSessions.messages')} ·{' '}
                      {t('settings.piSessions.trashedAt')} {entry.trashedAt}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(entry.trashPath)}
                    className="ml-3 flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] px-3 py-1.5 text-12 text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    {t('settings.piSessions.restore')}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Preview modal */}
      <SessionPreviewModal
        open={!!previewSession}
        onClose={() => setPreviewSession(null)}
        sessionName={previewSession?.name || ''}
        preview={preview}
        loading={previewLoading}
      />
    </div>
  );
}

// ─── Project Card ──────────────────────────────────────────────────────────

function ProjectCard({
  project,
  expanded,
  onToggle,
  onPreview,
  onTrash,
  lang,
  t,
}: {
  project: PiProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  onPreview: (session: PiSessionFileInfo) => void;
  onTrash: (session: PiSessionFileInfo) => void;
  lang: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
      {/* Project header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'h-2 w-2 rounded-full transition-transform',
              expanded ? 'rotate-90 bg-[#3b82f6]' : 'bg-[var(--settings-section-sublabel)]',
            )}
            style={{ clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }}
          />
          <FolderOpen className="h-4 w-4 text-[var(--settings-section-desc)]" />
          <span className="text-13 font-medium text-[var(--settings-section-title)]">
            {project.projectName}
          </span>
          <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-10 text-[var(--settings-section-sublabel)]">
            {project.totalSessions}
          </span>
        </div>
        <span className="text-11 text-[var(--settings-section-sublabel)]">
          {formatRelativeTime(project.lastActive)}
        </span>
      </button>

      {/* Sessions list */}
      {expanded && (
        <div className="border-t border-[var(--settings-theme-card-border)]">
          {project.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onPreview={() => onPreview(session)}
              onTrash={() => onTrash(session)}
              lang={lang}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Session Row ───────────────────────────────────────────────────────────

function SessionRow({
  session,
  onPreview,
  onTrash,
  lang,
  t,
}: {
  session: PiSessionFileInfo;
  onPreview: () => void;
  onTrash: () => void;
  lang: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const displayName = session.name || session.id.slice(0, 8);

  return (
    <div className="flex items-center gap-3 border-b border-[var(--settings-theme-card-border)] px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-12 font-medium text-[var(--settings-section-title)]">
          {displayName}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-11 text-[var(--settings-section-sublabel)]">
          <span>{session.messageCount} {t('settings.piSessions.messages')}</span>
          {session.model && (
            <>
              <span>·</span>
              <span className="truncate">{session.model}</span>
            </>
          )}
          {session.duration && session.duration > 0 && (
            <>
              <span>·</span>
              <span>{formatDuration(session.duration)}</span>
            </>
          )}
        </div>
      </div>

      <span className="shrink-0 text-11 text-[var(--settings-section-sublabel)]">
        {formatRelativeTime(session.lastActive)}
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={onPreview}
          className="rounded-lg p-1.5 text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
          title={t('settings.piSessions.preview')}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onTrash}
          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
          title={t('settings.piSessions.delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

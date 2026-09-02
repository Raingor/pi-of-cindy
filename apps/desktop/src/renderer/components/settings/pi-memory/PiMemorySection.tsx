import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  FileText,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  User,
  AlertCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { usePiMemory } from '@/hooks/usePiMemory';
import type { PiMemoryFile } from '@/../main/pi-agent/piTypes';
import { MemoryEntryCard } from './MemoryEntryCard';
import { MemoryConfigPanel } from './MemoryConfigPanel';

type ViewMode = 'files' | 'config';
type FileTab = 'all' | 'memory' | 'user' | 'failure';

/** pws 同款:按 § 分段,条目尾部的 `<!-- created=…, last=… -->` 标记提取日期。 */
const DEFAULT_OPEN_GROUPS = 3;

function parseMemoryEntries(
  content: string,
): Array<{ text: string; created: string; last: string }> {
  const entries: Array<{ text: string; created: string; last: string }> = [];
  const sections = content.split('§').filter((s) => s.trim().length > 0);

  for (const section of sections) {
    const trimmed = section.trim();
    // 容忍 last= 之后的额外字段(如 `, project64=...`)再接 `-->`。
    const markerMatch = trimmed.match(
      /<!--\s*created\s*=\s*([^,\s>]+)\s*,\s*last\s*=\s*([^,\s>]+)[^>]*-->\s*$/,
    );
    if (markerMatch) {
      entries.push({
        text: trimmed.slice(0, markerMatch.index).trim(),
        created: markerMatch[1]?.trim() ?? '',
        last: markerMatch[2]?.trim() ?? '',
      });
    } else if (trimmed) {
      entries.push({ text: trimmed, created: '', last: '' });
    }
  }
  return entries;
}

/** 按日期分组,新日期在前,无日期组垫底(pws groupByDate 同款)。 */
function groupByDate(
  entries: Array<{ text: string; created: string; last: string }>,
): Array<{ dateKey: string; entries: Array<{ text: string; created: string; last: string }> }> {
  const groups = new Map<string, Array<{ text: string; created: string; last: string }>>();
  for (const entry of entries) {
    const dateKey = entry.created || entry.last || 'other';
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(entry);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return b.localeCompare(a);
    })
    .map(([dateKey, list]) => ({ dateKey, entries: list }));
}

function formatEntryDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getFileIcon(filename: string) {
  if (filename.includes('USER')) return <User className="h-4 w-4 text-[#3b82f6]" />;
  if (filename.includes('failure')) return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <Brain className="h-4 w-4 text-[#8b5cf6]" />;
}

function getFileTabKey(filename: string): FileTab {
  if (filename.includes('USER')) return 'user';
  if (filename.includes('failure')) return 'failure';
  return 'memory';
}

export function PiMemorySection() {
  const { t } = useTranslation();
  const { files, config, status, loading, error, optimizing, optimizeResult, refresh, deleteEntry, saveConfig, optimize } = usePiMemory();

  const [viewMode, setViewMode] = useState<ViewMode>('files');
  const [searchQuery, setSearchQuery] = useState('');
  const [fileTab, setFileTab] = useState<FileTab>('all');

  const totalChars = useMemo(
    () => files.reduce((sum, f) => sum + f.content.length, 0),
    [files],
  );

  const totalLimit = useMemo(() => {
    if (!status) return 0;
    return status.targets.reduce((sum, t) => sum + t.limit, 0);
  }, [status]);

  const usagePercent = totalLimit > 0 ? Math.min((totalChars / totalLimit) * 100, 100) : 0;

  const filteredFiles = useMemo(() => {
    let result = files;
    if (fileTab !== 'all') {
      result = result.filter((f) => getFileTabKey(f.filename) === fileTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.content.toLowerCase().includes(q),
      );
    }
    return result;
  }, [files, fileTab, searchQuery]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
          {t('settings.piMemory.title')}
        </h2>
        <p className="mt-0.5 text-13 text-[var(--settings-section-desc)]">
          {t('settings.piMemory.subtitle', { count: files.length, chars: totalChars.toLocaleString() })}
        </p>
      </div>

      {/* Capacity bar */}
      {totalLimit > 0 && (
        <div className="rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-12 font-medium text-[var(--settings-section-title)]">
              {t('settings.piMemory.capacity')}
            </span>
            <span className="text-11 text-[var(--settings-section-sublabel)]">
              {totalChars.toLocaleString()} / {totalLimit.toLocaleString()} {t('settings.piMemory.chars')}
              {' '}({usagePercent.toFixed(1)}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[var(--settings-theme-card-border)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${usagePercent}%`,
                backgroundColor: usagePercent > 90 ? '#ef4444' : usagePercent > 70 ? '#f59e0b' : '#10b981',
              }}
            />
          </div>
          {/* Per-file breakdown */}
          {status && (
            <div className="mt-3 flex flex-wrap gap-3">
              {status.targets.map((target) => {
                const pct = target.limit > 0 ? (target.chars / target.limit) * 100 : 0;
                return (
                  <div key={target.filename} className="flex-1 min-w-[120px]">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-10 text-[var(--settings-section-sublabel)]">
                        {target.filename}
                      </span>
                      <span className="text-10 text-[var(--settings-section-sublabel)]">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-[var(--settings-theme-card-border)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          backgroundColor: pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#3b82f6',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--surface)] p-0.5">
          <button
            onClick={() => setViewMode('files')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-12 font-medium transition-colors',
              viewMode === 'files'
                ? 'bg-[#3b82f6] text-white'
                : 'text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            {t('settings.piMemory.files')}
          </button>
          <button
            onClick={() => setViewMode('config')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-12 font-medium transition-colors',
              viewMode === 'config'
                ? 'bg-[#3b82f6] text-white'
                : 'text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t('settings.piMemory.config')}
          </button>
        </div>

        {/* Search (files mode) */}
        {viewMode === 'files' && (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--settings-section-sublabel)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.piMemory.searchPlaceholder')}
              className="w-full rounded-lg border border-[var(--settings-input-border)] bg-[var(--settings-input-bg)] py-1.5 pl-9 pr-3 text-12 text-[var(--settings-input-text)] placeholder:text-[var(--settings-section-sublabel)]"
            />
          </div>
        )}

        {/* Optimize button */}
        {viewMode === 'files' && (
          <button
            onClick={optimize}
            disabled={optimizing}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-3 py-1.5 text-12 font-medium text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)] disabled:opacity-50"
          >
            <Sparkles className={cn('h-3.5 w-3.5', optimizing && 'animate-spin')} />
            {t('settings.piMemory.optimize')}
          </button>
        )}

        {/* Refresh */}
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-3 py-1.5 text-12 font-medium text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Optimize result */}
      {optimizeResult && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-12',
          optimizeResult.success
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
            : 'border-red-500/30 bg-red-500/5 text-red-500',
        )}>
          {optimizeResult.success
            ? t('settings.piMemory.optimizeSuccess', {
                freed: optimizeResult.freedBytes.toLocaleString(),
                before: optimizeResult.before.toLocaleString(),
                after: optimizeResult.after.toLocaleString(),
              })
            : optimizeResult.message || t('settings.piMemory.optimizeFailed')}
        </div>
      )}

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

      {/* Files view */}
      {!loading && viewMode === 'files' && (
        <div className="flex flex-col gap-4">
          {/* File tabs */}
          <div className="flex items-center gap-1">
            {(['all', 'memory', 'user', 'failure'] as FileTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFileTab(tab)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-11 font-medium transition-colors',
                  fileTab === tab
                    ? 'bg-[var(--surface)] text-[var(--settings-section-title)]'
                    : 'text-[var(--settings-section-desc)] hover:bg-[var(--settings-menu-bg-hover)]',
                )}
              >
                {t(`settings.piMemory.tab.${tab}`)}
              </button>
            ))}
          </div>

          {filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Brain className="mb-3 h-10 w-10 text-[var(--settings-section-sublabel)]" />
              <p className="text-13 text-[var(--settings-section-desc)]">
                {t('settings.piMemory.noFiles')}
              </p>
            </div>
          ) : (
            filteredFiles.map((file) => (
              <MemoryFileSection
                key={file.filename}
                file={file}
                onDelete={deleteEntry}
                searchQuery={searchQuery}
              />
            ))
          )}
        </div>
      )}

      {/* Config view */}
      {!loading && viewMode === 'config' && (
        <MemoryConfigPanel config={config} onSave={saveConfig} />
      )}
    </div>
  );
}

function MemoryFileSection({
  file,
  onDelete,
  searchQuery,
}: {
  file: PiMemoryFile;
  onDelete: (filename: string, entryText: string) => Promise<boolean>;
  searchQuery: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const allEntries = useMemo(() => parseMemoryEntries(file.content), [file.content]);

  const highlightedEntries = useMemo(() => {
    if (!searchQuery.trim()) return allEntries;
    const q = searchQuery.toLowerCase();
    return allEntries.filter((e) => e.text.toLowerCase().includes(q));
  }, [allEntries, searchQuery]);

  const groups = useMemo(() => groupByDate(highlightedEntries), [highlightedEntries]);
  // 默认展开前 3 组,用户手点优先(pws openOverrides 同款)。
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (dateKey: string, index: number) =>
    dateKey in openOverrides ? openOverrides[dateKey]! : index < DEFAULT_OPEN_GROUPS;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
      >
        {getFileIcon(file.filename)}
        <span className="text-13 font-medium text-[var(--settings-section-title)]">
          {file.name}
        </span>
        <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-10 text-[var(--settings-section-sublabel)]">
          {allEntries.length} {t('settings.piMemory.entries')}
        </span>
        <span className="ml-auto text-10 text-[var(--settings-section-sublabel)]">
          {file.content.length.toLocaleString()} {t('settings.piMemory.chars')}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--settings-theme-card-border)] p-3">
          {highlightedEntries.length === 0 ? (
            <p className="py-4 text-center text-12 text-[var(--settings-section-sublabel)]">
              {t('settings.piMemory.noEntries')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group, gi) => (
                <div key={group.dateKey} className="flex flex-col gap-2">
                  <button
                    onClick={() =>
                      setOpenOverrides((prev) => ({
                        ...prev,
                        [group.dateKey]: !isOpen(group.dateKey, gi),
                      }))
                    }
                    className="flex items-center gap-2 text-left"
                  >
                    <span
                      className={cn(
                        'text-10 transition-transform',
                        isOpen(group.dateKey, gi) ? 'rotate-90' : '',
                      )}
                      style={{ clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }}
                    >
                      ▶
                    </span>
                    <span className="text-11 font-medium text-[var(--settings-section-sublabel)]">
                      {group.dateKey === 'other'
                        ? t('settings.piMemory.noDateGroup')
                        : formatEntryDate(group.dateKey)}
                    </span>
                    <span className="text-10 text-[var(--settings-section-sublabel)]">
                      {group.entries.length}
                    </span>
                  </button>
                  {isOpen(group.dateKey, gi) && (
                    <div className="flex flex-col gap-2">
                      {group.entries.map((entry, i) => (
                        <MemoryEntryCard
                          key={`${group.dateKey}-${i}`}
                          filename={file.filename}
                          entry={entry}
                          query={searchQuery.trim().toLowerCase()}
                          onDelete={onDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

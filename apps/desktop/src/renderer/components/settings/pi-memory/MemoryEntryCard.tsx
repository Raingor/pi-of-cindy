import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Trash2, Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface MemoryEntryData {
  text: string;
  created: string;
  last: string;
}

/** 搜索命中高亮(pws highlight 同款)。 */
function highlight(text: string, q: string): ReactNode {
  if (!q || !text) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(
      <mark
        key={`${idx}-${pos}`}
        className="rounded-sm px-0.5"
        style={{ backgroundColor: 'rgba(250, 204, 21, 0.35)', color: 'inherit' }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

/** 轻量行内 markdown:**粗体** / `代码` / [文本](https 链接),无外部依赖(pws renderInline 同款)。 */
function renderInline(text: string, q: string): ReactNode {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/)[^)\s]+\))/g;
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={i} className="font-semibold">
          {highlight(part.slice(2, -2), q)}
        </strong>
      );
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code
          key={i}
          className="rounded border px-1 py-px font-mono text-11"
          style={{
            borderColor: 'var(--settings-theme-card-border)',
            color: 'var(--settings-section-title)',
          }}
        >
          {highlight(part.slice(1, -1), q)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/)[^)\s]+)\)$/);
    if (link) {
      return (
        <span key={i} className="underline underline-offset-2 text-[var(--text-link-primary,var(--accent-emphasis))]">
          {highlight(link[1] ?? '', q)}
        </span>
      );
    }
    return <span key={i}>{highlight(part, q)}</span>;
  });
}

interface MemoryEntryCardProps {
  filename: string;
  entry: MemoryEntryData;
  query: string;
  onDelete: (filename: string, entryText: string) => Promise<boolean>;
}

export function MemoryEntryCard({ filename, entry, query, onDelete }: MemoryEntryCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!confirm(t('settings.piMemory.confirmDelete'))) return;
    setDeleting(true);
    await onDelete(filename, entry.text);
    setDeleting(false);
  };

  return (
    <div
      className={cn(
        'group relative rounded-lg border p-3 transition-colors hover:border-[#3b82f6]/30',
        'border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]',
      )}
    >
      {/* 全文展示(pws 不截断),行内 markdown + 搜索高亮。 */}
      <p className="whitespace-pre-wrap break-words pr-12 text-12 leading-relaxed text-[var(--settings-section-title)]">
        {renderInline(entry.text, query)}
      </p>
      {/* 悬停操作:复制 / 删除(pws 同款 hover actions)。 */}
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleCopy}
          className="rounded p-1 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
          style={{ color: copied ? '#10b981' : 'var(--settings-section-desc)' }}
          title={copied ? t('settings.piMemory.copied') : t('settings.piMemory.copy')}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          title={t('settings.piMemory.delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

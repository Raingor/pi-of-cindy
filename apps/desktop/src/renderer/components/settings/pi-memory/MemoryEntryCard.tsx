import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Trash2, Check } from 'lucide-react';

import { cn } from '@/lib/utils';

interface MemoryEntryCardProps {
  filename: string;
  entryText: string;
  index: number;
  onDelete: (filename: string, entryText: string) => Promise<boolean>;
}

export function MemoryEntryCard({ filename, entryText, index, onDelete }: MemoryEntryCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!confirm(t('settings.piMemory.confirmDelete'))) return;
    setDeleting(true);
    await onDelete(filename, entryText);
    setDeleting(false);
  };

  const preview = entryText.length > 200 ? entryText.slice(0, 200) + '…' : entryText;

  return (
    <div className="group rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-3 transition-colors hover:border-[#3b82f6]/30">
      <p className="whitespace-pre-wrap break-words text-12 leading-relaxed text-[var(--settings-section-title)]">
        {preview}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-10 text-[var(--settings-section-sublabel)]">
          #{index + 1}
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
            className="rounded p-1 text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
            title={t('settings.piMemory.copy')}
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
            title={t('settings.piMemory.delete')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MessageSquare, User } from 'lucide-react';

import type { PiSessionPreviewResult } from '@/../main/pi-agent/piTypes';
import { cn } from '@/lib/utils';

interface SessionPreviewModalProps {
  open: boolean;
  onClose: () => void;
  sessionName: string;
  preview: PiSessionPreviewResult | null;
  loading: boolean;
}

export function SessionPreviewModal({
  open,
  onClose,
  sessionName,
  preview,
  loading,
}: SessionPreviewModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--settings-theme-card-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--settings-section-desc)]" />
            <h3 className="text-14 font-medium text-[var(--settings-section-title)]">
              {sessionName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--settings-section-desc)] transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex h-32 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--settings-theme-card-border)] border-t-[#3b82f6]" />
            </div>
          )}

          {!loading && !preview && (
            <p className="py-8 text-center text-13 text-[var(--settings-section-sublabel)]">
              {t('settings.piSessions.previewUnavailable')}
            </p>
          )}

          {!loading && preview && preview.messages.length === 0 && (
            <p className="py-8 text-center text-13 text-[var(--settings-section-sublabel)]">
              {t('settings.piSessions.noMessages')}
            </p>
          )}

          {!loading && preview && preview.messages.length > 0 && (
            <div className="flex flex-col gap-3">
              {preview.messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex gap-3 rounded-xl p-3',
                    msg.role === 'user'
                      ? 'bg-[var(--surface)]'
                      : 'bg-[var(--settings-menu-bg-hover)]',
                  )}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--settings-theme-card-border)]">
                    {msg.role === 'user' ? (
                      <User className="h-3.5 w-3.5 text-[var(--settings-section-desc)]" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 text-[var(--settings-section-desc)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-11 font-medium uppercase tracking-wider text-[var(--settings-section-sublabel)]">
                      {msg.role === 'user'
                        ? t('settings.piSessions.you')
                        : t('settings.piSessions.assistant')}
                      {msg.timestamp && (
                        <span className="ml-2 font-normal normal-case tracking-normal">
                          {msg.timestamp}
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-13 leading-relaxed text-[var(--settings-section-title)]">
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
              {preview.total > preview.messages.length && (
                <p className="pt-2 text-center text-12 text-[var(--settings-section-sublabel)]">
                  {t('settings.piSessions.showingFirst', {
                    count: preview.messages.length,
                    total: preview.total,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

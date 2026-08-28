import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { RECOMMENDED_PACKAGES } from './recommendedPackages';

interface PackageSearchResult {
  name: string;
  description: string;
  version: string;
  downloads: number;
  link: string;
}

type BrowseTab = 'recommended' | 'search';

interface PackageBrowserProps {
  installedSources: Set<string>;
  onInstall: (source: string) => void;
  busy: boolean;
}

function PackageRow({
  name,
  description,
  link,
  installed,
  onInstall,
  busy,
}: {
  name: string;
  description: string;
  link?: string;
  installed: boolean;
  onInstall: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--surface-subtle)] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-13 font-medium text-[var(--settings-section-title)]">
            {name}
          </span>
          <a
            href={link ?? `https://www.npmjs.com/package/${name}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[var(--settings-section-desc)] hover:text-[var(--settings-section-sublabel)]"
            title={t('settings.piPackages.viewOnNpm')}
          >
            <ExternalLink size={12} />
          </a>
        </div>
        {description && (
          <p className="truncate text-11 leading-[1.45] text-[var(--settings-section-desc)]">
            {description}
          </p>
        )}
      </div>
      {installed ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 px-2.5 py-1 text-11 font-medium text-emerald-500">
          <Check size={12} />
          {t('settings.piPackages.installedBadge')}
        </span>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--focus-ring)]/50 px-2.5 py-1 text-11 font-medium text-[var(--focus-ring)] transition-colors hover:bg-[var(--focus-ring)]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner size={12} /> : <Plus size={12} />}
          {t('settings.piPackages.install')}
        </button>
      )}
    </div>
  );
}

export function PackageBrowser({ installedSources, onInstall, busy }: PackageBrowserProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BrowseTab>('recommended');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const api = window.electronAPI?.maker?.piAgent;

  const runSearch = useCallback(
    (q: string) => {
      if (!api?.searchPackages) return;
      setLoading(true);
      api
        .searchPackages(q)
        .then((rows) => setResults(rows as PackageSearchResult[]))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    [api],
  );

  useEffect(() => {
    if (tab !== 'search') return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 350);
    return () => clearTimeout(debounceRef.current);
  }, [query, tab, runSearch]);

  const isInstalled = (name: string) => {
    const id = `npm:${name}`;
    return installedSources.has(id) || justAdded.has(id);
  };

  const handleInstall = (id: string) => {
    onInstall(id);
    setJustAdded((prev) => new Set(prev).add(id));
  };

  const tabBtnClass = (active: boolean) =>
    cn(
      'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-12 font-medium transition-colors',
      active
        ? 'bg-[var(--focus-ring)]/15 text-[var(--focus-ring)]'
        : 'text-[var(--settings-section-desc)] hover:text-[var(--settings-section-sublabel)]',
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-lg bg-[var(--surface-subtle)] p-1">
        <button type="button" onClick={() => setTab('recommended')} className={tabBtnClass(tab === 'recommended')}>
          <Sparkles size={13} />
          {t('settings.piPackages.tabRecommended')}
        </button>
        <button type="button" onClick={() => setTab('search')} className={tabBtnClass(tab === 'search')}>
          <Search size={13} />
          {t('settings.piPackages.tabSearch')}
        </button>
      </div>

      {tab === 'recommended' ? (
        <div className="flex max-h-[400px] flex-col gap-1.5 overflow-y-auto">
          {RECOMMENDED_PACKAGES.map((pkg) => (
            <PackageRow
              key={pkg.id}
              name={pkg.name}
              description={t(pkg.descKey)}
              installed={installedSources.has(pkg.id) || justAdded.has(pkg.id)}
              onInstall={() => handleInstall(pkg.id)}
              busy={busy}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--settings-section-desc)]"
              size={14}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.piPackages.searchPlaceholder')}
              className="w-full rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--surface-subtle)] py-2 pl-9 pr-3 text-13 text-[var(--settings-section-title)] outline-none placeholder:text-[var(--settings-section-desc)] focus:border-[var(--focus-ring)] focus:ring-1 focus:ring-[var(--focus-ring)]"
            />
          </div>

          <div className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto">
            {loading && results.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-12 text-[var(--settings-section-desc)]">
                <Loader2 size={16} className="animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <p className="py-10 text-center text-12 text-[var(--settings-section-desc)]">
                {t('settings.piPackages.noResults')}
              </p>
            ) : (
              results.map((pkg) => (
                <PackageRow
                  key={pkg.name}
                  name={pkg.name}
                  description={pkg.description}
                  link={pkg.link}
                  installed={isInstalled(pkg.name)}
                  onInstall={() => handleInstall(`npm:${pkg.name}`)}
                  busy={busy}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';

import type {
  PiAgentDef,
  PiChainDef,
  PiRunRecord,
} from '@/../main/pi-agent/piTypes';
import {
  Brain,
  CheckCircle2,
  GitBranch,
  History,
  Loader2,
  Search,
  XCircle,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';

import { AgentCard } from './AgentCard';
import { ChainView } from './ChainView';
import { usePiSubagents } from '@/hooks/usePiSubagents';

type Tab = 'agents' | 'chains' | 'history';

export function PiSubagentsSection() {
  const { t } = useTranslation();
  const { data, loading, error, refresh, updateAgent } = usePiSubagents();
  const [tab, setTab] = useState<Tab>('agents');
  const [search, setSearch] = useState('');
  const [selectedAgentFile, setSelectedAgentFile] = useState<string | null>(null);
  const [selectedChainFile, setSelectedChainFile] = useState<string | null>(null);

  const q = search.trim().toLowerCase();

  const filteredAgents = useMemo(
    () =>
      data?.agents.filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q),
      ) ?? [],
    [data?.agents, q],
  );

  const filteredChains = useMemo(
    () =>
      data?.chains.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      ) ?? [],
    [data?.chains, q],
  );

  const filteredHistory = useMemo(
    () =>
      data?.runHistory.filter(
        (r) =>
          !q ||
          r.agent.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q),
      ) ?? [],
    [data?.runHistory, q],
  );

  const selectedAgent = data?.agents.find(
    (a) => a.fileName === selectedAgentFile,
  ) ?? null;
  const selectedChain = data?.chains.find(
    (c) => c.fileName === selectedChainFile,
  ) ?? null;

  if (loading && !data) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--settings-text-tertiary)' }} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-3">
        <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
        <button
          onClick={refresh}
          className="rounded-md px-4 py-2 text-sm text-white"
          style={{ backgroundColor: 'var(--accent, var(--text-link))' }}
        >
          {t('settings.piSubagents.retry')}
        </button>
      </div>
    );
  }

  const tabs: { key: Tab; icon: typeof Brain; count: number }[] = [
    { key: 'agents', icon: Brain, count: data?.agents.length ?? 0 },
    { key: 'chains', icon: GitBranch, count: data?.chains.length ?? 0 },
    { key: 'history', icon: History, count: data?.runHistory.length ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--settings-text-primary)' }}
          >
            {t('settings.piSubagents.title')}
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--settings-text-secondary)' }}>
            {data &&
              t('settings.piSubagents.summary', { arg0: String(data.agents.length), arg1: String(data.chains.length) })}
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
          style={{
            borderColor: 'var(--settings-border)',
            color: 'var(--settings-text-secondary)',
          }}
        >
          <Loader2 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('settings.piSubagents.refresh')}
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 rounded-lg p-1"
        style={{ backgroundColor: 'var(--settings-bg-tertiary)' }}
      >
        {tabs.map(({ key, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: tab === key ? 'var(--settings-bg-primary)' : 'transparent',
              color: tab === key ? 'var(--settings-text-primary)' : 'var(--settings-text-secondary)',
              boxShadow: tab === key ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <Icon className="h-4 w-4" />
            {t(`settings.piSubagents.tab_${key}`)}
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor:
                  tab === key
                    ? 'var(--accent-muted, rgba(59,130,246,0.15))'
                    : 'var(--settings-bg-secondary)',
                color:
                  tab === key
                    ? 'var(--accent, var(--text-link))'
                    : 'var(--settings-text-tertiary)',
              }}
            >
              {count}
            </span>
          </button>
        ))}
        {(filteredAgents.length > 5 || filteredChains.length > 5 || filteredHistory.length > 5) && (
          <div className="relative ml-auto">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: 'var(--settings-text-tertiary)' }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('settings.piSubagents.searchPlaceholder')}
              className="w-48 rounded-lg border py-2 pl-9 pr-3 text-sm outline-none"
              style={{
                borderColor: 'var(--settings-border)',
                backgroundColor: 'var(--settings-bg-primary)',
                color: 'var(--settings-text-primary)',
              }}
            />
          </div>
        )}
      </div>

      {/* Tab Content */}
      {tab === 'agents' && (
        <AgentList
          agents={filteredAgents}
          selectedAgent={selectedAgent}
          onSelect={setSelectedAgentFile}
          onSave={updateAgent}
          onSaved={refresh}
        />
      )}
      {tab === 'chains' && (
        <ChainList
          chains={filteredChains}
          selectedChain={selectedChain}
          onSelect={setSelectedChainFile}
        />
      )}
      {tab === 'history' && <RunHistoryList records={filteredHistory} />}
    </div>
  );
}

function AgentList({
  agents,
  selectedAgent,
  onSelect,
  onSave,
  onSaved,
}: {
  agents: PiAgentDef[];
  selectedAgent: PiAgentDef | null;
  onSelect: (fileName: string | null) => void;
  onSave: (fileName: string, patch: { model?: string; thinking?: string }) => Promise<boolean>;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border py-12"
        style={{ borderColor: 'var(--settings-border)' }}
      >
        <Brain className="h-8 w-8" style={{ color: 'var(--settings-text-tertiary)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--settings-text-secondary)' }}>
          {t('settings.piSubagents.noAgents')}
        </p>
        <p className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
          {t('settings.piSubagents.noAgentsDesc')}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--settings-border)' }}
    >
      <div
        className="w-72 shrink-0 space-y-2 overflow-y-auto border-r p-3"
        style={{
          borderColor: 'var(--settings-border)',
          maxHeight: '70vh',
        }}
      >
        {agents.map((agent) => (
          <button
            key={agent.fileName}
            onClick={() => onSelect(agent.fileName)}
            className="w-full rounded-lg border px-3 py-3 text-left transition-colors"
            style={{
              borderColor:
                selectedAgent?.fileName === agent.fileName
                  ? 'var(--accent, var(--text-link))'
                  : 'var(--settings-border)',
              backgroundColor:
                selectedAgent?.fileName === agent.fileName
                  ? 'var(--settings-bg-secondary)'
                  : 'transparent',
              color: 'var(--settings-text-primary)',
            }}
          >
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 shrink-0" style={{ color: 'var(--accent, var(--text-link))' }} />
              <span className="truncate text-sm font-medium">{agent.name}</span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor:
                    agent.package === 'custom'
                      ? 'var(--accent-muted, rgba(59,130,246,0.15))'
                      : 'var(--settings-bg-tertiary)',
                  color:
                    agent.package === 'custom'
                      ? 'var(--accent, var(--text-link))'
                      : 'var(--settings-text-tertiary)',
                }}
              >
                {agent.package}
              </span>
            </div>
            <p
              className="mt-1 line-clamp-2 text-xs"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {agent.description}
            </p>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 p-6">
        {selectedAgent ? (
          <AgentCard agent={selectedAgent} onSave={onSave} onSaved={onSaved} />
        ) : (
          <div
            className="flex h-40 items-center justify-center text-sm"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.selectHint')}
          </div>
        )}
      </div>
    </div>
  );
}

function ChainList({
  chains,
  selectedChain,
  onSelect,
}: {
  chains: PiChainDef[];
  selectedChain: PiChainDef | null;
  onSelect: (fileName: string | null) => void;
}) {
  const { t } = useTranslation();

  if (chains.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border py-12"
        style={{ borderColor: 'var(--settings-border)' }}
      >
        <GitBranch className="h-8 w-8" style={{ color: 'var(--settings-text-tertiary)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--settings-text-secondary)' }}>
          {t('settings.piSubagents.noChains')}
        </p>
        <p className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
          {t('settings.piSubagents.noChainsDesc')}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--settings-border)' }}
    >
      <div
        className="w-72 shrink-0 space-y-2 overflow-y-auto border-r p-3"
        style={{
          borderColor: 'var(--settings-border)',
          maxHeight: '70vh',
        }}
      >
        {chains.map((chain) => (
          <button
            key={chain.fileName}
            onClick={() => onSelect(chain.fileName)}
            className="w-full rounded-lg border px-3 py-3 text-left transition-colors"
            style={{
              borderColor:
                selectedChain?.fileName === chain.fileName
                  ? 'var(--success)'
                  : 'var(--settings-border)',
              backgroundColor:
                selectedChain?.fileName === chain.fileName
                  ? 'var(--settings-bg-secondary)'
                  : 'transparent',
              color: 'var(--settings-text-primary)',
            }}
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} />
              <span className="truncate text-sm font-medium">{chain.name}</span>
            </div>
            <p
              className="mt-1 line-clamp-2 text-xs"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {chain.description}
            </p>
            <p
              className="mt-1 text-xs"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {chain.steps.length} {t('settings.piSubagents.stepsCount')}
            </p>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 p-6">
        {selectedChain ? (
          <ChainView chain={selectedChain} />
        ) : (
          <div
            className="flex h-40 items-center justify-center text-sm"
            style={{ color: 'var(--settings-text-tertiary)' }}
          >
            {t('settings.piSubagents.selectHint')}
          </div>
        )}
      </div>
    </div>
  );
}

function RunHistoryList({ records }: { records: PiRunRecord[] }) {
  const { t } = useTranslation();

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border py-12"
        style={{ borderColor: 'var(--settings-border)' }}
      >
        <History className="h-8 w-8" style={{ color: 'var(--settings-text-tertiary)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--settings-text-secondary)' }}>
          {t('settings.piSubagents.noHistory')}
        </p>
        <p className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
          {t('settings.piSubagents.noHistoryDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--settings-border)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr
            className="border-b"
            style={{
              borderColor: 'var(--settings-border)',
              backgroundColor: 'var(--settings-bg-secondary)',
            }}
          >
            <th
              className="px-4 py-3 text-left text-xs font-medium"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {t('settings.piSubagents.agent')}
            </th>
            <th
              className="px-4 py-3 text-left text-xs font-medium"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {t('settings.piSubagents.time')}
            </th>
            <th
              className="px-4 py-3 text-left text-xs font-medium"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {t('settings.piSubagents.status')}
            </th>
            <th
              className="px-4 py-3 text-right text-xs font-medium"
              style={{ color: 'var(--settings-text-tertiary)' }}
            >
              {t('settings.piSubagents.duration')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--settings-border)' }}>
          {records.map((r, i) => (
            <tr key={`${r.taskHash}-${i}`} className="transition-colors hover:bg-black/5 dark:hover:bg-white/5">
              <td className="px-4 py-3">
                <code className="text-sm" style={{ color: 'var(--accent, var(--text-link))' }}>
                  {r.agent}
                </code>
              </td>
              <td className="px-4 py-3" style={{ color: 'var(--settings-text-secondary)' }}>
                {formatTimestamp(r.ts)}
              </td>
              <td className="px-4 py-3">
                {r.status === 'ok' ? (
                  <span className="flex items-center gap-1" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('settings.piSubagents.statusOk')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                    <XCircle className="h-3.5 w-3.5" />
                    {t('settings.piSubagents.statusError')}
                    {r.exit != null && (
                      <span className="text-xs" style={{ color: 'var(--settings-text-tertiary)' }}>
                        (exit {r.exit})
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td
                className="px-4 py-3 text-right"
                style={{ color: 'var(--settings-text-secondary)' }}
              >
                {r.duration != null ? formatDuration(r.duration) : '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {records.length >= 100 && (
        <p
          className="border-t px-4 py-2 text-xs"
          style={{
            borderColor: 'var(--settings-border)',
            color: 'var(--settings-text-tertiary)',
          }}
        >
          {t('settings.piSubagents.showingRecent')}
        </p>
      )}
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

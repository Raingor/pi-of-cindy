/**
 * Types for pi-agent data layer — shared between main process pi-reader and renderer via IPC.
 * Ported from pi-web-switch/src/types/index.ts with adaptations for Cindy's architecture.
 */

// ─── Usage & Analytics ─────────────────────────────────────────────────────

export interface PiUsageRecord {
  date: string; // YYYY-MM-DD
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  cost: number;
}

export interface PiDailyAggregate {
  date: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface PiProviderUsageSummary {
  providerId: string;
  providerName: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  modelCount: number;
}

export interface PiModelUsageSummary {
  modelId: string;
  providerId: string;
  modelName: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  avgTokensPerRequest: number;
}

export interface PiUsageByRangeResult {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  totalRequests: number;
  cacheHitRate: number;
  dailyBreakdown: PiDailyAggregate[];
  hourlyBreakdown: PiHourlyAggregate[];
  requestLog: PiRequestLogEntry[];
  providerStats: PiProviderUsageSummary[];
  modelStats: PiModelUsageSummary[];
}

export interface PiHourlyAggregate {
  date: string;
  hour: number;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
}

export interface PiRequestLogEntry {
  date: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  cost: number;
}

// ─── Sessions ──────────────────────────────────────────────────────────────

export interface PiSessionFileInfo {
  id: string;
  fileName: string;
  filePath: string;
  timestamp: number;
  lastActive: number;
  name?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  duration?: number;
}

export interface PiProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: PiSessionFileInfo[];
  totalSessions: number;
  lastActive: number;
}

export interface PiSessionPreviewMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export interface PiSessionPreviewResult {
  messages: PiSessionPreviewMessage[];
  total: number;
}

export interface PiTrashEntry {
  trashPath: string;
  originalPath: string;
  fileName: string;
  trashedAt: string;
  sessionId: string;
  sessionName: string;
  lastActive: number;
  messageCount: number;
}

// ─── Memory (Hermes) ──────────────────────────────────────────────────────

export interface PiMemoryFile {
  name: string;
  filename: string;
  content: string;
  updatedAt: string;
}

export interface PiHermesMemoryConfig {
  llmModelOverride?: string;
  llmThinkingOverride?: string;
  consolidationTimeoutMs?: number;
  memoryCharLimit?: number;
  userCharLimit?: number;
  memoryOverflowStrategy?: 'auto-consolidate' | 'reject' | 'fifo-evict';
}

export interface PiMemoryStatusTarget {
  filename: string;
  target: 'memory' | 'user' | 'failure';
  chars: number;
  limit: number;
}

export interface PiMemoryStatus {
  targets: PiMemoryStatusTarget[];
}

export interface PiOptimizeMemoryResult {
  success: boolean;
  before: number;
  after: number;
  freedBytes: number;
  message?: string;
}

// ─── Subagents ─────────────────────────────────────────────────────────────

export interface PiAgentDef {
  name: string;
  fileName: string;
  filePath: string;
  package: string;
  description: string;
  model?: string;
  tools?: string[];
  thinking?: string;
  systemPromptMode?: string;
  inheritProjectContext?: boolean;
  inheritSkills?: boolean;
  input?: string[];
  body: string;
}

export interface PiChainStep {
  agent: string;
  phase?: string;
  label?: string;
  output?: string;
  as?: string;
  task?: string;
}

export interface PiChainDef {
  name: string;
  fileName: string;
  filePath: string;
  description: string;
  steps: PiChainStep[];
  body: string;
}

export interface PiRunRecord {
  agent: string;
  ts: number;
  status: string;
  duration?: number;
  exit?: number;
  taskHash?: string;
}

export interface PiSubagentsData {
  agents: PiAgentDef[];
  chains: PiChainDef[];
  runHistory: PiRunRecord[];
}

// ─── Packages & Updates ────────────────────────────────────────────────────

export interface PiUpdateItem {
  name: string;
  installed: string;
  latest: string | null;
  hasUpdate: boolean;
}

export interface PiUpdateCheckResult {
  pi: PiUpdateItem | null;
  extensions: PiUpdateItem[];
  checkedAt: number;
}

export interface PiApplyUpdateResult {
  name: string;
  success: boolean;
  message?: string;
}

export interface PiPackageSearchResult {
  name: string;
  description: string;
  version: string;
  downloads: number;
  link: string;
}

// ─── Provider Testing ──────────────────────────────────────────────────────

export interface PiProviderTestResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
}

export interface PiFetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  source: 'openai' | 'openrouter' | 'ollama' | 'heuristic';
}

export interface PiFetchModelsResult {
  models: PiFetchedModel[];
  error?: string;
}

// ─── Settings (pi settings.json) ───────────────────────────────────────────

export interface PiSettings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  defaultProjectTrust?: string;
  theme?: 'light' | 'dark' | 'light/dark';
  hideThinkingBlock?: boolean;
  retry?: { enabled: boolean };
  packages?: string[];
  terminal?: { showTerminalProgress?: boolean };
  warnings?: Record<string, boolean>;
  treeFilterMode?: string;
  doubleEscapeAction?: string;
  enabledModels?: string[];
}

export interface PiCustomProviderModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image' | 'audio')[];
  contextWindow?: number;
  maxTokens?: number;
  enabled?: boolean;
}

export interface PiCustomProviderConfig {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: PiCustomProviderModel[];
}

export interface PiModelsJson {
  providers: Record<string, PiCustomProviderConfig>;
}

export interface PiConfig {
  settings: PiSettings;
  auth: Record<string, { type: string; key?: string }>;
  modelsJson: PiModelsJson | null;
}

// ─── Config Import/Export ──────────────────────────────────────────────────

export interface PiExportPayload {
  version: string;
  exportedAt: string;
  config: PiConfig;
}

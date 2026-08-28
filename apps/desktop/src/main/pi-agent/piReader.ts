/**
 * pi-agent data reader — reads ~/.pi/agent/ configuration and session data.
 * Ported from pi-web-switch/server/pi-reader.ts for Cindy's main process.
 *
 * All functions are safe to call from the main process; they only read/write
 * files under ~/.pi/agent/ and do not touch Cindy's own SQLite/safeStorage.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  PiAgentDef,
  PiApplyUpdateResult,
  PiChainDef,
  PiChainStep,
  PiConfig,
  PiFetchedModel,
  PiFetchModelsResult,
  PiHermesMemoryConfig,
  PiMemoryFile,
  PiMemoryStatus,
  PiModelUsageSummary,
  PiOptimizeMemoryResult,
  PiPackageSearchResult,
  PiProjectGroup,
  PiProviderTestResult,
  PiProviderUsageSummary,
  PiRunRecord,
  PiSessionFileInfo,
  PiSessionPreviewMessage,
  PiSessionPreviewResult,
  PiSettings,
  PiSubagentsData,
  PiTrashEntry,
  PiUpdateCheckResult,
  PiUpdateItem,
  PiUsageByRangeResult,
  PiUsageRecord,
  PiDailyAggregate,
  PiHourlyAggregate,
  PiRequestLogEntry,
} from './piTypes.js';
import { readPiUsageRecords, readCindyPiUsageRecords } from './piUsageParser.js';

// ─── Path Constants ────────────────────────────────────────────────────────

const PI_DIR = join(homedir(), '.pi', 'agent');
const SESSIONS_DIR = join(PI_DIR, 'sessions');
const TRASH_DIR = join(PI_DIR, '.trash');
const HERMES_DIR = join(PI_DIR, 'pi-hermes-memory');
const AGENTS_DIR = join(PI_DIR, 'agents');
const CHAINS_DIR = join(PI_DIR, 'chains');
const RUN_HISTORY_FILE = join(PI_DIR, 'run-history.jsonl');

const CINDY_PI_SESSIONS_DIR =
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Cindy', 'pi-agent-home', 'sessions')
    : join(homedir(), '.config', 'cindy', 'pi-agent-home', 'sessions');

const MEMORY_FILENAMES = ['MEMORY.md', 'USER.md', 'failures.md'];
const DEFAULT_MEMORY_CHAR_LIMIT = 5000;
const DEFAULT_USER_CHAR_LIMIT = 5000;
const STALE_SESSION_DAYS = 14;
const USAGE_CACHE_TTL_MS = 30_000;

// ─── Usage Cache ───────────────────────────────────────────────────────────

let usageCache: { ts: number; records: PiUsageRecord[] } | null = null;

export function clearUsageCache(): void {
  usageCache = null;
}

// ─── Settings ──────────────────────────────────────────────────────────────

function piPath(filename: string): string {
  return join(PI_DIR, filename);
}

function readJson<T>(filename: string): T | null {
  const p = piPath(filename);
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filename: string, data: unknown): boolean {
  try {
    writeFileSync(piPath(filename), JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function readSettings(): PiSettings | null {
  return readJson<PiSettings>('settings.json');
}

export function writeSettings(settings: PiSettings): boolean {
  return writeJson('settings.json', settings);
}

export function readAuth(): Record<string, { type: string; key?: string }> | null {
  return readJson('auth.json');
}

export function writeAuth(auth: Record<string, { type: string; key?: string }>): boolean {
  return writeJson('auth.json', auth);
}

export function readModelsJson(): { providers: Record<string, unknown> } | null {
  return readJson('models.json');
}

export function writeModelsJson(models: { providers: Record<string, unknown> }): boolean {
  return writeJson('models.json', models);
}

// ─── Usage ─────────────────────────────────────────────────────────────────

export function readAllUsage(): PiUsageRecord[] {
  if (usageCache && Date.now() - usageCache.ts < USAGE_CACHE_TTL_MS) {
    return usageCache.records;
  }
  const piRecords = readPiUsageRecords();
  const cindyRecords = readCindyPiUsageRecords();
  const all = [...piRecords, ...cindyRecords];
  usageCache = { ts: Date.now(), records: all };
  return all;
}

export function getUsageByRange(fromDate: string, toDate: string): PiUsageByRangeResult {
  const records = readAllUsage().filter((r) => r.date >= fromDate && r.date <= toDate);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let totalRequests = 0;

  const dailyMap = new Map<string, PiDailyAggregate>();
  const hourlyMap = new Map<string, PiHourlyAggregate>();
  const requestLogMap = new Map<string, PiRequestLogEntry>();
  const providerMap = new Map<string, { tokens: number; cost: number; requests: number; models: Set<string> }>();
  const modelMap = new Map<string, { tokens: number; cost: number; requests: number; providerId: string }>();

  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCacheRead += r.cacheReadTokens;
    totalCacheWrite += r.cacheWriteTokens;
    totalCost += r.cost;
    totalRequests += r.requests;

    // Daily
    const daily = dailyMap.get(r.date) ?? { date: r.date, totalTokens: 0, totalCost: 0, totalRequests: 0, inputTokens: 0, outputTokens: 0 };
    const tokens = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    daily.totalTokens += tokens;
    daily.totalCost += r.cost;
    daily.totalRequests += r.requests;
    daily.inputTokens += r.inputTokens;
    daily.outputTokens += r.outputTokens;
    dailyMap.set(r.date, daily);

    // Provider
    const prov = providerMap.get(r.providerId) ?? { tokens: 0, cost: 0, requests: 0, models: new Set() };
    prov.tokens += tokens;
    prov.cost += r.cost;
    prov.requests += r.requests;
    prov.models.add(r.modelId);
    providerMap.set(r.providerId, prov);

    // Model
    const modelKey = `${r.providerId}|${r.modelId}`;
    const mod = modelMap.get(modelKey) ?? { tokens: 0, cost: 0, requests: 0, providerId: r.providerId };
    mod.tokens += tokens;
    mod.cost += r.cost;
    mod.requests += r.requests;
    modelMap.set(modelKey, mod);

    // Request log
    const logKey = `${r.date}|${r.providerId}|${r.modelId}`;
    const logEntry = requestLogMap.get(logKey) ?? { ...r };
    if (requestLogMap.has(logKey)) {
      const existing = requestLogMap.get(logKey)!;
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.cacheReadTokens += r.cacheReadTokens;
      existing.cacheWriteTokens += r.cacheWriteTokens;
      existing.requests += r.requests;
      existing.cost += r.cost;
    } else {
      requestLogMap.set(logKey, { ...r });
    }
  }

  const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;
  const cacheHitRate = totalCacheRead + totalCacheWrite > 0
    ? totalCacheRead / (totalCacheRead + totalCacheWrite)
    : 0;

  const dailyBreakdown = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const hourlyBreakdown: PiHourlyAggregate[] = [];
  const requestLog = Array.from(requestLogMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  const providerStats: PiProviderUsageSummary[] = Array.from(providerMap.entries()).map(([id, v]) => ({
    providerId: id,
    providerName: id,
    totalTokens: v.tokens,
    totalCost: v.cost,
    totalRequests: v.requests,
    modelCount: v.models.size,
  })).sort((a, b) => b.totalCost - a.totalCost);

  const modelStats: PiModelUsageSummary[] = Array.from(modelMap.entries()).map(([key, v]) => {
    const [, modelId] = key.split('|');
    return {
      modelId,
      providerId: v.providerId,
      modelName: modelId,
      totalTokens: v.tokens,
      totalCost: v.cost,
      totalRequests: v.requests,
      avgTokensPerRequest: v.requests > 0 ? Math.round(v.tokens / v.requests) : 0,
    };
  }).sort((a, b) => b.totalCost - a.totalCost);

  return {
    totalTokens,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalCost,
    totalRequests,
    cacheHitRate,
    dailyBreakdown,
    hourlyBreakdown,
    requestLog,
    providerStats,
    modelStats,
  };
}

// ─── Sessions ──────────────────────────────────────────────────────────────

function decodeProjectPath(dirName: string): string {
  return dirName.replace(/^--/, '/').replace(/--/g, '/');
}

function parseSessionFile(filePath: string): PiSessionFileInfo | null {
  try {
    const stat = statSync(filePath);
    const fileName = filePath.split(sep).pop() ?? '';
    const id = fileName.replace('.jsonl', '');

    let name: string | undefined;
    let provider: string | undefined;
    let model: string | undefined;
    let messageCount = 0;
    let lastActive = stat.mtimeMs;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'message') {
          messageCount++;
          if (obj.message?.role === 'assistant' && obj.timestamp) {
            lastActive = Math.max(lastActive, new Date(obj.timestamp).getTime());
          }
        }
        if (obj.type === 'session_start' && obj.name) {
          name = obj.name;
        }
        if (obj.type === 'model_change') {
          if (obj.provider) provider = obj.provider;
          if (obj.model) model = obj.model;
        }
      } catch {
        continue;
      }
    }

    return {
      id,
      fileName,
      filePath,
      timestamp: stat.birthtimeMs,
      lastActive,
      name,
      provider,
      model,
      messageCount,
    };
  } catch {
    return null;
  }
}

export function listSessions(): PiProjectGroup[] {
  const groups = new Map<string, PiSessionFileInfo[]>();

  const scanDir = (dir: string) => {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory() && entry.startsWith('--')) {
          const projectPath = decodeProjectPath(entry);
          const projectName = projectPath.split('/').pop() ?? projectPath;
          const sessions: PiSessionFileInfo[] = [];

          const subEntries = readdirSync(fullPath);
          for (const subEntry of subEntries) {
            if (subEntry.endsWith('.jsonl')) {
              const info = parseSessionFile(join(fullPath, subEntry));
              if (info) sessions.push(info);
            }
          }

          if (sessions.length > 0) {
            sessions.sort((a, b) => b.lastActive - a.lastActive);
            groups.set(projectPath, sessions);
          }
        } else if (entry.endsWith('.jsonl')) {
          const info = parseSessionFile(fullPath);
          if (info) {
            const key = '(root)';
            const existing = groups.get(key) ?? [];
            existing.push(info);
            groups.set(key, existing);
          }
        }
      }
    } catch {
      return;
    }
  };

  scanDir(SESSIONS_DIR);

  const result: PiProjectGroup[] = [];
  for (const [projectPath, sessions] of groups) {
    const projectName = projectPath === '(root)' ? '(root)' : projectPath.split('/').pop() ?? projectPath;
    result.push({
      projectPath,
      projectName,
      sessions,
      totalSessions: sessions.length,
      lastActive: Math.max(...sessions.map((s) => s.lastActive)),
    });
  }

  return result.sort((a, b) => b.lastActive - a.lastActive);
}

export function readSessionPreview(filePath: string, limit = 20): PiSessionPreviewResult | null {
  const resolved = resolve(filePath);
  const inSessions = resolved.startsWith(resolve(SESSIONS_DIR));
  const inTrash = resolved.startsWith(resolve(TRASH_DIR));
  if (!inSessions && !inTrash) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const messages: PiSessionPreviewMessage[] = [];
    let total = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'message' && obj.message) {
          const role = obj.message.role;
          if (role !== 'user' && role !== 'assistant') continue;
          total++;

          let text = '';
          const content = obj.message.content;
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text') text += part.text ?? '';
              else if (part.type === 'tool_use') text += `[Tool: ${part.name}] `;
              else if (part.type === 'tool_result') text += `[Tool result] `;
            }
          }

          if (text.trim()) {
            messages.push({
              role,
              text: text.slice(0, 400),
              timestamp: obj.timestamp,
            });
          }

          if (messages.length >= limit) break;
        }
      } catch {
        continue;
      }
    }

    return { messages, total };
  } catch {
    return null;
  }
}

// ─── Trash ─────────────────────────────────────────────────────────────────

function ensureTrashDir(): void {
  if (!existsSync(TRASH_DIR)) {
    mkdirSync(TRASH_DIR, { recursive: true });
  }
}

export function trashSessionFile(filePath: string): boolean {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(SESSIONS_DIR))) return false;
  if (!resolved.endsWith('.jsonl')) return false;
  if (!existsSync(resolved)) return false;

  ensureTrashDir();
  const rel = relative(SESSIONS_DIR, resolved);
  const trashPath = join(TRASH_DIR, rel);
  const trashDir = join(trashPath, '..');
  if (!existsSync(trashDir)) mkdirSync(trashDir, { recursive: true });

  try {
    renameSync(resolved, trashPath);
    return true;
  } catch {
    return false;
  }
}

export function listTrash(): PiTrashEntry[] {
  ensureTrashDir();
  const entries: PiTrashEntry[] = [];

  const scanDir = (dir: string, baseDir: string) => {
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath, baseDir);
        } else if (item.endsWith('.jsonl')) {
          const rel = relative(baseDir, fullPath);
          const sessionId = item.replace('.jsonl', '');
          entries.push({
            trashPath: fullPath,
            originalPath: join(SESSIONS_DIR, rel),
            fileName: item,
            trashedAt: stat.ctime.toISOString(),
            sessionId,
            sessionName: sessionId,
            lastActive: stat.mtimeMs,
            messageCount: 0,
          });
        }
      }
    } catch {
      return;
    }
  };

  scanDir(TRASH_DIR, TRASH_DIR);
  return entries.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

export function restoreFromTrash(trashPath: string): boolean {
  const resolved = resolve(trashPath);
  if (!resolved.startsWith(resolve(TRASH_DIR))) return false;
  if (!existsSync(resolved)) return false;

  const rel = relative(TRASH_DIR, resolved);
  const originalPath = join(SESSIONS_DIR, rel);
  const originalDir = join(originalPath, '..');
  if (!existsSync(originalDir)) mkdirSync(originalDir, { recursive: true });

  try {
    renameSync(resolved, originalPath);
    return true;
  } catch {
    return false;
  }
}

export function permanentlyDeleteTrash(trashPath: string): boolean {
  const resolved = resolve(trashPath);
  if (!resolved.startsWith(resolve(TRASH_DIR))) return false;
  if (!existsSync(resolved)) return false;

  try {
    unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

// ─── Memory (Hermes) ──────────────────────────────────────────────────────

export function readMemoryFiles(): PiMemoryFile[] {
  const files: PiMemoryFile[] = [];

  for (const filename of MEMORY_FILENAMES) {
    const filePath = join(HERMES_DIR, filename);
    try {
      if (!existsSync(filePath)) {
        files.push({ name: filename, filename, content: '', updatedAt: new Date().toISOString() });
        continue;
      }
      const stat = statSync(filePath);
      const content = readFileSync(filePath, 'utf-8');
      const name = filename === 'MEMORY.md' ? 'Project Memories' : filename === 'USER.md' ? 'User Profile' : 'Failure Records';
      files.push({ name, filename, content, updatedAt: stat.mtime.toISOString() });
    } catch {
      files.push({ name: filename, filename, content: '', updatedAt: new Date().toISOString() });
    }
  }

  return files;
}

export function readHermesMemoryConfig(): PiHermesMemoryConfig {
  const config = readJson<Partial<PiHermesMemoryConfig>>('hermes-memory-config.json');
  if (!config) return {};
  return {
    llmModelOverride: typeof config.llmModelOverride === 'string' ? config.llmModelOverride : undefined,
    llmThinkingOverride: typeof config.llmThinkingOverride === 'string' ? config.llmThinkingOverride : undefined,
    consolidationTimeoutMs: typeof config.consolidationTimeoutMs === 'number' ? config.consolidationTimeoutMs : undefined,
    memoryCharLimit: typeof config.memoryCharLimit === 'number' ? config.memoryCharLimit : undefined,
    userCharLimit: typeof config.userCharLimit === 'number' ? config.userCharLimit : undefined,
    memoryOverflowStrategy: config.memoryOverflowStrategy,
  };
}

export function writeHermesMemoryConfig(patch: PiHermesMemoryConfig): boolean {
  const existing = readJson<Record<string, unknown>>('hermes-memory-config.json') ?? {};
  const merged = { ...existing, ...patch };
  if (patch.llmModelOverride === '') delete merged.llmModelOverride;
  return writeJson('hermes-memory-config.json', merged);
}

export function readMemoryStatus(): PiMemoryStatus {
  const config = readHermesMemoryConfig();
  const memoryLimit = config.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT;
  const userLimit = config.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT;

  const targets = [];
  for (const filename of MEMORY_FILENAMES) {
    const filePath = join(HERMES_DIR, filename);
    let chars = 0;
    try {
      if (existsSync(filePath)) {
        chars = readFileSync(filePath, 'utf-8').length;
      }
    } catch { /* ignore */ }

    const target: 'memory' | 'user' | 'failure' = filename === 'MEMORY.md' ? 'memory' : filename === 'USER.md' ? 'user' : 'failure';
    const limit = target === 'memory' ? memoryLimit : target === 'user' ? userLimit : memoryLimit * 2;
    targets.push({ filename, target, chars, limit });
  }

  return { targets };
}

export function deleteMemoryEntry(filename: string, entryText: string): boolean {
  if (!MEMORY_FILENAMES.includes(filename)) return false;
  const filePath = join(HERMES_DIR, filename);
  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const sections = content.split(/^§\s*$/m);
    const filtered = sections.filter((section) => {
      const trimmed = section.trim();
      const cleanText = entryText.replace(/<!-- created=.*? -->/g, '').trim();
      const cleanSection = trimmed.replace(/<!-- created=.*? -->/g, '').trim();
      return cleanSection !== cleanText && trimmed !== '';
    });
    writeFileSync(filePath, filtered.join('§\n\n'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function optimizeMemory(): Promise<PiOptimizeMemoryResult> {
  const config = readHermesMemoryConfig();
  const before = readMemoryStatus().targets.reduce((sum, t) => sum + t.chars, 0);

  return new Promise((resolve) => {
    const piBinary = process.env.PI_BINARY ?? 'pi';
    const extEntry = join(PI_DIR, 'npm', 'node_modules', 'pi-hermes-memory', 'src', 'index.ts');

    const args = ['-p', '--no-session', '-e', extEntry];
    if (config.llmModelOverride) args.push('--model', config.llmModelOverride);
    if (config.llmThinkingOverride) args.push('--thinking', config.llmThinkingOverride);

    const child = spawn(piBinary, args, { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ success: false, before, after: before, freedBytes: 0, message: 'Timeout' });
    }, config.consolidationTimeoutMs ?? 600_000);

    child.on('close', () => {
      clearTimeout(timeout);
      const after = readMemoryStatus().targets.reduce((sum, t) => sum + t.chars, 0);
      resolve({ success: true, before, after, freedBytes: before - after });
    });

    child.on('error', () => {
      clearTimeout(timeout);
      resolve({ success: false, before, after: before, freedBytes: 0, message: 'Failed to start pi' });
    });
  });
}

// ─── Subagents ─────────────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, unknown> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
    else if (/^\d+\.\d+$/.test(value as string)) value = parseFloat(value as string);
    else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
      const inner = (value as string).slice(1, -1);
      value = inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      value = (value as string).replace(/^["']|["']$/g, '');
    }

    result[key] = value;
  }

  return result;
}

export function listAgents(): PiAgentDef[] {
  if (!existsSync(AGENTS_DIR)) return [];
  const agents: PiAgentDef[] = [];

  try {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
    for (const fileName of files) {
      const filePath = join(AGENTS_DIR, fileName);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const fm = parseFrontmatter(content);
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

        agents.push({
          name: (fm.name as string) ?? fileName.replace('.md', ''),
          fileName,
          filePath,
          package: (fm.package as string) ?? 'user',
          description: (fm.description as string) ?? '',
          model: fm.model as string | undefined,
          tools: fm.tools as string[] | undefined,
          thinking: fm.thinking as string | undefined,
          systemPromptMode: fm.systemPromptMode as string | undefined,
          inheritProjectContext: fm.inheritProjectContext as boolean | undefined,
          inheritSkills: fm.inheritSkills as boolean | undefined,
          input: fm.input as string[] | undefined,
          body: body.slice(0, 500),
        });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return agents;
}

export function listChains(): PiChainDef[] {
  if (!existsSync(CHAINS_DIR)) return [];
  const chains: PiChainDef[] = [];

  try {
    const files = readdirSync(CHAINS_DIR).filter((f) => f.endsWith('.chain.md'));
    for (const fileName of files) {
      const filePath = join(CHAINS_DIR, fileName);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const fm = parseFrontmatter(content);
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

        const steps: PiChainStep[] = [];
        const stepMatches = body.matchAll(/^##\s+(.+)$/gm);
        for (const match of stepMatches) {
          steps.push({ agent: match[1].trim() });
        }

        chains.push({
          name: (fm.name as string) ?? fileName.replace('.chain.md', ''),
          fileName,
          filePath,
          description: (fm.description as string) ?? '',
          steps,
          body: body.slice(0, 500),
        });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return chains;
}

export function readRunHistory(limit = 100): PiRunRecord[] {
  if (!existsSync(RUN_HISTORY_FILE)) return [];

  try {
    const content = readFileSync(RUN_HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const records: PiRunRecord[] = [];

    for (const line of lines.slice(-limit)) {
      try {
        const obj = JSON.parse(line);
        records.push({
          agent: obj.agent ?? '',
          ts: obj.ts ?? 0,
          status: obj.status ?? 'unknown',
          duration: obj.duration,
          exit: obj.exit,
          taskHash: obj.taskHash,
        });
      } catch {
        continue;
      }
    }

    return records.reverse();
  } catch {
    return [];
  }
}

export function readSubagents(): PiSubagentsData {
  return {
    agents: listAgents(),
    chains: listChains(),
    runHistory: readRunHistory(),
  };
}

export function updateAgentFields(fileName: string, patch: { model?: string; thinking?: string }): boolean {
  if (!/^[\w.-]+\.md$/.test(fileName)) return false;
  const filePath = join(AGENTS_DIR, fileName);
  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath, 'utf-8');
    let updated = content;

    if (patch.model !== undefined) {
      if (patch.model === '') {
        updated = updated.replace(/^model:\s*.*\n/m, '');
      } else if (/^model:\s*/m.test(updated)) {
        updated = updated.replace(/^model:\s*.*\n/m, `model: ${patch.model}\n`);
      } else {
        updated = updated.replace(/^(---\n)/, `$1model: ${patch.model}\n`);
      }
    }

    if (patch.thinking !== undefined) {
      if (patch.thinking === '') {
        updated = updated.replace(/^thinking:\s*.*\n/m, '');
      } else if (/^thinking:\s*/m.test(updated)) {
        updated = updated.replace(/^thinking:\s*.*\n/m, `thinking: ${patch.thinking}\n`);
      } else {
        updated = updated.replace(/^(---\n)/, `$1thinking: ${patch.thinking}\n`);
      }
    }

    writeFileSync(filePath, updated, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ─── Packages & Updates ────────────────────────────────────────────────────

export async function checkUpdates(): Promise<PiUpdateCheckResult> {
  const extensions: PiUpdateItem[] = [];
  const npmDir = join(PI_DIR, 'npm');
  const pkgJsonPath = join(npmDir, 'package.json');

  let piItem: PiUpdateItem | null = null;
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      const child = spawn('pi', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.on('close', () => resolve({ stdout }));
      child.on('error', reject);
    });
    const installed = stdout.trim();
    piItem = { name: '@earendil-works/pi-coding-agent', installed, latest: null, hasUpdate: false };

    try {
      const resp = await fetch('https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest');
      if (resp.ok) {
        const data = await resp.json() as { version: string };
        piItem.latest = data.version;
        piItem.hasUpdate = data.version !== installed;
      }
    } catch { /* ignore */ }
  } catch { /* ignore */ }

  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const deps = pkg.dependencies ?? {};

      for (const [name, installed] of Object.entries(deps)) {
        if (name === '@earendil-works/pi-coding-agent') continue;
        const item: PiUpdateItem = { name, installed: installed as string, latest: null, hasUpdate: false };

        try {
          const resp = await fetch(`https://registry.npmjs.org/${name}/latest`);
          if (resp.ok) {
            const data = await resp.json() as { version: string };
            item.latest = data.version;
            item.hasUpdate = data.version !== installed;
          }
        } catch { /* ignore */ }

        extensions.push(item);
      }
    } catch { /* ignore */ }
  }

  return { pi: piItem, extensions, checkedAt: Date.now() };
}

export async function applyExtensionUpdates(names: string[]): Promise<PiApplyUpdateResult[]> {
  const results: PiApplyUpdateResult[] = [];
  const npmDir = join(PI_DIR, 'npm');

  for (const name of names) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('npm', ['install', `${name}@latest`, '--no-audit', '--no-fund', '--legacy-peer-deps'], {
          cwd: npmDir,
          stdio: 'ignore',
        });
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
        child.on('error', reject);
      });
      results.push({ name, success: true });
    } catch (err) {
      results.push({ name, success: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return results;
}

export async function searchPackages(query: string): Promise<PiPackageSearchResult[]> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}%20pi&size=40`);
    if (!resp.ok) return [];
    const data = await resp.json() as { objects: Array<{ package: { name: string; description: string; version: string } }> };

    return data.objects
      .filter((obj) => /pi|agent|coding/i.test(obj.package.name + ' ' + obj.package.description))
      .map((obj) => ({
        name: obj.package.name,
        description: obj.package.description ?? '',
        version: obj.package.version,
        downloads: 0,
        link: `https://www.npmjs.com/package/${obj.package.name}`,
      }));
  } catch {
    return [];
  }
}

// ─── Provider Testing ──────────────────────────────────────────────────────

export async function testProviderConnection(baseUrl: string, apiKey?: string): Promise<PiProviderTestResult> {
  try {
    const start = Date.now();
    const resp = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;

    return {
      success: resp.ok,
      status: resp.status,
      latencyMs,
      message: resp.ok ? undefined : `HTTP ${resp.status}`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function testModel(baseUrl: string, modelId: string, apiKey?: string): Promise<PiProviderTestResult> {
  try {
    const start = Date.now();
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply ok' }],
        max_tokens: 4,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      return { success: false, status: resp.status, latencyMs, message: `HTTP ${resp.status}` };
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
    const ok = data.choices?.[0]?.message?.content || data.usage;
    return { success: !!ok, status: resp.status, latencyMs, message: ok ? undefined : 'Invalid response' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchProviderModels(baseUrl: string, apiKey?: string): Promise<PiFetchModelsResult> {
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return { models: [], error: `HTTP ${resp.status}` };
    }

    const data = await resp.json() as { data?: Array<{ id: string }>; models?: Array<{ id: string }> };
    const rawModels = data.data ?? data.models ?? [];

    const models: PiFetchedModel[] = rawModels.map((m) => ({
      id: m.id,
      name: m.id,
      source: 'openai' as const,
    }));

    return { models };
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Config Import/Export ──────────────────────────────────────────────────

export function exportPiConfig(): PiConfig {
  return {
    settings: readSettings() ?? {},
    auth: readAuth() ?? {},
    modelsJson: readModelsJson() as PiConfig['modelsJson'],
  };
}

export function importPiConfig(config: PiConfig): boolean {
  let ok = true;
  if (config.settings) ok = writeSettings(config.settings) && ok;
  if (config.auth) ok = writeAuth(config.auth) && ok;
  if (config.modelsJson) ok = writeModelsJson(config.modelsJson) && ok;
  return ok;
}

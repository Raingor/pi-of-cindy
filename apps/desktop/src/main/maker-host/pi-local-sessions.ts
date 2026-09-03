/**
 * Pi CLI local session bridge.
 *
 * pi 把原生会话历史存为 `~/.pi/agent/sessions/**.jsonl`(目录名 `--` 编码项目路径)。
 * 本模块把用户在 pi CLI 里跑过的会话投影成普通 xdt-maker Pi 任务(agent_kind='pi'):
 *   - scan(设置页「本地任务导入」):只读、头部限量摘要,列候选;
 *   - import(用户勾选确认后):upsert sessions 行;
 *   - messages 懒导入:messages:list 首次拉取该会话时才解析 JSONL 落 messages 表。
 *
 * 会话钥匙语义:pi 的 resume 走 `switch_session(sessionPath)` —— **JSONL 绝对路径**就是
 * 会话身份,maker-core 落库 sdk_session_id 存的也是它。因此导入行的 sdk_session_id =
 * 文件绝对路径,与 Cindy 自建 pi 任务共用同一 resume 语义(文件在共享目录,可直接续聊)。
 *
 * JSONL 行形态(实测 pi 0.84.x):
 *   {type:'session', version, id, timestamp, cwd}
 *   {type:'session_info', name}                        — pi /rename 写的会话名
 *   {type:'model_change', provider, modelId}
 *   {type:'thinking_level_change', thinkingLevel}
 *   {type:'message', id, parentId, timestamp, message:{role, content[], toolCallId?, usage?}}
 *     role ∈ user | assistant | toolResult;content part ∈ text | thinking | toolCall | image
 */

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { getCurrentDbClientUserId, getDbClient } from '../localDb/client/current.js';
import { createLogger } from '../logger.js';
import { normalizeWorkingDirForStorage } from '../../shared/workingDir.js';
import { recordPrRefsForImportedMessages } from '../git-context/prRefsStore.js';
import { commitMessageMediaRefs } from '../cindy-media/chatAttachments.js';
import { capImportedToolResultContent } from '../../shared/toolResultPersistCap.js';

const log = createLogger('pi-local-sessions');

/** 导入行的本地会话 id 前缀(messages:list 懒导入按它分发)。 */
const LOCAL_SESSION_ID_PREFIX = 'pi-';
/** 扫描摘要的头部读取上限(与 claude-local-sessions 同款量级)。 */
const SCAN_SUMMARY_MAX_BYTES = 384 * 1024;
const SCAN_SUMMARY_MAX_LINES = 400;
const SCAN_SUMMARY_CACHE_MAX_ENTRIES = 8192;
/** 单目录(项目分组)最多列出的会话数,防畸形目录拖垮扫描。 */
const MAX_SESSIONS_PER_DIR = 1000;

interface PiScanSummaryCacheEntry {
  scope: string;
  mtimeMs: number;
  size: number;
  summary: PiSessionScanSummary | null;
}

interface PiMessageImportFileCacheEntry {
  scope: string;
  path: string;
  mtimeMs: number;
  size: number;
}

export interface PiSessionScanSummary {
  /** JSONL 文件名去扩展名(候选 id,如 `2026-08-31T07-38-59-815Z_01a056c1-…`)。 */
  fileStem: string;
  /** 会话钥匙 = JSONL 绝对路径(pi switch_session / sdk_session_id 语义)。 */
  sdkSessionPath: string;
  title: string;
  cwd: string;
  /** `provider/modelId` 形态(与模型选择器 wire id 同口径,如 `openai-codex/gpt-5.6-terra`)。 */
  model: string;
  tokensUsed: number;
  createdAt: number;
  updatedAt: number;
}

export interface PiExternalSessionCandidate {
  source: 'pi';
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
  archived: boolean;
  sourceFile: string;
}

export interface PiExternalScanResult {
  roots: string[];
  candidates: PiExternalSessionCandidate[];
  rejectedCount: number;
}

export interface PiExternalImportResult {
  roots: number;
  scanned: number;
  inserted: number;
  updated: number;
}

/** 消息导入行(与 claude import 同形状,复用同一 tx op)。 */
export interface ImportedPiMessage {
  lineNo: number;
  partIndex: number;
  role: string;
  content: unknown;
  toolUseId: string | null;
  agentMeta: Record<string, unknown> | null;
  createdAt: number;
}

const piScanSummaryCache = new Map<string, PiScanSummaryCacheEntry>();
const piMessageImportFileCache = new Map<string, PiMessageImportFileCacheEntry>();

export function piSessionsDir(): string {
  return path.join(os.homedir(), '.pi', 'agent', 'sessions');
}

// ─── Scan(设置页只读扫描)──────────────────────────────────────────────────

export async function scanExternalPiSessions(options: {
  maxSessionsPerDir?: number;
} = {}): Promise<PiExternalScanResult> {
  const maxPerDir = options.maxSessionsPerDir ?? MAX_SESSIONS_PER_DIR;
  const root = piSessionsDir();
  const candidates: PiExternalSessionCandidate[] = [];
  let rejectedCount = 0;
  if (!existsSync(root)) return { roots: [], candidates, rejectedCount };

  const scope = getCurrentDbClientUserId();
  const dirs: Array<{ dir: string; limit: number }> = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    if (statSync(fullPath).isDirectory() && entry.startsWith('--')) {
      dirs.push({ dir: fullPath, limit: maxPerDir });
    } else if (entry.endsWith('.jsonl')) {
      dirs.push({ dir: root, limit: maxPerDir });
    }
  }

  for (const { dir, limit } of dirs) {
    let scannedForDir = 0;
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.jsonl')) files.push(path.join(dir, entry));
    }
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const file of files) {
      if (scannedForDir >= limit) break;
      const summary = await readPiSessionScanSummary(file, scope);
      if (!summary) {
        rejectedCount += 1;
        continue;
      }
      scannedForDir += 1;
      candidates.push({
        source: 'pi',
        id: summary.fileStem,
        title: summary.title,
        cwd: summary.cwd,
        updatedAt: new Date(summary.updatedAt).toISOString(),
        archived: false,
        sourceFile: summary.sdkSessionPath,
      });
    }
  }
  candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { roots: [root], candidates, rejectedCount };
}

// ─── Import(sessions 行 upsert)─────────────────────────────────────────────

export async function importExternalPiSessions(fileStems: string[]): Promise<PiExternalImportResult> {
  const root = piSessionsDir();
  const out: PiExternalImportResult = { roots: existsSync(root) ? 1 : 0, scanned: 0, inserted: 0, updated: 0 };
  const uniqueStems = [...new Set(fileStems)].filter((stem) => stem && !stem.includes('/') && !stem.includes('\\'));
  out.scanned = uniqueStems.length;
  for (const stem of uniqueStems) {
    const file = await findPiSessionFileByStem(stem);
    if (!file) continue;
    const summary = await readPiSessionSummary(file);
    if (!summary) continue;
    const action = await upsertPiLocalSession(summary);
    if (action === 'inserted') out.inserted += 1;
    else if (action === 'updated') out.updated += 1;
  }
  return out;
}

async function findPiSessionFileByStem(stem: string): Promise<string | null> {
  const root = piSessionsDir();
  if (!existsSync(root)) return null;
  const direct = path.join(root, `${stem}.jsonl`);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    if (!statSync(fullPath).isDirectory() || !entry.startsWith('--')) continue;
    const candidate = path.join(fullPath, `${stem}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 头部限量摘要(扫描态):mtime+size 缓存,读前 SCAN_SUMMARY_MAX_LINES 行拿
 * cwd / 标题 / 模型;updatedAt 以文件 mtime 兜底(尾部时间戳在头部读不到)。
 */
async function readPiSessionScanSummary(
  file: string,
  cacheScope: string | null,
): Promise<PiSessionScanSummary | null> {
  let stat: { mtimeMs: number; size: number };
  try {
    const s = await fsp.stat(file);
    stat = { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
  const cacheKey = cacheScope ? `${cacheScope}\0${file}` : file;
  const cached = piScanSummaryCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.summary;
  }
  if (piScanSummaryCache.size > SCAN_SUMMARY_CACHE_MAX_ENTRIES) piScanSummaryCache.clear();
  const summary = await readPiSessionSummary(file, {
    maxBytes: SCAN_SUMMARY_MAX_BYTES,
    maxLines: SCAN_SUMMARY_MAX_LINES,
  });
  piScanSummaryCache.set(cacheKey, { scope: cacheScope ?? '', mtimeMs: stat.mtimeMs, size: stat.size, summary });
  return summary;
}

/** 全量摘要(导入态):读整个文件,时间戳/用量取真实尾值。 */
async function readPiSessionSummary(
  file: string,
  limits?: { maxBytes?: number; maxLines?: number },
): Promise<PiSessionScanSummary | null> {
  let statMs: number;
  try {
    const s = await fsp.stat(file);
    statMs = Math.floor(s.mtimeMs);
  } catch {
    return null;
  }
  const fileStem = path.basename(file, '.jsonl');
  let title = '';
  let cwd = '';
  let provider = '';
  let modelId = '';
  let tokensUsed = 0;
  let createdAt = Number.POSITIVE_INFINITY;
  let updatedAt = 0;
  let sawSessionLine = false;

  const input = createReadStream(file, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lineCount = 0;
  let readBytes = 0;
  for await (const line of rl) {
    lineCount += 1;
    readBytes += line.length + 1;
    // 扫描态只读头部:标题 / cwd / 模型都在开头几行,尾部时间戳由 mtime 兜底。
    // **不能因文件总大小拒绝候选** —— 真实工作会话动辄几 MB,那样会把它们全筛掉。
    if (limits?.maxLines !== undefined && lineCount > limits.maxLines) break;
    if (limits?.maxBytes !== undefined && readBytes > limits.maxBytes) break;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof obj.type === 'string' ? obj.type : '';
    if (type === 'session') {
      sawSessionLine = true;
      if (typeof obj.cwd === 'string' && obj.cwd.trim()) cwd = obj.cwd;
      const ts = Date.parse(typeof obj.timestamp === 'string' ? obj.timestamp : '');
      if (Number.isFinite(ts)) createdAt = ts;
    } else if (type === 'session_info' && typeof obj.name === 'string' && obj.name.trim()) {
      title = obj.name.trim();
    } else if (type === 'model_change') {
      if (typeof obj.provider === 'string' && obj.provider.trim()) provider = obj.provider;
      if (typeof obj.modelId === 'string' && obj.modelId.trim()) modelId = obj.modelId;
      else if (typeof obj.model === 'string' && obj.model.trim()) modelId = obj.model;
    } else if (type === 'message' && obj.message && typeof obj.message === 'object') {
      const message = obj.message as Record<string, unknown>;
      const ts = Date.parse(typeof obj.timestamp === 'string' ? obj.timestamp : '');
      if (Number.isFinite(ts)) updatedAt = Math.max(updatedAt, ts);
      if (message.role === 'user' && !title) {
        const text = piUserText(message.content);
        if (text) title = makeTitle(text);
      }
      const usage = message.usage;
      if (usage && typeof usage === 'object') {
        const total = (usage as Record<string, unknown>).totalTokens;
        if (typeof total === 'number' && Number.isFinite(total) && total > 0) tokensUsed = total;
      }
    }
  }
  if (!sawSessionLine) return null;
  if (!Number.isFinite(createdAt)) createdAt = statMs;
  if (updatedAt <= 0) updatedAt = statMs;
  else updatedAt = Math.max(updatedAt, statMs);
  return {
    fileStem,
    sdkSessionPath: file,
    title: title || 'Pi Session',
    cwd: cwd || os.homedir(),
    model: provider && modelId ? `${provider}/${modelId}` : modelId || 'openai-codex/gpt-5.6-terra',
    tokensUsed,
    createdAt,
    updatedAt,
  };
}

async function upsertPiLocalSession(summary: PiSessionScanSummary): Promise<'inserted' | 'updated' | 'skipped'> {
  const existingRows = await getDbClient().query<{ id: string; updatedAt: number; status: string }>(`
    SELECT id, updated_at AS updatedAt, status
    FROM sessions
    WHERE agent_kind = 'pi' AND sdk_session_id = ?
  `, [summary.sdkSessionPath]);
  // 只认存活的非导入行(分享导入等)为占位;软删行不挡导入(与 claude 侧 #599 语义一致)。
  if (existingRows.some((row) => row.status !== 'deleted' && !row.id.startsWith(LOCAL_SESSION_ID_PREFIX))) {
    return 'skipped';
  }
  const existing = existingRows.find((row) => row.id.startsWith(LOCAL_SESSION_ID_PREFIX));
  const localId = existing?.id ?? `${LOCAL_SESSION_ID_PREFIX}${summary.fileStem}`;
  const existingById = await getDbClient().queryOne<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? LIMIT 1',
    [localId],
  );
  const existed = !!existing || !!existingById;
  const result = await getDbClient().exec(`
    INSERT INTO sessions (
      id, title, working_dir, model, effort, permission_mode, status, sdk_session_id,
      total_token_usage, total_cost_usd, context_tokens, context_window, fast_mode,
      cleared_at, pinned_at, user_send_at, agent_kind, parent_session_id,
      forked_at_message_id, worktree_path, source, feishu_open_id, feishu_bot_app_id,
      used_project_context, extra_dirs, workspace_kind, created_at, updated_at
    )
    VALUES (
      ?, ?, ?, ?, 'high', 'ask', 'active', ?,
      ?, 0, 0, 0, 0,
      NULL, NULL, ?, 'pi', NULL,
      NULL, NULL, 'desktop', NULL, NULL,
      0, '[]', 'project', ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = CASE WHEN sessions.updated_at <= excluded.updated_at THEN excluded.title ELSE sessions.title END,
      working_dir = CASE WHEN sessions.updated_at <= excluded.updated_at THEN excluded.working_dir ELSE sessions.working_dir END,
      workspace_kind = excluded.workspace_kind,
      model = CASE WHEN sessions.updated_at <= excluded.updated_at THEN excluded.model ELSE sessions.model END,
      permission_mode = excluded.permission_mode,
      status = excluded.status,
      sdk_session_id = excluded.sdk_session_id,
      total_token_usage = CASE WHEN sessions.updated_at <= excluded.updated_at THEN excluded.total_token_usage ELSE sessions.total_token_usage END,
      updated_at = CASE WHEN sessions.updated_at <= excluded.updated_at THEN excluded.updated_at ELSE sessions.updated_at END
    WHERE sessions.status != 'deleted'
  `, [
    localId,
    summary.title,
    normalizeWorkingDirForStorage(summary.cwd) ?? summary.cwd,
    summary.model,
    summary.sdkSessionPath,
    summary.tokensUsed,
    summary.updatedAt,
    summary.createdAt,
    summary.updatedAt,
  ]);
  if (!existed && result.changes > 0) return 'inserted';
  if (existed && result.changes > 0) return 'updated';
  return 'skipped';
}

// ─── Messages 懒导入(messages:list 首拉触发)──────────────────────────────

/**
 * 为导入的 pi 会话按需导入历史消息。源 JSONL 未变化时直接短路;会话已有本地
 * 新消息后维持「不再刷新外部历史」语义(与 claude 侧同款守卫)。
 */
export async function importExternalPiMessagesForSession(sessionId: string): Promise<void> {
  const session = await getDbClient().queryOne<{
    id: string;
    agentKind: string;
    sdkSessionId: string | null;
    model: string;
  }>(`
    SELECT id, agent_kind AS agentKind, sdk_session_id AS sdkSessionId, model
    FROM sessions
    WHERE id = ?
    LIMIT 1
  `, [sessionId]);
  if (session?.agentKind !== 'pi') return;
  if (!session.sdkSessionId) return;
  if (!session.id.startsWith(LOCAL_SESSION_ID_PREFIX)) return;

  const importClientIdPrefix = `pi-import:${session.sdkSessionId}:`;
  const hasLocalMessages = await getDbClient().queryOne<{ one: number }>(`
    SELECT 1
    FROM messages
    WHERE session_id = ?
      AND client_id NOT LIKE ?
      AND client_id NOT LIKE 'app-exit-interrupted-%'
    LIMIT 1
  `, [sessionId, `${importClientIdPrefix}%`]);
  if (hasLocalMessages) return;

  const cacheScope = getCurrentDbClientUserId();
  const cached = piMessageImportFileCache.get(sessionId);
  if (cacheScope && cached?.scope === cacheScope) {
    try {
      const s = await fsp.stat(cached.path);
      if (s.mtimeMs === cached.mtimeMs && s.size === cached.size) return;
    } catch {
      // fall through to re-read
    }
    piMessageImportFileCache.delete(sessionId);
  } else if (cached) {
    piMessageImportFileCache.delete(sessionId);
  }

  const sourceFile = session.sdkSessionId;
  let sourceStat: { mtimeMs: number; size: number };
  try {
    const s = await fsp.stat(sourceFile);
    sourceStat = { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    log.debug('message import skipped: pi session file missing', { sessionId });
    return;
  }

  const imported = await readPiMessages(sourceFile, session.model);
  if (imported.length > 0) {
    const rows = [];
    for (const row of imported) {
      if (row.role === 'tool_result' && typeof row.content === 'string') {
        await commitMessageMediaRefs({
          sessionId,
          role: 'tool_result',
          content: row.content,
        }).catch((err) => {
          log.warn('imported pi tool_result media ref commit failed', {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      rows.push({
        lineNo: row.lineNo,
        partIndex: row.partIndex,
        role: row.role,
        content: capImportedToolResultContent(row.role, row.content),
        toolUseId: row.toolUseId,
        agentMeta: row.agentMeta,
        createdAt: row.createdAt,
      });
    }
    const { changed } = await getDbClient().tx('pi.importMessages', {
      sessionId,
      importClientIdPrefix,
      sdkSessionId: session.sdkSessionId,
      rows,
    });
    if (changed === 0) {
      piMessageImportFileCache.set(sessionId, { scope: cacheScope ?? '', path: sourceFile, ...sourceStat });
      return;
    }
    log.info('imported external pi messages', {
      sessionId,
      file: path.basename(sourceFile),
      count: changed,
    });
    void recordPrRefsForImportedMessages(
      sessionId,
      imported.map((row) => ({
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      })),
    ).catch(() => undefined);
  }
  piMessageImportFileCache.set(sessionId, { scope: cacheScope ?? '', path: sourceFile, ...sourceStat });
}

async function readPiMessages(file: string, fallbackModel: string): Promise<ImportedPiMessage[]> {
  const input = createReadStream(file, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const out: ImportedPiMessage[] = [];
  let lineNo = 0;
  let sequence = 0;
  for await (const line of rl) {
    lineNo += 1;
    const rows = parsePiMessageLine(line, lineNo, fallbackModel);
    for (const row of rows) {
      sequence += 1;
      out.push({ ...row, createdAt: row.createdAt + sequence });
    }
  }
  return out;
}

/** 单行 JSONL → 消息行(导出供单测)。非 message 行(session/model_change/…)一律忽略。 */
export function parsePiMessageLine(
  line: string,
  lineNo: number,
  fallbackModel: string,
): ImportedPiMessage[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (obj.type !== 'message' || !obj.message || typeof obj.message !== 'object') return [];
  const message = obj.message as Record<string, unknown>;
  const createdAt = Date.parse(typeof obj.timestamp === 'string' ? obj.timestamp : '') || Date.now();
  const role = typeof message.role === 'string' ? message.role : '';
  const content = Array.isArray(message.content) ? message.content : [];
  const meta = { model: fallbackModel };

  if (role === 'user') {
    const text = piUserText(message.content);
    if (!text) return [];
    return [{
      lineNo,
      partIndex: 0,
      role: 'user',
      content: text,
      toolUseId: null,
      agentMeta: null,
      createdAt,
    }];
  }
  if (role === 'assistant') {
    const out: ImportedPiMessage[] = [];
    let partIndex = 0;
    for (const block of content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      const part = block as Record<string, unknown>;
      const partType = typeof part.type === 'string' ? part.type : '';
      if (partType === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        out.push({
          lineNo, partIndex: partIndex++, role: 'assistant',
          content: part.text, toolUseId: null, agentMeta: meta, createdAt,
        });
      } else if (partType === 'thinking' && typeof part.thinking === 'string') {
        out.push({
          lineNo, partIndex: partIndex++, role: 'thinking',
          content: { text: part.thinking, durationMs: 0, isRedacted: false },
          toolUseId: null, agentMeta: meta, createdAt,
        });
      } else if (partType === 'toolCall') {
        const toolUseId = typeof part.id === 'string' ? part.id : '';
        out.push({
          lineNo, partIndex: partIndex++, role: 'tool_use',
          content: {
            toolUseId,
            toolName: typeof part.name === 'string' ? part.name : '',
            input: part.arguments ?? null,
          },
          toolUseId: toolUseId || null, agentMeta: meta, createdAt,
        });
      }
      // image parts v1 不导入(与 claude 导入的 v1 取舍一致,后续按需补媒体抽取)。
    }
    return out;
  }
  if (role === 'toolResult') {
    const text = piToolResultText(message.content);
    const toolUseId = typeof message.toolCallId === 'string' ? message.toolCallId : null;
    return [{
      lineNo,
      partIndex: 0,
      role: 'tool_result',
      content: text,
      toolUseId,
      agentMeta: null,
      createdAt,
    }];
  }
  return [];
}

function piUserText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const part = block as Record<string, unknown>;
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      parts.push(part.text);
    }
  }
  return parts.join('\n\n');
}

function piToolResultText(content: unknown): string {
  return piUserText(content);
}

function makeTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
  const title = firstLine.trim();
  return title.length > 60 ? `${title.slice(0, 60)}…` : title;
}

/**
 * Pi Agent 数据层 IPC handler — Settings 里 6 个 Pi tab 的 main 侧入口。
 *
 * 纯 adapter:参数校验 + 调 piReader 的服务函数。业务逻辑(文件解析、缓存、npm 查询)
 * 在 piReader.ts / piUsageParser.ts,单测直接打那两层。
 *
 * 所有 channel 只读写 ~/.pi/agent/,不碰 Cindy 自身的 SQLite/safeStorage。
 */

import { ipcMain } from 'electron';

import { createLogger } from '../logger.js';
import {
  applyExtensionUpdates,
  checkUpdates,
  deleteMemoryEntry,
  exportPiConfig,
  fetchProviderModels,
  getUsageByRange,
  importPiConfig,
  listSessions,
  listTrash,
  optimizeMemory,
  permanentlyDeleteTrash,
  readAllUsage,
  readHermesMemoryConfig,
  readMemoryFiles,
  readMemoryStatus,
  readSessionPreview,
  readSettings,
  readSubagents,
  restoreFromTrash,
  searchPackages,
  testModel,
  testProviderConnection,
  trashSessionFile,
  updateAgentFields,
  writeHermesMemoryConfig,
  writeSettings,
} from '../pi-agent/piReader.js';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer.js';
import {
  optionalString,
  requireNonNegativeInt,
  requireObject,
  requireString,
  throwIpcError,
} from '../utils/ipcValidate.js';
import { MAKER_INVOKE } from './channels.js';

const log = createLogger('maker-ipc/pi-agent');

export function registerPiAgentIpc(): void {
  // ── Settings ────────────────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_READ_SETTINGS, (event) => {
    assertTrustedAppRendererEvent(event);
    return readSettings();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_WRITE_SETTINGS, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const settings = requireObject(raw, 'settings');
    const ok = writeSettings(settings as Parameters<typeof writeSettings>[0]);
    if (!ok) throwIpcError('PI_AGENT_DIR_NOT_FOUND', '~/.pi/agent directory not found');
    return { success: true };
  });

  // ── Usage ───────────────────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_READ_USAGE, (event) => {
    assertTrustedAppRendererEvent(event);
    return readAllUsage();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_USAGE_BY_RANGE, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const from = requireString(args.fromDate, 'fromDate');
    const to = requireString(args.toDate, 'toDate');
    return getUsageByRange(from, to);
  });

  // ── Sessions ────────────────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_LIST_SESSIONS, (event) => {
    assertTrustedAppRendererEvent(event);
    return listSessions();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_SESSION_PREVIEW, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const filePath = requireString(args.filePath, 'filePath');
    const limit =
      args.limit !== undefined ? requireNonNegativeInt(args.limit, 'limit') : 20;
    return readSessionPreview(filePath, limit);
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_TRASH_SESSION, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const filePath = requireString(args.filePath, 'filePath');
    const ok = trashSessionFile(filePath);
    if (!ok) throwIpcError('PI_AGENT_SESSION_LOCKED', 'session file is locked or not found');
    return { success: true };
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_LIST_TRASH, (event) => {
    assertTrustedAppRendererEvent(event);
    return listTrash();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_RESTORE_TRASH, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const trashPath = requireString(args.trashPath, 'trashPath');
    const ok = restoreFromTrash(trashPath);
    if (!ok) throwIpcError('NOT_FOUND', 'trash entry not found');
    return { success: true };
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_DELETE_TRASH, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const trashPath = requireString(args.trashPath, 'trashPath');
    const ok = permanentlyDeleteTrash(trashPath);
    if (!ok) throwIpcError('NOT_FOUND', 'trash entry not found');
    return { success: true };
  });

  // ── Memory ──────────────────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_READ_MEMORY, (event) => {
    assertTrustedAppRendererEvent(event);
    return readMemoryFiles();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_DELETE_MEMORY_ENTRY, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const filename = requireString(args.filename, 'filename');
    const entryText = requireString(args.entryText, 'entryText');
    const ok = deleteMemoryEntry(filename, entryText);
    if (!ok) throwIpcError('NOT_FOUND', 'memory entry not found');
    return { success: true };
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_OPTIMIZE_MEMORY, async (event) => {
    assertTrustedAppRendererEvent(event);
    try {
      return await optimizeMemory();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.warn('memory optimize failed', { detail });
      throwIpcError('PI_AGENT_MEMORY_BUSY', detail);
    }
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_READ_MEMORY_CONFIG, (event) => {
    assertTrustedAppRendererEvent(event);
    return readHermesMemoryConfig();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_WRITE_MEMORY_CONFIG, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const config = requireObject(raw, 'config');
    const ok = writeHermesMemoryConfig(config as Parameters<typeof writeHermesMemoryConfig>[0]);
    if (!ok) throwIpcError('PI_AGENT_DIR_NOT_FOUND', 'hermes memory directory not found');
    return { success: true };
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_READ_MEMORY_STATUS, (event) => {
    assertTrustedAppRendererEvent(event);
    return readMemoryStatus();
  });

  // ── Subagents ───────────────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_READ_SUBAGENTS, (event) => {
    assertTrustedAppRendererEvent(event);
    return readSubagents();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_UPDATE_AGENT, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const fileName = requireString(args.fileName, 'fileName');
    const patch = requireObject(args.patch, 'patch');
    const ok = updateAgentFields(fileName, patch as { model?: string; thinking?: string });
    if (!ok) throwIpcError('NOT_FOUND', 'agent file not found');
    return { success: true };
  });

  // ── Packages & Updates ──────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_CHECK_UPDATES, async (event) => {
    assertTrustedAppRendererEvent(event);
    return checkUpdates();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_APPLY_UPDATES, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const names = args.names;
    if (!Array.isArray(names)) throwIpcError('INVALID_PARAMS', 'names must be an array');
    return applyExtensionUpdates(names as string[]);
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_SEARCH_PACKAGES, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const query = requireString(args.query, 'query');
    return searchPackages(query);
  });

  // ── Speed Test ──────────────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_TEST_PROVIDER, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const baseUrl = requireString(args.baseUrl, 'baseUrl');
    const apiKey = optionalString(args.apiKey);
    return testProviderConnection(baseUrl, apiKey);
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_TEST_MODEL, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const baseUrl = requireString(args.baseUrl, 'baseUrl');
    const modelId = requireString(args.modelId, 'modelId');
    const apiKey = optionalString(args.apiKey);
    return testModel(baseUrl, modelId, apiKey);
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_FETCH_MODELS, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const args = requireObject(raw, 'payload');
    const baseUrl = requireString(args.baseUrl, 'baseUrl');
    const apiKey = optionalString(args.apiKey);
    return fetchProviderModels(baseUrl, apiKey);
  });

  // ── Config Import/Export ────────────────────────────────────────────────
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_EXPORT_CONFIG, (event) => {
    assertTrustedAppRendererEvent(event);
    return exportPiConfig();
  });

  ipcMain.handle(MAKER_INVOKE.PI_AGENT_IMPORT_CONFIG, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const config = requireObject(raw, 'config');
    try {
      const ok = importPiConfig(config as unknown as Parameters<typeof importPiConfig>[0]);
      if (!ok) throwIpcError('PI_AGENT_IMPORT_FAILED', 'import merge failed');
      return { success: true };
    } catch (err) {
      if ((err as { code?: string }).code === 'PI_AGENT_IMPORT_FAILED') throw err;
      const detail = err instanceof Error ? err.message : String(err);
      log.warn('pi config import failed', { detail });
      throwIpcError('PI_AGENT_IMPORT_FAILED', detail);
    }
  });
}

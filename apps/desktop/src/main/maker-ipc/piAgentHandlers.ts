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
  getUsageByRange,
  importPiConfig,
  isPiCliInstalled,
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
  trashSessionFile,
  updateAgentFields,
  writeHermesMemoryConfig,
  writeSettings,
} from '../pi-agent/piReader.js';
import {
  addPiCliProviderModel,
  fetchPiCliProviderModels,
  readPiCliExtensions,
  readPiCliProviders,
  removePiCliProvider,
  removePiCliProviderKey,
  renamePiCliProvider,
  runPiCliPackageCommand,
  setPiCliProviderDisabled,
  switchPiCliProviderKey,
  testPiCliModel,
  testPiCliProviderConnection,
  removePiCliProviderModel,
  updatePiCliEnabledModels,
  upsertPiCliProvider,
  upsertPiCliProviderModel,
  type PiCliModelInput,
  type PiCliProviderPatch,
} from '../pi-agent/piCliPanel.js';
import { fetchProviderModels } from '../pi-agent/piReader.js';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer.js';
import {
  optionalString,
  requireEnum,
  requireNonNegativeInt,
  requireObject,
  requireString,
  throwIpcError,
} from '../utils/ipcValidate.js';
import { MAKER_INVOKE } from './channels.js';

const log = createLogger('maker-ipc/pi-agent');

/** mutate 通道的补丁字段白名单：未知键不进 models.json。 */
function parseProviderPatch(raw: Record<string, unknown>): PiCliProviderPatch {
  const patch: PiCliProviderPatch = {};
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.length > 200) {
      throwIpcError('INVALID_PARAMS', 'patch.name must be a short string');
    }
    patch.name = raw.name;
  }
  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string' || raw.baseUrl.length > 2000) {
      throwIpcError('INVALID_PARAMS', 'patch.baseUrl must be a string');
    }
    patch.baseUrl = raw.baseUrl;
  }
  if (raw.api !== undefined) {
    if (typeof raw.api !== 'string' || raw.api.length > 60) {
      throwIpcError('INVALID_PARAMS', 'patch.api must be a string');
    }
    patch.api = raw.api as PiCliProviderPatch['api'];
  }
  if (raw.apiKey !== undefined) {
    if (typeof raw.apiKey !== 'string' || raw.apiKey.length > 2000) {
      throwIpcError('INVALID_PARAMS', 'patch.apiKey must be a string');
    }
    patch.apiKey = raw.apiKey;
  }
  if (raw.apiKeys !== undefined) {
    if (!Array.isArray(raw.apiKeys) || raw.apiKeys.length > 100) {
      throwIpcError('INVALID_PARAMS', 'patch.apiKeys must be an array');
    }
    patch.apiKeys = (raw.apiKeys as unknown[]).map((e) => {
      if (typeof e !== 'object' || e === null) {
        throwIpcError('INVALID_PARAMS', 'patch.apiKeys entries must be objects');
      }
      const entry = e as Record<string, unknown>;
      if (typeof entry.id !== 'string' || typeof entry.key !== 'string') {
        throwIpcError('INVALID_PARAMS', 'patch.apiKeys entries need id and key strings');
      }
      return { id: entry.id.slice(0, 64), key: entry.key };
    });
  }
  if (raw.activeKeyId !== undefined) {
    if (typeof raw.activeKeyId !== 'string' || raw.activeKeyId.length > 64) {
      throwIpcError('INVALID_PARAMS', 'patch.activeKeyId must be a string');
    }
    patch.activeKeyId = raw.activeKeyId;
  }
  if (raw.headers !== undefined) {
    if (typeof raw.headers !== 'object' || raw.headers === null || Array.isArray(raw.headers)) {
      throwIpcError('INVALID_PARAMS', 'patch.headers must be an object');
    }
    patch.headers = raw.headers as Record<string, string>;
  }
  if (raw.compat !== undefined) {
    if (typeof raw.compat !== 'object' || raw.compat === null || Array.isArray(raw.compat)) {
      throwIpcError('INVALID_PARAMS', 'patch.compat must be an object');
    }
    patch.compat = raw.compat as PiCliProviderPatch['compat'];
  }
  if (raw.models !== undefined) {
    if (!Array.isArray(raw.models) || raw.models.length > 2000) {
      throwIpcError('INVALID_PARAMS', 'patch.models must be an array');
    }
    patch.models = (raw.models as unknown[]).map((m) => parseModelInput(m as Record<string, unknown>));
  }
  return patch;
}

/** 模型定义字段白名单。 */
function parseModelInput(raw: Record<string, unknown>): PiCliModelInput {
  const input: PiCliModelInput = { id: requireString(raw.id, 'model.id') };
  if (input.id.length > 200) throwIpcError('INVALID_PARAMS', 'model.id too long');
  if (typeof raw.name === 'string' && raw.name.length <= 200) input.name = raw.name;
  if (raw.reasoning === true) input.reasoning = true;
  if (Array.isArray(raw.input)) {
    const vals = raw.input.filter((x): x is string => typeof x === 'string');
    if (vals.length > 0) input.input = vals;
  }
  for (const k of ['contextWindow', 'maxTokens'] as const) {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) input[k] = raw[k];
  }
  if (raw.cost && typeof raw.cost === 'object' && !Array.isArray(raw.cost)) {
    const c = raw.cost as Record<string, unknown>;
    const cost: PiCliModelInput['cost'] = {};
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      if (typeof c[k] === 'number' && Number.isFinite(c[k])) {
        cost[k] = c[k];
      }
    }
    if (Object.keys(cost).length > 0) input.cost = cost;
  }
  return input;
}

export function registerPiAgentIpc(): void {
  // ── Installation probe ──────────────────────────────────────────────────
  // 登录后的安装提示只需要一个布尔;不回目录路径,避免把用户 home 路径交给 Renderer。
  ipcMain.handle(MAKER_INVOKE.PI_AGENT_INSTALL_STATUS, (event) => {
    assertTrustedAppRendererEvent(event);
    return { installed: isPiCliInstalled() };
  });

  // ── Local Pi CLI panel ──────────────────────────────────────────────────
  // providers 的 apiKey / apiKeys 真值不出主进程:这里回的是剥密视图。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_LIST_PROVIDERS, (event) => {
    assertTrustedAppRendererEvent(event);
    return readPiCliProviders();
  });

  ipcMain.handle(MAKER_INVOKE.PI_CLI_LIST_EXTENSIONS, (event) => {
    assertTrustedAppRendererEvent(event);
    return readPiCliExtensions();
  });

  ipcMain.handle(MAKER_INVOKE.PI_CLI_PACKAGE_MUTATE, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const action = requireEnum(payload.action, ['install', 'remove'] as const, 'action');
    const source = requireString(payload.source, 'source');
    // source 直接进 argv(spawn 无 shell),但仍要挡住空白与超长输入。
    if (source.length > 512 || /\s/.test(source)) {
      throwIpcError('INVALID_PARAMS', 'invalid package source');
    }
    try {
      await runPiCliPackageCommand(action, source);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_BINARY_UNAVAILABLE') {
        throwIpcError('PI_AGENT_DIR_NOT_FOUND', 'Pi binary is not available in Cindy');
      }
      if (message === 'PI_CLI_DIR_MISSING') {
        throwIpcError('PI_AGENT_DIR_NOT_FOUND', '~/.pi/agent directory not found');
      }
      log.warn('pi cli package mutation failed', { action });
      throwIpcError('PI_AGENT_IMPORT_FAILED', message.slice(0, 500));
    }
  });

  // ── Local Pi CLI: provider live test(真值 key 全程留在主进程)──────────────
  // Renderer 只传 providerId;主进程现读 models.json/auth.json 取 baseUrl + 生效
  // key 发请求,只把测试结果(状态/延迟/模型清单)投影回 Renderer。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_TEST_PROVIDER, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const providerId = requireString(payload.providerId, 'providerId');
    try {
      return await testPiCliProviderConnection(providerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_CLI_PROVIDER_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'provider not found in ~/.pi/agent/models.json');
      }
      if (message === 'PI_CLI_PROVIDER_NO_BASEURL') {
        throwIpcError('INVALID_PARAMS', 'provider has no baseUrl configured');
      }
      log.warn('pi cli provider test failed', { providerId });
      throwIpcError('INTERNAL', message.slice(0, 500));
    }
  });

  ipcMain.handle(MAKER_INVOKE.PI_CLI_FETCH_MODELS, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const providerId = requireString(payload.providerId, 'providerId');
    try {
      return await fetchPiCliProviderModels(providerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_CLI_PROVIDER_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'provider not found in ~/.pi/agent/models.json');
      }
      if (message === 'PI_CLI_PROVIDER_NO_BASEURL') {
        throwIpcError('INVALID_PARAMS', 'provider has no baseUrl configured');
      }
      log.warn('pi cli provider fetch-models failed', { providerId });
      throwIpcError('INTERNAL', message.slice(0, 500));
    }
  });

  // 测速面板单模型探测:同上口径,Renderer 只传 providerId + modelId,真 key 全程在主进程。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_TEST_MODEL, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const providerId = requireString(payload.providerId, 'providerId');
    const modelId = requireString(payload.modelId, 'modelId');
    try {
      return await testPiCliModel(providerId, modelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_CLI_PROVIDER_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'provider not found in ~/.pi/agent/models.json');
      }
      if (message === 'PI_CLI_PROVIDER_NO_BASEURL') {
        throwIpcError('INVALID_PARAMS', 'provider has no baseUrl configured');
      }
      log.warn('pi cli model test failed', { providerId });
      throwIpcError('INTERNAL', message.slice(0, 500));
    }
  });

  // 面板「切换生效 key」:唯一写通道。只收 providerId + keyId,写回动作在主进程内
  // 完成,返回值只有布尔,不回传任何 key 真值。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_SWITCH_KEY, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const providerId = requireString(payload.providerId, 'providerId');
    const keyId = requireString(payload.keyId, 'keyId');
    try {
      switchPiCliProviderKey(providerId, keyId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_CLI_PROVIDER_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'provider not found in ~/.pi/agent/models.json');
      }
      if (message === 'PI_CLI_KEY_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'key not found in the provider key pool');
      }
      if (message === 'PI_CLI_WRITE_FAILED') {
        log.warn('pi cli key switch write failed', { providerId });
        throwIpcError('PI_AGENT_IMPORT_FAILED', 'failed to write ~/.pi/agent/models.json');
      }
      log.warn('pi cli key switch failed', { providerId });
      throwIpcError('INTERNAL', message.slice(0, 500));
    }
  });

  // 测速页「添加模型到正式配置」：payload 不含任何凭证字段；同 id 幂等返回 added=false。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_ADD_MODEL, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const providerId = requireString(payload.providerId, 'providerId');
    const model = requireObject(payload.model, 'model');
    const modelId = requireString(model.id, 'model.id');
    if (modelId.length > 200) {
      throwIpcError('INVALID_PARAMS', 'model.id too long');
    }
    // 只接受已知形状的字段，避免任意键穿透进 models.json。
    const input: PiCliModelInput = { id: modelId };
    if (typeof model.name === 'string') input.name = model.name;
    if (model.reasoning === true) input.reasoning = true;
    if (Array.isArray(model.input)) {
      const vals = model.input.filter((x): x is string => typeof x === 'string');
      if (vals.length > 0) input.input = vals;
    }
    for (const k of ['contextWindow', 'maxTokens'] as const) {
      if (typeof model[k] === 'number' && Number.isFinite(model[k])) {
        input[k] = model[k];
      }
    }
    const costInput = model.cost as Record<string, unknown> | undefined;
    if (
      costInput &&
      typeof costInput === 'object' &&
      !Array.isArray(costInput) &&
      ['input', 'output', 'cacheRead', 'cacheWrite'].some((k) => k in costInput)
    ) {
      input.cost = {};
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
        if (typeof costInput[k] === 'number' && Number.isFinite(costInput[k])) {
          input.cost[k] = costInput[k];
        }
      }
    }
    try {
      const added = addPiCliProviderModel(providerId, input);
      return { success: true, added };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_CLI_PROVIDER_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'provider not found in ~/.pi/agent/models.json');
      }
      if (message === 'PI_CLI_MODEL_INVALID') {
        throwIpcError('INVALID_PARAMS', 'model definition is invalid');
      }
      if (message === 'PI_CLI_WRITE_FAILED') {
        log.warn('pi cli add-model write failed', { providerId });
        throwIpcError('PI_AGENT_IMPORT_FAILED', 'failed to write ~/.pi/agent/models.json');
      }
      log.warn('pi cli add-model failed', { providerId });
      throwIpcError('INTERNAL', message.slice(0, 500));
    }
  });

  // 供应商/模型语义化变更：action 白名单分发,字段白名单校验,响应永不回传 key 真值。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_MUTATE, (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const action = requireEnum(payload.action, [
      'upsert-provider',
      'rename-provider',
      'remove-provider',
      'set-provider-disabled',
      'upsert-model',
      'remove-model',
      'remove-key',
      'update-enabled',
    ] as const, 'action');
    try {
      switch (action) {
        case 'upsert-provider': {
          const id = requireString(payload.id, 'id');
          upsertPiCliProvider(id, parseProviderPatch(requireObject(payload.patch, 'patch')));
          return { success: true };
        }
        case 'rename-provider': {
          const fromId = requireString(payload.fromId, 'fromId');
          const toId = requireString(payload.toId, 'toId');
          const patch = payload.patch ? parseProviderPatch(requireObject(payload.patch, 'patch')) : undefined;
          renamePiCliProvider(fromId, toId, patch);
          return { success: true };
        }
        case 'remove-provider': {
          removePiCliProvider(requireString(payload.id, 'id'));
          return { success: true };
        }
        case 'set-provider-disabled': {
          const id = requireString(payload.id, 'id');
          if (typeof payload.disabled !== 'boolean') {
            throwIpcError('INVALID_PARAMS', 'disabled must be a boolean');
          }
          setPiCliProviderDisabled(id, payload.disabled);
          return { success: true };
        }
        case 'upsert-model': {
          const providerId = requireString(payload.providerId, 'providerId');
          const model = parseModelInput(requireObject(payload.model, 'model'));
          upsertPiCliProviderModel(providerId, model);
          return { success: true };
        }
        case 'remove-model': {
          removePiCliProviderModel(
            requireString(payload.providerId, 'providerId'),
            requireString(payload.modelId, 'modelId'),
          );
          return { success: true };
        }
        case 'remove-key': {
          // 密钥真值不出主进程:renderer 只有遮罩视图,移除靠 id 定位。
          removePiCliProviderKey(
            requireString(payload.id, 'id'),
            requireString(payload.keyId, 'keyId'),
          );
          return { success: true };
        }
        case 'update-enabled': {
          const change = requireObject(payload.change, 'change');
          const clean: { add?: string[]; remove?: string[]; replaceAll?: string[] } = {};
          for (const k of ['add', 'remove', 'replaceAll'] as const) {
            if (Array.isArray(change[k])) {
              const vals = (change[k] as unknown[]).filter(
                (x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 300,
              );
              if (vals.length > 0) clean[k] = vals.slice(0, 2000);
            }
          }
          updatePiCliEnabledModels(clean);
          return { success: true };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PI_CLI_PROVIDER_NOT_FOUND') {
        throwIpcError('NOT_FOUND', 'provider not found in ~/.pi/agent/models.json');
      }
      if (message === 'PI_CLI_PROVIDER_EXISTS') {
        throwIpcError('INVALID_PARAMS', 'a provider with this id already exists');
      }
      if (message === 'PI_CLI_MODEL_INVALID') {
        throwIpcError('INVALID_PARAMS', 'invalid provider or model payload');
      }
      if (message === 'PI_CLI_WRITE_FAILED') {
        log.warn('pi cli mutate write failed', { action });
        throwIpcError('PI_AGENT_IMPORT_FAILED', 'failed to write ~/.pi/agent config');
      }
      log.warn('pi cli mutate failed', { action });
      throwIpcError('INTERNAL', message.slice(0, 500));
    }
  });

  // 供应商/模型语义化变更：action 白名单分发,字段白名单校验,响应永不回传 key 真值。
  // handler 本体在下方 PI_CLI_MUTATE 分支。

  // 导入弹窗 adhoc 拉取：表单未保存值仅内存透传 main → 上游,不落盘不回显。
  ipcMain.handle(MAKER_INVOKE.PI_CLI_FETCH_MODELS_ADHOC, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    const payload = requireObject(raw, 'payload');
    const baseUrl = requireString(payload.baseUrl, 'baseUrl');
    const apiKey = optionalString(payload.apiKey);
    return fetchProviderModels(baseUrl, apiKey);
  });

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

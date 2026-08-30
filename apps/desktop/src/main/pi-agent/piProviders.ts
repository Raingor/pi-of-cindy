/**
 * apps/desktop/src/main/pi-agent/piProviders.ts
 *
 * Settings 供应商区的 pi 数据层(Phase 6 pi-web-switch 模型)——供应商与模型管理
 * 直接读写 ~/.pi/agent/ 下的 models.json / auth.json / settings.json,内置目录
 * 从本机安装的 pi 自带的 @earendil-works/pi-ai dist/providers/data/*.json 读取,
 * 与用户本机 pi 版本保持同步(pi-web-switch server/pi-reader.ts 的移植)。
 *
 * 安全边界:auth.json / models.json 里的明文密钥只在 main 进程内流动;对
 * Renderer 的所有投影一律打码(maskProviderKey),写路径为语义化操作
 * (setAuth / addModel / updateProvider 等),Renderer 永远不会把打码值回写进文件。
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createLogger } from '../logger.js';
import { getCachedLocalPiPath } from './localPi.js';
import {
  readAuth,
  readModelsJson,
  readSettings,
  writeAuth,
  writeModelsJson,
  writeSettings,
} from './piReader.js';
import type {
  PiCustomProviderConfig,
  PiCustomProviderModel,
  PiModelsJson,
  PiProviderModelView,
  PiProviderView,
  PiSettings,
} from './piTypes.js';

const log = createLogger('pi-agent/piProviders');

// ─── Builtin Catalog(来自本机 pi 安装的 pi-ai 包)────────────────────────────

interface CatalogModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image' | 'audio')[];
  contextWindow?: number;
  maxTokens?: number;
  baseUrl?: string;
  api?: string;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

interface CatalogProvider {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  models: CatalogModel[];
}

const CATALOG_CACHE_TTL_MS = 300_000;
let catalogCache: { providers: CatalogProvider[]; at: number } | null = null;

/**
 * 从解析出的 pi 入口文件向上逐级找 node_modules/@earendil-works/pi-ai/dist/providers。
 * 覆盖 npm 全局(pi-coding-agent 包内依赖)与 pi 官方 tarball(归档根即完整目录)两种布局。
 * 探测缓存里的 pi 路径可能是 symlink(~/.local/bin/pi、FlyEnv 等),先 realpath 再逐级向上。
 */
function findPiAiProvidersDirFromBinary(binaryPath: string): string | null {
  let dir: string | null = null;
  try {
    dir = dirname(realpathSync(resolve(binaryPath)));
  } catch {
    return null;
  }
  for (let i = 0; i < 8 && dir; i += 1) {
    const candidate = join(dir, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers');
    if (existsSync(join(candidate, 'data'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findPiAiProvidersDir(): string | null {
  const binary = getCachedLocalPiPath();
  if (binary) {
    const found = findPiAiProvidersDirFromBinary(binary);
    if (found) return found;
  }
  // piInstaller 落盘位置(~/.pi/bin/pi-runtime)与 pi-node 版本目录兜底
  const home = homedir();
  const roots = [
    join(home, '.pi', 'bin', 'pi-runtime'),
    join(home, '.local', 'share', 'pi-node'),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const candidate = join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers');
    if (existsSync(join(candidate, 'data'))) return candidate;
    try {
      for (const v of readdirSync(root)) {
        const nested = join(root, v, 'lib', 'node_modules', 'pi-coding-agent');
        const nestedCandidate = join(
          nested,
          'node_modules',
          '@earendil-works',
          'pi-ai',
          'dist',
          'providers',
        );
        if (existsSync(join(nestedCandidate, 'data'))) return nestedCandidate;
      }
    } catch {
      // unreadable root — skip
    }
  }
  return null;
}

function catalogProviderName(dir: string, id: string): string {
  try {
    const src = readFileSync(join(dir, `${id}.js`), 'utf-8');
    const esc = id.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
    return (
      src.match(new RegExp(`id:\\s*"${esc}",\\s*name:\\s*"([^"]+)"`))?.[1] ??
      src.match(/createProvider\(\{[^}]*?name:\s*"([^"]+)"/s)?.[1] ??
      ''
    );
  } catch {
    return '';
  }
}

/** 清空内置目录缓存(安装引导完成后、单测间使用)。 */
export function clearBuiltinCatalogCache(): void {
  catalogCache = null;
}

/** 内置供应商目录;本机找不到 pi 时返回 null(UI 落到「引导安装」态)。 */
export function readBuiltinCatalog(): CatalogProvider[] | null {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_TTL_MS) {
    return catalogCache.providers;
  }
  const dir = findPiAiProvidersDir();
  if (!dir) return null;

  let files: string[];
  try {
    files = readdirSync(join(dir, 'data')).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  } catch {
    return null;
  }

  const providers: CatalogProvider[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    let data: Record<string, Record<string, CatalogModel>>;
    try {
      data = JSON.parse(readFileSync(join(dir, 'data', file), 'utf-8'));
    } catch {
      continue;
    }
    const models: CatalogModel[] = [];
    let baseUrl: string | undefined;
    let api: string | undefined;
    for (const apiKey of Object.keys(data)) {
      for (const m of Object.values(data[apiKey] ?? {})) {
        if (!m?.id) continue;
        baseUrl = baseUrl ?? m.baseUrl;
        api = api ?? m.api;
        models.push({
          id: m.id,
          name: m.name,
          reasoning: !!m.reasoning,
          input: Array.isArray(m.input) ? m.input : ['text'],
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          cost: m.cost,
        });
      }
    }
    if (models.length === 0) continue;
    const name = catalogProviderName(dir, id) || titleize(id);
    providers.push({ id, name, api, baseUrl, models: models.sort((a, b) => a.id.localeCompare(b.id)) });
  }

  if (providers.length === 0) return null;
  providers.sort((a, b) => a.id.localeCompare(b.id));
  catalogCache = { providers, at: Date.now() };
  return providers;
}

function titleize(id: string): string {
  return id
    .split('-')
    .map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');
}

// ─── Key Masking(明文密钥只在 main 内流动)────────────────────────────────

export function maskProviderKey(key: string): string {
  if (key.startsWith('$')) return key; // env 引用不是秘密
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

// ─── Provider View 合并(builtin catalog × models.json × auth.json)──────────

type AuthMap = Record<string, { type: string; key?: string }>;

/**
 * pi-web-switch config-store mergeProviders 的 main 侧移植:
 * - models.json 里与 builtin 同 id 且带 apiKey 的条目是独立自定义供应商(取代 builtin 行);
 * - 同 id 不带 apiKey 的是 override(合并额外模型、name/baseUrl/api/headers 覆写);
 * - hasAuth = auth.json 有条目或 override 带 apiKey。
 */
export function listPiProviders(): PiProviderView[] {
  const builtin = readBuiltinCatalog() ?? [];
  const auth = (readAuth() ?? {}) as AuthMap;
  const modelsJson = readModelsJson() as PiModelsJson | null;
  const settings = readSettings();
  const customs = Object.entries(modelsJson?.providers ?? {});

  const builtinIds = new Set(builtin.map((p) => p.id));
  const standaloneIds = new Set(
    customs.filter(([id, cfg]) => builtinIds.has(id) && !!cfg.apiKey).map(([id]) => id),
  );
  const overrides = new Map(customs.filter(([id, cfg]) => builtinIds.has(id) && !cfg.apiKey));

  const views: PiProviderView[] = [];

  for (const p of builtin) {
    if (standaloneIds.has(p.id)) continue;
    const override = overrides.get(p.id);
    const overrideModels = override?.models ?? [];
    const modelMap = new Map(p.models.map((m) => [m.id, m]));
    for (const m of overrideModels) {
      modelMap.set(m.id, {
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
        input: m.input,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        cost: m.cost,
      });
    }
    const authEntry = auth[p.id];
    const overrideKey = override?.apiKey;
    views.push({
      id: p.id,
      name: override?.name ?? p.name,
      type: 'builtin',
      api: override?.api ?? p.api,
      baseUrl: override?.baseUrl ?? p.baseUrl,
      hasAuth: !!authEntry || !!overrideKey,
      keyMasked: authEntry?.key
        ? maskProviderKey(authEntry.key)
        : overrideKey
          ? maskProviderKey(overrideKey)
          : null,
      authSource: authEntry ? 'auth' : overrideKey ? 'modelsJson' : null,
      isOverride: !!override,
      models: [...modelMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
      enabledModels: enabledRefsFor(p.id, settings),
    });
  }

  for (const [id, cfg] of customs) {
    if (!standaloneIds.has(id) && builtinIds.has(id)) continue; // override 已并入 builtin
    const key = cfg.apiKey;
    const authEntry = auth[id];
    views.push({
      id,
      name: cfg.name ?? titleize(id),
      type: 'custom',
      api: cfg.api,
      baseUrl: cfg.baseUrl,
      hasAuth: !!authEntry || !!key,
      keyMasked: authEntry?.key ? maskProviderKey(authEntry.key) : key ? maskProviderKey(key) : null,
      authSource: authEntry ? 'auth' : key ? 'modelsJson' : null,
      isOverride: false,
      models: (cfg.models ?? [])
        .map((m) => ({ ...m }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      enabledModels: enabledRefsFor(id, settings),
    });
  }

  return views;
}

function enabledRefsFor(providerId: string, settings: PiSettings | null): string[] {
  const prefix = `${providerId}/`;
  return (settings?.enabledModels ?? []).filter((ref) => ref.startsWith(prefix));
}

// ─── Auth(auth.json)────────────────────────────────────────────────────────

/** 写入/更新供应商的 api_key 凭证。key 必须是 Renderer 里新输入的明文。 */
export function setPiProviderAuth(providerId: string, key: string): boolean {
  if (!providerId || !key) return false;
  const auth = (readAuth() ?? {}) as AuthMap;
  const updated: AuthMap = { ...auth, [providerId]: { type: 'api_key', key } };
  const ok = writeAuth(updated);
  if (!ok) log.warn('setPiProviderAuth write failed', { providerId });
  return ok;
}

/** 删除供应商的 auth.json 凭证条目;不存在也算成功(幂等)。 */
export function removePiProviderAuth(providerId: string): boolean {
  const auth = (readAuth() ?? {}) as AuthMap;
  if (!(providerId in auth)) return true;
  const { [providerId]: _removed, ...rest } = auth;
  return writeAuth(rest);
}

/**
 * main 侧解析供应商的有效密钥(明文,仅 main 内使用,如连接测试)。
 * 优先 auth.json,其次 models.json override/custom apiKey,再次 $ENV 引用。
 */
export function resolveProviderKey(providerId: string): string | null {
  const auth = (readAuth() ?? {}) as AuthMap;
  const authKey = auth[providerId]?.key;
  if (authKey) return authKey.startsWith('$') ? (process.env[authKey.slice(1)] ?? null) : authKey;
  const cfg = (readModelsJson() as PiModelsJson | null)?.providers?.[providerId];
  const cfgKey = cfg?.apiKey;
  if (cfgKey) return cfgKey.startsWith('$') ? (process.env[cfgKey.slice(1)] ?? null) : cfgKey;
  return null;
}

// ─── Model CRUD(models.json override / 自定义供应商)────────────────────────

function mutateProviders(mutate: (providers: Record<string, PiCustomProviderConfig>) => boolean): boolean {
  const modelsJson = (readModelsJson() as PiModelsJson | null) ?? { providers: {} };
  const providers: Record<string, PiCustomProviderConfig> = { ...(modelsJson.providers ?? {}) };
  if (!mutate(providers)) return false;
  return writeModelsJson({ providers });
}

/** 新增或按 model.id 更新一条模型;builtin 供应商自动落 override 块。 */
export function savePiProviderModel(providerId: string, model: PiCustomProviderModel): boolean {
  if (!providerId || !model?.id) return false;
  return mutateProviders((providers) => {
    const block = providers[providerId] ?? {};
    const models = [...(block.models ?? []).filter((m) => m.id !== model.id), model];
    providers[providerId] = { ...block, models };
    return true;
  });
}

export function removePiProviderModel(providerId: string, modelId: string): boolean {
  if (!providerId || !modelId) return false;
  return mutateProviders((providers) => {
    const block = providers[providerId];
    if (!block?.models) return true; // 没有块 = 无可删,幂等成功
    providers[providerId] = { ...block, models: block.models.filter((m) => m.id !== modelId) };
    return true;
  });
}

// ─── Custom Provider CRUD(models.json providers map)───────────────────────

export interface PiCustomProviderInput {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: PiCustomProviderModel[];
}

export function addPiCustomProvider(id: string, config: PiCustomProviderInput): boolean {
  if (!id || (readModelsJson() as PiModelsJson | null)?.providers?.[id]) return false;
  return mutateProviders((providers) => {
    providers[id] = { ...config };
    return true;
  });
}

/**
 * 部分更新自定义供应商/override 块。apiKey 只在调用方显式传入新明文时覆盖;
 * 传 undefined 保持原值(Renderer 手里只有打码值,不回传即不会破坏真实密钥)。
 */
export function updatePiCustomProvider(id: string, patch: PiCustomProviderInput): boolean {
  if (!id) return false;
  return mutateProviders((providers) => {
    const existing = providers[id];
    if (!existing) return false;
    const next: PiCustomProviderConfig = { ...existing, ...patch };
    if (patch.apiKey === undefined) next.apiKey = existing.apiKey;
    else if (patch.apiKey === '') delete next.apiKey;
    providers[id] = next;
    return true;
  });
}

/** 重命名自定义供应商 id,并同步 settings 里的 defaultProvider/defaultModel/enabledModels 引用。 */
export function renamePiCustomProvider(oldId: string, newId: string): boolean {
  if (!oldId || !newId || oldId === newId) return false;
  const existingProviders = (readModelsJson() as PiModelsJson | null)?.providers ?? {};
  const existing = existingProviders[oldId];
  if (!existing || existingProviders[newId]) return false;

  const providers: Record<string, PiCustomProviderConfig> = {};
  for (const [k, v] of Object.entries(existingProviders)) {
    providers[k === oldId ? newId : k] = k === oldId ? { ...v } : v;
  }
  if (!writeModelsJson({ providers })) return false;

  const settings = readSettings();
  if (!settings) return true;
  const prefix = `${oldId}/`;
  const patch: Partial<PiSettings> = {};
  if (settings.defaultProvider === oldId) patch.defaultProvider = newId;
  if (settings.defaultModel?.startsWith(prefix)) {
    patch.defaultModel = `${newId}/${settings.defaultModel.slice(prefix.length)}`;
  }
  if ((settings.enabledModels ?? []).some((ref) => ref.startsWith(prefix))) {
    patch.enabledModels = (settings.enabledModels ?? []).map((ref) =>
      ref.startsWith(prefix) ? `${newId}/${ref.slice(prefix.length)}` : ref,
    );
  }
  if (Object.keys(patch).length > 0) writeSettings({ ...settings, ...patch });
  return true;
}

export function removePiCustomProvider(id: string): boolean {
  if (!id) return false;
  return mutateProviders((providers) => {
    if (!(id in providers)) return true;
    delete providers[id];
    return true;
  });
}

// 防止 sep 未使用告警已移除

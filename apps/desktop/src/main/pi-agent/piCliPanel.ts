/**
 * piCliPanel — 本机 Pi CLI(`~/.pi/agent`)的面板数据层。
 *
 * 与 `maker-host/pi-package-store.ts` 的边界:那个模块管的是 **Cindy 自己的**
 * `<userData>/pi-package-home`,带批准状态、指纹校验与权限确认。本模块管的是
 * **用户自己的** Pi CLI 安装,面板只做"看 + 装 / 卸",不引入 Cindy 侧批准态。
 * 两者数据源不同、语义不同,不要合并。
 *
 * 安全边界(与 pi-web-switch 的唯一实质差异):
 *   `models.json` / `auth.json` 里带明文 API key。Cindy 的 Renderer 会渲染 agent
 *   输出、Markdown、文件预览、插件面板与内置浏览器网页,是不可信环境 ——
 *   `electron-security-and-process-boundaries.md` 明确禁止 preload 向 Renderer
 *   返回凭证明文。因此本模块对外只给**遮罩串**(遮罩在主进程生成)与
 *   `hasApiKey` 布尔;真值只在主进程内用于测连接与写回。
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getReadyBinaryPath } from '../agent-binaries/index.js';
import { createLogger } from '../logger.js';
import type { PiFetchModelsResult, PiProviderTestResult } from './piTypes.js';
import { fetchProviderModels, testProviderConnection } from './piReader.js';

const log = createLogger('pi-cli-panel');

const PI_DIR = join(homedir(), '.pi', 'agent');
/** CLI 子命令超时。install 要下载 npm 包,给足;面板侧有 loading 态。 */
const COMMAND_TIMEOUT_MS = 180_000;
/** 单次命令输出上限,防超大 stdout 撑爆主进程内存。 */
const MAX_OUTPUT_BYTES = 1 << 20;
/** 面板一次最多展示的供应商数,防畸形文件拖垮渲染。 */
const MAX_PROVIDERS = 200;
const MAX_MODELS_PER_PROVIDER = 500;

// ─── Redacted provider view ────────────────────────────────────────────────

export interface PiCliModelView {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** models.json 里显式关掉的模型仍要列出,面板据此置灰。 */
  enabled: boolean;
}

/**
 * 密钥池里的一把 key —— **只带遮罩串,不带真值**。
 *
 * pi-web-switch 的面板把整池 key 列出来、标出当前生效的那把,并支持逐把明文显形。
 * Cindy 还原前两者(列表 + active 标记),但**不提供显形**:Renderer 是不可信环境,
 * 见本文件顶部的安全边界说明。
 */
export interface PiCliApiKeyView {
  id: string;
  maskedKey: string;
  /** 是否是 `activeKeyId` 指向的那把(池为空时单 key 视为 active)。 */
  active: boolean;
}

export interface PiCliProviderView {
  id: string;
  name: string;
  baseUrl?: string;
  api?: string;
  /** 是否配了 key。真值不出主进程。 */
  hasApiKey: boolean;
  /** 已遮罩的当前生效 key(如 `sk-2Aw…MuiA`);未配置时为 undefined。 */
  maskedApiKey?: string;
  /** 该供应商配了几把可轮换的 key(models.json 的 `apiKeys` 池)。 */
  apiKeyCount: number;
  /** 整池 key 的遮罩视图,顺序与 models.json 一致。 */
  apiKeys: PiCliApiKeyView[];
  models: PiCliModelView[];
}

export interface PiCliProvidersResult {
  installed: boolean;
  providers: PiCliProviderView[];
  /** 文件存在但解析失败时给出原因,面板显示可重试错误而不是空态。 */
  error?: string;
}

/**
 * 只保留头尾各 4 字符。key 短于 12 字符时整串打码 —— 短 key 露头尾等于露大半。
 */
export function maskApiKey(raw: string): string | undefined {
  const key = raw.trim();
  if (!key) return undefined;
  if (key.length < 12) return '•'.repeat(8);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * 把 models.json 的 `apiKeys` 池投影成遮罩视图。
 *
 * pi 的语义：`apiKey` 总是镜像当前 active 的那把（它是 pi 自己唯一读的字段），
 * `activeKeyId` 指向池里的哪一条。池为空时把单 key 当一条处理，面板才不会因
 * “没登记到池里”而显示成无密钥。
 */
function toApiKeyViews(
  rawPool: unknown,
  activeKeyId: unknown,
  fallbackKey: string,
): PiCliApiKeyView[] {
  const entries = Array.isArray(rawPool)
    ? rawPool.filter(
        (e): e is Record<string, unknown> =>
          isRecord(e) && typeof e.key === 'string' && e.key.trim().length > 0,
      )
    : [];

  if (entries.length === 0) {
    const masked = maskApiKey(fallbackKey);
    return masked ? [{ id: 'single', maskedKey: masked, active: true }] : [];
  }

  const activeId = typeof activeKeyId === 'string' ? activeKeyId : '';
  const hasActive = entries.some((e) => e.id === activeId);
  return entries.map((entry, index) => {
    const id = typeof entry.id === 'string' && entry.id ? entry.id : `key-${String(index)}`;
    return {
      id,
      maskedKey: maskApiKey(entry.key as string) ?? '',
      // activeKeyId 指向不到任何一条时，pi 自己也是回落到第一把。
      active: hasActive ? entry.id === activeId : index === 0,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readJsonFile<T>(path: string): { value: T } | { error: string } {
  try {
    if (!existsSync(path)) return { error: 'missing' };
    return { value: JSON.parse(readFileSync(path, 'utf-8')) as T };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function toModelView(raw: unknown): PiCliModelView | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const cost = isRecord(raw.cost)
    ? {
        input: optionalNumber(raw.cost.input),
        output: optionalNumber(raw.cost.output),
        cacheRead: optionalNumber(raw.cost.cacheRead),
        cacheWrite: optionalNumber(raw.cost.cacheWrite),
      }
    : undefined;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    reasoning: raw.reasoning === true,
    input: Array.isArray(raw.input) ? raw.input.filter((x): x is string => typeof x === 'string') : ['text'],
    ...(optionalNumber(raw.contextWindow) !== undefined
      ? { contextWindow: optionalNumber(raw.contextWindow) }
      : {}),
    ...(optionalNumber(raw.maxTokens) !== undefined ? { maxTokens: optionalNumber(raw.maxTokens) } : {}),
    ...(cost ? { cost } : {}),
    // 缺省视为启用:pi 只在显式 false 时跳过该模型。
    enabled: raw.enabled !== false,
  };
}

/**
 * 把 `~/.pi/agent/models.json` 投影成剥密后的面板视图。
 * `auth.json` 只用于补齐"这个供应商配过 key 没有",同样不回传真值。
 */
export function readPiCliProviders(): PiCliProvidersResult {
  if (!isPiCliDirPresent()) return { installed: false, providers: [] };

  const models = readJsonFile<{ providers?: Record<string, unknown> }>(join(PI_DIR, 'models.json'));
  if ('error' in models) {
    // 文件不存在是合法状态(装了 CLI 但还没配供应商);解析失败才是错误。
    return models.error === 'missing'
      ? { installed: true, providers: [] }
      : { installed: true, providers: [], error: models.error };
  }
  const auth = readJsonFile<Record<string, { key?: string }>>(join(PI_DIR, 'auth.json'));
  const authMap = 'value' in auth && isRecord(auth.value) ? auth.value : {};

  const rawProviders = isRecord(models.value.providers) ? models.value.providers : {};
  const providers: PiCliProviderView[] = [];
  for (const [id, raw] of Object.entries(rawProviders)) {
    if (providers.length >= MAX_PROVIDERS) break;
    if (!isRecord(raw)) continue;
    const inlineKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
    const authKey = typeof authMap[id]?.key === 'string' ? (authMap[id].key as string) : '';
    const effectiveKey = inlineKey || authKey;
    const apiKeys = toApiKeyViews(raw.apiKeys, raw.activeKeyId, effectiveKey);
    // 面板顶部展示的是当前生效的那把，与 pi 实际使用的一致。
    const masked = apiKeys.find((k) => k.active)?.maskedKey ?? maskApiKey(effectiveKey);
    providers.push({
      id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : id,
      ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
      ...(typeof raw.api === 'string' ? { api: raw.api } : {}),
      hasApiKey: Boolean(effectiveKey) || apiKeys.length > 0,
      ...(masked ? { maskedApiKey: masked } : {}),
      apiKeyCount: apiKeys.length,
      apiKeys,
      models: Array.isArray(raw.models)
        ? raw.models
            .slice(0, MAX_MODELS_PER_PROVIDER)
            .map(toModelView)
            .filter((m): m is PiCliModelView => m !== null)
        : [],
    });
  }
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { installed: true, providers };
}

// ─── Extensions (packages) ─────────────────────────────────────────────────

export interface PiCliExtensionView {
  /** settings.json `packages` 里的原始 source(如 `npm:pi-hermes-memory`)。 */
  source: string;
  /** 去掉 `npm:` 等前缀后的展示名。 */
  name: string;
}

export interface PiCliExtensionsResult {
  installed: boolean;
  extensions: PiCliExtensionView[];
  error?: string;
}

export function isPiCliDirPresent(): boolean {
  try {
    return existsSync(PI_DIR) && statSync(PI_DIR).isDirectory();
  } catch {
    return false;
  }
}

export function readPiCliExtensions(): PiCliExtensionsResult {
  if (!isPiCliDirPresent()) return { installed: false, extensions: [] };
  const settings = readJsonFile<{ packages?: unknown }>(join(PI_DIR, 'settings.json'));
  if ('error' in settings) {
    return settings.error === 'missing'
      ? { installed: true, extensions: [] }
      : { installed: true, extensions: [], error: settings.error };
  }
  const raw = Array.isArray(settings.value.packages) ? settings.value.packages : [];
  const extensions = raw
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((source) => ({
      source,
      // `npm:@scope/name` → `@scope/name`;本地/ git source 原样展示。
      name: source.replace(/^npm:/, ''),
    }));
  return { installed: true, extensions };
}

// ─── CLI mutations ─────────────────────────────────────────────────────────

export type PiCliPackageAction = 'install' | 'remove';

/**
 * 对用户自己的 `~/.pi/agent` 跑一次 `pi install|remove <source>`。
 *
 * 与终端里手敲同一命令等效 —— 会真实修改 `~/.pi/agent/settings.json` 与
 * `~/.pi/agent/npm/`。用的是 Cindy 受管的 pi 二进制(不去 PATH 里找,避免执行
 * 任意同名可执行文件),`shell: false` + 参数数组传参,不做字符串拼接。
 * `npm_config_ignore_scripts` 沿用 Cindy 既有姿态:装包不执行第三方生命周期脚本。
 */
export async function runPiCliPackageCommand(
  action: PiCliPackageAction,
  source: string,
): Promise<{ stdout: string; stderr: string }> {
  const binaryPath = getReadyBinaryPath('pi');
  if (!binaryPath) throw new Error('PI_BINARY_UNAVAILABLE');
  if (!isPiCliDirPresent()) throw new Error('PI_CLI_DIR_MISSING');

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [action, source, '--no-approve'], {
      cwd: PI_DIR,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: PI_DIR,
        NO_COLOR: '1',
        GIT_TERMINAL_PROMPT: '0',
        npm_config_yes: 'true',
        npm_config_ignore_scripts: 'true',
        NPM_CONFIG_IGNORE_SCRIPTS: 'true',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('PI_CLI_COMMAND_TIMEOUT'));
    }, COMMAND_TIMEOUT_MS);
    timer.unref?.();

    const append = (chunk: string, target: 'out' | 'err'): void => {
      if (target === 'out') {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk;
      } else if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
    };
    child.stdout?.on('data', (c: Buffer) => append(c.toString('utf-8'), 'out'));
    child.stderr?.on('data', (c: Buffer) => append(c.toString('utf-8'), 'err'));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      log.warn('pi cli package command failed', { action, exitCode: code });
      // stderr 可能含仓库地址等信息,但不含凭证;截断后交给 UI 做诊断。
      reject(new Error(stderr.slice(0, 2_000) || `pi ${action} exited with ${String(code)}`));
    });
  });
}

export const __testing = { maskApiKey, toModelView, toApiKeyViews, resolveProviderRuntimeConfigFromRaw };

// ─── Provider live test（主进程持真值,Renderer 只收结果）───────────────────

/** 请求端点缺失等主进程侧可直接判定的失败,handler 映射成对应 IPC 错误码。 */
export type PiCliProviderTestFailure =
  | 'PI_CLI_PROVIDER_NOT_FOUND'
  | 'PI_CLI_PROVIDER_NO_BASEURL';

interface PiCliProviderRuntimeConfig {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * 从已解析的 models.json / auth.json 原始 JSON 里解析供应商的运行时配置。
 * 独立成纯函数便于单测;文件读取包装在 readPiCliProviderRuntimeConfig 里。
 * 供应商"存在"的判定:models.json 或 auth.json 任一里有该 id。
 */
function resolveProviderRuntimeConfigFromRaw(
  providerId: string,
  modelsJson: unknown,
  authJson: unknown,
): PiCliProviderRuntimeConfig | null {
  const id = providerId.trim();
  if (!id) return null;
  const rawProviders = isRecord(modelsJson) && isRecord(modelsJson.providers)
    ? modelsJson.providers
    : {};
  const raw = isRecord(rawProviders[id]) ? rawProviders[id] : null;
  const authMap = isRecord(authJson) ? authJson : {};
  const authEntry = isRecord(authMap[id]) ? authMap[id] : null;
  if (!raw && !authEntry) return null;
  return {
    ...(typeof raw?.baseUrl === 'string' && raw.baseUrl.trim()
      ? { baseUrl: raw.baseUrl.trim() }
      : {}),
    // models.json 的 apiKey 镜像当前生效的那把;auth.json 是 pi 自己读的凭证源。
    apiKey:
      (typeof raw?.apiKey === 'string' && raw.apiKey.trim()) ||
      (typeof authEntry?.key === 'string' && authEntry.key.trim()) ||
      undefined,
  };
}

/**
 * 按 providerId 现读该供应商的 baseUrl 与生效 key(models.json 的 apiKey 镜像
 * 当前生效的那把)。**真值不出主进程**:调用方(piAgentHandlers 的测试/拉取
 * handler)只把请求结果投影给 Renderer,本函数的返回值不进 IPC。
 */
function readPiCliProviderRuntimeConfig(providerId: string): PiCliProviderRuntimeConfig | null {
  const models = readJsonFile<unknown>(join(PI_DIR, 'models.json'));
  const auth = readJsonFile<unknown>(join(PI_DIR, 'auth.json'));
  return resolveProviderRuntimeConfigFromRaw(
    providerId,
    'value' in models ? models.value : null,
    'value' in auth ? auth.value : null,
  );
}

/** 供应商详情「测连接」:GET {baseUrl}/models(带生效 key),结果同 SpeedTest 面板。 */
export async function testPiCliProviderConnection(
  providerId: string,
): Promise<PiProviderTestResult> {
  const config = readPiCliProviderRuntimeConfig(providerId);
  if (!config) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  if (!config.baseUrl) throw new Error('PI_CLI_PROVIDER_NO_BASEURL');
  return testProviderConnection(config.baseUrl, config.apiKey);
}

/** 供应商详情「拉取模型」:GET {baseUrl}/models 解析模型清单,真值 key 只在主进程。 */
export async function fetchPiCliProviderModels(providerId: string): Promise<PiFetchModelsResult> {
  const config = readPiCliProviderRuntimeConfig(providerId);
  if (!config) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  if (!config.baseUrl) throw new Error('PI_CLI_PROVIDER_NO_BASEURL');
  return fetchProviderModels(config.baseUrl, config.apiKey);
}

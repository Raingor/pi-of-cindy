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
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PI_CLI_PROVIDER_ID_PREFIX } from '../../shared/piCliProviders.js';
import { getReadyBinaryPath } from '../agent-binaries/index.js';
import { createLogger } from '../logger.js';
import type { Provider } from '@cindy/model-providers';
import type { PiFetchModelsResult, PiProviderTestResult } from './piTypes.js';
import { fetchProviderModels, testModel, testProviderConnection } from './piReader.js';

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
  /**
   * pi 是否会真的把这个模型放进可选清单。
   *
   * **判据是 `settings.json` 的 `enabledModels`,不是 `models.json` 里的 `enabled` 字段** ——
   * 后者不在 pi 的 ModelDefinitionSchema 里(实测 `dist/core/model-config.js`),pi 读配置时
   * 直接丢掉,pi-web-switch 的投影也把它一律映射成 true。`enabledModels` 为空数组时 pi 不做
   * 任何过滤(见 `agent-session.js` 与 `interactive-mode.js` 的 `!enabledModels?.length` 分支),
   * 也就是「空 = 全开」,不是「空 = 全关」。
   */
  enabled: boolean;
}

/**
 * 密钥池里的一把 key —— **只带遮罩串,不带真值**。
 *
 * pi-web-switch 的面板把整池 key 列出来、标出当前生效的那把,并支持逐把明文显形。
 * Cindy 还原列表 + active 标记 + **切换生效**(点击即改 `activeKeyId` 并同步 `apiKey`
 * 镜像,见 `applyPiCliKeySwitch`),但**不提供显形**:Renderer 是不可信环境,见本
 * 文件顶部的安全边界说明。
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
  /**
   * pi 把停用的供应商整块搬进 `models.json` 的 `_disabledProviders`。不读这个键
   * 的话被停用的供应商会从面板里凭空消失 —— 用户既看不到它还在、也不知道为什么。
   */
  disabled: boolean;
  /**
   * `compat` 兼容开关(pi 的 ProviderCompatSchema)。面板只展示 pi-web-switch
   * 也暴露的那两项;其余键 pi 认但两边都不展示。
   */
  compat?: { supportsDeveloperRole?: boolean; supportsFinishReason?: boolean };
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
  /**
   * settings.enabledModels 白名单是否生效(null/空 = 未过滤,所有模型都可用)。
   * 面板用它区分「全部可用(无名单)」与「部分启用(有名单)」两种展示态。
   */
  allowlistActive: boolean;
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

/**
 * 解 pi 的 `$VAR` 密钥引用。pi 支持把 `apiKey` 写成 `$OPENAI_API_KEY`,真值从
 * 进程环境读 —— 不解引用就会把字面量当 Bearer token 发出去。变量没导出时返回空串
 * (等价「没配 key」),不回落到字面量。
 */
function resolveKeyRef(raw: string | undefined): string {
  const key = (raw ?? '').trim();
  if (!key.startsWith('$')) return key;
  return (process.env[key.slice(1)] ?? '').trim();
}

function toModelView(raw: unknown, enabledRefs: ReadonlySet<string> | null, providerId: string): PiCliModelView | null {
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
    // enabledRefs === null 表示 settings.enabledModels 为空/缺省 —— pi 此时不过滤,全开。
    enabled: enabledRefs === null || enabledRefs.has(`${providerId}/${raw.id}`),
  };
}

/**
 * 读 `settings.json` 的 `enabledModels`。返回 null 表示「没有配过白名单」——
 * pi 在这种情况下不做任何过滤,不能误当成「一个都没启用」。
 */
function readEnabledModelPatterns(): string[] | null {
  const settings = readJsonFile<{ enabledModels?: unknown }>(join(PI_DIR, 'settings.json'));
  if ('error' in settings) return null;
  const raw = settings.value.enabledModels;
  if (!Array.isArray(raw)) return null;
  const patterns = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return patterns.length > 0 ? patterns : null;
}

// ─── enabledModels 模式解析(pi model-resolver 语义的忠实子集)────────────
// pi 的白名单不是「精确 ref 集合」,而是一组**模式**:支持 glob(* ? [..])、
// thinking 尾缀(:high)、裸 id、以及部分 id/name 包含匹配(别名优先)。
// 面板/选择器若只做精确字符串比对,展示和写入都会与 pi 的实际行为不一致。

/** pi 的 thinking-level 枚举(dist/cli/args.js 同一份);模式尾缀 `:high` 等不参与模型匹配。 */
const PI_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** pi 的 alias 判定:不以 -YYYYMMDD 结尾的 id 视为别名(部分匹配时优先)。 */
function isPiAliasModelId(id: string): boolean {
  return !/-\d{8}$/.test(id);
}

/**
 * 精简 glob 匹配(覆盖 pi 用 minimatch nocase 处理白名单时的常用子集):
 * `**` 跨段、`*`/`?` 不跨 `/`、`[a-z]`/`[!a-z]` 字符类,整体不区分大小写。
 */
function piGlobMatch(pattern: string, value: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
        continue;
      }
      let cls = pattern.slice(i + 1, end);
      const neg = cls.startsWith('!') || cls.startsWith('^');
      if (neg) cls = cls.slice(1);
      re += `[${neg ? '^' : ''}${cls.replace(/[\\\]]/g, '\\$&')}]`;
      i = end;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  try {
    return new RegExp(`^${re}$`, 'i').test(value);
  } catch {
    return false;
  }
}

/** 白名单模式参与匹配的 universe 条目(models.json 活跃桶的模型)。 */
export interface PiModelUniverseEntry {
  provider: string;
  id: string;
  name?: string;
}

/** 剥 thinking 尾缀(`seekai-a6/x:high` → `seekai-a6/x`);非法尾缀原样保留。 */
function stripThinkingSuffix(pattern: string): string {
  const idx = pattern.lastIndexOf(':');
  if (idx === -1) return pattern;
  const suffix = pattern.slice(idx + 1);
  return PI_THINKING_LEVELS.has(suffix) ? pattern.slice(0, idx) : pattern;
}

/**
 * 非oglob 模式的单模型解析(pi tryMatchModel 同构):
 * 精确 canonical `provider/id` → 显式 provider+id → 裸 id(均要求唯一,歧义即不命中)
 * → 部分 id/name 包含匹配(别名优先、同组取 id 最大者)。找不到返回 undefined。
 */
function tryMatchOneModel(
  body: string,
  universe: readonly PiModelUniverseEntry[],
): PiModelUniverseEntry | undefined {
  const canonical = universe.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === body);
  if (canonical.length === 1) return canonical[0];
  if (canonical.length > 1) return undefined;
  const slash = body.indexOf('/');
  if (slash !== -1) {
    const p = body.slice(0, slash);
    const id = body.slice(slash + 1);
    if (p && id) {
      const hits = universe.filter(
        (m) => m.provider.toLowerCase() === p && m.id.toLowerCase() === id,
      );
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return undefined;
    }
    return undefined;
  }
  const exactId = universe.filter((m) => m.id.toLowerCase() === body);
  if (exactId.length === 1) return exactId[0];
  const partial = universe.filter(
    (m) => m.id.toLowerCase().includes(body) || (m.name ?? '').toLowerCase().includes(body),
  );
  if (partial.length === 0) return undefined;
  const aliases = partial.filter((m) => isPiAliasModelId(m.id));
  const pool = aliases.length > 0 ? aliases : partial;
  return pool.reduce((best, m) => (m.id.localeCompare(best.id) > 0 ? m : best), pool[0]!);
}

/** 解析单个白名单模式 → 命中的模型集合(glob 可多命中,其余至多一个)。 */
function resolveEnabledPattern(
  pattern: string,
  universe: readonly PiModelUniverseEntry[],
): PiModelUniverseEntry[] {
  const body = stripThinkingSuffix(pattern.trim()).toLowerCase();
  if (!body) return [];
  if (/[*?[]/.test(body)) {
    return universe.filter(
      (m) =>
        piGlobMatch(body, `${m.provider}/${m.id}`.toLowerCase()) ||
        piGlobMatch(body, m.id.toLowerCase()),
    );
  }
  const one = tryMatchOneModel(body, universe);
  return one ? [one] : [];
}

/**
 * 白名单模式集合 → 启用 ref 集合(lowercased `provider/id`)。
 * patterns 为 null(未配白名单)= 不过滤 → 全部 universe 启用。
 */
function resolveEnabledRefSet(
  patterns: string[] | null,
  universe: readonly PiModelUniverseEntry[],
): Set<string> {
  if (patterns === null) {
    return new Set(universe.map((m) => `${m.provider}/${m.id}`.toLowerCase()));
  }
  const out = new Set<string>();
  for (const p of patterns) {
    for (const m of resolveEnabledPattern(p, universe)) {
      out.add(`${m.provider}/${m.id}`.toLowerCase());
    }
  }
  return out;
}

/** models.json 活跃桶的全部模型(白名单的 universe;停用桶的模型 pi 不加载,不在内)。 */
function readActiveModelUniverse(): PiModelUniverseEntry[] {
  const models = readJsonFile<{ providers?: unknown }>(join(PI_DIR, 'models.json'));
  if ('error' in models || !isRecord(models.value.providers)) return [];
  const out: PiModelUniverseEntry[] = [];
  for (const [id, raw] of Object.entries(models.value.providers)) {
    if (!isRecord(raw) || !Array.isArray(raw.models)) continue;
    for (const m of raw.models) {
      if (isRecord(m) && typeof m.id === 'string' && m.id.trim()) {
        out.push({
          provider: id,
          id: m.id,
          ...(typeof m.name === 'string' && m.name.trim() ? { name: m.name.trim() } : {}),
        });
      }
      if (out.length >= MAX_PROVIDERS * MAX_MODELS_PER_PROVIDER) return out;
    }
  }
  return out;
}

/**
 * 面板展示态:白名单模式解析后的启用集合 + 「名单是否真的在过滤」。
 *
 * 名单存在但**没有任何 pattern 命中任何模型**时,pi 运行时 resolve 出的 scoped
 * models 为空 = 无过滤(等于未配名单) —— 展示态必须跟随,否则面板会显示
 * 「0 个启用」而实际全部可用。universe 为空(没配任何模型)时同样视为未过滤。
 */
function resolvePanelEnabledState(): { enabledSet: Set<string>; allowlistActive: boolean } {
  const patterns = readEnabledModelPatterns();
  const universe = readActiveModelUniverse();
  if (patterns === null || universe.length === 0) {
    return { enabledSet: resolveEnabledRefSet(null, universe), allowlistActive: false };
  }
  const enabledSet = resolveEnabledRefSet(patterns, universe);
  // 名单里全部 pattern 都落空 = pi 实际不过滤。
  if (enabledSet.size === 0) {
    return { enabledSet: resolveEnabledRefSet(null, universe), allowlistActive: false };
  }
  return { enabledSet, allowlistActive: true };
}

/** models.json 的 `compat` 里 pi-web-switch 也展示的那两项。 */
function toCompatView(
  raw: unknown,
): { supportsDeveloperRole?: boolean; supportsFinishReason?: boolean } | undefined {
  if (!isRecord(raw)) return undefined;
  const out: { supportsDeveloperRole?: boolean; supportsFinishReason?: boolean } = {};
  if (typeof raw.supportsDeveloperRole === 'boolean') {
    out.supportsDeveloperRole = raw.supportsDeveloperRole;
  }
  if (typeof raw.supportsFinishReason === 'boolean') {
    out.supportsFinishReason = raw.supportsFinishReason;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 把 `~/.pi/agent/models.json` 投影成剥密后的面板视图。
 * `auth.json` 只用于补齐"这个供应商配过 key 没有",同样不回传真值。
 * `settings.json` 只用于读 `enabledModels` 白名单(模型是否真会被 pi 选中)。
 */
export function readPiCliProviders(): PiCliProvidersResult {
  if (!isPiCliDirPresent()) return { installed: false, providers: [], allowlistActive: false };

  const models = readJsonFile<{
    providers?: Record<string, unknown>;
    _disabledProviders?: Record<string, unknown>;
  }>(join(PI_DIR, 'models.json'));
  if ('error' in models) {
    // 文件不存在是合法状态(装了 CLI 但还没配供应商);解析失败才是错误。
    return models.error === 'missing'
      ? { installed: true, providers: [], allowlistActive: false }
      : { installed: true, providers: [], allowlistActive: false, error: models.error };
  }
  const auth = readJsonFile<Record<string, { key?: string }>>(join(PI_DIR, 'auth.json'));
  const authMap = 'value' in auth && isRecord(auth.value) ? auth.value : {};
  const { enabledSet: enabledRefs, allowlistActive } = resolvePanelEnabledState();

  const activeProviders = isRecord(models.value.providers) ? models.value.providers : {};
  const disabledProviders = isRecord(models.value._disabledProviders)
    ? models.value._disabledProviders
    : {};

  const providers: PiCliProviderView[] = [];
  const collect = (rawProviders: Record<string, unknown>, disabled: boolean): void => {
    for (const [id, raw] of Object.entries(rawProviders)) {
      if (providers.length >= MAX_PROVIDERS) break;
      if (!isRecord(raw)) continue;
      const inlineKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
      const authKey = typeof authMap[id]?.key === 'string' ? (authMap[id].key as string) : '';
      const effectiveKey = inlineKey || authKey;
      const apiKeys = toApiKeyViews(raw.apiKeys, raw.activeKeyId, effectiveKey);
      // 面板顶部展示的是当前生效的那把，与 pi 实际使用的一致。
      const masked = apiKeys.find((k) => k.active)?.maskedKey ?? maskApiKey(effectiveKey);
      const compat = toCompatView(raw.compat);
      providers.push({
        id,
        name: typeof raw.name === 'string' && raw.name ? raw.name : id,
        ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
        ...(typeof raw.api === 'string' ? { api: raw.api } : {}),
        disabled,
        ...(compat ? { compat } : {}),
        hasApiKey: Boolean(effectiveKey) || apiKeys.length > 0,
        ...(masked ? { maskedApiKey: masked } : {}),
        apiKeyCount: apiKeys.length,
        apiKeys,
        models: Array.isArray(raw.models)
          ? raw.models
              .slice(0, MAX_MODELS_PER_PROVIDER)
              .map((m) => toModelView(m, enabledRefs, id))
              .filter((m): m is PiCliModelView => m !== null)
          : [],
      });
    }
  };
  collect(activeProviders, false);
  collect(disabledProviders, true);

  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { installed: true, providers, allowlistActive: enabledRefs.size > 0 };
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

// ─── Catalog & runtime projection（本机 Pi 供应商接入模型选择器）───────────
//
// 需求:输入框的模型选择器要能选用户本机 ~/.pi/agent/models.json 里配的供应商模型
// （pi-web-switch 的核心能力）。接线三处:
//   1. buildPiCliCatalogProviders() → active-catalog 合并层（选择器可见性）;
//   2. resolvePiNativeProviders(pi-host) → PiNativeProviderSpec（会话路由,真 key 经
//      env 注入子进程）;
//   3. ProvidersSection 对 `pi-cli:` 前缀行渲染只读头（增删改归 Pi CLI,不走 Cindy CRUD）。
// providerId 统一用 `pi-cli-<id>`（连字符）:既是会话/停用 override/可见性 key 的
// 持久化主键,也是 pi 运行时 slug（pi 不接受冒号;连字符避开与内置/自定义 id 撞名）。
// key 真值不出主进程。

export interface PiCliRuntimeModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  supportsImageInput: boolean;
}

/** 运行时投影条目 —— key 真值只在主进程内存,不进目录/IPC。 */
export interface PiCliRuntimeProvider {
  /** Cindy 持久化 providerId（`pi-cli:<id>`）。 */
  catalogId: string;
  /** pi 运行时 slug（`pi-cli-<id>`）。 */
  runtimeId: string;
  name: string;
  baseUrl: string;
  api: string;
  models: PiCliRuntimeModel[];
  /** models.json inline apiKey 或 auth.json key,主进程内使用。 */
  key: string;
}

function toRuntimeModels(
  raw: unknown,
  enabledSet: ReadonlySet<string>,
  providerId: string,
): PiCliRuntimeModel[] {
  if (!Array.isArray(raw)) return [];
  const out: PiCliRuntimeModel[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) continue;
    const id = entry.id.trim();
    // 与 pi 同一把门:settings.enabledModels 由模式解析成启用集合(见上);
    // `models.json` 的 `enabled` 字段不在 pi 的 schema 里,pi 读配置时直接丢弃 ——
    // 按它过滤会让 pi 里能选的模型在 Cindy 里凭空少掉。
    if (!enabledSet.has(`${providerId}/${id}`.toLowerCase())) continue;
    const input = Array.isArray(entry.input)
      ? entry.input.filter((x): x is string => typeof x === 'string')
      : [];
    out.push({
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id,
      ...(optionalNumber(entry.contextWindow) !== undefined
        ? { contextWindow: optionalNumber(entry.contextWindow) }
        : {}),
      ...(optionalNumber(entry.maxTokens) !== undefined
        ? { maxTokens: optionalNumber(entry.maxTokens) }
        : {}),
      reasoning: entry.reasoning === true,
      supportsImageInput: input.includes('image'),
    });
    if (out.length >= MAX_MODELS_PER_PROVIDER) break;
  }
  return out;
}

/**
 * 读取本机 Pi CLI 供应商的运行时投影（baseUrl + 生效 key + 模型清单）。
 * 只返回**可路由**的条目:baseUrl 与至少一把 key 齐备（缺 key 的供应商路由必失败,
 * 投影进选择器只会制造「选了就连不上」的死行）。
 */
export function readPiCliRuntimeProviders(): PiCliRuntimeProvider[] {
  if (!isPiCliDirPresent()) return [];
  const models = readJsonFile<{ providers?: Record<string, unknown> }>(join(PI_DIR, 'models.json'));
  if ('error' in models || !isRecord(models.value.providers)) return [];
  const auth = readJsonFile<Record<string, { key?: string }>>(join(PI_DIR, 'auth.json'));
  const authMap = 'value' in auth && isRecord(auth.value) ? auth.value : {};
  const { enabledSet: enabledRefs } = resolvePanelEnabledState();

  const out: PiCliRuntimeProvider[] = [];
  for (const [id, raw] of Object.entries(models.value.providers)) {
    if (out.length >= MAX_PROVIDERS) break;
    if (!isRecord(raw) || !id.trim()) continue;
    const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
    if (!baseUrl) continue;
    const inlineKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    const authKey = typeof authMap[id]?.key === 'string' ? authMap[id].key.trim() : '';
    // `$VAR` 是 pi 的环境变量引用写法,不是密钥本身;这里解引用后再判「有没有 key」,
    // 否则未导出该变量的供应商会带着字面量 `$VAR` 进路由,首次请求必 401。
    const key = resolveKeyRef(inlineKey || authKey);
    if (!key) continue;
    const modelsList = toRuntimeModels(raw.models, enabledRefs, id);
    if (modelsList.length === 0) continue;
    out.push({
      catalogId: `${PI_CLI_PROVIDER_ID_PREFIX}${id}`,
      runtimeId: `${PI_CLI_PROVIDER_ID_PREFIX}${id}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      baseUrl,
      api: typeof raw.api === 'string' && raw.api.trim() ? raw.api.trim() : 'openai-completions',
      models: modelsList,
      key,
    });
  }
  out.sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  return out;
}

/** models.json 的 api 枚举与 pi 的 PiModelApi 同名,原样透传;未知值回落 openai-completions。 */
function toPiApi(
  api: string,
): 'anthropic-messages' | 'openai-responses' | 'openai-completions' | 'google-generative-ai' {
  switch (api) {
    case 'anthropic-messages':
    case 'openai-responses':
    case 'google-generative-ai':
      return api;
    default:
      return 'openai-completions';
  }
}

/**
 * 投影成 Cindy 目录 `Provider`（source: 'user' 语义,不含任何凭证真值）。
 * active-catalog 合并层消费:模型选择器/能力派生/连接态（user 来源「存在即连接」）
 * 全部自动跟随,cc/codex 不受影响（models 只填 pi）。
 */
export function buildPiCliCatalogProviders(): Provider[] {
  return readPiCliRuntimeProviders().map((entry) => ({
    id: entry.catalogId,
    name: entry.name,
    source: 'user' as const,
    agents: ['pi' as const],
    auth: { method: 'apiKey' as const },
    routing: {
      pi: {
        wireProtocol:
          entry.api === 'anthropic-messages'
            ? ('anthropic-messages' as const)
            : entry.api === 'openai-responses'
              ? ('openai-responses' as const)
              : ('openai-chat' as const),
        upstream: entry.baseUrl,
        authStrategy: 'api-key-header' as const,
      },
    },
    models: {
      pi: entry.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow ?? 200_000,
        ...(m.contextWindow !== undefined ? { contextWindowVerified: true as const } : {}),
        ...(m.maxTokens !== undefined ? { maxOutput: m.maxTokens } : {}),
        piApi: toPiApi(entry.api),
        efforts: m.reasoning ? ['low', 'medium', 'high'] : [],
        defaultEffort: m.reasoning ? ('high' as const) : null,
        group: `custom:${entry.runtimeId}`,
        defaultEnabled: true as const,
        ...(m.supportsImageInput ? { supportsImageInput: true as const } : {}),
      })),
    },
  }));
}

// ─── 供应商/模型语义化写路径（对齐 pi-web-switch config-store）────────────

/** 与 pws API_TYPES 一致的 9 种 pi 原生接口形态。 */
export const PI_CLI_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-vertex',
  'bedrock-converse-stream',
  'mistral-conversations',
] as const;
export type PiCliApiType = (typeof PI_CLI_API_TYPES)[number];

/** pws 同款：字母(任意文字)、数字与连字号的配置安全 id。 */
export function sanitizePiProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 名称取不出 id 时回落到端点 hostname 的有意义段。 */
export function derivePiProviderId(name: string, baseUrl: string): string {
  const fromName = sanitizePiProviderId(name);
  if (fromName || !name.trim()) return fromName;
  try {
    const host = new URL(baseUrl.trim()).hostname;
    const skip = new Set(['api', 'www', 'app', 'gateway', 'open', 'openapi', 'platform']);
    const part = host.split('.').find((p) => p && !skip.has(p.toLowerCase()));
    return sanitizePiProviderId(part ?? '');
  } catch {
    return '';
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 供应商字段补丁 —— 白名单字段，未知键不进 models.json。 */
export interface PiCliProviderPatch {
  name?: string;
  baseUrl?: string;
  api?: PiCliApiType;
  /** 单把 key（无池时直接写 apiKey 镜像；有池时归一化采纳进池）。 */
  apiKey?: string;
  apiKeys?: Array<{ id: string; key: string }>;
  activeKeyId?: string;
  headers?: Record<string, string>;
  compat?: { supportsDeveloperRole?: boolean; supportsFinishReason?: boolean };
  models?: PiCliModelInput[];
}

function findProviderBlock(
  doc: Record<string, unknown>,
  id: string,
): { bucket: Record<string, unknown> } | null {
  if (isRecord(doc.providers) && isRecord(doc.providers[id])) {
    return { bucket: doc.providers as Record<string, unknown> };
  }
  if (isRecord(doc._disabledProviders) && isRecord(doc._disabledProviders[id])) {
    return { bucket: doc._disabledProviders as Record<string, unknown> };
  }
  return null;
}

/** 把补丁合并进 provider 块（不落盘）。 apiKey 镜像语义与 pws persistKeys 一致。 */
function mergeProviderPatch(block: Record<string, unknown>, patch: PiCliProviderPatch): void {
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name) block.name = name;
  }
  if (patch.baseUrl !== undefined) {
    const baseUrl = patch.baseUrl.trim();
    if (!isValidHttpUrl(baseUrl)) throw new Error('PI_CLI_MODEL_INVALID');
    block.baseUrl = baseUrl.replace(/\/+$/, '');
  }
  if (patch.api !== undefined) {
    if (!(PI_CLI_API_TYPES as readonly string[]).includes(patch.api)) {
      throw new Error('PI_CLI_MODEL_INVALID');
    }
    block.api = patch.api;
  }
  if (patch.headers !== undefined) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.headers)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string') headers[k.trim()] = v;
    }
    if (Object.keys(headers).length > 0) block.headers = headers;
  }
  if (patch.compat !== undefined) {
    const compat: Record<string, boolean> = {};
    if (typeof patch.compat.supportsDeveloperRole === 'boolean') {
      compat.supportsDeveloperRole = patch.compat.supportsDeveloperRole;
    }
    if (typeof patch.compat.supportsFinishReason === 'boolean') {
      compat.supportsFinishReason = patch.compat.supportsFinishReason;
    }
    block.compat = compat;
  }
  if (patch.models !== undefined) {
    const models: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const m of patch.models) {
      const modelId = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!modelId || seen.has(modelId)) continue;
      seen.add(modelId);
      models.push(buildModelDefinition(m));
    }
    block.models = models;
  }
  // 密钥池：与 pws normalizeKeyPool/persistKeys 同语义 —— 池存在时 apiKey
  // 镜像 activeKeyId 指向的那把（pi 只读 apiKey）。
  if (patch.apiKeys !== undefined) {
    const pool = patch.apiKeys.filter(
      (k) => k && typeof k.id === 'string' && k.id.trim() && typeof k.key === 'string' && k.key.trim(),
    );
    if (pool.length > 0) {
      block.apiKeys = pool;
      const activeId =
        typeof patch.activeKeyId === 'string' && pool.some((k) => k.id === patch.activeKeyId)
          ? patch.activeKeyId
          : pool[0]!.id;
      block.activeKeyId = activeId;
      block.apiKey = pool.find((k) => k.id === activeId)!.key;
    } else {
      delete block.apiKeys;
      delete block.activeKeyId;
    }
  } else if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    // 单把 key：无池时直接镜像；有池时归一化采纳（同值不重复入库）。
    const pool = Array.isArray(block.apiKeys)
      ? (block.apiKeys as Array<Record<string, unknown>>).filter(
          (e) => isRecord(e) && typeof e.id === 'string' && typeof e.key === 'string' && e.key.trim(),
        )
      : [];
    const value = patch.apiKey.trim();
    if (pool.length === 0) {
      block.apiKey = value;
    } else if (!pool.some((e) => e.key === value)) {
      const entryId = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      pool.push({ id: entryId, key: value });
      block.apiKeys = pool;
      block.activeKeyId = entryId;
      block.apiKey = value;
    }
  }
}

function buildModelDefinition(m: PiCliModelInput): Record<string, unknown> {
  const modelId = typeof m?.id === 'string' ? m.id.trim() : '';
  if (!modelId) throw new Error('PI_CLI_MODEL_INVALID');
  const cost =
    isRecord(m.cost)
      ? {
          input: optionalNumber(m.cost.input) ?? 0,
          output: optionalNumber(m.cost.output) ?? 0,
          cacheRead: optionalNumber(m.cost.cacheRead) ?? 0,
          cacheWrite: optionalNumber(m.cost.cacheWrite) ?? 0,
        }
      : undefined;
  const input = Array.isArray(m.input)
    ? m.input.filter((x): x is string => typeof x === 'string')
    : undefined;
  return {
    id: modelId,
    ...(typeof m.name === 'string' && m.name.trim() ? { name: m.name.trim() } : {}),
    ...(m.reasoning === true ? { reasoning: true } : {}),
    ...(input && input.length > 0 ? { input } : {}),
    ...(optionalNumber(m.contextWindow) !== undefined
      ? { contextWindow: optionalNumber(m.contextWindow) }
      : {}),
    ...(optionalNumber(m.maxTokens) !== undefined
      ? { maxTokens: optionalNumber(m.maxTokens) }
      : {}),
    ...(cost ? { cost } : {}),
  };
}

/**
 * 纯函数：创建或更新供应商。id 必须已过 sanitize（不代猜）；目标在
 * providers 或 _disabledProviders 任一桶均可（停用状态下也能编辑）。
 */
export function applyPiCliUpsertProvider(
  modelsJson: unknown,
  id: string,
  patch: PiCliProviderPatch,
): Record<string, unknown> {
  if (!isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const safeId = sanitizePiProviderId(id);
  if (!safeId || safeId !== id.trim()) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const ensureBucket = (key: string): Record<string, unknown> => {
    if (!isRecord(modelsJson[key])) modelsJson[key] = {};
    return modelsJson[key] as Record<string, unknown>;
  };
  const found = findProviderBlock(modelsJson, safeId);
  const block = found
    ? (found.bucket[safeId] as Record<string, unknown>)
    : (ensureBucket('providers')[safeId] = {});
  mergeProviderPatch(block, patch);
  return modelsJson as Record<string, unknown>;
}

/**
 * 纯函数：重命名供应商（id 是 pi 模型选择器徽标与 enabledModels 引用的前缀），
 * 同步改写 settings.enabledModels 里的 `oldId/…` 引用。
 */
export function applyPiCliRenameProvider(
  modelsJson: unknown,
  settings: unknown,
  fromId: string,
  toId: string,
  patch?: PiCliProviderPatch,
): { doc: Record<string, unknown>; settings: Record<string, unknown> } {
  if (!isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const from = sanitizePiProviderId(fromId);
  const to = sanitizePiProviderId(toId);
  if (!from || !to || to !== toId.trim() || from !== fromId.trim()) {
    throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  }
  if (from === to) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const found = findProviderBlock(modelsJson, from);
  if (!found) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  if (findProviderBlock(modelsJson, to)) throw new Error('PI_CLI_PROVIDER_EXISTS');
  const block = found.bucket[from] as Record<string, unknown>;
  delete found.bucket[from];
  found.bucket[to] = block;
  if (patch) mergeProviderPatch(block, patch);
  // enabledModels 引用改写（settings 可能没有该键）。
  const s = isRecord(settings) ? settings : {};
  if (Array.isArray(s.enabledModels)) {
    s.enabledModels = (s.enabledModels as unknown[]).map((ref) =>
      typeof ref === 'string' && ref.startsWith(`${from}/`) ? `${to}/${ref.slice(from.length + 1)}` : ref,
    );
  }
  return { doc: modelsJson as Record<string, unknown>, settings: s };
}

/** 纯函数：从两个桶里彻底删除供应商。 */
export function applyPiCliRemoveProvider(modelsJson: unknown, id: string): Record<string, unknown> {
  if (!isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const safeId = sanitizePiProviderId(id);
  const found = findProviderBlock(modelsJson, safeId);
  if (!found) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  delete found.bucket[safeId];
  return modelsJson as Record<string, unknown>;
}

/**
 * 纯函数：停用/重新启用供应商 —— pi 的语义是把整块配置在 providers 与
 * _disabledProviders 之间搬运。已在目标桶时幂等返回。
 */
export function applyPiCliSetProviderDisabled(
  modelsJson: unknown,
  id: string,
  disabled: boolean,
): Record<string, unknown> {
  if (!isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const safeId = sanitizePiProviderId(id);
  const providers = isRecord(modelsJson.providers) ? modelsJson.providers : undefined;
  const disabledProviders = isRecord(modelsJson._disabledProviders)
    ? modelsJson._disabledProviders
    : undefined;
  if (disabled) {
    if (providers && isRecord(providers[safeId])) {
      const dp = (modelsJson._disabledProviders =
        modelsJson._disabledProviders && isRecord(modelsJson._disabledProviders)
          ? modelsJson._disabledProviders
          : {}) as Record<string, unknown>;
      dp[safeId] = providers[safeId];
      delete providers[safeId];
    } else if (!disabledProviders || !isRecord(disabledProviders[safeId])) {
      throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
    }
  } else {
    if (disabledProviders && isRecord(disabledProviders[safeId])) {
      const pv = (modelsJson.providers = providers ?? {}) as Record<string, unknown>;
      pv[safeId] = disabledProviders[safeId];
      delete disabledProviders[safeId];
    } else if (!providers || !isRecord(providers[safeId])) {
      throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
    }
  }
  return modelsJson as Record<string, unknown>;
}

/** 纯函数：创建或更新单个模型（同 id 原地合并，未提供的字段保留）。 */
export function applyPiCliUpsertModel(
  modelsJson: unknown,
  providerId: string,
  model: PiCliModelInput,
): { doc: Record<string, unknown>; added: boolean } {
  if (!isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const found = findProviderBlock(modelsJson, sanitizePiProviderId(providerId));
  if (!found) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const provider = found.bucket[sanitizePiProviderId(providerId)] as Record<string, unknown>;
  const definition = buildModelDefinition(model);
  const modelId = definition.id as string;
  const existing = Array.isArray(provider.models) ? provider.models : [];
  const at = existing.findIndex(
    (m) => isRecord(m) && typeof m.id === 'string' && m.id === modelId,
  );
  if (at >= 0) {
    existing[at] = { ...(existing[at] as Record<string, unknown>), ...definition };
    provider.models = existing;
    return { doc: modelsJson as Record<string, unknown>, added: false };
  }
  provider.models = [...existing, definition];
  return { doc: modelsJson as Record<string, unknown>, added: true };
}

/** 纯函数：删除供应商下的单个模型。 */
export function applyPiCliRemoveModel(
  modelsJson: unknown,
  providerId: string,
  modelId: string,
): Record<string, unknown> {
  if (!isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const safeId = sanitizePiProviderId(providerId);
  const found = findProviderBlock(modelsJson, safeId);
  if (!found) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const provider = found.bucket[safeId] as Record<string, unknown>;
  if (!Array.isArray(provider.models)) throw new Error('PI_CLI_MODEL_INVALID');
  provider.models = provider.models.filter(
    (m) => !(isRecord(m) && m.id === modelId),
  );
  return modelsJson as Record<string, unknown>;
}

/**
 * settings.enabledModels 白名单变更。
 *
 * 两组语义并存:
 * - `add` / `remove` / `replaceAll`:直写名单(pws 同款,导入流程用)。注意直写
 *   在「名单原本为空 = 全启用」态下会把名单钉成部分名单,其它模型随之被过滤 ——
 *   只有调用方明确要这个行为时才用。
 * - `enable` / `disable`:**语义化启停**(面板开关用)。以 pi 的白名单语义计算:
 *   空名单态下停用会先物化名单(全 universe - targets),保证「其它模型保持可用」;
 *   名单存在时按模式解析命中集后增删(glob 命中多个时拆成精确 ref 保留未命中的)。
 */
export interface PiCliEnabledModelChange {
  add?: string[];
  remove?: string[];
  replaceAll?: string[];
  enable?: string[];
  disable?: string[];
}

const hasGlobChar = (p: string): boolean => /[*?[]/.test(stripThinkingSuffix(p));

export function applyPiCliUpdateEnabledModels(
  settings: unknown,
  change: PiCliEnabledModelChange,
  universe: readonly PiModelUniverseEntry[] = [],
): Record<string, unknown> {
  const s = isRecord(settings) ? settings : {};
  // ── 直写路径(既有行为,保持不变)─────────────────────────────
  if (change.add !== undefined || change.remove !== undefined || change.replaceAll !== undefined) {
    const current = Array.isArray(s.enabledModels)
      ? (s.enabledModels as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let next: string[];
    if (Array.isArray(change.replaceAll)) {
      next = [...new Set(change.replaceAll.map((r) => r.trim()).filter(Boolean))];
    } else {
      const set = new Set(current);
      for (const ref of change.add ?? []) {
        if (typeof ref === 'string' && ref.trim()) set.add(ref.trim());
      }
      for (const ref of change.remove ?? []) set.delete(ref);
      next = [...set];
    }
    if (next.length > 0) s.enabledModels = next;
    else delete s.enabledModels;
    return s;
  }

  // ── 语义化路径(面板开关)───────────────────────────────────
  const enable = Array.isArray(change.enable)
    ? change.enable.map((r) => r.trim()).filter(Boolean)
    : [];
  const disable = Array.isArray(change.disable)
    ? change.disable.map((r) => r.trim()).filter(Boolean)
    : [];
  if (enable.length === 0 && disable.length === 0) return s;

  const refOf = (m: PiModelUniverseEntry): string => `${m.provider}/${m.id}`;
  const universeRefs = universe.map(refOf);
  const universeLower = new Set(universeRefs.map((r) => r.toLowerCase()));
  const targetsLower = new Set(disable.map((r) => r.toLowerCase()));

  const currentPatterns = Array.isArray(s.enabledModels)
    ? (s.enabledModels as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const hasList = currentPatterns.length > 0;

  if (!hasList) {
    // 空名单 = 全启用(pi 语义)。
    if (disable.length === 0) return s; // 启用已满足;写入反而会把名单钉成部分名单
    // 物化:全 universe 减去停用目标 —— 其它模型保持可用。
    const next = universeRefs.filter((r) => !targetsLower.has(r.toLowerCase()));
    // targets 覆盖全部 universe:pi 的白名单无法表达「一个都不启用」(空名单 = 不过滤),
    // 保持原状,不制造假状态。
    if (next.length === 0) return s;
    s.enabledModels = next;
    return s;
  }

  // 名单存在:逐 pattern 解析命中集后增删。命中的 glob 拆成精确 ref 保留未命中部分,
  // 保证「只关目标、其余不变」;无法解析的 pattern(手写的悬空引用)原样保留。
  let next: string[] = [];
  for (const entry of currentPatterns) {
    const matched = resolveEnabledPattern(entry, universe);
    if (matched.length === 0 || !hasGlobChar(entry)) {
      // 精确引用 / 无法解析:命中 targets 就丢弃,否则保留。
      if (!targetsLower.has(entry.toLowerCase())) next.push(entry);
      continue;
    }
    const hitTargets = matched.some((m) => targetsLower.has(refOf(m).toLowerCase()));
    if (!hitTargets) {
      next.push(entry);
      continue;
    }
    for (const m of matched) {
      const ref = refOf(m);
      if (!targetsLower.has(ref.toLowerCase())) next.push(ref);
    }
  }
  for (const ref of enable) {
    if (universeLower.size > 0 && !universeLower.has(ref.toLowerCase())) continue; // 未知 ref 不入名单
    if (!next.some((x) => x.toLowerCase() === ref.toLowerCase())) next.push(ref);
  }

  // pi 自己的 selector 保存时:名单覆盖全部可用模型 = 不过滤 → 删键;
  // 名单被清空 = 无过滤 → 删键(空名单在 pi 运行时等价于全开)。
  const coversAll =
    universeRefs.length > 0 &&
    universeRefs.every((r) => next.some((x) => x.toLowerCase() === r.toLowerCase()));
  if (next.length === 0 || coversAll) delete s.enabledModels;
  else s.enabledModels = next;
  return s;
}

// ─── 上述纯函数的文件 IO 包装（models.json / settings.json / auth.json）────

function readModelsDoc(): Record<string, unknown> {
  const models = readJsonFile<unknown>(join(PI_DIR, 'models.json'));
  if ('error' in models) {
    throw new Error(
      models.error === 'missing' ? 'PI_CLI_PROVIDER_NOT_FOUND' : 'PI_CLI_WRITE_FAILED',
    );
  }
  return models.value as Record<string, unknown>;
}

function writeModelsDoc(doc: Record<string, unknown>): void {
  try {
    writeFileSync(join(PI_DIR, 'models.json'), JSON.stringify(doc, null, 2), 'utf-8');
  } catch {
    throw new Error('PI_CLI_WRITE_FAILED');
  }
}

function withSettingsDoc(fn: (settings: Record<string, unknown>) => Record<string, unknown>): void {
  const settingsPath = join(PI_DIR, 'settings.json');
  const settings = readJsonFile<unknown>(settingsPath);
  const value = 'error' in settings ? {} : (settings.value as Record<string, unknown>);
  const next = fn(value);
  try {
    writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    throw new Error('PI_CLI_WRITE_FAILED');
  }
}

export function upsertPiCliProvider(id: string, patch: PiCliProviderPatch): void {
  writeModelsDoc(applyPiCliUpsertProvider(readModelsDoc(), id, patch));
}

export function renamePiCliProvider(fromId: string, toId: string, patch?: PiCliProviderPatch): void {
  const doc = readModelsDoc();
  const settingsPath = join(PI_DIR, 'settings.json');
  const settings = readJsonFile<unknown>(settingsPath);
  const settingsValue = 'error' in settings ? {} : (settings.value as Record<string, unknown>);
  const { doc: nextDoc, settings: nextSettings } = applyPiCliRenameProvider(
    doc,
    settingsValue,
    fromId,
    toId,
    patch,
  );
  writeModelsDoc(nextDoc);
  try {
    writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf-8');
  } catch {
    throw new Error('PI_CLI_WRITE_FAILED');
  }
}

export function removePiCliProvider(id: string): void {
  writeModelsDoc(applyPiCliRemoveProvider(readModelsDoc(), id));
  // auth.json 里的同名凭证一并清掉（pws removeCustomProvider 同语义）。
  const authPath = join(PI_DIR, 'auth.json');
  const auth = readJsonFile<unknown>(authPath);
  if ('error' in auth) return;
  const value = auth.value;
  if (isRecord(value) && isRecord(value[id])) {
    delete value[id];
    try {
      writeFileSync(authPath, JSON.stringify(value, null, 2), 'utf-8');
    } catch {
      throw new Error('PI_CLI_WRITE_FAILED');
    }
  }
}

export function setPiCliProviderDisabled(id: string, disabled: boolean): void {
  writeModelsDoc(applyPiCliSetProviderDisabled(readModelsDoc(), id, disabled));
}

export function updatePiCliEnabledModels(change: PiCliEnabledModelChange): void {
  // 语义化启停(enable/disable)需要 models.json 的模型全集做 universe;
  // 直写路径(add/remove/replaceAll)不用它,读一份也无妨(同一次写盘前的事)。
  withSettingsDoc((settings) =>
    applyPiCliUpdateEnabledModels(settings, change, readActiveModelUniverse()),
  );
}

/** 创建或更新单个模型（同 id 原地合并）。 */
export function upsertPiCliProviderModel(providerId: string, model: PiCliModelInput): void {
  const { doc, added } = applyPiCliUpsertModel(readModelsDoc(), providerId, model);
  if (!added) {
    // 原地合并也写回（字段可能被部分更新）。
    writeModelsDoc(doc);
    return;
  }
  writeModelsDoc(doc);
}

/** 删除供应商下的单个模型。 */
export function removePiCliProviderModel(providerId: string, modelId: string): void {
  writeModelsDoc(applyPiCliRemoveModel(readModelsDoc(), providerId, modelId));
}

export const __testing = {
  maskApiKey,
  toModelView,
  toApiKeyViews,
  toCompatView,
  resolveKeyRef,
  resolveProviderRuntimeConfigFromRaw,
  applyPiCliKeySwitch,
  applyPiCliAddModel,
  applyPiCliRemoveKey,
  sanitizePiProviderId,
  derivePiProviderId,
  applyPiCliUpsertProvider,
  applyPiCliRenameProvider,
  applyPiCliRemoveProvider,
  applyPiCliSetProviderDisabled,
  applyPiCliUpsertModel,
  applyPiCliRemoveModel,
  applyPiCliUpdateEnabledModels,
  resolveEnabledRefSet,
  readPiCliRuntimeProviders,
  buildPiCliCatalogProviders,
};

/**
 * models.json + auth.json 的 mtime 指纹(目录投影外部变化探测用;任一文件缺失记 '0')。
 * 变化判定由调用方(createDesktopProviderService 的 poll 钩子)做,这里只读指纹。
 */
export function readPiCliConfigMtimes(): string {
  const stat = (file: string): string => {
    try {
      return String(statSync(file).mtimeMs);
    } catch {
      return '0';
    }
  };
  return `${stat(join(PI_DIR, 'models.json'))}:${stat(join(PI_DIR, 'auth.json'))}`;
}

// ─── Provider live test（主进程持真值,Renderer 只收结果）───────────────────

/** 请求端点缺失等主进程侧可直接判定的失败,handler 映射成对应 IPC 错误码。 */
export type PiCliProviderTestFailure =
  | 'PI_CLI_PROVIDER_NOT_FOUND'
  | 'PI_CLI_PROVIDER_NO_BASEURL';

interface PiCliProviderRuntimeConfig {
  baseUrl?: string;
  apiKey?: string;
  /** models.json 的 `api` 字段 —— 探测请求按 wire 选端点与鉴权头。 */
  api?: string;
}

/**
 * 从已解析的 models.json / auth.json 原始 JSON 里解析供应商的运行时配置。
 * 独立成纯函数便于单测;文件读取包装在 readPiCliProviderRuntimeConfig 里。
 * 供应商"存在"的判定:`providers`、`_disabledProviders` 或 auth.json 任一里有该 id ——
 * 已停用的供应商在面板里仍列出,测连接这类只读探测对它照样要能用。
 */
function resolveProviderRuntimeConfigFromRaw(
  providerId: string,
  modelsJson: unknown,
  authJson: unknown,
): PiCliProviderRuntimeConfig | null {
  const id = providerId.trim();
  if (!id) return null;
  const activeProviders = isRecord(modelsJson) && isRecord(modelsJson.providers)
    ? modelsJson.providers
    : {};
  const disabledProviders = isRecord(modelsJson) && isRecord(modelsJson._disabledProviders)
    ? modelsJson._disabledProviders
    : {};
  const raw = isRecord(activeProviders[id])
    ? activeProviders[id]
    : isRecord(disabledProviders[id])
      ? disabledProviders[id]
      : null;
  const authMap = isRecord(authJson) ? authJson : {};
  const authEntry = isRecord(authMap[id]) ? authMap[id] : null;
  if (!raw && !authEntry) return null;
  // `$VAR` 引用在这里就地解引用:探测请求要发的是真值,不是字面量。
  const apiKey = resolveKeyRef(
    (typeof raw?.apiKey === 'string' && raw.apiKey) ||
      (typeof authEntry?.key === 'string' && authEntry.key) ||
      undefined,
  );
  return {
    ...(typeof raw?.baseUrl === 'string' && raw.baseUrl.trim()
      ? { baseUrl: raw.baseUrl.trim().replace(/\/+$/, '') }
      : {}),
    // models.json 的 apiKey 镜像当前生效的那把;auth.json 是 pi 自己读的凭证源。
    ...(apiKey ? { apiKey } : {}),
    ...(typeof raw?.api === 'string' && raw.api.trim() ? { api: raw.api.trim() } : {}),
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
  return testProviderConnection(config.baseUrl, config.apiKey, config.api);
}

/** 供应商详情「拉取模型」:GET {baseUrl}/models 解析模型清单,真值 key 只在主进程。 */
export async function fetchPiCliProviderModels(providerId: string): Promise<PiFetchModelsResult> {
  const config = readPiCliProviderRuntimeConfig(providerId);
  if (!config) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  if (!config.baseUrl) throw new Error('PI_CLI_PROVIDER_NO_BASEURL');
  return fetchProviderModels(config.baseUrl, config.apiKey, config.api);
}

/** 测速面板单模型探测:按 wire 选路径与 body,真值 key 只在主进程。 */
export async function testPiCliModel(
  providerId: string,
  modelId: string,
): Promise<PiProviderTestResult> {
  const config = readPiCliProviderRuntimeConfig(providerId);
  if (!config) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  if (!config.baseUrl) throw new Error('PI_CLI_PROVIDER_NO_BASEURL');
  return testModel(config.baseUrl, modelId, config.apiKey, config.api);
}

// ─── Key pool 切换（面板唯一写路径，真值不出主进程）────────────────────

/**
 * 纯函数：在 models.json 原始 JSON 里切换供应商的生效 key，返回写回用整文档。
 *
 * 语义对齐 pi-web-switch 的 `persistKeys`：`activeKeyId` 指向池里选中的那把，
 * `apiKey` 镜像该条**原值**（`$VAR` 引用原样保留，由 pi 自己解引用）—— pi 的
 * `ProviderConfigSchema` 只读 `apiKey`，池与指针只是 pws/本面板的管理层约定。
 * 停用供应商（`_disabledProviders`）同样支持切换，便于重新启用前先换 key。
 *
 * 抛类型化错误：`PI_CLI_PROVIDER_NOT_FOUND` / `PI_CLI_KEY_NOT_FOUND`。
 * 池条目缺 `id` 的文件（非 pws 写入的旧文件）无法按 id 定位，面板对它们
 * 不提供切换入口；这里也一律按 id 精确匹配，不做下标猜测。
 */
export function applyPiCliKeySwitch(
  modelsJson: unknown,
  providerId: string,
  keyId: string,
): Record<string, unknown> {
  const id = providerId.trim();
  const targetKeyId = keyId.trim();
  if (!id || !targetKeyId || !isRecord(modelsJson)) {
    throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  }
  const block = isRecord(modelsJson.providers)
    ? modelsJson.providers[id]
    : undefined;
  const disabledBlock = isRecord(modelsJson._disabledProviders)
    ? modelsJson._disabledProviders[id]
    : undefined;
  const provider = isRecord(block) ? block : isRecord(disabledBlock) ? disabledBlock : null;
  if (!provider) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const pool = Array.isArray(provider.apiKeys) ? provider.apiKeys : [];
  const entry = pool.find(
    (e): e is Record<string, unknown> & { id: string; key: string } =>
      isRecord(e) && e.id === targetKeyId && typeof e.key === 'string' && e.key.trim().length > 0,
  );
  if (!entry) throw new Error('PI_CLI_KEY_NOT_FOUND');
  provider.activeKeyId = entry.id;
  provider.apiKey = entry.key;
  return modelsJson as Record<string, unknown>;
}

/**
 * 面板「切换生效 key」：读 models.json → applyPiCliKeySwitch → 整文档写回。
 * 真值（池里的 key 原文）只在这条主进程路径里流转，不进 IPC 返回值。
 */
export function switchPiCliProviderKey(providerId: string, keyId: string): void {
  const modelsPath = join(PI_DIR, 'models.json');
  const models = readJsonFile<unknown>(modelsPath);
  if ('error' in models) {
    // 文件缺失 = 没有任何供应商可切；解析失败不能拿半份文件去覆盖。
    throw new Error(
      models.error === 'missing' ? 'PI_CLI_PROVIDER_NOT_FOUND' : 'PI_CLI_WRITE_FAILED',
    );
  }
  const next = applyPiCliKeySwitch(models.value, providerId, keyId);
  try {
    writeFileSync(modelsPath, JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    throw new Error('PI_CLI_WRITE_FAILED');
  }
}

/** 纯函数：从池里移除一把 key；移除生效 key 时回落到剩余第一把（pws 同语义）。 */
export function applyPiCliRemoveKey(
  modelsJson: unknown,
  providerId: string,
  keyId: string,
): Record<string, unknown> {
  const id = providerId.trim();
  if (!id || !isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const block = isRecord(modelsJson.providers) ? modelsJson.providers[id] : undefined;
  const disabledBlock = isRecord(modelsJson._disabledProviders)
    ? modelsJson._disabledProviders[id]
    : undefined;
  const provider = isRecord(block) ? block : isRecord(disabledBlock) ? disabledBlock : null;
  if (!provider) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const pool = Array.isArray(provider.apiKeys)
    ? (provider.apiKeys as unknown[]).filter(
        (e): e is Record<string, unknown> => isRecord(e),
      )
    : [];
  const entry = pool.find((e) => e.id === keyId);
  if (!entry) throw new Error('PI_CLI_KEY_NOT_FOUND');
  const next = pool.filter((e) => e.id !== keyId);
  if (next.length > 0) {
    provider.apiKeys = next;
    if (provider.activeKeyId === keyId) {
      const first = next[0]!;
      provider.activeKeyId = first.id;
      provider.apiKey = first.key;
    }
  } else {
    // 池空:整个池结构撤销,apiKey 镜像一并清掉。
    delete provider.apiKeys;
    delete provider.activeKeyId;
    delete provider.apiKey;
  }
  return modelsJson as Record<string, unknown>;
}

/** 面板「移除池里的 key」：读 models.json → applyPiCliRemoveKey → 整文档写回。 */
export function removePiCliProviderKey(providerId: string, keyId: string): void {
  writeModelsDoc(applyPiCliRemoveKey(readModelsDoc(), providerId, keyId));
}

// ─── 模型追加（测速页「添加到正式配置」）──────────────────────────

/** 测速页传来的模型定义（不含任何凭证字段）。 */
export interface PiCliModelInput {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/**
 * 纯函数：把测速页拉取到的模型追加进 models.json 里某 provider 的 models 数组，
 * 返回写回用整文档。语义对齐 pi-web-switch 的 addToProvider：同 id 已存在时
 * 幂等跳过（added=false）；新模型不动 settings.enabledModels —— 白名单非空时
 * 新模型默认不在名单内 = 未启用，用户在供应商页打开（与 pws "added disabled
 * by default" 同语义）。
 *
 * 抛类型化错误：PI_CLI_PROVIDER_NOT_FOUND / PI_CLI_MODEL_INVALID /
 * PI_CLI_WRITE_FAILED（wrapper）。
 */
export function applyPiCliAddModel(
  modelsJson: unknown,
  providerId: string,
  model: PiCliModelInput,
): { doc: Record<string, unknown>; added: boolean } {
  const id = providerId.trim();
  if (!id || !isRecord(modelsJson)) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');
  const block = isRecord(modelsJson.providers) ? modelsJson.providers[id] : undefined;
  const disabledBlock = isRecord(modelsJson._disabledProviders)
    ? modelsJson._disabledProviders[id]
    : undefined;
  const provider = isRecord(block) ? block : isRecord(disabledBlock) ? disabledBlock : null;
  if (!provider) throw new Error('PI_CLI_PROVIDER_NOT_FOUND');

  // 模型定义校验：pi 的 ModelDefinitionSchema 要求 id 非空；其余字段带默认值。
  const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!modelId) throw new Error('PI_CLI_MODEL_INVALID');
  const cost =
    isRecord(model.cost)
      ? {
          input: optionalNumber(model.cost.input) ?? 0,
          output: optionalNumber(model.cost.output) ?? 0,
          cacheRead: optionalNumber(model.cost.cacheRead) ?? 0,
          cacheWrite: optionalNumber(model.cost.cacheWrite) ?? 0,
        }
      : undefined;
  const input = Array.isArray(model.input)
    ? model.input.filter((x): x is string => typeof x === 'string')
    : undefined;
  const definition: Record<string, unknown> = {
    id: modelId,
    ...(typeof model.name === 'string' && model.name.trim() ? { name: model.name.trim() } : {}),
    ...(model.reasoning === true ? { reasoning: true } : {}),
    ...(input && input.length > 0 ? { input } : {}),
    ...(optionalNumber(model.contextWindow) !== undefined
      ? { contextWindow: optionalNumber(model.contextWindow) }
      : {}),
    ...(optionalNumber(model.maxTokens) !== undefined
      ? { maxTokens: optionalNumber(model.maxTokens) }
      : {}),
    ...(cost ? { cost } : {}),
  };

  const existing = Array.isArray(provider.models) ? provider.models : [];
  const duplicate = existing.some(
    (m) => isRecord(m) && typeof m.id === 'string' && m.id === modelId,
  );
  if (duplicate) return { doc: modelsJson as Record<string, unknown>, added: false };
  provider.models = [...existing, definition];
  return { doc: modelsJson as Record<string, unknown>, added: true };
}

/** 面板「添加模型到正式配置」：读 models.json → applyPiCliAddModel → 整文档写回。 */
export function addPiCliProviderModel(
  providerId: string,
  model: PiCliModelInput,
): boolean {
  const modelsPath = join(PI_DIR, 'models.json');
  const models = readJsonFile<unknown>(modelsPath);
  if ('error' in models) {
    throw new Error(
      models.error === 'missing' ? 'PI_CLI_PROVIDER_NOT_FOUND' : 'PI_CLI_WRITE_FAILED',
    );
  }
  const { doc, added } = applyPiCliAddModel(models.value, providerId, model);
  if (!added) return false;
  try {
    writeFileSync(modelsPath, JSON.stringify(doc, null, 2), 'utf-8');
  } catch {
    throw new Error('PI_CLI_WRITE_FAILED');
  }
  return true;
}

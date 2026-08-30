// @vitest-environment node

/**
 * piProviders —— Settings 供应商区 pi 数据层的关键不变量:
 *   1. 内置目录从本机 pi 安装位置(pi 入口向上找 pi-ai dist/providers/data)读取;
 *   2. 密钥只出打码值:任何投影(view)都不含明文 key,明文只进 setAuth 写路径;
 *   3. models.json 合并语义:同 id 带 apiKey = 独立自定义供应商(取代 builtin 行),
 *      同 id 不带 apiKey = override(并入 builtin,可加模型/覆写 baseUrl);
 *   4. 写路径语义化:saveModel 对 builtin 落 override 块;rename 同步 settings 引用;
 *   5. 连接测试 URL 校验:非 http(s) / 解析失败 fail closed,不发请求。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// piReader 的 PI_DIR 在 import 期由 homedir() 派生,因此 homedir mock 必须在
// import 前就指向可写的系统临时目录(每 worker 进程一个,afterAll 清理)。
const { homedirMock, cachedPiPathMock, FAKE_HOME } = vi.hoisted(() => {
  const base = process.env.TMPDIR ?? process.env.TEMP ?? '/tmp';
  return {
    homedirMock: vi.fn(() => `${base}/pi-providers-test-${process.pid}`),
    cachedPiPathMock: vi.fn<() => string | null>(() => null),
    FAKE_HOME: `${base}/pi-providers-test-${process.pid}`,
  };
});

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: homedirMock,
}));

vi.mock('../localPi.js', () => ({
  getCachedLocalPiPath: () => cachedPiPathMock(),
}));

import {
  addPiCustomProvider,
  listPiProviders,
  maskProviderKey,
  readBuiltinCatalog,
  clearBuiltinCatalogCache,
  removePiCustomProvider,
  removePiProviderAuth,
  removePiProviderModel,
  renamePiCustomProvider,
  savePiProviderModel,
  setPiProviderAuth,
  updatePiCustomProvider,
} from '../piProviders.js';
import { readAuth, readModelsJson, readSettings } from '../piReader.js';
import type { PiModelsJson } from '../piTypes.js';

// 假 HOME 下的 pi agent 目录;piReader 写入函数会 mkdir 该目录的父链吗?
// 不会 —— writeJson 直接 writeFileSync,所以用例里统一先 mkdirSync(recursive)。

function piAgentDir(): string {
  return join(FAKE_HOME, '.pi', 'agent');
}

function writeAgentFile(name: string, data: unknown): void {
  mkdirSync(piAgentDir(), { recursive: true });
  writeFileSync(join(piAgentDir(), name), JSON.stringify(data, null, 2), 'utf-8');
}

function writeAgentRaw(name: string, content: string): void {
  mkdirSync(piAgentDir(), { recursive: true });
  writeFileSync(join(piAgentDir(), name), content, 'utf-8');
}

function readAgentFile<T>(name: string): T | null {
  const p = join(piAgentDir(), name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

// ─── 假 pi 安装:<tmp>/pi/bin/pi → 向上找到 <tmp>/pi/node_modules/pi-ai ──────

let fakePiRoot: string;
let fakePiBinary: string;

function installFakePi(): void {
  const providersDir = join(
    fakePiRoot,
    'node_modules',
    '@earendil-works',
    'pi-ai',
    'dist',
    'providers',
  );
  mkdirSync(join(providersDir, 'data'), { recursive: true });
  writeFileSync(
    join(providersDir, 'data', 'deepseek.json'),
    JSON.stringify({
      'openai-completions': {
        'deepseek-v4': {
          id: 'deepseek-v4',
          name: 'DeepSeek V4',
          api: 'openai-completions',
          baseUrl: 'https://api.deepseek.com',
          reasoning: true,
          input: ['text'],
          contextWindow: 1_048_576,
          maxTokens: 384_000,
          cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
        },
      },
    }),
    'utf-8',
  );
  writeFileSync(
    join(providersDir, 'deepseek.js'),
    `export function deepseekProvider() {\n  return createProvider({ id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" });\n}`,
    'utf-8',
  );
  mkdirSync(join(fakePiRoot, 'bin'), { recursive: true });
  writeFileSync(fakePiBinary, '#!/bin/sh\n', { mode: 0o755 });
}

beforeEach(() => {
  fakePiRoot = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'pi-providers-root-'));
  fakePiBinary = join(fakePiRoot, 'bin', 'pi');
  clearBuiltinCatalogCache();
  cachedPiPathMock.mockReset();
  cachedPiPathMock.mockReturnValue(null);
  rmSync(piAgentDir(), { recursive: true, force: true });
  // piReader 的 writeJson 不建父目录,先准备好 ~/.pi/agent
  mkdirSync(piAgentDir(), { recursive: true });
});

afterEach(() => {
  rmSync(fakePiRoot, { recursive: true, force: true });
  rmSync(piAgentDir(), { recursive: true, force: true });
});

describe('readBuiltinCatalog', () => {
  it('从本机 pi 入口向上定位 pi-ai 目录并解析目录数据', () => {
    installFakePi();
    cachedPiPathMock.mockReturnValue(fakePiBinary);
    const catalog = readBuiltinCatalog();
    expect(catalog).not.toBeNull();
    expect(catalog).toHaveLength(1);
    expect(catalog?.[0]).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      api: 'openai-completions',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(catalog?.[0]?.models?.[0]?.id).toBe('deepseek-v4');
  });

  it('本机没有 pi 时返回 null(不抛错)', () => {
    cachedPiPathMock.mockReturnValue(null);
    expect(readBuiltinCatalog()).toBeNull();
  });
});

describe('listPiProviders 合并语义', () => {
  it('密钥只出打码值,authSource 标明所在文件', () => {
    installFakePi();
    cachedPiPathMock.mockReturnValue(fakePiBinary);
    writeAgentFile('auth.json', {
      deepseek: { type: 'api_key', key: 'sk-secret-abcdef1234567890' },
    });
    const views = listPiProviders();
    const deepseek = views.find((v) => v.id === 'deepseek');
    expect(deepseek?.hasAuth).toBe(true);
    expect(deepseek?.keyMasked).not.toContain('sk-secret-abcdef1234567890');
    expect(deepseek?.authSource).toBe('auth');
    expect(JSON.stringify(views)).not.toContain('sk-secret-abcdef1234567890');
  });

  it('models.json 同 id 不带 apiKey 的条目并入 builtin(override)', () => {
    installFakePi();
    cachedPiPathMock.mockReturnValue(fakePiBinary);
    writeAgentFile('models.json', {
      providers: {
        deepseek: {
          name: 'My DeepSeek',
          baseUrl: 'https://proxy.example.com/v1',
          models: [{ id: 'vendor-model', name: 'Vendor Model', contextWindow: 128000 }],
        },
      },
    });
    const deepseek = listPiProviders().find((v) => v.id === 'deepseek');
    expect(deepseek?.type).toBe('builtin');
    expect(deepseek?.isOverride).toBe(true);
    expect(deepseek?.name).toBe('My DeepSeek');
    expect(deepseek?.baseUrl).toBe('https://proxy.example.com/v1');
    expect(deepseek?.models.map((m) => m.id)).toEqual(['deepseek-v4', 'vendor-model']);
  });

  it('models.json 同 id 带 apiKey 的条目是独立自定义供应商(取代 builtin 行)', () => {
    installFakePi();
    cachedPiPathMock.mockReturnValue(fakePiBinary);
    writeAgentFile('models.json', {
      providers: {
        deepseek: {
          name: 'Relay',
          apiKey: 'sk-relay-key-1234567890',
          baseUrl: 'https://relay.example.com/v1',
          models: [{ id: 'm1' }],
        },
      },
    });
    const views = listPiProviders();
    expect(views.filter((v) => v.id === 'deepseek')).toHaveLength(1);
    const relay = views.find((v) => v.id === 'deepseek');
    expect(relay?.type).toBe('custom');
    expect(relay?.authSource).toBe('modelsJson');
    expect(relay?.keyMasked).not.toContain('sk-relay-key-1234567890');
  });
});

describe('auth 写路径', () => {
  it('setPiProviderAuth 写入 auth.json,remove 幂等', () => {
    expect(setPiProviderAuth('deepseek', 'sk-new-key-1234567890')).toBe(true);
    expect(readAuth()).toMatchObject({
      deepseek: { type: 'api_key', key: 'sk-new-key-1234567890' },
    });
    expect(removePiProviderAuth('deepseek')).toBe(true);
    expect(readAuth()).toEqual({});
    expect(removePiProviderAuth('deepseek')).toBe(true);
  });

  it('空 providerId / 空 key 拒绝写入', () => {
    expect(setPiProviderAuth('', 'sk-x')).toBe(false);
    expect(setPiProviderAuth('deepseek', '')).toBe(false);
  });
});

describe('model CRUD', () => {
  it('saveModel 对 builtin 供应商落 override 块,可更新同 id 模型', () => {
    installFakePi();
    cachedPiPathMock.mockReturnValue(fakePiBinary);
    expect(savePiProviderModel('deepseek', { id: 'm2', name: 'M2' })).toBe(true);
    expect((readModelsJson() as PiModelsJson | null)).toMatchObject({
      providers: { deepseek: { models: [{ id: 'm2', name: 'M2' }] } },
    });
    expect(savePiProviderModel('deepseek', { id: 'm2', name: 'M2 updated' })).toBe(true);
    expect((readModelsJson() as PiModelsJson | null)?.providers?.deepseek?.models).toHaveLength(1);
    expect((readModelsJson() as PiModelsJson | null)?.providers?.deepseek?.models?.[0]?.name).toBe('M2 updated');

    // override 块并入 builtin 视图
    const deepseek = listPiProviders().find((v) => v.id === 'deepseek');
    expect(deepseek?.isOverride).toBe(true);
    expect(deepseek?.models.map((m) => m.id)).toEqual(['deepseek-v4', 'm2']);
  });

  it('removeModel 删除 override 中的模型;空块后 provider 条目仍在(字段保留)', () => {
    writeAgentFile('models.json', {
      providers: { relay: { baseUrl: 'https://x.example.com', models: [{ id: 'a' }, { id: 'b' }] } },
    });
    expect(removePiProviderModel('relay', 'a')).toBe(true);
    expect((readModelsJson() as PiModelsJson | null)?.providers?.relay?.models?.map((m) => m.id)).toEqual(['b']);
    expect((readModelsJson() as PiModelsJson | null)?.providers?.relay?.baseUrl).toBe('https://x.example.com');
  });
});

describe('custom provider CRUD', () => {
  it('add/update 保留未传字段;apiKey 传 undefined 不覆盖真实值', () => {
    writeAgentFile('models.json', {
      providers: { relay: { baseUrl: 'https://x.example.com', apiKey: 'sk-real-1234567890' } },
    });
    expect(addPiCustomProvider('relay', { baseUrl: 'https://y' })).toBe(false);
    expect(addPiCustomProvider('newp', { baseUrl: 'https://y' })).toBe(true);

    expect(updatePiCustomProvider('relay', { name: 'Renamed' })).toBe(true);
    const relay = (readModelsJson() as PiModelsJson | null)?.providers?.relay;
    expect(relay?.name).toBe('Renamed');
    expect(relay?.apiKey).toBe('sk-real-1234567890');
    expect(updatePiCustomProvider('relay', { apiKey: '' })).toBe(true);
    expect((readModelsJson() as PiModelsJson | null)?.providers?.relay?.apiKey).toBeUndefined();
  });

  it('rename 重排 providers 并同步 settings 里的引用', () => {
    writeAgentFile('models.json', {
      providers: { oldp: { models: [{ id: 'm1' }] }, keep: {} },
    });
    writeAgentFile('settings.json', {
      defaultProvider: 'oldp',
      defaultModel: 'oldp/m1',
      enabledModels: ['oldp/m1', 'keep/x'],
    });
    expect(renamePiCustomProvider('oldp', 'keep')).toBe(false); // 目标已存在
    expect(renamePiCustomProvider('oldp', 'newp')).toBe(true);
    expect(Object.keys((readModelsJson() as PiModelsJson | null)?.providers ?? {})).toEqual(['newp', 'keep']);
    const settings = readSettings();
    expect(settings?.defaultProvider).toBe('newp');
    expect(settings?.defaultModel).toBe('newp/m1');
    expect(settings?.enabledModels).toEqual(['newp/m1', 'keep/x']);
  });

  it('remove 删除条目', () => {
    writeAgentFile('models.json', { providers: { a: {}, b: {} } });
    expect(removePiCustomProvider('a')).toBe(true);
    expect(Object.keys((readModelsJson() as PiModelsJson | null)?.providers ?? {})).toEqual(['b']);
  });
});

describe('maskProviderKey', () => {
  it('短 key 截头,长 key 保两端,env 引用原样', () => {
    expect(maskProviderKey('short')).toBe('sho…');
    expect(maskProviderKey('sk-1234567890abcdef')).toBe('sk-1234…cdef');
    expect(maskProviderKey('$OPENAI_API_KEY')).toBe('$OPENAI_API_KEY');
  });
});

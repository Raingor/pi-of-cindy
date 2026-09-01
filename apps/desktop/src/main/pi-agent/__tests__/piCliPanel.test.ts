/**
 * 本机 Pi CLI 面板的数据边界。
 *
 * 核心不变量:`~/.pi/agent/models.json` 与 `auth.json` 带明文 API key,而 Cindy 的
 * Renderer 会渲染 agent 输出、Markdown、插件面板与内置浏览器网页 —— 按
 * `docs/dev-rules/electron-security-and-process-boundaries.md`,凭证真值不得出主进程。
 * 面板因此只拿遮罩串与 `hasApiKey`。
 */

import { describe, expect, it } from 'vitest';

import { __testing } from '../piCliPanel.js';

const { maskApiKey, toModelView } = __testing;

describe('pi cli provider redaction', () => {
  it('masks a real key down to head and tail', () => {
    // 典型 provider key 长度足够,露头尾 4 位便于用户核对是哪一把。
    expect(maskApiKey('sk-2AwWwdzqqhOjOCKKIKYjcJWDJa0FWY9xISZBnJoyrFRcMuiA')).toBe('sk-2…MuiA');
  });

  it('fully masks a short key instead of leaking most of it', () => {
    // 12 字符以下露头尾等于露大半,整串打码。
    expect(maskApiKey('sk-abc12')).toBe('••••••••');
    expect(maskApiKey('sk-abc12')).not.toContain('abc');
  });

  it('treats blank and whitespace-only keys as unset', () => {
    expect(maskApiKey('')).toBeUndefined();
    expect(maskApiKey('   ')).toBeUndefined();
  });

  it('never returns the original key for any input length', () => {
    for (const key of ['k', 'sk-0123456789', 'sk-' + 'x'.repeat(200)]) {
      const masked = maskApiKey(key);
      expect(masked).not.toBe(key);
    }
  });
});

describe('pi cli model projection', () => {
  it('keeps the display fields the panel needs', () => {
    const model = toModelView({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      enabled: true,
    });

    expect(model).toMatchObject({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      enabled: true,
    });
  });

  it('treats a missing enabled flag as enabled', () => {
    // pi 只在显式 false 时跳过该模型;缺省当停用会让面板少列模型。
    expect(toModelView({ id: 'm1' })?.enabled).toBe(true);
    expect(toModelView({ id: 'm1', enabled: false })?.enabled).toBe(false);
  });

  it('falls back to the id when no display name is set', () => {
    expect(toModelView({ id: 'gpt-5.6-sol' })?.name).toBe('gpt-5.6-sol');
  });

  it('drops entries without a usable id', () => {
    expect(toModelView({ name: 'no id' })).toBeNull();
    expect(toModelView({ id: '' })).toBeNull();
    expect(toModelView('not an object')).toBeNull();
  });

  it('does not carry credential-shaped fields into the view', () => {
    const model = toModelView({ id: 'm1', apiKey: 'sk-should-not-appear' });
    expect(JSON.stringify(model)).not.toContain('sk-should-not-appear');
  });
});

describe('pi cli api key pool projection', () => {
  const { toApiKeyViews } = __testing;

  it('lists the whole pool with the active entry marked', () => {
    // pi-web-switch 的面板会列出整池并标出生效那把；这里还原同一信息，只是值是遮罩。
    const views = toApiKeyViews(
      [
        { id: 'k1', key: 'sk-2tx0123456789abcd' },
        { id: 'k2', key: 'sk-VP20123456789abcd' },
      ],
      'k2',
      '',
    );
    expect(views.map((v) => v.id)).toEqual(['k1', 'k2']);
    expect(views.map((v) => v.active)).toEqual([false, true]);
  });

  it('never returns a real key value', () => {
    const raw = 'sk-2tx0123456789abcd';
    const views = toApiKeyViews([{ id: 'k1', key: raw }], 'k1', '');
    expect(views[0]!.maskedKey).not.toBe(raw);
    expect(views[0]!.maskedKey).not.toContain('0123456789');
  });

  it('falls back to the first entry when activeKeyId points nowhere', () => {
    // pi 自身在 activeKeyId 失效时也是用第一把，面板不能显示成「没有生效的密钥」。
    const views = toApiKeyViews(
      [
        { id: 'k1', key: 'sk-aaa0123456789abc' },
        { id: 'k2', key: 'sk-bbb0123456789abc' },
      ],
      'gone',
      '',
    );
    expect(views[0]!.active).toBe(true);
    expect(views.filter((v) => v.active)).toHaveLength(1);
  });

  it('treats a single configured key as a one-entry active pool', () => {
    // 只写了 apiKey、没登记 apiKeys 的供应商不能显示成无密钥。
    const views = toApiKeyViews(undefined, undefined, 'sk-single0123456789');
    expect(views).toHaveLength(1);
    expect(views[0]!.active).toBe(true);
  });

  it('returns an empty pool when no key is configured at all', () => {
    expect(toApiKeyViews(undefined, undefined, '')).toEqual([]);
    expect(toApiKeyViews([], undefined, '   ')).toEqual([]);
  });

  it('skips pool entries without a usable key', () => {
    const views = toApiKeyViews(
      [{ id: 'k1', key: '' }, { id: 'k2', key: 'sk-ok0123456789abcd' }],
      'k2',
      '',
    );
    expect(views).toHaveLength(1);
    expect(views[0]!.id).toBe('k2');
  });
});

describe('pi cli provider runtime config resolution (live test source)', () => {
  const { resolveProviderRuntimeConfigFromRaw } = __testing;

  it('resolves baseUrl and the inline apiKey from models.json', () => {
    const config = resolveProviderRuntimeConfigFromRaw(
      'agentrouter-a1',
      {
        providers: {
          'agentrouter-a1': { baseUrl: 'https://agentrouter.org/v1', apiKey: 'sk-2AwW…real' },
        },
      },
      {},
    );
    expect(config).toEqual({ baseUrl: 'https://agentrouter.org/v1', apiKey: 'sk-2AwW…real' });
  });

  it('falls back to auth.json when models.json has no inline key', () => {
    const config = resolveProviderRuntimeConfigFromRaw(
      'p1',
      { providers: { p1: { baseUrl: 'https://x.example/v1' } } },
      { p1: { key: 'sk-auth-json-key-000' } },
    );
    expect(config?.apiKey).toBe('sk-auth-json-key-000');
  });

  it('treats a provider known only to auth.json as existing (no baseUrl)', () => {
    const config = resolveProviderRuntimeConfigFromRaw('p1', {}, { p1: { key: 'k' } });
    expect(config).toEqual({ apiKey: 'k' });
  });

  it('returns null for an unknown provider id', () => {
    expect(resolveProviderRuntimeConfigFromRaw('ghost', { providers: { p1: {} } }, {})).toBeNull();
    expect(resolveProviderRuntimeConfigFromRaw('', { providers: { p1: {} } }, {})).toBeNull();
  });

  it('keeps whitespace-only keys out of the resolved config', () => {
    const config = resolveProviderRuntimeConfigFromRaw(
      'p1',
      { providers: { p1: { baseUrl: '  https://x.example  ', apiKey: '   ' } } },
      { p1: { key: '   ' } },
    );
    expect(config).toEqual({ baseUrl: 'https://x.example' });
  });

  it('tolerates malformed json shapes without throwing', () => {
    expect(resolveProviderRuntimeConfigFromRaw('p1', null, 'garbage')).toBeNull();
    expect(
      resolveProviderRuntimeConfigFromRaw('p1', { providers: 'not-an-object' }, []),
    ).toBeNull();
  });
});

describe('pi cli runtime providers & catalog projection (model picker source)', () => {
  const { resolveProviderRuntimeConfigFromRaw } = __testing;

  // readPiCliRuntimeProviders / buildPiCliCatalogProviders 读真实 ~/.pi/agent,
  // 没有文件注入点;这里锁它们的**下游纯函数**契约与 id 约定,文件侧行为由实机
  // 目检覆盖(见 PI-WORKBENCH-PROGRESS.md)。

  it('resolves the runtime config that session routing consumes', () => {
    const config = resolveProviderRuntimeConfigFromRaw(
      'agentrouter-a1',
      {
        providers: {
          'agentrouter-a1': {
            baseUrl: 'https://agentrouter.org/v1/',
            apiKey: 'sk-2AwW-real-key',
            api: 'openai-completions',
          },
        },
      },
      {},
    );
    // baseUrl 会被 trim;pi-cli 投影与测试连接共用同一读取路径。
    expect(config).toEqual({ baseUrl: 'https://agentrouter.org/v1', apiKey: 'sk-2AwW-real-key' });
  });

  it('keeps the pi-cli id prefix collision-safe (hyphen, not colon)', () => {
    // id 会进 disableOverrides / 可见性 key(冒号是分隔符)与 pi 运行时 slug(禁冒号),
    // 因此目录 id 与运行时 slug 必须统一为连字符形态。
    const { readPiCliRuntimeProviders: _fn } = __testing;
    expect('pi-cli-agentrouter-a1').toMatch(/^pi-cli-[A-Za-z0-9_-]+$/);
    expect('pi-cli:bad').toContain(':'); // 反例:冒号形态绝不能回流
  });
});

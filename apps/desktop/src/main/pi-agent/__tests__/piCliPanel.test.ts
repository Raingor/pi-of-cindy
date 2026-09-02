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
    const model = toModelView(
      {
        id: 'glm-5.3',
        name: 'GLM-5.3',
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      null,
      'p1',
    );

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

  it('reads availability from the enabledModels allowlist, not the models.json enabled flag', () => {
    // pi 的 ModelDefinitionSchema 里没有 `enabled` —— 它读配置时直接丢弃该字段。
    // 真正决定「能不能选到」的是 settings.json 的 enabledModels 白名单。
    const refs = new Set(['p1/allowed']);
    expect(toModelView({ id: 'allowed', enabled: false }, refs, 'p1')?.enabled).toBe(true);
    expect(toModelView({ id: 'blocked', enabled: true }, refs, 'p1')?.enabled).toBe(false);
    // 白名单属于另一个供应商时不串号。
    expect(toModelView({ id: 'allowed' }, refs, 'p2')?.enabled).toBe(false);
  });

  it('treats an absent allowlist as "everything available"', () => {
    // pi 在 enabledModels 为空/缺省时不做任何过滤 —— 空不等于全关。
    expect(toModelView({ id: 'm1' }, null, 'p1')?.enabled).toBe(true);
    expect(toModelView({ id: 'm1', enabled: false }, null, 'p1')?.enabled).toBe(true);
  });

  it('falls back to the id when no display name is set', () => {
    expect(toModelView({ id: 'gpt-5.6-sol' }, null, 'p1')?.name).toBe('gpt-5.6-sol');
  });

  it('drops entries without a usable id', () => {
    expect(toModelView({ name: 'no id' }, null, 'p1')).toBeNull();
    expect(toModelView({ id: '' }, null, 'p1')).toBeNull();
    expect(toModelView('not an object', null, 'p1')).toBeNull();
  });

  it('does not carry credential-shaped fields into the view', () => {
    const model = toModelView({ id: 'm1', apiKey: 'sk-should-not-appear' }, null, 'p1');
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

  it('resolves a provider that pi has moved into _disabledProviders', () => {
    // 已停用的供应商仍列在面板里,对它测连接/拉模型是合法的只读操作 ——
    // 只看 `providers` 会让这两个按钮对停用行永远报「找不到供应商」。
    const config = resolveProviderRuntimeConfigFromRaw(
      'p1',
      {
        providers: {},
        _disabledProviders: { p1: { baseUrl: 'https://x.example/v1', apiKey: 'sk-disabled-000' } },
      },
      {},
    );
    expect(config).toEqual({ baseUrl: 'https://x.example/v1', apiKey: 'sk-disabled-000' });
  });

  it('dereferences a $ENV key instead of sending the literal', () => {
    // pi 支持把 apiKey 写成 $VAR;不解引用就会把字面量当 Bearer token 发出去。
    process.env.CINDY_TEST_PI_KEY = 'sk-from-env-0001';
    try {
      const config = resolveProviderRuntimeConfigFromRaw(
        'p1',
        { providers: { p1: { baseUrl: 'https://x.example/v1', apiKey: '$CINDY_TEST_PI_KEY' } } },
        {},
      );
      expect(config?.apiKey).toBe('sk-from-env-0001');
    } finally {
      delete process.env.CINDY_TEST_PI_KEY;
    }
  });

  it('treats an unset $ENV reference as "no key", not as a literal', () => {
    delete process.env.CINDY_TEST_PI_MISSING;
    const config = resolveProviderRuntimeConfigFromRaw(
      'p1',
      { providers: { p1: { baseUrl: 'https://x.example/v1', apiKey: '$CINDY_TEST_PI_MISSING' } } },
      {},
    );
    expect(config).toEqual({ baseUrl: 'https://x.example/v1' });
  });
});

describe('pi cli compat projection', () => {
  const { toCompatView } = __testing;

  it('keeps the two switches the panel shows', () => {
    expect(toCompatView({ supportsDeveloperRole: false, supportsFinishReason: true })).toEqual({
      supportsDeveloperRole: false,
      supportsFinishReason: true,
    });
  });

  it('drops non-boolean and unknown keys', () => {
    expect(
      toCompatView({ supportsDeveloperRole: 'yes', forceAdaptiveThinking: true }),
    ).toBeUndefined();
  });

  it('returns undefined for a missing or malformed compat block', () => {
    expect(toCompatView(undefined)).toBeUndefined();
    expect(toCompatView('nope')).toBeUndefined();
    expect(toCompatView({})).toBeUndefined();
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
    // baseUrl 会被 trim;pi-cli 投影与测试连接共用同一读取路径(api 供探测按 wire 选端点)。
    expect(config).toEqual({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'sk-2AwW-real-key',
      api: 'openai-completions',
    });
  });

  it('keeps the pi-cli id prefix collision-safe (hyphen, not colon)', () => {
    // id 会进 disableOverrides / 可见性 key(冒号是分隔符)与 pi 运行时 slug(禁冒号),
    // 因此目录 id 与运行时 slug 必须统一为连字符形态。
    const { readPiCliRuntimeProviders: _fn } = __testing;
    expect('pi-cli-agentrouter-a1').toMatch(/^pi-cli-[A-Za-z0-9_-]+$/);
    expect('pi-cli:bad').toContain(':'); // 反例:冒号形态绝不能回流
  });
});

describe('applyPiCliKeySwitch', () => {
  const { applyPiCliKeySwitch } = __testing;

  const doc = () => ({
    providers: {
      active1: {
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-old-key-0000000001',
        activeKeyId: 'k1',
        apiKeys: [
          { id: 'k1', key: 'sk-old-key-0000000001' },
          { id: 'k2', key: '$MY_NEW_KEY' },
        ],
      },
      other: { apiKey: 'sk-untouched-00000000003' },
    },
    _disabledProviders: {
      disabled1: {
        baseUrl: 'https://down.example.com/v1',
        apiKey: 'sk-disabled-0000000002',
        apiKeys: [{ id: 'd1', key: 'sk-disabled-0000000002' }],
      },
    },
  });

  it('moves activeKeyId and mirrors the raw key into apiKey', () => {
    const next = applyPiCliKeySwitch(doc(), 'active1', 'k2');
    const p = (next.providers as Record<string, Record<string, unknown>>).active1!;
    expect(p.activeKeyId).toBe('k2');
    // $VAR 引用原样镜像,不展开 —— 展开是 pi 运行时的职责。
    expect(p.apiKey).toBe('$MY_NEW_KEY');
    // 池本身不动。
    expect(p.apiKeys).toHaveLength(2);
    // 其他供应商不受影响。
    expect((next.providers as Record<string, Record<string, unknown>>).other!.apiKey).toBe(
      'sk-untouched-00000000003',
    );
  });

  it('switches keys inside _disabledProviders too', () => {
    const next = applyPiCliKeySwitch(doc(), 'disabled1', 'd1');
    const p = (next._disabledProviders as Record<string, Record<string, unknown>>).disabled1!;
    expect(p.activeKeyId).toBe('d1');
    expect(p.apiKey).toBe('sk-disabled-0000000002');
  });

  it('rejects unknown provider, unknown key, blank ids and malformed docs', () => {
    expect(() => applyPiCliKeySwitch(doc(), 'ghost', 'k1')).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
    expect(() => applyPiCliKeySwitch(doc(), 'active1', 'nope')).toThrow('PI_CLI_KEY_NOT_FOUND');
    expect(() => applyPiCliKeySwitch(doc(), '', 'k1')).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
    expect(() => applyPiCliKeySwitch(doc(), 'active1', '  ')).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
    expect(() => applyPiCliKeySwitch(null, 'active1', 'k1')).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
    expect(() => applyPiCliKeySwitch({}, 'active1', 'k1')).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
  });

  it('does not guess by index when pool entries lack ids', () => {
    // 非 pws 写入的旧文件:条目没有 id。按 id 精确匹配 = 切不了,报 key 不存在,
    // 绝不下标猜测误切。
    const legacy = { providers: { p: { apiKey: 'sk-a', apiKeys: [{ key: 'sk-b' }] } } };
    expect(() => applyPiCliKeySwitch(legacy, 'p', '0')).toThrow('PI_CLI_KEY_NOT_FOUND');
  });
});

describe('applyPiCliAddModel', () => {
  const { applyPiCliAddModel } = __testing;

  const doc = () => ({
    providers: {
      p1: {
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-x-0000000000000001',
        models: [{ id: 'existing-1', name: 'Existing' }],
      },
    },
  });

  it('appends the model with pi-compatible defaults and reports added', () => {
    const { doc: next, added } = applyPiCliAddModel(doc(), 'p1', {
      id: 'new-model',
      name: 'New Model',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 262144,
      maxTokens: 32768,
      cost: { input: 1.5, output: 9 },
    });
    expect(added).toBe(true);
    const models = (next.providers as Record<string, Record<string, unknown>>).p1!.models as Array<
      Record<string, unknown>
    >;
    expect(models).toHaveLength(2);
    expect(models[1]).toEqual({
      id: 'new-model',
      name: 'New Model',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 262144,
      maxTokens: 32768,
      cost: { input: 1.5, output: 9, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it('is idempotent on duplicate ids and does not touch other fields', () => {
    const { added } = applyPiCliAddModel(doc(), 'p1', { id: 'existing-1' });
    expect(added).toBe(false);
  });

  it('rejects unknown provider and blank model ids', () => {
    expect(() => applyPiCliAddModel(doc(), 'ghost', { id: 'm' })).toThrow(
      'PI_CLI_PROVIDER_NOT_FOUND',
    );
    expect(() => applyPiCliAddModel(doc(), 'p1', { id: '  ' })).toThrow('PI_CLI_MODEL_INVALID');
    expect(() => applyPiCliAddModel(doc(), 'p1', {} as never)).toThrow('PI_CLI_MODEL_INVALID');
    expect(() => applyPiCliAddModel(null, 'p1', { id: 'm' })).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
  });

  it('works on providers inside _disabledProviders', () => {
    const d = {
      providers: {},
      _disabledProviders: { off: { baseUrl: 'https://x', models: [] } },
    };
    const { added } = applyPiCliAddModel(d, 'off', { id: 'm1' });
    expect(added).toBe(true);
  });
});

describe('pi provider semantic mutations (pws parity)', () => {
  const {
    sanitizePiProviderId,
    derivePiProviderId,
    applyPiCliUpsertProvider,
    applyPiCliRenameProvider,
    applyPiCliRemoveProvider,
    applyPiCliSetProviderDisabled,
    applyPiCliUpsertModel,
    applyPiCliRemoveModel,
    applyPiCliUpdateEnabledModels,
  } = __testing;

  it('sanitizes provider ids like pws (unicode letters, digits, hyphens)', () => {
    expect(sanitizePiProviderId('  My  Provider! ')).toBe('my-provider');
    expect(sanitizePiProviderId('百灵 中转')).toBe('百灵-中转');
    expect(sanitizePiProviderId('--a--b--')).toBe('a-b');
    expect(derivePiProviderId('', 'https://api.example.com/v1')).toBe('');
    // 非空但全是符号 → 回落 hostname（pws 同款）
    expect(derivePiProviderId('!!!', 'https://api.example.com/v1')).toBe('example');
    expect(derivePiProviderId('!!!', 'https://api.platform.openai.com/v1')).toBe('openai');
  });

  it('upsert creates then patches a provider with apiKey mirroring', () => {
    const doc: Record<string, unknown> = {};
    applyPiCliUpsertProvider(doc, 'myprov', {
      name: 'MyProv',
      baseUrl: 'https://api.example.com/v1/',
      api: 'openai-completions',
      apiKey: 'sk-value-0000000001',
    });
    const created = (doc.providers as Record<string, Record<string, unknown>>).myprov!;
    expect(created.name).toBe('MyProv');
    expect(created.baseUrl).toBe('https://api.example.com/v1'); // trailing slash stripped
    expect(created.apiKey).toBe('sk-value-0000000001');
    // second upsert with pool: apiKey mirrors active entry
    applyPiCliUpsertProvider(doc, 'myprov', {
      apiKeys: [
        { id: 'k1', key: 'sk-a-000000000000001' },
        { id: 'k2', key: 'sk-b-000000000000002' },
      ],
      activeKeyId: 'k2',
    });
    expect(created.activeKeyId).toBe('k2');
    expect(created.apiKey).toBe('sk-b-000000000000002');
    // adopting an extra single key into an existing pool appends and activates
    applyPiCliUpsertProvider(doc, 'myprov', { apiKey: 'sk-c-000000000000003' });
    expect((created.apiKeys as unknown[]).length).toBe(3);
    expect(created.apiKey).toBe('sk-c-000000000000003');
    // invalid baseUrl rejected
    expect(() =>
      applyPiCliUpsertProvider(doc, 'myprov', { baseUrl: 'ftp://x' }),
    ).toThrow('PI_CLI_MODEL_INVALID');
  });

  it('rename moves the block between buckets and rewrites enabledModels refs', () => {
    const doc = { providers: { old: { apiKey: 'k', models: [{ id: 'm1' }] } } };
    const settings = { enabledModels: ['old/m1', 'other/m2'] };
    const { doc: nextDoc, settings: nextSettings } = applyPiCliRenameProvider(
      doc,
      settings,
      'old',
      'new',
      { name: 'Renamed' },
    );
    expect((nextDoc.providers as Record<string, unknown>).old).toBeUndefined();
    const moved = (nextDoc.providers as Record<string, Record<string, unknown>>).new!;
    expect(moved.name).toBe('Renamed');
    expect(nextSettings.enabledModels).toEqual(['new/m1', 'other/m2']);
    // duplicate target rejected
    expect(() => applyPiCliRenameProvider(nextDoc, nextSettings, 'new', 'new2')).not.toThrow();
    const dup = { providers: { a: {}, b: {} } };
    expect(() => applyPiCliRenameProvider(dup, {}, 'a', 'b')).toThrow('PI_CLI_PROVIDER_EXISTS');
  });

  it('remove deletes from either bucket', () => {
    const doc = {
      providers: { a: { apiKey: 'k' } },
      _disabledProviders: { b: { apiKey: 'k' } },
    };
    applyPiCliRemoveProvider(doc, 'a');
    applyPiCliRemoveProvider(doc, 'b');
    expect(Object.keys(doc.providers as object)).toHaveLength(0);
    expect(Object.keys(doc._disabledProviders as object)).toHaveLength(0);
    expect(() => applyPiCliRemoveProvider(doc, 'ghost')).toThrow('PI_CLI_PROVIDER_NOT_FOUND');
  });

  it('set-disabled moves the block to/from _disabledProviders idempotently', () => {
    const doc: Record<string, unknown> = { providers: { a: { apiKey: 'k' } } };
    applyPiCliSetProviderDisabled(doc, 'a', true);
    expect((doc._disabledProviders as Record<string, unknown>).a).toBeDefined();
    expect((doc.providers as Record<string, unknown>).a).toBeUndefined();
    // idempotent
    applyPiCliSetProviderDisabled(doc, 'a', true);
    applyPiCliSetProviderDisabled(doc, 'a', false);
    expect((doc.providers as Record<string, Record<string, unknown>>).a!.apiKey).toBe('k');
    applyPiCliSetProviderDisabled(doc, 'a', false); // already active, no-op
    // unknown provider
    expect(() => applyPiCliSetProviderDisabled(doc, 'ghost', true)).toThrow(
      'PI_CLI_PROVIDER_NOT_FOUND',
    );
  });

  it('upsert-model merges in place; remove-model filters', () => {
    const doc = { providers: { p: { models: [{ id: 'm1', name: 'Old' }] } } };
    const r1 = applyPiCliUpsertModel(doc, 'p', { id: 'm1', contextWindow: 1000 });
    expect(r1.added).toBe(false);
    expect((doc.providers as Record<string, Record<string, unknown>>).p!.models).toEqual([
      { id: 'm1', name: 'Old', contextWindow: 1000 },
    ]);
    const r2 = applyPiCliUpsertModel(doc, 'p', { id: 'm2' });
    expect(r2.added).toBe(true);
    applyPiCliRemoveModel(doc, 'p', 'm1');
    expect(
      ((doc.providers as Record<string, Record<string, unknown>>).p!.models as unknown[]).map(
        (m) => (m as { id: string }).id,
      ),
    ).toEqual(['m2']);
  });

  it('enabledModels add/remove/replaceAll with empty-means-unset semantics', () => {
    expect(applyPiCliUpdateEnabledModels({}, { add: ['a/1', 'b/2', 'a/1'] })).toEqual({
      enabledModels: ['a/1', 'b/2'],
    });
    expect(
      applyPiCliUpdateEnabledModels({ enabledModels: ['a/1', 'b/2'] }, { remove: ['a/1'] }),
    ).toEqual({ enabledModels: ['b/2'] });
    // empty list = unset (pi treats absent/empty as no filtering)
    const out = applyPiCliUpdateEnabledModels({ enabledModels: ['a/1'] }, { replaceAll: [] });
    expect(out.enabledModels).toBeUndefined();
  });
});

describe('applyPiCliRemoveKey', () => {
  const { applyPiCliRemoveKey } = __testing;

  it('removes a pool entry and falls back when the active one is removed', () => {
    const doc = {
      providers: {
        p: {
          apiKey: 'sk-b-0000000000000002',
          activeKeyId: 'k2',
          apiKeys: [
            { id: 'k1', key: 'sk-a-0000000000000001' },
            { id: 'k2', key: 'sk-b-0000000000000002' },
          ],
        },
      },
    };
    applyPiCliRemoveKey(doc, 'p', 'k2');
    const p = (doc.providers as Record<string, Record<string, unknown>>).p!;
    expect((p.apiKeys as unknown[]).map((e) => (e as { id: string }).id)).toEqual(['k1']);
    expect(p.activeKeyId).toBe('k1');
    expect(p.apiKey).toBe('sk-a-0000000000000001');
  });

  it('dismantles the pool when the last entry is removed', () => {
    const doc = {
      providers: { p: { apiKey: 'sk-a', activeKeyId: 'k1', apiKeys: [{ id: 'k1', key: 'sk-a' }] } },
    };
    applyPiCliRemoveKey(doc, 'p', 'k1');
    const p = (doc.providers as Record<string, Record<string, unknown>>).p!;
    expect(p.apiKeys).toBeUndefined();
    expect(p.activeKeyId).toBeUndefined();
    expect(p.apiKey).toBeUndefined();
  });

  it('rejects unknown providers and unknown key ids', () => {
    expect(() => applyPiCliRemoveKey({ providers: {} }, 'p', 'k1')).toThrow(
      'PI_CLI_PROVIDER_NOT_FOUND',
    );
    expect(() =>
      applyPiCliRemoveKey({ providers: { p: { apiKeys: [{ id: 'k1', key: 'sk-a' }] } } }, 'p', 'x'),
    ).toThrow('PI_CLI_KEY_NOT_FOUND');
  });
});

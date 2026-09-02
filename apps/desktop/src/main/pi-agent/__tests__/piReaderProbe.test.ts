/**
 * piReader 导出快照与探测请求的 wire 语义。
 *
 * R2:配置导出必须同时投影 `providers` 与 `_disabledProviders`(pi 把停用的
 * 供应商整块搬进后者),且逐 provider 剥凭证 —— 丢掉停用桶 = 「导出 → 导入」
 * 往返后停用供应商连同模型一起静默消失。
 *
 * R3/R4:探测请求按 `api` wire 选端点与鉴权头 —— Ollama 本机实例没有 /models、
 * Anthropic 不认 Bearer、Google 的 key 走 query param。判定以 pi 自身的
 * wire 语义为准,全部用 fetch mock,不打真实网络。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPiConfigExport,
  fetchProviderModels,
  testModel,
  testProviderConnection,
} from '../piReader.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── R2:导出快照 ───────────────────────────────────────────────────────────

describe('buildPiConfigExport (config export projection)', () => {
  const models = {
    providers: {
      active1: {
        name: 'Active One',
        baseUrl: 'https://a.example/v1',
        apiKey: 'sk-active-secret-0001',
        apiKeys: [{ id: 'k1', key: 'sk-pool-secret-0002' }],
        activeKeyId: 'k1',
        models: [{ id: 'm1' }],
      },
    },
    _disabledProviders: {
      off1: {
        name: 'Disabled One',
        baseUrl: 'https://d.example/v1',
        apiKey: 'sk-disabled-secret-03',
        activeKeyId: 'k9',
        models: [{ id: 'm2' }, { id: 'm3' }],
      },
    },
  };

  it('projects both buckets so a disabled provider survives an export/import round-trip', () => {
    const snap = buildPiConfigExport(models, {});
    expect(snap.modelsJson?.providers.active1).toBeDefined();
    expect(snap.modelsJson?._disabledProviders?.off1).toBeDefined();
    expect(snap.modelsJson?._disabledProviders?.off1?.models).toEqual([{ id: 'm2' }, { id: 'm3' }]);
  });

  it('strips credential fields from every entry in both buckets', () => {
    const snap = buildPiConfigExport(models, {});
    const json = JSON.stringify(snap.modelsJson);
    expect(json).not.toContain('sk-active-secret-0001');
    expect(json).not.toContain('sk-pool-secret-0002');
    expect(json).not.toContain('sk-disabled-secret-03');
    expect(JSON.parse(json)).not.toContain('activeKeyId');
    const disabled = snap.modelsJson?._disabledProviders?.off1 as Record<string, unknown>;
    expect(disabled.apiKey).toBeUndefined();
    expect(disabled.activeKeyId).toBeUndefined();
    // 非凭证字段原样保留。
    expect(disabled.baseUrl).toBe('https://d.example/v1');
  });

  it('omits the disabled bucket when it is absent or empty, and always keeps providers', () => {
    expect(buildPiConfigExport({ providers: {} }, null).modelsJson).toEqual({ providers: {} });
    expect(
      buildPiConfigExport({ providers: { p: {} }, _disabledProviders: {} }, null).modelsJson,
    ).toEqual({ providers: { p: {} } });
  });

  it('keeps malformed entries as-is instead of silently dropping them', () => {
    const snap = buildPiConfigExport(
      { providers: { broken: 'not-an-object' } as unknown as Record<string, unknown> },
      null,
    );
    expect(snap.modelsJson?.providers.broken).toBe('not-an-object');
  });
});

// ─── R3/R4:探测请求的 wire 语义(fetch mock)────────────────────────────────

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function stubFetch(resp: { ok: boolean; status?: number; json?: unknown } | null) {
  fetchCalls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init: init ?? {} });
      if (!resp) throw new Error('network down');
      return {
        ok: resp.ok,
        status: resp.status ?? (resp.ok ? 200 : 500),
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => resp.json,
        text: async () => JSON.stringify(resp.json),
      } as unknown as Response;
    }),
  );
}

describe('probe endpoint selection (Ollama vs /models)', () => {
  it('lists models via /api/tags for a loopback 11434 endpoint', async () => {
    stubFetch({ ok: true, json: { models: [{ name: 'llama3:8b' }] } });
    const result = await fetchProviderModels('http://localhost:11434', undefined, 'openai-completions');
    expect(result.error).toBeUndefined();
    expect(fetchCalls[0]?.url).toBe('http://localhost:11434/api/tags');
    expect(result.models?.[0]?.id).toBe('llama3:8b');
    expect(result.models?.[0]?.source).toBe('ollama');
  });

  it('keeps /models for a remote host even on port 11434', async () => {
    stubFetch({ ok: true, json: { data: [{ id: 'm1' }] } });
    await fetchProviderModels('https://relay.example:11434/v1', 'sk-x');
    expect(fetchCalls[0]?.url).toBe('https://relay.example:11434/v1/models');
  });

  it('connection test also hits /api/tags on loopback 11434', async () => {
    stubFetch({ ok: true, json: { models: [] } });
    const result = await testProviderConnection('http://127.0.0.1:11434', undefined, 'openai-completions');
    expect(result.success).toBe(true);
    expect(fetchCalls[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
  });
});

describe('probe auth headers per wire', () => {
  it('sends x-api-key + anthropic-version for anthropic-messages, not Bearer', async () => {
    stubFetch({ ok: true, json: { data: [{ id: 'claude-x' }] } });
    await fetchProviderModels('https://api.anthropic.com/v1', 'sk-ant-000', 'anthropic-messages');
    const init = fetchCalls[0]!.init;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-000');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers.Authorization).toBeUndefined();
    expect(fetchCalls[0]?.url).toBe('https://api.anthropic.com/v1/models');
  });

  it('passes the Google key as a query param, never as a header', async () => {
    stubFetch({ ok: true, json: { models: [{ name: 'models/gemini-x' }] } });
    await fetchProviderModels(
      'https://generativelanguage.googleapis.com/v1beta',
      'g-key-000',
      'google-generative-ai',
    );
    const url = new URL(fetchCalls[0]!.url);
    expect(url.pathname).toBe('/v1beta/models');
    expect(url.searchParams.get('key')).toBe('g-key-000');
    expect(fetchCalls[0]!.init.headers).toEqual({});
  });

  it('keeps Bearer for openai wires', async () => {
    stubFetch({ ok: true, json: { data: [{ id: 'm1' }] } });
    await fetchProviderModels('https://api.example.com/v1', 'sk-openai-000', 'openai-completions');
    expect((fetchCalls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-openai-000',
    );
  });

  it('sends no auth header when no key is configured', async () => {
    stubFetch({ ok: true, json: { data: [] } });
    await fetchProviderModels('https://api.example.com/v1', undefined, 'openai-completions');
    expect(fetchCalls[0]!.init.headers).toEqual({});
  });
});

describe('testModel request shape per wire', () => {
  it('posts an anthropic messages body for anthropic-messages', async () => {
    stubFetch({ ok: true, json: { type: 'message', content: [{ type: 'text', text: 'ok' }] } });
    const result = await testModel('https://api.anthropic.com/v1', 'claude-x', 'sk-ant-000', 'anthropic-messages');
    expect(result.success).toBe(true);
    const url = new URL(fetchCalls[0]!.url);
    expect(url.pathname).toBe('/v1/messages');
    const body = JSON.parse(String(fetchCalls[0]!.init.body));
    expect(body).toEqual({
      model: 'claude-x',
      max_tokens: 4,
      messages: [{ role: 'user', content: 'Reply ok' }],
    });
    expect((fetchCalls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-000');
  });

  it('posts a generateContent body with the key query param for google-generative-ai', async () => {
    stubFetch({ ok: true, json: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } });
    const result = await testModel(
      'https://generativelanguage.googleapis.com/v1beta',
      'gemini-x',
      'g-key-000',
      'google-generative-ai',
    );
    expect(result.success).toBe(true);
    const url = new URL(fetchCalls[0]!.url);
    expect(url.pathname).toBe('/v1beta/models/gemini-x:generateContent');
    expect(url.searchParams.get('key')).toBe('g-key-000');
    const body = JSON.parse(String(fetchCalls[0]!.init.body));
    expect(body.contents).toEqual([{ parts: [{ text: 'Reply ok' }] }]);
  });

  it('posts an input body for openai-responses', async () => {
    stubFetch({ ok: true, json: { output: [{ type: 'message' }], status: 'completed' } });
    const result = await testModel('https://api.example.com/v1', 'gpt-x', 'sk-x', 'openai-responses');
    expect(result.success).toBe(true);
    expect(new URL(fetchCalls[0]!.url).pathname).toBe('/v1/responses');
    const body = JSON.parse(String(fetchCalls[0]!.init.body));
    expect(body).toEqual({ model: 'gpt-x', input: 'Reply ok', max_output_tokens: 16 });
  });

  it('keeps /chat/completions for openai-completions', async () => {
    stubFetch({ ok: true, json: { choices: [{ message: { content: 'ok' } }] } });
    await testModel('https://api.example.com/v1', 'm1', 'sk-x', 'openai-completions');
    expect(new URL(fetchCalls[0]!.url).pathname).toBe('/v1/chat/completions');
  });

  it('rejects non-http schemes before fetching', async () => {
    stubFetch(null);
    const result = await testModel('file:///etc', 'm1', 'sk-x');
    expect(result.success).toBe(false);
    expect(result.message).toBe('invalid URL');
    expect(fetchCalls).toHaveLength(0);
  });

  it('reports a failed probe instead of throwing on a bad response body', async () => {
    stubFetch({ ok: true, json: { unexpected: true } });
    const result = await testModel('https://api.example.com/v1', 'm1', 'sk-x');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Invalid response');
  });
});

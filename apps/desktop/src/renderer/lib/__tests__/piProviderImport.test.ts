import { describe, expect, it } from 'vitest';

import { parseProviderImport } from '../piProviderImport.js';

describe('parseProviderImport (pws parity)', () => {
  it('parses labeled full-width and half-width colons', () => {
    const p = parseProviderImport(
      'tokenrouter baseurl：https://api.example.com/v1 key：sk-abcdef1234567890 modelid：vendor/model-a, vendor/model-b',
    );
    expect(p.name).toBe('tokenrouter');
    expect(p.baseUrl).toBe('https://api.example.com/v1');
    expect(p.apiKeys).toEqual(['sk-abcdef1234567890']);
    expect(p.modelIds).toEqual(['vendor/model-a', 'vendor/model-b']);
  });

  it('collects a numbered key pool (key-1/key-2/key-3)', () => {
    const p = parseProviderImport(
      [
        '**Seekai**',
        '',
        'baseurl: https://seekai.cc/v1',
        '',
        'key-1: sk-first0000000000000001',
        '',
        'key-2: sk-second000000000000002',
        '',
        'key-3: sk-third0000000000000003',
      ].join('\n'),
    );
    expect(p.name).toBe('**Seekai**');
    expect(p.baseUrl).toBe('https://seekai.cc/v1');
    // 三把 key 按出现顺序整池收集,apiKey 指向首把。
    expect(p.apiKeys).toEqual([
      'sk-first0000000000000001',
      'sk-second000000000000002',
      'sk-third0000000000000003',
    ]);
    expect(p.apiKey).toBe('sk-first0000000000000001');
  });

  it('collects repeated plain key: labels and dedupes', () => {
    const p = parseProviderImport(
      'api: https://a.cc/v1\napikey: sk-one000000000000001\napikey: sk-two000000000000002\nkey: sk-one000000000000001',
    );
    expect(p.apiKeys).toEqual(['sk-one000000000000001', 'sk-two000000000000002']);
  });

  it('collects multiple unlabeled sk- tokens and comma-separated key values', () => {
    const p = parseProviderImport('https://a.cc/v1 sk-alpha000000000001 sk-beta000000000002');
    expect(p.apiKeys).toEqual(['sk-alpha000000000001', 'sk-beta000000000002']);
    const q = parseProviderImport('key: sk-gamma000000000003, sk-delta000000000004');
    expect(q.apiKeys).toEqual(['sk-gamma000000000003', 'sk-delta000000000004']);
  });

  it('parses Chinese labels and multiline input', () => {
    const p = parseProviderImport('名称：百灵\n接口：https://api.b.cn/v1\n密钥：sk-xabcdef123456\n模型：m/1 m/2');
    expect(p.name).toBe('百灵');
    expect(p.baseUrl).toBe('https://api.b.cn/v1');
    expect(p.apiKey).toBe('sk-xabcdef123456');
    expect(p.modelIds).toEqual(['m/1', 'm/2']);
  });

  it('heuristic fallback: url, sk- key, slash ids, bare name', () => {
    const p = parseProviderImport('百灵 https://api.b.cn/v1 sk-abcdef1234567890');
    expect(p.name).toBe('百灵');
    expect(p.baseUrl).toBe('https://api.b.cn/v1');
    expect(p.apiKey).toBe('sk-abcdef1234567890');
  });

  it('keeps $ENV refs as keys and dedupes model ids', () => {
    const p = parseProviderImport('key：$MY_KEY models：a/1 a/1 b/2');
    expect(p.apiKey).toBe('$MY_KEY');
    expect(p.modelIds).toEqual(['a/1', 'b/2']);
  });
});

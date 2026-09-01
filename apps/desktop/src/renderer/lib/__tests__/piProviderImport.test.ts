import { describe, expect, it } from 'vitest';

import { parseProviderImport } from '../piProviderImport.js';

describe('parseProviderImport (pws parity)', () => {
  it('parses labeled full-width and half-width colons', () => {
    const p = parseProviderImport(
      'tokenrouter baseurl：https://api.example.com/v1 key：sk-abcdef1234567890 modelid：vendor/model-a, vendor/model-b',
    );
    expect(p).toEqual({
      name: 'tokenrouter',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-abcdef1234567890',
      modelIds: ['vendor/model-a', 'vendor/model-b'],
    });
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

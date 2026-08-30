// @vitest-environment node

/**
 * piProviderImport —— 自由文本导入解析器的关键行为(pi-web-switch 同款):
 *   1. 带标签(半角/全角冒号)字段:baseurl / key / models / name 各归其位;
 *   2. 无标签自由 token 启发式:URL → baseUrl,sk-… 或长随机串 → apiKey,
 *      含 "/" → 模型 id,其余 → 显示名(保留首行不带冒号的原文);
 *   3. deriveProviderId:名称可生成 id 时用名称,否则回落 hostname 可读段。
 */

import { describe, expect, it } from 'vitest';

import {
  deriveProviderId,
  isValidHttpUrl,
  parseProviderImport,
} from '../piProviderImport';

describe('parseProviderImport', () => {
  it('解析全角冒号标签(名称/地址/密钥/模型)', () => {
    const r = parseProviderImport(
      'tokenrouter baseurl：https://api.example.com/v1 key：sk-abcdef12345678 modelid：vendor/model-a, vendor/model-b',
    );
    expect(r).toEqual({
      name: 'tokenrouter',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-abcdef12345678',
      modelIds: ['vendor/model-a', 'vendor/model-b'],
    });
  });

  it('解析半角标签与多行输入', () => {
    const r = parseProviderImport(
      ['myrelay', 'base_url: https://relay.test/v1', 'api_key: sk-xyz123456789', 'models: a/b c/d'].join('\n'),
    );
    expect(r.name).toBe('myrelay');
    expect(r.baseUrl).toBe('https://relay.test/v1');
    expect(r.apiKey).toBe('sk-xyz123456789');
    expect(r.modelIds).toEqual(['a/b', 'c/d']);
  });

  it('无标签自由 token:URL/密钥/模型 id/名称各按启发式归类', () => {
    const r = parseProviderImport('百灵 https://api.bailing.cn/v1 sk-abc123456789 deepseek-v4 qwen/max');
    expect(r.name).toBe('百灵');
    expect(r.baseUrl).toBe('https://api.bailing.cn/v1');
    expect(r.apiKey).toBe('sk-abc123456789');
    expect(r.modelIds).toEqual(['qwen/max']);
  });

  it('空字符串返回全空结果', () => {
    expect(parseProviderImport('')).toEqual({ name: '', baseUrl: '', apiKey: '', modelIds: [] });
  });
});

describe('deriveProviderId', () => {
  it('名称可读时用名称,否则回落 hostname 可读段', () => {
    expect(deriveProviderId('My Relay', 'https://x.test/v1')).toBe('my-relay');
    expect(deriveProviderId('!!', 'https://api.tokenrouter.test/v1')).toBe('tokenrouter');
    expect(deriveProviderId('', 'not a url')).toBe('');
  });
});

describe('isValidHttpUrl', () => {
  it('只接受 http(s)', () => {
    expect(isValidHttpUrl('https://a.test/v1')).toBe(true);
    expect(isValidHttpUrl('ftp://a.test')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});

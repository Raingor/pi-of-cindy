/**
 * subagent frontmatter 列表字段解析。
 *
 * 用户手写的 agent md 常见 `tools: read, write, bash`（逗号分隔字符串）。
 * pi-web-switch 的 splitMaybe 兼容数组与逗号字符串两种写法；Cindy 移植时漏了它，
 * 字符串直接 cast 成 string[] 流到 Renderer，`agent.tools.map is not a function`
 * 把整个设置页渲染炸掉 —— 本文件锁住这个回归。
 */

import { describe, expect, it } from 'vitest';

import { splitMaybe } from '../piReader.js';

describe('splitMaybe (subagent frontmatter list fields)', () => {
  it('parses a comma-separated string like `tools: read, write, bash`', () => {
    expect(splitMaybe('read, write, bash, web_search')).toEqual([
      'read',
      'write',
      'bash',
      'web_search',
    ]);
  });

  it('keeps YAML flow-array values as strings', () => {
    expect(splitMaybe(['text', 'image'])).toEqual(['text', 'image']);
  });

  it('tolerates loose spacing and trailing commas', () => {
    expect(splitMaybe('read ,  write,')).toEqual(['read', 'write']);
  });

  it('returns undefined for blank strings and non-string scalars', () => {
    expect(splitMaybe('')).toBeUndefined();
    expect(splitMaybe('   ')).toBeUndefined();
    expect(splitMaybe(undefined)).toBeUndefined();
    expect(splitMaybe(42)).toBeUndefined();
    expect(splitMaybe(true)).toBeUndefined();
  });
});

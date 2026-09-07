/**
 * 幽灵主题 token 防回归 —— `--danger` / `--success` / `--danger-soft` /
 * `--success-soft` 从未在主题系统(themes/colors.ts registerColor)注册,
 * 但历史上被 6 个文件裸引用:背景/文字解析为空,表现为「永久删除」按钮白底白字
 * 不可见(2026-09-07 实报)。已全部改用注册过的语义 token:
 *   --danger(前景/背景) → --error-flat / --error-bg
 *   --success(前景)     → --card-status-done
 *
 * 本测试扫描 renderer 源码,确保这四个幽灵 token 不再出现;新增危险/成功语义
 * 颜色必须走 registerColor 注册过的 token(colors.ts),别再引用不存在的变量。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RENDERER_ROOT = join(__dirname, '..');
const GHOST_TOKENS = ['var(--danger)', 'var(--success)', 'var(--danger-soft)', 'var(--success-soft)'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (/\.(tsx?|css)$/.test(entry)) {
      yield full;
    }
  }
}

describe('ghost theme tokens must not be referenced', () => {
  it('renderer source contains no unregistered --danger/--success tokens', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const token of GHOST_TOKENS) {
        if (source.includes(token)) {
          offenders.push(`${file}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the replacement tokens are actually registered in the theme system', () => {
    const colors = readFileSync(join(__dirname, '..', 'themes', 'colors.ts'), 'utf8');
    expect(colors).toContain("registerColor('error-flat'");
    expect(colors).toContain("registerColor('error-bg'");
    expect(colors).toContain("registerColor('card-status-done'");
  });
});

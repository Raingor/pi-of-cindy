/**
 * 会话列表的项目归属与命名。
 *
 * 会话目录名把路径分隔符写成单个 `-`，首尾各带一对 `--`；而目录名里本来就有 `-`
 * （`mac-2312-r`、`M-projects`），从目录名反推路径是有损的。因此项目路径优先取
 * 会话文件 `session` 行里的 `cwd`，目录名只作兜底。
 *
 * 之前的实现把首个 `--` 换成 `/` 再把剩余 `--` 换成 `/`，尾部那对 `--` 变成尾斜杠，
 * `split('/').pop()` 拿到空串——会话列表的项目名整片空白。这个失败模式不报错，
 * 所以钉在这里。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PiProjectGroup } from '../piTypes.js';

let tempRoot: string;
let sessionsDir: string;
let listSessions: () => PiProjectGroup[];

function writeSessionFile(
  relativeDir: string,
  fileName: string,
  lines: Array<Record<string, unknown>>,
): void {
  const dir = join(sessionsDir, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf-8');
}

beforeEach(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'pi-sessions-'));
  sessionsDir = join(tempRoot, '.pi', 'agent', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return { ...actual, homedir: () => tempRoot, default: { ...actual, homedir: () => tempRoot } };
  });
  vi.resetModules();
  ({ listSessions } = await import('../piReader.js'));
});

afterEach(() => {
  vi.doUnmock('node:os');
  vi.resetModules();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('project attribution', () => {
  it('uses the cwd recorded in the session over the encoded directory name', () => {
    writeSessionFile('--Users-mac-2312-r-workspace-wwwroot-M-projects-pi-of-cindy--', 's.jsonl', [
      { type: 'session', cwd: '/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-of-cindy' },
      { type: 'message', message: { role: 'assistant' } },
    ]);
    const [group] = listSessions();
    expect(group!.projectPath).toBe('/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-of-cindy');
    // 目录名里的 `-` 无法区分「路径分隔符」和「名字里的连字符」，只有 cwd 能给出真名。
    expect(group!.projectName).toBe('pi-of-cindy');
  });

  it('never yields an empty project name when falling back to the directory name', () => {
    // 没有 session 行 → 只能靠目录名兜底；尾部 `--` 处理错会让名字变成空串。
    writeSessionFile('--tmp--', 's.jsonl', [{ type: 'message', message: { role: 'assistant' } }]);
    const [group] = listSessions();
    expect(group!.projectName).not.toBe('');
    expect(group!.projectName.length).toBeGreaterThan(0);
  });

  it('merges sessions that share one cwd across differently encoded directories', () => {
    const cwd = '/Users/me/project';
    writeSessionFile('--Users-me-project--', 'a.jsonl', [
      { type: 'session', cwd },
      { type: 'message', message: { role: 'assistant' } },
    ]);
    writeSessionFile('--Users-me-project-2--', 'b.jsonl', [
      { type: 'session', cwd },
      { type: 'message', message: { role: 'assistant' } },
    ]);
    const groups = listSessions();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.totalSessions).toBe(2);
  });
});

describe('session metadata', () => {
  it('reads the session name from session_info', () => {
    // 会话名写在 `session_info` 行；读 `session_start` 会让所有会话都没有名字。
    writeSessionFile('--Users-me-app--', 's.jsonl', [
      { type: 'session', cwd: '/Users/me/app' },
      { type: 'session_info', name: '静态站点部署' },
      { type: 'message', message: { role: 'assistant' } },
    ]);
    expect(listSessions()[0]!.sessions[0]!.name).toBe('静态站点部署');
  });

  it('reads the model from model_change modelId', () => {
    writeSessionFile('--Users-me-app--', 's.jsonl', [
      { type: 'session', cwd: '/Users/me/app' },
      { type: 'model_change', provider: 'opencode-go', modelId: 'ox-alpha-free' },
      { type: 'message', message: { role: 'assistant' } },
    ]);
    const session = listSessions()[0]!.sessions[0]!;
    expect(session.provider).toBe('opencode-go');
    expect(session.model).toBe('ox-alpha-free');
  });
});

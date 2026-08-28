// @vitest-environment node

/**
 * localPi —— 本机 pi 探测的关键不变量:
 *   1. 标准位置或 PATH 命中且 `--version` 成功 → installed + 缓存路径/版本;
 *   2. 全部候选失败(不存在 / 不可执行 / --version 失败)→ installed:false;
 *   3. 并发探测共享同一在途 Promise;force 丢弃缓存重探;
 *   4. 探测从不 reject,失败一律归约为未安装。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, accessMock, homedirMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  accessMock: vi.fn(),
  homedirMock: vi.fn(() => '/home/tester'),
}));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    accessSync: (...args: unknown[]) => accessMock(...args),
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: homedirMock,
  };
});

import {
  getCachedLocalPiPath,
  getLocalPiStatusSnapshot,
  probeLocalPi,
} from '../localPi.js';

function mockExec(handler: (file: string, args: string[]) => { stdout?: string; error?: Error }) {
  execFileMock.mockImplementation(
    (file: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      const { stdout, error } = handler(file, args);
      // 异步触发,贴近真实 execFile 语义。
      setImmediate(() => cb(error ?? null, stdout ?? ''));
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  execFileMock.mockReset();
  accessMock.mockReset();
  // 默认:所有路径都不可执行、PATH 查找为空。
  accessMock.mockImplementation(() => {
    throw new Error('ENOENT');
  });
  mockExec(() => ({ error: new Error('not found') }));
});

describe('localPi probe', () => {
  it('standard location hit → installed with cached path and version', async () => {
    const piPath = '/home/tester/.local/bin/pi';
    accessMock.mockImplementation((p: string) => {
      if (p === piPath) return undefined;
      throw new Error('ENOENT');
    });
    mockExec((file, args) => {
      if (file === piPath && args[0] === '--version') return { stdout: 'pi 1.2.3\n' };
      if (file === 'which') return { stdout: '' };
      return { error: new Error('unexpected spawn') };
    });

    const status = await probeLocalPi({ force: true });
    expect(status).toEqual({ installed: true, path: piPath, version: 'pi 1.2.3' });
    expect(getCachedLocalPiPath()).toBe(piPath);
    expect(getLocalPiStatusSnapshot()?.installed).toBe(true);
  });

  it('all candidates fail → installed:false, never rejects', async () => {
    const status = await probeLocalPi({ force: true });
    expect(status).toEqual({ installed: false, path: null, version: null });
    expect(getCachedLocalPiPath()).toBeNull();
  });

  it('--version failure on an executable candidate falls through to the next candidate', async () => {
    const broken = '/opt/homebrew/bin/pi';
    const good = '/usr/local/bin/pi';
    accessMock.mockImplementation((p: string) => {
      if (p === broken || p === good) return undefined;
      throw new Error('ENOENT');
    });
    mockExec((file, args) => {
      if (file === broken) return { error: new Error('spawn failed') };
      if (file === good && args[0] === '--version') return { stdout: 'pi 9.9.9' };
      if (file === 'which') return { stdout: '' };
      return { error: new Error('unexpected spawn') };
    });

    const status = await probeLocalPi({ force: true });
    expect(status).toEqual({ installed: true, path: good, version: 'pi 9.9.9' });
  });

  it('cached result is reused without re-probing; force re-probes', async () => {
    const piPath = '/home/tester/.local/bin/pi';
    accessMock.mockImplementation((p: string) => {
      if (p === piPath) return undefined;
      throw new Error('ENOENT');
    });
    mockExec((file, args) => {
      if (file === piPath && args[0] === '--version') return { stdout: 'pi 1.0.0' };
      if (file === 'which') return { stdout: '' };
      return { error: new Error('unexpected spawn') };
    });

    await probeLocalPi({ force: true });
    const callsAfterFirst = execFileMock.mock.calls.length;

    const cached = await probeLocalPi();
    expect(cached.path).toBe(piPath);
    expect(execFileMock.mock.calls.length).toBe(callsAfterFirst);

    const again = await probeLocalPi({ force: true });
    expect(again.path).toBe(piPath);
    expect(execFileMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('concurrent force probes share one in-flight probe', async () => {
    const piPath = '/home/tester/.local/bin/pi';
    accessMock.mockImplementation((p: string) => {
      if (p === piPath) return undefined;
      throw new Error('ENOENT');
    });
    mockExec((file, args) => {
      if (file === piPath && args[0] === '--version') return { stdout: 'pi 2.0.0' };
      if (file === 'which') return { stdout: '' };
      return { error: new Error('unexpected spawn') };
    });

    const [a, b] = await Promise.all([probeLocalPi({ force: true }), probeLocalPi({ force: true })]);
    expect(a).toEqual(b);
    // 两个并发调用只应触发一轮探测(1 次 --version + 1 次 which)。
    const versionSpawns = execFileMock.mock.calls.filter(
      (call) => call[0] === piPath && (call[1] as string[])[0] === '--version',
    );
    expect(versionSpawns).toHaveLength(1);
  });
});

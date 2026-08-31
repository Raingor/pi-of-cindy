import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AuthAdapter } from '../../../../../packages/maker-core/src/interfaces/auth-adapter';
// pi-only 改造:codex env-builder 已随 CodexAgent 删除;buildClaudeEnv 仍被
// claude 历史数据链路(conversion / local sessions)所在的 env 守卫面使用。
import { buildClaudeEnv } from '../../../../../packages/maker-core/src/agents/claude-code/env-builder';

function makeAuth(authEnv: Record<string, string>): AuthAdapter {
  return {
    getState: async () => ({ authenticated: true }),
    triggerLogin: async () => ({ authenticated: true }),
    logout: async () => undefined,
    getAuthEnv: async () => authEnv,
  };
}

async function withProcessEnv<T>(
  env: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

function pathKey(): string {
  return process.platform === 'win32' ? 'Path' : 'PATH';
}

function bundledToolDir(): string {
  return process.platform === 'win32' ? 'C:\\xdt-maker\\tools\\ripgrep' : '/xdt-maker/tools/ripgrep';
}

function systemPath(): string {
  return process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin';
}

describe('agent env PATH prepends', () => {
  it('does not apply pathPrepends to Claude env assembly', async () => {
    const key = pathKey();
    const originalPath = systemPath();

    await withProcessEnv({ [key]: originalPath, XDT_KEEP: 'keep' }, async () => {
      const env = await buildClaudeEnv(makeAuth({ ANTHROPIC_API_KEY: 'injected' }), {
        pathPrepends: [bundledToolDir()],
      });

      expect(process.env[key]).toBe(originalPath);
      expect(env[key]).toBe(originalPath);
      expect(env.XDT_KEEP).toBe('keep');
      expect(env.ANTHROPIC_API_KEY).toBe('injected');
    });
  });
});

/**
 * 本机 Pi CLI 缺失时的登录后提示。
 *
 * 三条不变量:
 *  1. 提示而非阻断 —— Cindy 自身与既有任务不依赖用户的 Pi CLI 安装;
 *  2. 探测失败(IPC 抖动)不提示 —— 弹「你没装 Pi」是错误信息;
 *  3. 登出后允许重新探测 —— 期间可能刚装好。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(process.cwd());

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8');
}

describe('pi install prompt contract', () => {
  const gate = readSource('src/renderer/components/pi-install/PiCliInstallGate.tsx');

  it('probes only after login and re-probes after a logout', () => {
    expect(gate).toContain('const { isAuthenticated } = useAuth();');
    // 登出把 probedRef 复位,否则下次登录不会再探测(用户装好了也看不到提示)。
    expect(gate).toContain('probedRef.current = false;');
    expect(gate).toContain('}, [isAuthenticated]);');
  });

  it('opens the prompt only when the probe reports pi as missing', () => {
    expect(gate).toContain('await window.electronAPI.maker.piAgent.installStatus()');
    expect(gate).toContain('if (cancelled || status.installed) return;');
  });

  it('stays silent when the probe itself fails', () => {
    const catchIndex = gate.indexOf('} catch (err: unknown) {');
    expect(catchIndex).toBeGreaterThan(-1);
    const catchBody = gate.slice(catchIndex, gate.indexOf('})();', catchIndex));
    // 只记日志,绝不 setOpen(true)。
    expect(catchBody).toContain('log.warn');
    expect(catchBody).not.toContain('setOpen(true)');
  });

  it('honours a persisted dismissal before probing', () => {
    const effectIndex = gate.indexOf('probedRef.current = true;');
    const dismissCheck = gate.indexOf('if (isPromptDismissed()) return;', effectIndex);
    const probeCall = gate.indexOf('installStatus()', effectIndex);
    expect(dismissCheck).toBeGreaterThan(effectIndex);
    // dismiss 检查必须早于 IPC:勾过「不再提示」就不该再打这条 IPC。
    expect(dismissCheck).toBeLessThan(probeCall);
  });
});

describe('pi install probe contract', () => {
  it('treats the Pi CLI data directory as the single source of truth', () => {
    const reader = readSource('src/main/pi-agent/piReader.ts');
    const probeIndex = reader.indexOf('export function isPiCliInstalled');
    expect(probeIndex).toBeGreaterThan(-1);
    const probe = reader.slice(probeIndex, reader.indexOf('\n}', probeIndex));

    expect(probe).toContain('existsSync(PI_DIR)');
    expect(probe).toContain('statSync(PI_DIR).isDirectory()');
    // Cindy 自带的受管 pi 二进制是另一套东西,不能拿它冒充用户的 CLI 安装。
    expect(probe).not.toContain('getReadyBinaryPath');
  });

  it('returns a boolean only, never the resolved home path', () => {
    const handlers = readSource('src/main/maker-ipc/piAgentHandlers.ts');
    const handlerIndex = handlers.indexOf('MAKER_INVOKE.PI_AGENT_INSTALL_STATUS');
    expect(handlerIndex).toBeGreaterThan(-1);
    const handler = handlers.slice(handlerIndex, handlerIndex + 300);

    expect(handler).toContain('assertTrustedAppRendererEvent(event)');
    expect(handler).toContain('return { installed: isPiCliInstalled() };');
    // 不得把用户 home 下的绝对路径交给 Renderer。
    expect(handler).not.toContain('PI_DIR');
  });
});

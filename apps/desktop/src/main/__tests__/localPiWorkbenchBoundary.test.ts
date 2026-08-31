/**
 * 本机 Pi 工作台的入口边界。
 *
 * 这里只锁一条不变量:**创建入口只暴露 pi**。pi-only 改造(2026-08-31 Phase B)后
 * Maker registry 也只注册 pi —— 历史 claude/codex 会话的打开路径由后续阶段处理;
 * splash 亦不再为 claude/codex 准备二进制(Phase A,commit 1033bdad7)。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(process.cwd());

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8');
}

describe('local Pi workbench entry contract', () => {
  it('exposes only pi to the task creation entry', () => {
    const register = readSource('src/main/maker-ipc/register.ts');
    const handlerIndex = register.indexOf('MAKER_INVOKE.LIST_AVAILABLE_AGENTS');
    expect(handlerIndex).toBeGreaterThan(-1);
    const handler = register.slice(handlerIndex, handlerIndex + 400);

    expect(handler).toContain("filter((kind) => kind === 'pi')");
  });

  it('registers only pi in the Maker agents map', () => {
    const host = readSource('src/main/maker-host/index.ts');

    // pi-only:agents map 只注册 pi(pi 不可用时为空 map)。
    expect(host).toContain('agents: piAgent ? { pi: piAgent } : {}');
    expect(host).not.toContain("'claude-code': claudeAgent");
    expect(host).not.toContain('codex: codexAgent');
  });

  it('no longer requires claude/codex binaries at maker construction', () => {
    const bootstrap = readSource('src/main/bootstrap-electron.ts');
    const host = readSource('src/main/maker-host/index.ts');

    // Phase A 停掉下载链;Phase B 摘掉 getMaker 对 claude/codex 二进制的读取。
    expect(host).not.toContain("getReadyBinaryPath('claude-code')");
    expect(host).not.toContain("getCachedBinaryStatus('codex')");
    expect(bootstrap).not.toContain("binaryPrepare('claude-code'");
    expect(bootstrap).not.toContain("binaryPrepare('codex'");
  });

  it('keeps pi optional at startup', () => {
    const bootstrap = readSource('src/main/bootstrap-electron.ts');
    const start = bootstrap.indexOf("ipcMain.handle('check-environment'");
    expect(start).toBeGreaterThan(-1);
    const body = bootstrap.slice(start, bootstrap.indexOf('ipcMain.handle(', start + 1));

    // Phase A(pi-only step 1)起 pi 不经下载链,check-environment 只探测本机安装;
    // 探测失败仅打非致命告警并按 skipped/failed 上报,不得把 splash 打进失败态。
    expect(body).toContain('probeLocalPi({ force: true })');
    expect(body).toContain('local pi probe failed (non-fatal');
    expect(body).toContain("status: 'skipped' as const");
    const returnIndex = body.lastIndexOf('return {');
    expect(body.slice(returnIndex)).toContain('allPassed: true');
  });
});

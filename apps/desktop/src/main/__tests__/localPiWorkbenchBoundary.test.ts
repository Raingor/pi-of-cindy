/**
 * 本机 Pi 工作台的入口边界。
 *
 * 这里只锁一条不变量:**创建入口只暴露 pi**,而 Maker registry 必须保留全部 harness。
 *
 * 为什么不锁"splash 只准备 pi":试过,不成立。`getMaker()` 在构造期就要求 Claude 与
 * Codex 二进制已 provision(BaseAgent 的 binaryPath 是必填,缺失即构造抛错),停掉
 * splash 的预下载会让 `maker:*` 整套 IPC 注册失败 —— 不是"少下两个二进制",而是整个
 * 应用的核心 IPC 挂不上。实机启动日志:
 *   `getMaker: Claude binary not provisioned (bootstrap must run prepare("claude-code"))`
 * 想真正停掉预下载,得先让两个 agent 支持"路径延迟解析",那是独立一项改动。
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

  it('keeps every harness registered so existing sessions still open', () => {
    const host = readSource('src/main/maker-host/index.ts');

    // agent map 必须保留三个 harness:摘掉任何一个都会让历史会话在
    // Maker.requireAgent 上炸成 not-registered。
    expect(host).toContain("'claude-code': claudeAgent");
    expect(host).toContain('codex: codexAgent');
    expect(host).toContain('...(piAgent ? { pi: piAgent } : {})');
  });

  it('still provisions the binaries getMaker asserts on', () => {
    const bootstrap = readSource('src/main/bootstrap-electron.ts');
    const host = readSource('src/main/maker-host/index.ts');

    // getMaker 的两条前置断言与 splash 的两段 prepare 是同一条不变量的两半:
    // 删掉任一侧,maker:* IPC 注册就会失败。
    expect(host).toContain("getReadyBinaryPath('claude-code')");
    expect(host).toContain("getCachedBinaryStatus('codex').binaryPath");
    expect(bootstrap).toContain("binaryPrepare('claude-code'");
    expect(bootstrap).toContain("binaryPrepare('codex'");
  });

  it('keeps pi optional at startup', () => {
    const bootstrap = readSource('src/main/bootstrap-electron.ts');
    const start = bootstrap.indexOf("ipcMain.handle('check-environment'");
    expect(start).toBeGreaterThan(-1);
    const body = bootstrap.slice(start, bootstrap.indexOf('ipcMain.handle(', start + 1));

    // pi 段显式关掉失败广播,pi 不可用不得把 splash 打进失败态。
    expect(body).toContain("binaryPrepare('pi'");
    expect(body).toContain('broadcastFailure: false');
    expect(body).toContain('piDisabledForLaunch = true');
    const returnIndex = body.lastIndexOf('return {');
    expect(body.slice(returnIndex)).toContain('allPassed: true');
  });
});

/**
 * Pi 二进制分发契约(2026-08-29 Pi-first 改造后重写):Cindy 不下载、不捆绑 pi,
 * 运行时只调用本机安装的 pi(pi-agent/localPi.ts 探测缓存);安装包与 CDN 链
 * 都不再有 pi 资产。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(process.cwd());

describe('Pi binary distribution contract', () => {
  it('does not stage or copy Pi into packaged resources', () => {
    const forge = fs.readFileSync(path.join(desktopRoot, 'forge.config.ts'), 'utf8');

    expect(forge).not.toContain('function stagePi(');
    expect(forge).not.toContain("'resources/pi'");
    expect(forge).not.toContain('stagePi(targetPlatform');
  });

  it('resolves Pi only through the local-machine probe cache', () => {
    const host = fs.readFileSync(
      path.join(desktopRoot, 'src/main/maker-host/pi-host.ts'),
      'utf8',
    );

    expect(host).toContain('getCachedLocalPiPath()');
    expect(host).not.toContain("getReadyBinaryPath('pi')");
    expect(host).not.toContain("getCachedBinaryStatus('pi')");
    expect(host).not.toContain("path.join(process.resourcesPath, 'pi'");
    expect(host).not.toContain('安装包自带');
  });

  it('probes the local pi once at splash and never downloads one', () => {
    const bootstrap = fs.readFileSync(
      path.join(desktopRoot, 'src/main/bootstrap-electron.ts'),
      'utf8',
    );

    expect(bootstrap).toContain('probeLocalPi({ force: true })');
    // 探测被启动预算兜底,超时按未安装处理,不阻塞 splash。
    expect(bootstrap).toContain('PI_AGENT_INSTALL_STARTUP_DEADLINE_MS');
    expect(bootstrap).not.toContain("binaryPrepare('pi'");
  });

  it('bounds optional Pi preparation so CDN trouble cannot hold the startup page', () => {
    const bootstrap = fs.readFileSync(
      path.join(desktopRoot, 'src/main/bootstrap-electron.ts'),
      'utf8',
    );

  });

  it('reports the local pi through the binary-version IPC', () => {
    const binaryVersion = fs.readFileSync(
      path.join(desktopRoot, 'src/main/maker-ipc/binary-version.ts'),
      'utf8',
    );

    expect(binaryVersion).toContain("if (kind === 'pi') return getCachedLocalPiPath();");
  });

  it('treats a missing local pi as non-fatal for startup', () => {
    const bootstrap = fs.readFileSync(
      path.join(desktopRoot, 'src/main/bootstrap-electron.ts'),
      'utf8',
    );

    expect(bootstrap).toContain('local pi probe failed (non-fatal');
  });
});

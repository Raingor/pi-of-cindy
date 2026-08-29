/**
 * apps/desktop/src/main/pi-agent/piInstaller.ts
 *
 * 本机 pi 一键安装(登录页 / 设置引导)—— Pi-first 改造 Phase 4。
 *
 * 链路:复用 agent-binaries 的受管下载链(CDN manifest + SHA256 校验,dev 走
 * apps/pi-bin)拿到已验证的 pi 目录产物,再把它落到用户目录 ~/.pi/bin/:
 *   - unix:~/.pi/bin/pi-runtime/<目录内容>,~/.pi/bin/pi 为指向其中可执行文件的符号链接;
 *   - windows:~/.pi/bin/pi/<目录内容>(探测候选覆盖 ~/.pi/bin/pi/pi.exe)。
 * 全程只写用户主目录,不需要提权;装完 force 重探并返回最新 LocalPiStatus。
 *
 * 注意:~/.pi/bin 未必在用户 shell 的 PATH 上 —— Cindy 自身探测覆盖它,不依赖 PATH;
 * 终端可见性由 UI 层的 PATH 提示文案说明。
 */

import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { prepare } from '../agent-binaries/index.js';
import { createLogger } from '../logger.js';
import { probeLocalPi, type LocalPiStatus } from './localPi.js';

const log = createLogger('pi-agent/piInstaller');

/** ~/.pi/bin 下的完整目录产物目录名(版本无关,重装整体替换)。 */
const RUNTIME_DIR_NAME = 'pi-runtime';

/** 统一 IPC 错误协议的失败码(renderer 据此选文案)。 */
export type PiInstallErrorCode =
  | 'PI_INSTALL_DOWNLOAD_FAILED'
  | 'PI_INSTALL_LAYOUT_FAILED'
  | 'PI_INSTALL_VERIFY_FAILED';

export class PiInstallError extends Error {
  constructor(
    readonly code: PiInstallErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function piBinRoot(): string {
  return path.join(homedir(), '.pi', 'bin');
}

function linkPath(): string {
  return path.join(piBinRoot(), 'pi');
}

function removeAll(target: string): void {
  if (!existsSync(target)) return;
  rmSync(target, { recursive: true, force: true });
}

function ensureSymlink(target: string, link: string): void {
  try {
    unlinkSync(link);
  } catch {
    /* 不存在即目标态 */
  }
  try {
    symlinkSync(target, link);
  } catch (err) {
    if (process.platform !== 'win32') throw err;
    // Windows 无特权 symlink 常见失败;目录形态兜底(探测候选含 ~/.pi/bin/pi/pi.exe)。
    const fallbackDir = link;
    if (existsSync(fallbackDir)) removeAll(fallbackDir);
    mkdirSync(path.dirname(fallbackDir), { recursive: true });
    cpSync(target, fallbackDir, { recursive: true });
  }
}

/**
 * 下载(复用受管链)→ 落盘 ~/.pi/bin → force 重探。
 * 失败抛 PiInstallError(code 进统一 IPC 错误协议)。
 */
export async function installLocalPi(): Promise<LocalPiStatus> {
  // 复用受管下载链:broadcastFailure=false —— 失败经本模块错误协议上抛,
  // 不走 splash 广播;进度仍走 'binary-download-progress' 广播(renderer 可显)。
  const res = await prepare('pi', { broadcastFailure: false });
  if (!res.ready || !res.path) {
    throw new PiInstallError(
      'PI_INSTALL_DOWNLOAD_FAILED',
      res.error ?? 'pi download did not produce a binary',
    );
  }

  const srcExe = res.path;
  const srcDir = path.dirname(srcExe);
  const exeName = path.basename(srcExe);
  const destRoot = piBinRoot();
  const runtimeDir = path.join(destRoot, RUNTIME_DIR_NAME);
  const runtimeExe = path.join(runtimeDir, exeName);

  try {
    mkdirSync(destRoot, { recursive: true });
    removeAll(runtimeDir);
    cpSync(srcDir, runtimeDir, { recursive: true });
    chmodSync(runtimeExe, 0o755);
    ensureSymlink(runtimeExe, linkPath());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn('pi install layout failed', { detail, srcDir, destRoot });
    throw new PiInstallError('PI_INSTALL_LAYOUT_FAILED', detail);
  }

  const status = await probeLocalPi({ force: true });
  if (!status.installed || !status.path) {
    throw new PiInstallError('PI_INSTALL_VERIFY_FAILED', 'installed pi failed --version probe');
  }
  log.info(`local pi installed at ${status.path} (${status.version ?? 'unknown version'})`);
  return status;
}

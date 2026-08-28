/**
 * apps/desktop/src/main/pi-agent/localPi.ts
 *
 * 本机 pi 探测 —— 2026-08-29 Pi-first 改造后 Cindy 不再下载/捆绑 pi 二进制,
 * 运行时只调用用户本机安装的 pi(用户已确认的行为变更,见 docs/dev-rules/pi-harness.md
 * §6)。本模块负责:
 *   - 探测本机 pi:标准安装位置 + PATH 查找,命中即 spawn `--version` 验证;
 *   - 缓存最近一次探测结果,供 resolvePiBinaryPath() 同步取路径、
 *     `maker:pi-local:status` IPC 与登录页安装引导消费。
 *
 * 探测是异步的;缓存未就绪时 getCachedLocalPiPath() 返回 null(等价「pi 不可用」)。
 * splash 阶段会先 await 一次探测,因此正常启动路径下 maker 构造前缓存已就绪。
 * 安装引导完成后调 probeLocalPi({ force: true }) 失效缓存重探。
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { createLogger } from '../logger.js';

const log = createLogger('pi-agent/localPi');

export interface LocalPiStatus {
  installed: boolean;
  /** 命中的本机 pi 可执行文件绝对路径;未安装为 null。 */
  path: string | null;
  /** `pi --version` 首行输出;探测失败为 null。 */
  version: string | null;
}

const VERSION_TIMEOUT_MS = 5000;

let cachedStatus: LocalPiStatus | null = null;
let inFlight: Promise<LocalPiStatus> | null = null;

/** 本机 pi 的候选安装位置(逐个验证,先命中先用)。 */
function candidatePaths(): string[] {
  const bin = process.platform === 'win32' ? 'pi.exe' : 'pi';
  const home = homedir();
  return [
    path.join(home, '.local', 'bin', bin),
    path.join(home, '.pi', 'bin', bin),
    '/opt/homebrew/bin/pi',
    '/usr/local/bin/pi',
    path.join(home, 'AppData', 'Local', 'Programs', 'pi', bin),
  ];
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnVersion(binaryPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['--version'],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          resolve(null);
          return;
        }
        const firstLine = (stdout || stderr || '').toString().trim().split(/\r?\n/)[0]?.trim();
        resolve(firstLine || null);
      },
    );
  });
}

/** PATH 查找(unix `which` / windows `where`),失败返回空数组。 */
function whichPi(): Promise<string[]> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, ['pi'], { timeout: VERSION_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      const hits = stdout
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      resolve(hits);
    });
  });
}

async function probe(): Promise<LocalPiStatus> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const p of [...candidatePaths(), ...(await whichPi())]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    candidates.push(p);
  }

  for (const candidate of candidates) {
    if (!isExecutable(candidate)) continue;
    const version = await spawnVersion(candidate);
    if (version === null) continue;
    log.info(`local pi found: ${candidate} (${version})`);
    return { installed: true, path: candidate, version };
  }

  log.info('local pi not found');
  return { installed: false, path: null, version: null };
}

/**
 * 探测本机 pi 并刷新缓存。并发调用共享同一在途探测;force 时丢弃缓存重探
 * (安装引导完成后使用)。探测从不 reject —— 失败即 installed:false。
 */
export function probeLocalPi(options?: { force?: boolean }): Promise<LocalPiStatus> {
  if (!options?.force && cachedStatus) return Promise.resolve(cachedStatus);
  if (!inFlight) {
    inFlight = probe()
      .then((status) => {
        cachedStatus = status;
        return status;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** 最近一次探测结果;尚未探测过返回 null。 */
export function getLocalPiStatusSnapshot(): LocalPiStatus | null {
  return cachedStatus;
}

/** 同步取缓存的本机 pi 路径;未探测或未安装返回 null。 */
export function getCachedLocalPiPath(): string | null {
  return cachedStatus?.path ?? null;
}

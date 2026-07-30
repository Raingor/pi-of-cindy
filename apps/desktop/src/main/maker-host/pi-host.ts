/**
 * Pi harness host 装配：本地 pi 二进制发现 + no-op auth/runtime config。
 *
 * 决策（plan §3 个拍板点）：
 *  - **复用本地 pi**：不随包自带、不进 agent-binaries 下载套。host 启动时探测
 *    PATH + pi-node 已知安装路径，找到才注册 PiAgent，找不到就跳过（picker 不显示）。
 *  - **pi 自管 provider/credentials**：Cindy 不注入任何凭证 env，pi 用 `~/.pi` 自配。
 *    故 AuthAdapter 是 no-op stub（恒 authenticated），runtimeConfig 为空对象 --
 *    真正的鉴权失败由 pi 子进程在首次 prompt 时经 error event 透出，不在此伪造。
 */

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AuthAdapter, AuthState, AgentRuntimeConfig, Logger } from '@cindy/maker-core';

/** pi-node 默认安装根（pi installer 把 node + pi 放这里）。 */
const PI_NODE_ROOT = join(homedir(), '.local', 'share', 'pi-node');

/**
 * 找本地 pi 可执行文件。查找顺序：
 *  1. PATH 里直接可执行的 `pi`（用户已加进 shell profile）
 *  2. `~/.local/share/pi-node/current/bin/pi`（installer 的稳定 symlink）
 *  3. pi-node 下各版本目录的 bin/pi（按版本目录名降序取最新）
 *
 * 返回绝对路径；任一都找不到返回 null（host 据此跳过 pi harness 注册）。
 */
export function resolvePiBinaryPath(): string | null {
  // 1. PATH 查找（跨平台：unix ':' / win ';'，可执行名 pi / pi.exe）
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const exeName = process.platform === 'win32' ? 'pi.exe' : 'pi';
  const pathDirs = (process.env.PATH ?? '').split(pathSep);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, exeName);
    if (isExecutableFile(candidate)) return candidate;
  }

  // 2. pi-node current symlink
  const currentPath = join(PI_NODE_ROOT, 'current', 'bin', exeName);
  if (isExecutableFile(currentPath)) return currentPath;

  // 3. glob 版本目录（node-vX.Y.Z-platform-arch），降序取最新
  let versionDirs: string[] = [];
  try {
    versionDirs = readdirSync(PI_NODE_ROOT).filter((d) => d.startsWith('node-'));
  } catch {
    // 目录不存在 / 无权限 -> 跳到返回 null
  }
  versionDirs.sort().reverse();
  for (const v of versionDirs) {
    const candidate = join(PI_NODE_ROOT, v, 'bin', exeName);
    if (isExecutableFile(candidate)) return candidate;
  }

  return null;
}

function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * pi 专用 no-op AuthAdapter。pi 自管 `~/.pi` 凭证，Cindy 不触碰其鉴权状态：
 *  - getState: 恒 authenticated（Cindy 视角下 pi 总是"可用"，真正不可用由 pi 子进程报错）
 *  - triggerLogin / logout: no-op（不在 Cindy 侧伪造登录态 / 不清 pi 本地凭证）
 *  - getAuthEnv: 空（不注入任何凭证 env，pi 自己读 ~/.pi）
 */
export function createPiAuthAdapter(logger: Logger): AuthAdapter {
  const authenticated: AuthState = {
    authenticated: true,
    identity: 'pi (self-managed via ~/.pi)',
  };
  return {
    getState: async () => authenticated,
    triggerLogin: async () => {
      logger.warn('pi: triggerLogin called but pi self-manages credentials; no-op');
      return authenticated;
    },
    logout: async () => {
      logger.warn('pi: logout called but pi self-manages credentials; no-op (not wiping ~/.pi)');
    },
    getAuthEnv: async () => ({}),
  };
}

/**
 * pi 专用 runtime config。pi 自管 endpoint / model / memory / system prompt，
 * 所有字段留 undefined -> 不注入任何 host 侧行为 flag。
 */
export function createPiRuntimeConfig(): AgentRuntimeConfig {
  return {
    // pi 自管 memory（~/.pi），Cindy 侧不启用原生 memory 也不启用 Maker Memory。
    memoryEnabled: false,
    makerMemoryEnabled: false,
  };
}

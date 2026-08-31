/**
 * SSH remote 会话的 Maker Memory 开关链路 (review R1 P1/P2) 的结构性回归断言。
 *
 * register.ts 是巨型组装函数, 闭包逻辑难以直接单测; 与
 * remoteCcQueryFactory.test.ts 同一模式用源码结构守住两条回归:
 *
 *  1. R1 P1: ensureRemoteReadyForSessionStart 曾对所有远端 createOpts 强制
 *     `makerMemoryEnabled = false`, 把 renderer/DB-hydrate 侧已放开的开关又
 *     盖回去 — 远端会话永远拿不到记忆注入。现在必须保留调用方值, 缺失时按
 *     全局开关补齐。
 *  2. R1 P2: cindy_memory provider 的 isEnabled 在 codex HTTP bridge 启动时
 *     冻结。Maker Memory 开关翻转必须重建 bridge (shutdownCodexEnvironment,
 *     与 contacts / 全局插件开关同机制), 否则旧 bridge 缺/多 cindy_memory:
 *     远端 CC prompt 与工具面失配, codex 远端漂移判定永不收敛。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '..', 'register.ts'), 'utf8').replace(/\r\n?/g, '\n');

describe('ensureRemoteReadyForSessionStart Maker Memory flag (R1 P1)', () => {
  it('no longer hard-forces makerMemoryEnabled=false on remote createOpts', () => {
    // 旧回归形态:remoteHostId 赋值后紧跟无条件覆盖 false。R2 的 stale-bridge
    // 钳制分支里也有受守卫的 `= false` 赋值, 所以只锁「无条件」形态。
    expect(source).not.toMatch(
      /remoteHostId = remoteHostIdToEnsure;\s*\n\s*mutableCreateOpts\.makerMemoryEnabled = false;/,
    );
  });

  it('preserves the caller flag and only backfills from the global manager state', () => {
    const fnStart = source.indexOf('async function ensureRemoteReadyForSessionStart');
    expect(fnStart).toBeGreaterThan(-1);
    const backfill = source.indexOf(
      'mutableCreateOpts.makerMemoryEnabled ??= maker.makerMemory?.isEnabled() ?? false;',
      fnStart,
    );
    expect(backfill).toBeGreaterThan(fnStart);
  });

  it('clamps the session flag when the active (stale) bridge lacks cindy_memory (R2 P2)', () => {
    // busy 延迟窗口:manager 已翻转、bridge 重建被推迟。flag 保持 true 会让
    // prompt 注入 memory rules 而工具面没有 server — 必须按活跃 bridge 的
    // server 快照 (activeBridgeMissingMemory 谓词, 与 drift 判定共用) 钳制
    // 到关闭, 保持 prompt / 工具面同源。
    expect(source).toContain('function activeBridgeMissingMemory()');
    const fnStart = source.indexOf('async function ensureRemoteReadyForSessionStart');
    const backfill = source.indexOf('mutableCreateOpts.makerMemoryEnabled ??=', fnStart);
    const clamp = source.indexOf(
      'if (mutableCreateOpts.makerMemoryEnabled && activeBridgeMissingMemory()) {',
      backfill,
    );
    const clampAssign = source.indexOf('mutableCreateOpts.makerMemoryEnabled = false;', clamp);
    expect(backfill).toBeGreaterThan(fnStart);
    expect(clamp).toBeGreaterThan(backfill);
    expect(clampAssign).toBeGreaterThan(clamp);
  });
});

describe('codex remote drift gates after the pi-only harness change', () => {
  it('no longer references codex bridge drift in register.ts', () => {
    // pi-only 改造:codex HTTP bridge / drift 判定已随 CodexAgent 摘除,
    // 远端 ensure 只服务 pi;stale-bridge 钳制谓词保留为恒 false 的形状。
    expect(source).toContain('function activeBridgeMissingMemory()');
    expect(source).not.toContain('hasPendingRemoteMcpDrift');
    expect(source).not.toContain('codexRemoteDriftOpts');
    expect(source).not.toContain('remoteMakerMemoryEnabledForBridge');
  });
});

describe('maker-memory toggle rebuilds the codex MCP bridge (R1 P2)', () => {
  it('MAKER_MEMORY_SET_ENABLED applyRuntime shuts down the codex environment when the flag flips', () => {
    const handler = source.indexOf('MAKER_INVOKE.MAKER_MEMORY_SET_ENABLED');
    expect(handler).toBeGreaterThan(-1);
    const guard = source.indexOf('if (wasEnabled !== enabled) {', handler);
    expect(guard).toBeGreaterThan(handler);
    const shutdown = source.indexOf('await shutdownAgentMcpEnvironmentsBestEffort(', guard);
    expect(shutdown).toBeGreaterThan(guard);
    // 同值调用 (无翻转) 不得白杀 bridge — shutdown 必须在翻转守卫之内。
    const wasEnabledSnapshot = source.indexOf('const wasEnabled = makerMemory.isEnabled();', handler);
    expect(wasEnabledSnapshot).toBeGreaterThan(handler);
    expect(wasEnabledSnapshot).toBeLessThan(guard);
  });

  it('MEMORY_RESET_SETTINGS applyRuntime shuts down the codex environment when the maker flag flips', () => {
    const handler = source.indexOf('MAKER_INVOKE.MEMORY_RESET_SETTINGS');
    expect(handler).toBeGreaterThan(-1);
    const guard = source.indexOf('if (wasMakerEnabled !== resetSettings_.maker) {', handler);
    expect(guard).toBeGreaterThan(handler);
    const shutdown = source.indexOf('await shutdownAgentMcpEnvironmentsBestEffort(', guard);
    expect(shutdown).toBeGreaterThan(guard);
  });
});

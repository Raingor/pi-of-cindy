/**
 * piCredentialReload 接线回归 —— 方案 B 的关键接线点用源断言锁住:
 *   1. 发送事务在 getSession 之前先兑现 pending 重载(agent-switch 同款时序);
 *   2. register.ts 装配 tracker 并注入事务 dep;
 *   3. pi-cli key 写入点(upsert / remove-key / switch-key)带 `pi-cli-` 目录口径通知;
 *   4. 自定义供应商 update/delete 通知 pi 凭证变更;
 *   5. 任务窗口横幅按 providerId 匹配显示,turn 开始消失;
 *   6. 五语言 i18n notice 齐备。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string =>
  readFileSync(resolve(__dirname, '..', '..', '..', '..', 'src', ...parts), 'utf8');

const sendTransactionSource = read('main', 'maker-ipc', 'makerSendTransaction.ts');
const registerSource = read('main', 'maker-ipc', 'register.ts');
const piAgentHandlersSource = read('main', 'maker-ipc', 'piAgentHandlers.ts');
const providerHandlersSource = read('main', 'maker-ipc', 'providerHandlers.ts');
const sessionViewSource = read('renderer', 'features', 'cc-agent', 'CCAgentSessionView.tsx');

describe('piCredentialReload wiring', () => {
  it('send transaction applies the pending reload before getSession', () => {
    const switchIdx = sendTransactionSource.indexOf(
      'await deps.applyPendingAgentSwitch?.(sessionId);',
    );
    const reloadIdx = sendTransactionSource.indexOf(
      'await deps.applyPendingCredentialReload?.(sessionId);',
    );
    const getSessionIdx = sendTransactionSource.indexOf('let sess = deps.getSession(sessionId);');
    expect(switchIdx).toBeGreaterThan(-1);
    expect(reloadIdx).toBeGreaterThan(switchIdx);
    expect(getSessionIdx).toBeGreaterThan(reloadIdx);
  });

  it('register assembles the tracker and injects the transaction dep', () => {
    expect(registerSource).toContain('createPiCredentialReloadTracker({');
    expect(registerSource).toContain('setPiCredentialReloadTracker(piCredentialReloadTracker);');
    // 关旧 handle 待重建必须套 rehydrate close 抑制窗口(agent-switch 同款，#1930)。
    expect(registerSource).toContain(
      'withRehydrateCloseSuppressed(sessionId, () => maker.closeSession(sessionId, \'requested\'))',
    );
    expect(registerSource).toContain(
      'applyPendingCredentialReload: (sessionId) =>\n      piCredentialReloadTracker.applyPendingReload(sessionId),',
    );
    // DB 查询只取本地 pi 会话(agent_kind='pi' 且 remote_host_id 为空)。
    expect(registerSource).toContain('eq(sessions.agentKind, \'pi\')');
    expect(registerSource).toContain('isNull(sessions.remoteHostId)');
    // 自定义供应商通知注入。
    expect(registerSource).toContain('notifyPiCredentialStale: (providerId) =>');
  });

  it('pi-cli key mutations notify with the catalog-scoped provider id', () => {
    expect(piAgentHandlersSource).toContain('notifyPiCredentialsChanged');
    expect(piAgentHandlersSource).toContain('PI_CLI_PROVIDER_ID_PREFIX');
    // upsert-provider 只在 apiKey / apiKeys / activeKeyId 出现时通知。
    expect(piAgentHandlersSource).toContain('patch.apiKey !== undefined');
    expect(piAgentHandlersSource).toContain('patch.apiKeys !== undefined');
    expect(piAgentHandlersSource).toContain('patch.activeKeyId !== undefined');
    // remove-key 与 switch-key 必然改变生效凭证。(4 = 函数定义 1 + 三处调用。)
    expect(piAgentHandlersSource.match(/notifyPiCliCredentialsChanged\(/g)?.length).toBe(4);
  });

  it('custom provider update notifies only when the pi key actually mutated', () => {
    expect(providerHandlersSource).toContain(
      "keyMutations.some((mutation) => mutation.agent === 'pi')",
    );
    expect(providerHandlersSource).toContain('if (piKeyMutated) deps.notifyPiCredentialStale?.(config.id);');
    // 删除供应商也通知(引用它的 pi 会话下次重建拿到清晰错误)。
    expect(providerHandlersSource).toContain('deps.notifyPiCredentialStale?.(providerId);');
  });

  it('session view shows the banner for matching local pi sessions and hides on turn start', () => {
    expect(sessionViewSource).toContain('PiCredentialReloadBanner');
    expect(sessionViewSource).toContain('showPiCredentialReloadBanner');
    expect(sessionViewSource).toContain("realAgentKind === 'pi'");
    expect(sessionViewSource).toContain('!session?.remoteHostId');
    expect(sessionViewSource).toContain('piCredentialReloadAffected.includes(session.providerId)');
    // turn 开始 = 重载已兑现 → 清提示。
    expect(sessionViewSource).toContain('if (agentStatus.isRunning) setPiCredentialReloadAffected(null);');
  });

  it('ships the notice copy in all five locales', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
      const localeSource = readFileSync(
        resolve(__dirname, '..', '..', '..', '..', 'src', 'renderer', 'i18n', 'locales', locale, 'common.json'),
        'utf8',
      );
      expect(localeSource, locale).toContain('"piCredentialReload"');
      expect(localeSource, locale).toContain('"notice"');
    }
  });
});

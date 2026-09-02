/**
 * pi-only 目录裁剪:非 pi-cli 来源的 models.pi 统一标记 disabled。
 *
 * 用户指令(2026-09-02):对话模型选择器只列 **pi 的模型**(models.json 的本机
 * 供应商 pi-cli-*),Cindy 自有/网关来源(xd、anthropic、openai、xai)不再加载。
 * 实现走 CatalogModel.disabled(新路由准入关,运行中会话 keepSelected 豁免),
 * 而不是删除条目 —— 目录仍可解析运行中会话的选中模型供续跑。
 */

import { describe, expect, it } from 'vitest';

import type { ProviderView } from '@cindy/model-providers';

import { BUNDLED_CATALOG } from '@cindy/model-providers';

import {
  getActiveCatalog,
  setActiveCatalog,
  setPiCliCatalogProviders,
} from '../active-catalog.js';

function providerWithPi(id: string, models: string[], source: ProviderView['source'] = 'builtin'): ProviderView {
  return {
    id,
    name: id,
    source,
    agents: ['pi'],
    auth: { method: 'none' },
    routing: {
      pi: { wireProtocol: 'openai-chat', upstream: `https://${id}.example/v1`, authStrategy: 'none' },
    },
    models: {
      pi: models.map((m) => ({
        id: m,
        name: m,
        contextWindow: 128_000,
        efforts: [],
        defaultEffort: null,
      })),
    },
    connected: true,
  };
}

describe('pi-only catalog projection (builtin pi models disabled)', () => {
  it('marks builtin providers pi models disabled while keeping pi-cli providers selectable', () => {
    // base 用真实 BUNDLED_CATALOG:anthropic/openai/xai 的静态条目最贴近运行时
    // (root 装配会从 claude-code/codex seed 重算 pi 投影);xd 的 pi models 是
    // 网关动态注入,fixture 里本来为空,另用 FakeCindy 断言不适用。
    setActiveCatalog(BUNDLED_CATALOG, { capabilityEvidence: 'current' });
    setPiCliCatalogProviders([providerWithPi('pi-cli-seekai-a6', ['gpt-5.6-sol', 'glm-5.3'], 'user')]);

    const providers = getActiveCatalog().providers;
    const seekai = providers.find((p) => p.id === 'pi-cli-seekai-a6');
    // pi 的模型:原样可选。
    expect(seekai?.models.pi?.map((m) => [m.id, m.disabled ?? false])).toEqual([
      ['gpt-5.6-sol', false],
      ['glm-5.3', false],
    ]);
    // Cindy 自有来源:全部 pi 条目已标记 disabled(条目保留,新路由准入排除)。
    const builtin = providers.filter((p) => !p.id.startsWith('pi-cli-'));
    const nonEmpty = builtin.filter((p) => (p.models.pi ?? []).length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    for (const p of nonEmpty) {
      for (const m of p.models.pi ?? []) {
        expect(m.disabled).toBe(true);
      }
    }
  });

});

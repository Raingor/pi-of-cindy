/**
 * 本机 Pi CLI 面板的 IPC 与安全契约。
 *
 * 两条不变量,都会被"顺手改回去"破坏:
 *  1. 凭证真值不出主进程 —— providers 视图与配置导出都必须剥掉 apiKey / apiKeys;
 *  2. 装 / 卸走 Cindy 受管的 pi 二进制 + 参数数组,不拼 shell 命令行。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(process.cwd());

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8');
}

describe('pi cli panel credential boundary', () => {
  const panel = readSource('src/main/pi-agent/piCliPanel.ts');

  it('never puts a key value on the provider view type', () => {
    const start = panel.indexOf('export interface PiCliProviderView');
    expect(start).toBeGreaterThan(-1);
    const view = panel.slice(start, panel.indexOf('}', panel.indexOf('models:', start)));

    expect(view).toContain('hasApiKey: boolean;');
    expect(view).toContain('maskedApiKey?: string;');
    // 一旦有人加回 apiKey 字段,真值就会流到 Renderer。
    expect(view).not.toMatch(/\bapiKey\?*:\s*string/);
    // 密钥池只能以遮罩视图出现——不得直接挂原始字符串数组。
    expect(view).toContain('apiKeys: PiCliApiKeyView[];');
    expect(view).not.toMatch(/\bapiKeys\?*:\s*(string|Array<\s*\{[^}]*\bkey\b)/);
  });

  it('never puts a key value on the key-pool view type', () => {
    const start = panel.indexOf('export interface PiCliApiKeyView');
    expect(start).toBeGreaterThan(-1);
    const view = panel.slice(start, panel.indexOf('\n}', start));

    expect(view).toContain('maskedKey: string;');
    // 只允许 id / maskedKey / active。多出一个 `key` 就是明文逗口。
    expect(view).not.toMatch(/^\s*key\?*:/m);
    expect(view).not.toMatch(/\brawKey\b|\bplainKey\b|\bsecret\b/);
  });

  it('masks in the main process rather than shipping the raw key', () => {
    const start = panel.indexOf('export function readPiCliProviders');
    const body = panel.slice(start, panel.indexOf('\n}', panel.indexOf('providers.sort', start)));

    expect(body).toContain('toApiKeyViews(raw.apiKeys, raw.activeKeyId, effectiveKey)');
    // effectiveKey 只用于派生 hasApiKey / 遮罩 / 计数,不得直接进 view。
    expect(body).not.toContain('apiKey: effectiveKey');
    expect(body).not.toContain('apiKey: inlineKey');
    expect(body).not.toContain('apiKeys: raw.apiKeys');
  });

  it('derives the pool view only through maskApiKey', () => {
    const start = panel.indexOf('function toApiKeyViews');
    expect(start).toBeGreaterThan(-1);
    const body = panel.slice(start, panel.indexOf('\n}', panel.indexOf('return entries.map', start)));

    // 每一条都过 maskApiKey;直接拿 entry.key 回传就是逗口。
    expect(body).toContain('maskApiKey(entry.key as string)');
    expect(body).not.toMatch(/maskedKey:\s*entry\.key/);
  });

  it('keeps the config export free of credentials', () => {
    const reader = readSource('src/main/pi-agent/piReader.ts');
    const start = reader.indexOf('export function exportPiConfig');
    expect(start).toBeGreaterThan(-1);
    const body = reader.slice(start, reader.indexOf('\n}', start));

    // auth.json 整份省略;models.json 逐 provider 剥掉三个凭证字段。
    expect(body).toContain('auth: {}');
    expect(body).toContain('apiKey: _apiKey');
    expect(body).toContain('apiKeys: _apiKeys');
    expect(body).toContain('activeKeyId: _activeKeyId');
    expect(body).not.toContain('auth: readAuth()');
  });
});

describe('pi cli package mutation contract', () => {
  const panel = readSource('src/main/pi-agent/piCliPanel.ts');

  it('spawns the managed pi binary without a shell', () => {
    const start = panel.indexOf('export async function runPiCliPackageCommand');
    const body = panel.slice(start);

    // 不走 PATH 查找:避免执行同名的任意可执行文件。
    expect(body).toContain("getReadyBinaryPath('pi')");
    expect(body).toContain('shell: false');
    // 参数数组传参,不做字符串拼接。
    expect(body).toContain("spawn(binaryPath, [action, source, '--no-approve']");
    // 目标是用户自己的 Pi CLI 目录,不是 Cindy 的 pi-package-home。
    expect(body).toContain('cwd: PI_DIR');
    expect(body).toContain('PI_CODING_AGENT_DIR: PI_DIR');
    // 装包不执行第三方生命周期脚本(沿用 Cindy 既有姿态)。
    expect(body).toContain("npm_config_ignore_scripts: 'true'");
  });

  it('validates the action and source before spawning', () => {
    const handlers = readSource('src/main/maker-ipc/piAgentHandlers.ts');
    const start = handlers.indexOf('MAKER_INVOKE.PI_CLI_PACKAGE_MUTATE');
    expect(start).toBeGreaterThan(-1);
    const body = handlers.slice(start, handlers.indexOf('  });', start));

    expect(body).toContain('assertTrustedAppRendererEvent(event)');
    expect(body).toContain("requireEnum(payload.action, ['install', 'remove'] as const");
    expect(body).toContain("requireString(payload.source, 'source')");
    // 空白字符与超长 source 一律拒绝。
    expect(body).toContain('source.length > 512');
    expect(body).toContain('/\\s/.test(source)');
  });

  it('gates every panel channel on a trusted renderer', () => {
    const handlers = readSource('src/main/maker-ipc/piAgentHandlers.ts');
    for (const channel of [
      'PI_CLI_LIST_PROVIDERS',
      'PI_CLI_LIST_EXTENSIONS',
      'PI_CLI_PACKAGE_MUTATE',
      'PI_CLI_TEST_PROVIDER',
      'PI_CLI_FETCH_MODELS',
      'PI_CLI_TEST_MODEL',
      'PI_CLI_SWITCH_KEY',
      'PI_CLI_ADD_MODEL',
      'PI_CLI_MUTATE',
    ]) {
      const start = handlers.indexOf(`MAKER_INVOKE.${channel}`);
      expect(start, channel).toBeGreaterThan(-1);
      expect(handlers.slice(start, start + 260)).toContain('assertTrustedAppRendererEvent(event)');
    }
  });

  it('speed test never ships a key through the renderer', () => {
    const hook = readSource('src/renderer/hooks/usePiSpeedTest.ts');
    // 测速面板不读 settings(那会带回明文 apiKey),也不再出现 apiKey 形参。
    expect(hook).not.toContain('readSettings');
    expect(hook).not.toMatch(/\bapiKey\b/);

    // 旧的「Renderer 传 baseUrl+apiKey」通道已删,不得借尸还魂。
    const channels = readSource('src/main/maker-ipc/channels.ts');
    for (const legacy of ['PI_AGENT_TEST_PROVIDER', 'PI_AGENT_TEST_MODEL', 'PI_AGENT_FETCH_MODELS']) {
      expect(channels.includes(legacy), legacy).toBe(false);
    }

    // 单模型探测与供应商详情同口径:主进程现读真 key,Handler 只投递结果。
    const panel = readSource('src/main/pi-agent/piCliPanel.ts');
    const start = panel.indexOf('export async function testPiCliModel');
    expect(start).toBeGreaterThan(-1);
    const body = panel.slice(start, panel.indexOf('\n}', start));
    expect(body).toContain('readPiCliProviderRuntimeConfig(providerId)');
    expect(body).toContain('testModel(config.baseUrl, modelId, config.apiKey)');
  });

  it('key switch writes only through the providerId path and never echoes key values', () => {
    const panel = readSource('src/main/pi-agent/piCliPanel.ts');
    const start = panel.indexOf('export function switchPiCliProviderKey');
    expect(start).toBeGreaterThan(-1);
    const body = panel.slice(start, panel.indexOf('\n}', start));
    // 走纯函数切换,不拼接任何 key 真值;写回的是从盘上读的原文。
    expect(body).toContain('applyPiCliKeySwitch(models.value, providerId, keyId)');

    // handler 只收 providerId + keyId,返回布尔;不出现 apiKey 形参或回传。
    const handlers = readSource('src/main/maker-ipc/piAgentHandlers.ts');
    const hStart = handlers.indexOf('MAKER_INVOKE.PI_CLI_SWITCH_KEY');
    expect(hStart).toBeGreaterThan(-1);
    const hBody = handlers.slice(hStart, handlers.indexOf('  });', hStart));
    expect(hBody).toContain("requireString(payload.providerId, 'providerId')");
    expect(hBody).toContain("requireString(payload.keyId, 'keyId')");
    expect(hBody).toContain('return { success: true };');
    expect(hBody).not.toMatch(/apiKey/);
  });

  it('add-model payload carries no credentials and is whitelisted', () => {
    const handlers = readSource('src/main/maker-ipc/piAgentHandlers.ts');
    const start = handlers.indexOf('MAKER_INVOKE.PI_CLI_ADD_MODEL');
    expect(start).toBeGreaterThan(-1);
    const body = handlers.slice(start, handlers.indexOf('  });', start));
    expect(body).toContain('assertTrustedAppRendererEvent(event)');
    // 任意键穿透禁止:只接受已知字段。
    expect(body).toContain("for (const k of ['contextWindow', 'maxTokens'] as const)");
    // models.json 写路径不携带 apiKey/credential 字段。
    expect(body).not.toMatch(/apiKey/);
  });

  it('mutate channel dispatches a whitelisted action set with payload validation', () => {
    const handlers = readSource('src/main/maker-ipc/piAgentHandlers.ts');
    const start = handlers.indexOf('MAKER_INVOKE.PI_CLI_MUTATE');
    expect(start).toBeGreaterThan(-1);
    const body = handlers.slice(start, handlers.indexOf('  // ── Settings', start));
    expect(body).toContain('assertTrustedAppRendererEvent(event)');
    // action 白名单与 pws config-store 动作一一对应。
    for (const action of [
      'upsert-provider',
      'rename-provider',
      'remove-provider',
      'set-provider-disabled',
      'upsert-model',
      'remove-model',
      'update-enabled',
    ]) {
      expect(body.includes(`'${action}'`), action).toBe(true);
    }
    // 字段白名单解析存在（未知键不进 models.json）。
    expect(handlers).toContain('function parseProviderPatch');
    expect(handlers).toContain('function parseModelInput');
    // 响应只回 success 布尔,永不回传 key 真值。
    expect(body.match(/return \{ success: true \};/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

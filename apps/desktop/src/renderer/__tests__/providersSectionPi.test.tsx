// @vitest-environment jsdom

/**
 * ProvidersSection(Phase 6 pi 数据层)关键不变量:
 *   1. 列表来自 maker.piProviders.list(builtin + custom);明文密钥绝不出现在
 *      渲染结果里,只有 main 打码后的 keyMasked。
 *   2. 模型开关 = settings.enabledModels 引用的增删(read → 改 → write)。
 *   3. 设置密钥把用户新输入的明文经 setAuth 写入 main;不回传打码值。
 *   4. ?connect=<id> 深链命中列表时直接选中该供应商。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PiProviderView } from '../../shared/piProviderTypes';

const { listSpy, setAuthSpy, removeAuthSpy, saveModelSpy, readSettingsSpy, writeSettingsSpy, toastError } =
  vi.hoisted(() => ({
    listSpy: vi.fn<() => Promise<PiProviderView[]>>(),
    setAuthSpy: vi.fn(),
    removeAuthSpy: vi.fn(),
    saveModelSpy: vi.fn(),
    readSettingsSpy: vi.fn(),
    writeSettingsSpy: vi.fn(),
    toastError: vi.fn(),
  }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => {
    if (!opts) return key;
    let out = key;
    for (const [k, v] of Object.entries(opts)) out = `${out}(${k}=${String(v)})`;
    return out;
  } }),
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));

vi.mock('./EnabledModelsPanel', () => ({
  EnabledModelsPanel: () => <div data-testid="enabled-models-panel" />,
}));

const PLAINTEXT_KEY = 'sk-secret-abcdef1234567890';

const providers: PiProviderView[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'builtin',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    hasAuth: true,
    keyMasked: 'sk-se…7890',
    authSource: 'auth',
    isOverride: false,
    models: [
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', reasoning: true, contextWindow: 1_000_000 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    ],
    enabledModels: ['anthropic/claude-sonnet-5'],
  },
  {
    id: 'my-relay',
    name: 'My Relay',
    type: 'custom',
    api: 'openai-completions',
    baseUrl: 'https://relay.example.com/v1',
    hasAuth: false,
    keyMasked: null,
    authSource: null,
    isOverride: false,
    models: [],
    enabledModels: [],
  },
];

function mockApi() {
  const electronAPI = {
    maker: {
      piProviders: {
        list: listSpy,
        setAuth: setAuthSpy,
        removeAuth: removeAuthSpy,
        saveModel: saveModelSpy,
        removeModel: vi.fn(),
        add: vi.fn(),
        update: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
      },
      piAgent: {
        readSettings: readSettingsSpy,
        writeSettings: writeSettingsSpy,
      },
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = electronAPI;
  return electronAPI;
}

beforeEach(() => {
  vi.clearAllMocks();
  listSpy.mockResolvedValue(providers.map((p) => ({ ...p })));
  readSettingsSpy.mockResolvedValue({ enabledModels: ['anthropic/claude-sonnet-5'] });
  writeSettingsSpy.mockResolvedValue({ success: true });
  setAuthSpy.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
});

import { ProvidersSection } from '../components/settings/ProvidersSection';

function renderSection(initialEntry = '/settings?tab=providers') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProvidersSection />
    </MemoryRouter>,
  );
}

describe('ProvidersSection(pi 数据层)', () => {
  it('渲染 builtin + custom 供应商列表,且明文密钥不进 DOM', async () => {
    mockApi();
    renderSection();
    await waitFor(() => expect(screen.getAllByText('Anthropic').length).toBeGreaterThan(0));
    expect(screen.getAllByText('My Relay').length).toBeGreaterThan(0);
    // 选中默认第一行,详情里是打码值
    expect(await screen.findByText('sk-se…7890')).toBeTruthy();
    expect(document.body.textContent).not.toContain(PLAINTEXT_KEY);
  });

  it('模型开关改写 settings.enabledModels 引用', async () => {
    mockApi();
    renderSection();
    await waitFor(() => expect(screen.getAllByText('Anthropic').length).toBeGreaterThan(0));
    // 当前 enabledModels = [anthropic/claude-sonnet-5];切 haiku 开 → 追加引用
    const haikuSwitch = await screen.findByRole('switch', {
      name: /toggleAria.*model=Claude Haiku 4\.5/,
    });
    fireEvent.click(haikuSwitch);
    await waitFor(() => expect(writeSettingsSpy).toHaveBeenCalled());
    const written = writeSettingsSpy.mock.calls[0][0] as { enabledModels?: string[] };
    expect(written.enabledModels).toContain('anthropic/claude-haiku-4-5');
    expect(written.enabledModels).toContain('anthropic/claude-sonnet-5');
    // 再切 sonnet 关 → 移除引用
    const sonnetSwitch = screen.getByRole('switch', { name: /toggleAria.*model=Claude Sonnet 5/ });
    fireEvent.click(sonnetSwitch);
    await waitFor(() => expect(writeSettingsSpy).toHaveBeenCalledTimes(2));
    const written2 = writeSettingsSpy.mock.calls[1][0] as { enabledModels?: string[] };
    expect(written2.enabledModels).not.toContain('anthropic/claude-sonnet-5');
  });

  it('设置密钥把明文经 setAuth 写入 main', async () => {
    mockApi();
    renderSection();
    await waitFor(() => expect(screen.getAllByText('Anthropic').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('settings.providers.pi.key.replace'));
    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: PLAINTEXT_KEY } });
    fireEvent.click(screen.getByText('settings.providers.button.save'));
    await waitFor(() => expect(setAuthSpy).toHaveBeenCalledWith('anthropic', PLAINTEXT_KEY));
    // 明文不应被回显到 DOM
    expect(document.body.textContent).not.toContain(PLAINTEXT_KEY);
  });

  it('?connect=<id> 深链命中列表时选中该供应商', async () => {
    mockApi();
    renderSection('/settings?connect=my-relay');
    await waitFor(() => expect(screen.getAllByText('My Relay').length).toBeGreaterThan(0));
    // relay 详情:无密钥 → 显示「设置密钥」;openai-completions 徽标文案 key 出现
    await waitFor(() =>
      expect(screen.getByText('settings.providers.pi.key.set')).toBeTruthy(),
    );
    expect(listSpy).toHaveBeenCalled();
  });
});

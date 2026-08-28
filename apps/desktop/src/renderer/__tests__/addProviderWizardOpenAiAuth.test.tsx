// @vitest-environment jsdom

/**
 * 向导 OAuth 授权边界(通用渠道)。原「OpenAI 授权边界」用例随 2026-08-29
 * Pi-first 改造下架 ChatGPT/Codex 订阅 OAuth 一并移除。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderView } from '@cindy/model-providers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));

vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/providerModels', () => ({
  providerMonogram: () => 'O',
}));

vi.mock('@/components/icons/ProviderLogoMark', () => ({
  hasProviderLogo: () => false,
  ProviderLogoMark: () => null,
}));

import { AddProviderWizard } from '@/components/settings/AddProviderWizard';

const OPENAI_PROVIDER = {
  id: 'openai',
  name: 'OpenAI',
  source: 'builtin',
  agents: ['codex'],
  auth: { method: 'oauth' },
  routing: {},
  models: { codex: [] },
  connected: false,
} satisfies ProviderView;
const DEVICE_PROVIDER = {
  id: 'device-provider',
  name: 'Device Provider',
  source: 'builtin',
  agents: ['codex'],
  auth: {
    method: 'oauth',
    oauth: {
      flow: 'device-code',
      deviceAuthorizationUrl: 'https://auth.example.test/device',
      tokenUrl: 'https://auth.example.test/token',
      clientId: 'device-client',
      scopes: 'openid',
    },
  },
  routing: {
    codex: {
      upstream: 'https://api.example.test/v1',
      authStrategy: 'oauth-token',
    },
  },
  models: { codex: [] },
  connected: false,
} satisfies ProviderView;
const AUTH_CODE_PROVIDER = {
  id: 'auth-code-provider',
  name: 'Authorization Code Provider',
  source: 'builtin',
  agents: ['codex'],
  auth: {
    method: 'oauth',
    oauth: {
      authorizeUrl: 'https://auth.example.test/authorize',
      tokenUrl: 'https://auth.example.test/token',
      clientId: 'auth-code-client',
      scopes: 'openid',
    },
  },
  routing: {
    codex: {
      upstream: 'https://api.example.test/v1',
      authStrategy: 'oauth-token',
    },
  },
  models: { codex: [] },
  connected: false,
} satisfies ProviderView;

const providerOAuthLogin = vi.fn();
const providerOAuthCancel = vi.fn();
type ProviderOAuthProgress = {
  providerId: string;
  phase: 'device-code';
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
};
let providerOAuthProgressListener: ((progress: ProviderOAuthProgress) => void) | null = null;

beforeEach(() => {
  providerOAuthLogin.mockReset();
  providerOAuthCancel.mockReset();
  providerOAuthProgressListener = null;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    maker: {
      listProviderPresets: vi.fn(async () => ({ presets: [] })),
      localModelList: vi.fn(async () => ({
        status: { runtime: 'ollama', kind: 'absent', appInstalled: false },
        models: [],
        memoryGb: 0,
      })),
      scanLocalCli: vi.fn(async () => ({ detections: [] })),
      providerOAuthLogin,
      providerOAuthCancel,
      onProviderOAuthProgress: vi.fn((listener: (progress: ProviderOAuthProgress) => void) => {
        providerOAuthProgressListener = listener;
        return () => {
          if (providerOAuthProgressListener === listener) providerOAuthProgressListener = null;
        };
      }),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddProviderWizard — 通用 OAuth 授权边界', () => {
  it('目录声明 Device Grant 时，添加流程直接展示供应商设备码', async () => {
    providerOAuthLogin.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = render(
      <AddProviderWizard
        providers={[DEVICE_PROVIDER]}
        entry={{ kind: 'builtin', providerId: DEVICE_PROVIDER.id }}
        onOpenCustomForm={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await waitFor(() => expect(providerOAuthProgressListener).not.toBeNull());

    fireEvent.click(screen.getByText('settings.providers.wizard.authorizeWithDeviceCode'));
    await waitFor(() =>
      expect(providerOAuthLogin).toHaveBeenCalledWith(
        DEVICE_PROVIDER.id,
        expect.objectContaining({ ownerId: expect.any(String) }),
      ),
    );
    const ownerId = providerOAuthLogin.mock.calls[0]?.[1]?.ownerId;
    act(() => {
      providerOAuthProgressListener?.({
        providerId: DEVICE_PROVIDER.id,
        phase: 'device-code',
        verificationUrl: 'https://auth.example.test/device',
        userCode: 'TEST-CODE',
        expiresAt: Date.now() + 300_000,
      });
    });

    expect(await screen.findByText('TEST-CODE')).not.toBeNull();
    expect(screen.getByText(/auth\.example\.test/)).not.toBeNull();

    unmount();
    expect(providerOAuthCancel).toHaveBeenCalledOnce();
    expect(providerOAuthCancel).toHaveBeenCalledWith(DEVICE_PROVIDER.id, {
      releaseOwner: true,
      ownerId,
    });
  });

  it('authorization-code 登录期间被父级卸载时取消仍在等待的回环授权', async () => {
    providerOAuthLogin.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = render(
      <AddProviderWizard
        providers={[AUTH_CODE_PROVIDER]}
        entry={{ kind: 'builtin', providerId: AUTH_CODE_PROVIDER.id }}
        onOpenCustomForm={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('settings.providers.button.authorize'));
    await waitFor(() =>
      expect(providerOAuthLogin).toHaveBeenCalledWith(
        AUTH_CODE_PROVIDER.id,
        expect.objectContaining({ ownerId: expect.any(String) }),
      ),
    );
    const ownerId = providerOAuthLogin.mock.calls[0]?.[1]?.ownerId;
    expect(providerOAuthProgressListener).toBeNull();

    unmount();
    expect(providerOAuthCancel).toHaveBeenCalledOnce();
    expect(providerOAuthCancel).toHaveBeenCalledWith(AUTH_CODE_PROVIDER.id, {
      releaseOwner: true,
      ownerId,
    });
  });
});

describe('AddProviderWizard — 关闭途径(DESIGN.md §4:取消 / Esc / 遮罩)', () => {
  it('按 Esc 关闭向导', () => {
    const onClose = vi.fn();
    render(
      <AddProviderWizard
        providers={[OPENAI_PROVIDER]}
        onOpenCustomForm={vi.fn()}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('输入法组合期间按 Esc 不关闭向导(取消候选词,不是关闭命令)', () => {
    const onClose = vi.fn();
    render(
      <AddProviderWizard
        providers={[OPENAI_PROVIDER]}
        onOpenCustomForm={vi.fn()}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape', keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩关闭向导;点击弹窗内部不关闭', () => {
    const onClose = vi.fn();
    const { container } = render(
      <AddProviderWizard
        providers={[OPENAI_PROVIDER]}
        onOpenCustomForm={vi.fn()}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );
    // 点弹窗内部(标题):target ≠ 遮罩本身,不得关闭。
    fireEvent.click(screen.getByText('settings.providers.wizard.title'));
    expect(onClose).not.toHaveBeenCalled();
    const overlay = container.firstElementChild as HTMLElement;
    // 从弹窗内部按下、拖出到遮罩松开:合成 click 落在遮罩,但按下不始于遮罩,
    // 不得误关(防丢表单)。
    fireEvent.mouseDown(screen.getByText('settings.providers.wizard.title'));
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    // 按下与松开都在遮罩上:关闭。
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

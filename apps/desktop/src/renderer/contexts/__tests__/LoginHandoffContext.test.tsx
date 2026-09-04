// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LoginHandoff 衔接动画测试(implementation-plan Step 3b WHAT2/WHAT3)。
 *
 * - fake-timer 时序:settle 0.3s → shift 650ms → panel 420ms 上滑 20px →
 *   slogan +100ms/500ms(demo splashHandoff() 时间轴逐项对照;Slogan 最后出现);
 * - 冷启动每次播放、resize/reset 不重播、卸载清理;reduced-motion 直落终态;
 * - 两条冷启动集成(real AuthProvider + resolved snapshot,集成层禁 mock-reject
 *   ——异常路径由 AuthContext catch 归一为 resolved-unauthenticated,单测另测):
 *   unauthenticated = 完整播放;authenticated = 品牌淡出直入主界面不闪登录面板。
 */

const svc = vi.hoisted(() => ({
  // onAuthStateChange 捕获 listener,供集成测试模拟「登出推送」(auth:state-change)
  authListener: null as ((state: unknown) => void) | null,
  service: {
    initialize: vi.fn<() => Promise<unknown>>(),
    onAuthStateChange: vi.fn(),
    dispose: vi.fn(),
    getLoginState: vi.fn(async () => ({ ok: true, state: null })),
    dispatchLoginAction: vi.fn(async () => ({ ok: true, state: null })),
    logout: vi.fn(async () => {}),
  },
  loginHook: {
    isLoading: false,
    errorCode: null as string | null,
    loginState: {
      step: 'identifier',
      providers: { email: true, phone: true, attribution: 'email', social: [] },
    } as unknown,
    dispatch: vi.fn(async () => true),
    clearError: vi.fn(),
  },
  env: { status: 'passed' as string },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/authService', () => ({ createAuthService: () => svc.service }));
vi.mock('@/lib/makerChatStore', () => ({
  cancelRemoteOptimisticSendsForDataOwnerBoundary: vi.fn(),
  setCurrentUserName: vi.fn(),
}));
vi.mock('@/lib/sessionsStore', () => ({ sessionsStore: { reset: vi.fn() } }));
vi.mock('@/features/cc-agent/hooks/useWorkers', () => ({ clearWorkersCache: vi.fn() }));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => {}) }),
}));
vi.mock('@/hooks/useLogin', () => ({ useLogin: () => svc.loginHook }));
vi.mock('@/components/title-bar/WindowControls', () => ({ WindowControls: () => null }));
vi.mock('@/contexts/EnvCheckContext', () => ({
  useEnvCheck: () => ({
    status: svc.env.status,
    downloadProgress: 0,
    downloadInfo: { progress: 0 },
    updateVersion: undefined,
    step: undefined,
    totalSteps: undefined,
    resetSignal: 0,
    checkEnvironment: vi.fn(async () => {}),
  }),
}));
vi.mock('@/hooks/useUpdateStatus', () => ({ useUpdateStatus: () => ({ errorCode: undefined }) }));

import {
  LOGIN_HANDOFF_TIMINGS,
  LoginHandoffProvider,
  useLoginHandoff,
  type LoginHandoffContextValue,
} from '../LoginHandoffContext';
import { AuthProvider, useAuth } from '../AuthContext';
import { LoginBrandStage } from '@/components/login/LoginBrandStage';
import { SplashScreen } from '@/components/splash/SplashScreen';
import { LoginPage } from '@/components/login/LoginPage';
import { brandPlacement, panelPlacement } from '@/components/login/loginScale';

/* ── 探针:抓取 context 值供命令式驱动 ── */
const probe: { current: LoginHandoffContextValue | null } = { current: null };
function Probe() {
  probe.current = useLoginHandoff();
  return <div data-testid="handoff-phase">{probe.current.phase}</div>;
}

function setReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  probe.current = null;
  svc.env.status = 'passed';
  svc.loginHook.loginState = {
    step: 'identifier',
    providers: { email: true, phone: true, attribution: 'email', social: [] },
  };
  svc.authListener = null;
  svc.service.initialize.mockReset();
  svc.service.onAuthStateChange.mockReset();
  svc.service.onAuthStateChange.mockImplementation((cb: (state: unknown) => void) => {
    svc.authListener = cb;
    return () => {};
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    platform: 'darwin',
    onAuthSessionExpired: () => () => {},
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const T = LOGIN_HANDOFF_TIMINGS;

function fireAnchors() {
  act(() => {
    probe.current!.reportBrandAssetsReady();
    probe.current!.reportSplashExited();
  });
}

describe('LoginHandoff 时序(fake-timer)', () => {
  // 2026-09-03 移除登录后本 fork 恒走品牌淡出分支(原因见 LoginHandoffContext 文件头)。
  // 未登录那条四段编舞(settle→shift→panel→slogan)已不可达,但时序常量与 easing
  // 仍被 LoginPage / LoginBrandStage 的样式消费,继续在此锚定防漂。
  it('品牌 Splash 淡出 500ms 直落 done(brandExit 分支),不经四段编舞', () => {
    render(
      <LoginHandoffProvider authResolved authenticated={false}>
        <Probe />
      </LoginHandoffProvider>,
    );
    expect(probe.current!.phase).toBe('boot');

    fireAnchors();
    expect(probe.current!.branch).toBe('authenticated');
    expect(probe.current!.phase).toBe('brand-exit');
    expect(probe.current!.isPlaying).toBe(true);

    act(() => vi.advanceTimersByTime(T.brandExitMs - 1));
    expect(probe.current!.phase).toBe('brand-exit');
    act(() => vi.advanceTimersByTime(1));
    expect(probe.current!.phase).toBe('done');
    expect(probe.current!.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // 全程不经未登录分支的中间相
    expect(probe.current!.phase).not.toBe('awaiting-panel');
  });

  it('时序常量本体锚定(demo 逐字):300/650/420/100/500/brandExit 500 + 三条 easing', () => {
    expect(T.settleMs).toBe(300);
    expect(T.shiftMs).toBe(650);
    expect(T.panelMs).toBe(420);
    expect(T.panelRisePx).toBe(20);
    expect(T.sloganDelayMs).toBe(100);
    expect(T.sloganMs).toBe(500);
    expect(T.brandExitMs).toBe(500);
    expect(T.shiftEasing).toBe('cubic-bezier(.33,0,.18,1)');
    expect(T.panelEasing).toBe('cubic-bezier(.35,.1,.25,1)');
    expect(T.sloganEasing).toBe('cubic-bezier(.55,.06,.38,.96)');
  });

  // 回归守卫(本轮实际踩到的坑):启动期 owner 过渡会先广播一次 canEnterApp=false
  // 的边界态快照,若那一刻恰好与推进锚对齐,旧实现会把分支钉成 unauthenticated 并停在
  // awaiting-panel 等 LoginPage —— 而登录面板已随登录线下架,永远不会挂载,品牌 overlay
  // 就永久盖在最上层,表现是卡在开机动画里进不了应用。所以「宿主说没登录」也必须走完。
  it('宿主报未登录(启动期边界态瞬态)时仍走完淡出,不停在 awaiting-panel', () => {
    render(
      <LoginHandoffProvider authResolved authenticated={false}>
        <Probe />
      </LoginHandoffProvider>,
    );
    fireAnchors();
    // 永不上报面板挂载 —— 本 fork 里 LoginPage 不再被任何路由挂起来
    for (let round = 0; round < 4; round += 1) act(() => vi.runAllTimers());

    expect(probe.current!.phase).toBe('done');
    expect(probe.current!.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('完全不传 authenticated 也能走完(入参已不参与分支判定)', () => {
    render(
      <LoginHandoffProvider authResolved>
        <Probe />
      </LoginHandoffProvider>,
    );
    fireAnchors();
    expect(probe.current!.branch).toBe('authenticated');
    act(() => vi.advanceTimersByTime(T.brandExitMs));
    expect(probe.current!.phase).toBe('done');
  });

  it('冷启动每次播放但不重播:done 后重发锚/信号 phase 恒 done、无残留 timer', () => {
    render(
      <LoginHandoffProvider authResolved authenticated={false}>
        <Probe />
      </LoginHandoffProvider>,
    );
    act(() => probe.current!.reportLoginPanelMounted());
    fireAnchors();
    // phase 链每步在 effect 内续排 timer,分轮跑空直至收敛
    for (let round = 0; round < 4; round += 1) act(() => vi.runAllTimers());
    expect(probe.current!.phase).toBe('done');

    // 模拟 resize/reset 后各类信号重放:不重播
    fireAnchors();
    act(() => {
      probe.current!.reportLoginPanelUnmounted();
      probe.current!.reportLoginPanelMounted();
    });
    for (let round = 0; round < 4; round += 1) act(() => vi.runAllTimers());
    expect(probe.current!.phase).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('卸载清理:播放中途 unmount 清空全部在途 timer', () => {
    const view = render(
      <LoginHandoffProvider authResolved authenticated={false}>
        <Probe />
      </LoginHandoffProvider>,
    );
    fireAnchors();
    expect(probe.current!.phase).toBe('brand-exit');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prefers-reduced-motion: reduce 直落终态(无位移/无渐入过程)', () => {
    setReducedMotion(true);
    render(
      <LoginHandoffProvider authResolved authenticated={false}>
        <Probe />
      </LoginHandoffProvider>,
    );
    fireAnchors();
    // 不经 settle/shift/panel/slogan,直接 done;面板与 Slogan 即刻可见
    expect(probe.current!.phase).toBe('done');
    expect(probe.current!.panelRevealed).toBe(true);
    expect(probe.current!.sloganRevealed).toBe(true);
    expect(probe.current!.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('登录面板与品牌层通过 context 共享同一 bottom reserve', () => {
    render(
      <LoginHandoffProvider authResolved authenticated={false}>
        <Probe />
      </LoginHandoffProvider>,
    );
    expect(probe.current!.panelBottomReserve).toBeNull();
    act(() => probe.current!.reportPanelBottomReserve(124));
    expect(probe.current!.panelBottomReserve).toBe(124);
    act(() => probe.current!.reportPanelBottomReserve(0));
    expect(probe.current!.panelBottomReserve).toBe(0);
    act(() => probe.current!.reportPanelBottomReserve(null));
    expect(probe.current!.panelBottomReserve).toBeNull();
  });
});

/* ── 冷启动集成(real AuthProvider + LoginBrandStage + SplashScreen + LoginPage) ── */

function HandoffHost({ children }: { children: React.ReactNode }) {
  const { isInitializing, isAuthenticated, canEnterApp } = useAuth();
  return (
    <LoginHandoffProvider
      authResolved={!isInitializing}
      authenticated={isAuthenticated || canEnterApp}
    >
      {children}
    </LoginHandoffProvider>
  );
}

/**
 * GuestRoute 等价物:auth 未决/已登录不挂 LoginPage(路由层职责的测试内投影)。
 *
 * 注意这是**历史形态**的投影:2026-09-03 移除登录后 GuestRoute 与 /login 路由都已
 * 下架,产品里没有任何东西会挂 LoginPage 了。保留它只为继续覆盖 LoginPage 组件自身
 * 的布局/复位行为(组件文件按 pi-only 口径保留);要按**当前产品树**验入场动画的用例
 * 请用 renderColdStartWithoutLoginPanel()。
 */
function GuestGate() {
  const { isInitializing, isAuthenticated } = useAuth();
  if (isInitializing || isAuthenticated) return null;
  return <LoginPage />;
}

function renderColdStart() {
  return render(
    <AuthProvider>
      <HandoffHost>
        <LoginBrandStage />
        <SplashScreen />
        <GuestGate />
        <Probe />
      </HandoffHost>
    </AuthProvider>,
  );
}

/** 当前产品树:没有任何登录面板宿主,只有品牌层 + Splash。 */
function renderColdStartWithoutLoginPanel() {
  return render(
    <AuthProvider>
      <HandoffHost>
        <LoginBrandStage />
        <SplashScreen />
        <Probe />
      </HandoffHost>
    </AuthProvider>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function loadBrandAssets() {
  fireEvent.load(screen.getByTestId('login-brand-hero'));
  fireEvent.load(screen.getByTestId('login-brand-wordmark'));
  fireEvent.load(screen.getByTestId('login-slogan'));
}

describe('冷启动集成(resolved snapshot,禁 mock-reject)', () => {
  it('browser-redirect 无 footer 时，面板与品牌层统一使用 0 bottom reserve', async () => {
    svc.loginHook.loginState = { step: 'browser-redirect', label: 'Google' };
    svc.service.initialize.mockResolvedValue({
      isAuthenticated: false,
      isCanary: false,
      deviceId: 'test-device',
      user: null,
    });
    renderColdStart();
    await flush();

    expect(probe.current!.panelBottomReserve).toBe(0);
    expect(screen.queryByTestId('login-stage-footer')).toBeNull();

    const panel = panelPlacement(window.innerWidth, window.innerHeight, 1229, 0);
    expect(screen.getByTestId('login-stage').style.top).toBe(`${panel.topY}px`);

    const brand = brandPlacement(window.innerWidth, window.innerHeight, 0);
    expect(screen.getByTestId('login-brand-canvas').style.transform).toBe(
      `translate(-50%, calc(-50% + ${brand.translateY}px)) scale(${brand.scale})`,
    );
  });

  // 2026-09-03 移除登录后,「未登录 → 登录面板入场」这条集成路径已不存在:GuestGate
  // 的真身(GuestRoute + /login 路由)整块下架,LoginPage 不再被挂起来。这里改成守
  // **入场动画本身**在未登录快照下依然完整播放并让开主界面 —— 这正是用户要保留的东西。
  it('未登录快照下入场动画照样完整播放:品牌屏 → 3s 地板 → 淡出 → overlay 让开主界面', async () => {
    // 集成层异常路径口径 = resolved-unauthenticated snapshot(v6.8 消歧)
    svc.service.initialize.mockResolvedValue({
      isAuthenticated: false,
      isCanary: false,
      deviceId: 'test-device',
      user: null,
    });
    renderColdStartWithoutLoginPanel();
    await flush();

    // ── 冷启动品牌屏(demo desktop-splash 相):品牌可见、Slogan 未出现、
    //    Splash 统一面板在场 ──
    expect(screen.getAllByTestId('login-stage-root').length).toBe(1);
    const hero = screen.getByTestId('login-brand-hero');
    expect(hero.style.left).toBe('443px'); // wave4 品牌位 = 登录位(379:5xx 实测)
    expect(hero.style.top).toBe('275px');
    expect(screen.getByTestId('login-slogan').style.opacity).toBe('0');
    expect(screen.getByTestId('splash-panel')).toBeTruthy();
    // overlay 不拦截 hit-test
    expect(screen.getByTestId('login-stage-root').className).toContain('pointer-events-none');

    // ── 品牌资产 onload(推进锚) + 3s 地板后 Splash 退场 → 起播淡出 ──
    loadBrandAssets();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(probe.current!.branch).toBe('authenticated');
    expect(probe.current!.phase).toBe('brand-exit');
    // 淡出中:overlay 仍挂载(平滑),opacity → 0
    const overlay = screen.getByTestId('login-stage-root');
    expect(overlay.style.opacity).toBe('0');
    expect(overlay.style.transition).toContain('--splash-fade-duration');

    // splash fade 500ms 后统一面板卸载
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('splash-panel')).toBeNull();
    expect(probe.current!.phase).toBe('done');
    // 品牌 overlay 让开,主界面接管;全程没有停在中间相
    expect(screen.queryByTestId('login-stage-root')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('authenticated 冷启动:品牌 Splash 淡出直入主界面,不闪登录面板,overlay 平滑卸载', async () => {
    svc.service.initialize.mockResolvedValue({
      isAuthenticated: true,
      isCanary: false,
      deviceId: 'test-device',
      user: { id: 'u1', name: 'Tester' },
    });
    renderColdStart();
    await flush();

    // 已登录从不挂载 login panel
    expect(screen.queryByTestId('login-panel-stage-root')).toBeNull();
    expect(screen.queryByTestId(/^login-panel-/)).toBeNull();

    loadBrandAssets();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(probe.current!.branch).toBe('authenticated');
    expect(probe.current!.phase).toBe('brand-exit');
    // 淡出中:overlay 仍挂载(平滑),opacity → 0
    const overlay = screen.getByTestId('login-stage-root');
    expect(overlay.style.opacity).toBe('0');
    expect(overlay.style.transition).toContain('--splash-fade-duration');

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(probe.current!.phase).toBe('done');
    // overlay 卸载,主界面接管;全程未出现登录面板
    expect(screen.queryByTestId('login-stage-root')).toBeNull();
    expect(screen.queryByTestId('login-panel-stage-root')).toBeNull();
  });

  it('authenticated 冷启动 → 登出回 /login:品牌层重挂为终态(固定登录位/Slogan 直落可见/不重播)——P1 回归', async () => {
    svc.service.initialize.mockResolvedValue({
      isAuthenticated: true,
      isCanary: false,
      deviceId: 'test-device',
      user: { id: 'u1', name: 'Tester' },
    });
    renderColdStart();
    await flush();

    // 走完 authenticated 冷启动:brand-exit 淡出 → done,overlay 卸载
    loadBrandAssets();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(probe.current!.phase).toBe('done');
    expect(screen.queryByTestId('login-stage-root')).toBeNull();

    // 登出:auth:state-change 推送未登录快照 → GuestGate 挂 LoginPage(/login)
    await act(async () => {
      svc.authListener!({
        isAuthenticated: false,
        isCanary: false,
        deviceId: 'test-device',
        user: null,
      });
    });

    // 品牌层重挂(它是背景/立绘/字标/Slogan 唯一渲染者,缺席 = 悬空白面板)
    const overlay = screen.getByTestId('login-stage-root');
    expect(overlay.className).toContain('pointer-events-none');
    // 终态:品牌固定登录位、Slogan 直落可见且无入场过渡(不重播,playedRef 语义)
    const hero = screen.getByTestId('login-brand-hero');
    expect(hero.style.left).toBe('443px');
    expect(hero.style.top).toBe('275px');
    const slogan = screen.getByTestId('login-slogan');
    expect(slogan.style.opacity).toBe('1');
    expect(slogan.style.transition).toBe('');
    // 登录面板同样直落终态可点击,无入场动画重播
    const group = screen.getByTestId('login-group');
    expect(group.style.opacity).toBe('1');
    expect(group.style.transform).toBe('translateY(0px)');
    expect(group.style.transition).toBe('');
    expect(group.style.pointerEvents).not.toBe('none');
    // phase 恒 done;跑空全部在途 timer(仅剩 jsdom input focus 的 0ms 内部 timer)
    // 后 phase/视觉零变化 = 不重播(playedRef 语义)
    expect(probe.current!.phase).toBe('done');
    act(() => vi.runAllTimers());
    expect(probe.current!.phase).toBe('done');
    expect(screen.getByTestId('login-slogan').style.opacity).toBe('1');
    expect(screen.getByTestId('login-group').style.opacity).toBe('1');
    expect(screen.getByTestId('login-stage-root')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('local cold start uses the entered-app handoff branch', async () => {
    svc.service.initialize.mockResolvedValue({
      isAuthenticated: false,
      mode: 'local',
      dataOwnerId: 'local-v1',
      canEnterApp: true,
      isCanary: false,
      deviceId: 'test-device',
      user: null,
    });
    renderColdStart();
    await flush();

    loadBrandAssets();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(probe.current!.branch).toBe('authenticated');
    expect(probe.current!.phase).toBe('brand-exit');
  });
});

/**
 * PiCliInstallGate — 登录后检查本机是否装了 Pi CLI(`~/.pi/agent`),缺失则弹一次
 * 安装提示。
 *
 * 为什么需要:设置页的六个 Pi 面板(仪表盘 / 任务 / 记忆 / 子代理 / 测速 / 扩展)全部
 * 从 `~/.pi/agent` 读数据。没装 Pi CLI 时它们只会显示空态,用户无从知道"是没装"还是
 * "真没数据"。登录后主动提示一次,比让用户逐个面板猜要诚实。
 *
 * 边界:
 *   - **提示而非阻断**:Cindy 自身、既有任务、其余设置分区都照常可用。Cindy 跑任务用的
 *     是自带的受管 pi 二进制,与用户的 Pi CLI 安装是两套独立数据。
 *   - **每个账号只提示一次**:勾了「不再提示」就永久记住(localStorage);没勾则下次
 *     登录还会提示,因为那时可能已经装好了。
 *   - 探测只发生在登录后:未登录时设置页不可达,提示没有落点。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const log = createLogger('PiCliInstallGate');

const STORAGE_KEY = 'piCliInstall.promptDismissedAt';
const PI_INSTALL_DOCS_URL = 'https://github.com/earendil-works/pi';

function isPromptDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) != null;
  } catch {
    // localStorage 不可用(隐私模式 / 配额):按"未 dismiss"处理。多提示一次可以接受,
    // 静默吞掉提示不行 —— 用户会一直对着空面板。
    return false;
  }
}

function dismissPrompt(): void {
  try {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
    // 写不进去就只在本次会话内生效(下面的 dismissed state 已置位)。
  }
}

export function PiCliInstallGate() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  // 每次登录态只探测一次:探测本身很轻,但重复弹窗很烦。
  const probedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      // 登出后允许下次登录重新探测(可能期间刚装好)。
      probedRef.current = false;
      setOpen(false);
      return;
    }
    if (probedRef.current) return;
    probedRef.current = true;
    if (isPromptDismissed()) return;

    let cancelled = false;
    void (async () => {
      try {
        const status = await window.electronAPI.maker.piAgent.installStatus();
        if (cancelled || status.installed) return;
        setOpen(true);
      } catch (err: unknown) {
        // 探测失败不提示:IPC 抖动时弹一个"你没装 Pi"是错误信息。
        log.warn('pi install probe failed; skipping the install prompt', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const handleConfirm = useCallback((opts?: { dontShowAgain?: boolean }) => {
    if (opts?.dontShowAgain) dismissPrompt();
    setOpen(false);
    void window.electronAPI.openExternal(PI_INSTALL_DOCS_URL);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  if (!open) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('settings.piInstall.dialogTitle')}
      description={t('settings.piInstall.dialogBody')}
      confirmText={t('settings.piInstall.dialogConfirm')}
      cancelText={t('settings.piInstall.dialogCancel')}
      dontShowAgainLabel={t('settings.piInstall.dialogDontShowAgain')}
      autoFocusConfirm
      onConfirm={handleConfirm}
    />
  );
}

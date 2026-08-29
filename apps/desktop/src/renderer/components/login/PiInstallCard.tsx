import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { extractIpcError } from '@/utils/ipcError';
import { toast } from '@/lib/toast';
import { Spinner } from '@/components/ui/spinner';

import type { LocalPiStatus } from '../../../main/pi-agent/localPi';

/**
 * 登录页「本机 pi 未安装」一键安装引导(Pi-first 改造 Phase 4)。
 *
 * 挂载时查询 maker:pi-local:status;本机已有 pi 则不渲染任何内容。未安装时展示
 * 引导卡片:一键安装复用受管下载链(进度走 binary-download-progress 广播),
 * 落盘 ~/.pi/bin 后 force 重探;失败按统一 IPC 错误码映射文案。
 * main 进程尚未探测出结果(启动早期)时同样不渲染,避免闪烁。
 */

const PI_VENDOR = 'pi';

export function PiInstallCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LocalPiStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const api = window.electronAPI?.maker?.piLocal;
    if (api) {
      void api
        .getStatus()
        .then((raw) => {
          if (mountedRef.current) setStatus(raw as LocalPiStatus);
        })
        .catch(() => {
          /* 探测失败按未渲染处理,下轮挂载再试 */
        });
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!installing) return;
    return window.electronAPI.onBinaryDownloadProgress((next) => {
      if (next?.vendor !== PI_VENDOR) return;
      // progress 已是 0-100(main 侧 ProgressNormalizer 归一)。
      if (typeof next.progress === 'number') setPercent(Math.round(next.progress));
    });
  }, [installing]);

  const handleInstall = useCallback(async () => {
    const api = window.electronAPI?.maker?.piLocal;
    if (!api || installing) return;
    setInstalling(true);
    setPercent(null);
    try {
      const installed = (await api.install()) as LocalPiStatus | undefined;
      if (installed?.installed) {
        setStatus(installed);
        setDone(true);
        toast.success(t('login.piInstall.successToast'));
      } else {
        toast.error(t('login.piInstall.verifyFailed'));
      }
    } catch (err) {
      const code = extractIpcError(err)?.code;
      toast.error(
        t(
          code === 'PI_INSTALL_DOWNLOAD_FAILED'
            ? 'login.piInstall.downloadFailed'
            : code === 'PI_INSTALL_VERIFY_FAILED'
              ? 'login.piInstall.verifyFailed'
              : 'login.piInstall.installFailed',
        ),
      );
    } finally {
      setInstalling(false);
    }
  }, [installing, t]);

  // 已安装 / 探测未就绪(main 缓存未回填)/ 安装完成:都不再占位。
  if (status === null || status.installed || done) return null;

  return (
    <div
      data-testid="login-pi-install-card"
      className="mx-auto w-full max-w-[420px] rounded-xl border p-4 text-left"
      style={{
        backgroundColor: 'var(--surface-elevated)',
        borderColor: 'var(--border-default)',
      }}
    >
      <p className="text-14 font-medium" style={{ color: 'var(--text-primary)' }}>
        {t('login.piInstall.title')}
      </p>
      <p className="mt-1 text-13 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t('login.piInstall.description')}
      </p>
      {installing ? (
        <div className="mt-3 flex items-center gap-2" aria-live="polite">
          <Spinner size={14} />
          <span className="text-13" style={{ color: 'var(--text-secondary)' }}>
            {percent === null
              ? t('login.piInstall.installing')
              : t('login.piInstall.installingPercent', { percent })}
          </span>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="select-none self-start rounded-full px-5 py-2 text-13 font-medium transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)]"
            style={{ backgroundColor: 'var(--accent-cta-bg)', color: 'var(--accent-pure-cta-fg)' }}
          >
            {t('login.piInstall.installButton')}
          </button>
          <span className="text-12" style={{ color: 'var(--text-tertiary)' }}>
            {t('login.piInstall.manualHint')}
          </span>
        </div>
      )}
    </div>
  );
}

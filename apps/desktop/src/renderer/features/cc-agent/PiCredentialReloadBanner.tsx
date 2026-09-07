/**
 * PiCredentialReloadBanner —— Pi 供应商密钥变更后的任务窗口提示条。
 *
 * 机制（piCredentialReload「方案 B」）：设置里改了某个供应商的 key 后，main 把
 * 引用该供应商的**运行中**本地 pi 会话标记为 stale 并广播 PROVIDER_CHANGED（带
 * affectedProviderIds）。本条在对应任务窗口顶部非模态提示：该任务下一次发送消息
 * 时会自动重载 Pi（关旧 handle → 按 DB 行重建，对话记录保留），新 key 随之生效。
 *
 * 交互约定（与用户确认的 MVP）：
 *   · 无按钮 —— 重载全自动，发生在下一次发送的分发路径上；
 *   · 不打断进行中的回合：回合运行中标记保留，下个空闲发送边界再重载；
 *   · 本轮 turn 开始（重载已完成）或切换任务后自动消失。
 *
 * 颜色走语义 token（Light/Dark 同一套），不硬编码。
 */

import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';

export function PiCredentialReloadBanner() {
  const { t } = useTranslation();
  return (
    <div
      className="flex select-none items-center gap-2 border-b border-[var(--border-default)] bg-[var(--surface-chip)] px-4 py-1.5"
      role="status"
    >
      <KeyRound size={12} strokeWidth={1.75} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
      <span className="flex-1 truncate text-12 text-[var(--text-secondary)]">
        {t('ccAgent.piCredentialReload.notice')}
      </span>
    </div>
  );
}

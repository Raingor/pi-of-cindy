/**
 * SessionIdsIndicator —— composer 上方的「任务 ID / Intercom ID」信息条。
 *
 * 与 GoalIndicator / PlanModeIndicator 同形(同一位置、同 chip 外形),但它是
 * **纯信息、无动作**的一条:只展示两个 id,点一下复制。
 *
 * 为什么两个 id 都要露出:跨会话协同(pi-intercom)要用 pi 运行时 session id 定位
 * 对端,而排查 Cindy 侧的任务数据要用 Cindy 任务 ID —— 两者不同,凭记忆换算不了,
 * 只能直接给。
 *
 * Intercom ID 取不到(非 pi 任务,或该任务还没启动过 pi、`sdk_session_id` 还是空)
 * 时只显示任务 ID,不占位显示占位符。
 *
 * 展示形式两边不同:任务 ID 走 CSS 截断(它可能是 `pi-<时间戳>_<uuid>` 这种长
 * 形式,前 8 位全是 `pi-2026-` 区分不了);Intercom ID 取前 8 位 —— 与
 * `intercom list` 展示的 `(01a05fc6)` 同口径,照着忽就能对上。两边点一下都复制**完整**值。
 *
 * 颜色全走主题 token:surface-chip / border-default,文字层次与同位置的
 * PlanModeIndicator 完全对齐 —— 标题位（这里是字段名）用 `--text-secondary`，正文位
 * （这里是 id 本体）用 `--text-tertiary`。cindy 两个皮肤里 tertiary 比 secondary 更醒目
 * （浅色 #6B6B67 vs #888883，深色 #C1C1C1 vs #6F6F6F），正好让 id 本身压过字段名。无语义色。
 */

import { useTranslation } from 'react-i18next';

import { Tip } from '@/components/ui/tooltip';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { shortRuntimeId, type SessionRuntimeIds } from '../lib/sessionRuntimeIds';

interface SessionIdsIndicatorProps {
  ids: SessionRuntimeIds | null;
}

function IdPiece({
  label,
  value,
  /** 展示形式:short = 前 8 位(与 `intercom list` 同口径);truncate = 全值 CSS 截断。 */
  display,
  copiedMessage,
}: {
  label: string;
  value: string;
  display: 'short' | 'truncate';
  copiedMessage: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const copy = (): void => {
    // 复制**完整** id,展示截断只是省空间 —— 截断值粘出去没用。
    navigator.clipboard.writeText(value).then(
      () => toast.success(copiedMessage),
      () => toast.error(t('ccAgent.sessionIds.copyFailed')),
    );
  };
  return (
    <Tip text={value} mono side="top">
      <button
        type="button"
        onClick={copy}
        aria-label={`${label} ${value}`}
        className={cn(
          'flex min-w-0 shrink items-center gap-1 rounded px-1 py-0.5 transition-colors',
          'hover:bg-[var(--surface-elevated)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)]',
        )}
      >
        <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span
          className={cn('font-mono', display === 'truncate' ? 'max-w-[24ch] truncate' : 'shrink-0')}
          style={{ color: 'var(--text-tertiary)' }}
        >
          {display === 'short' ? shortRuntimeId(value) : value}
        </span>
      </button>
    </Tip>
  );
}

export function SessionIdsIndicator({ ids }: SessionIdsIndicatorProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (!ids) return null;
  return (
    <div
      className="mx-auto flex max-w-full select-none items-center gap-2 rounded-lg px-2.5 py-1 text-11"
      style={{
        backgroundColor: 'var(--surface-chip)',
        border: '1px solid var(--border-default)',
      }}
    >
      <IdPiece
        label={t('ccAgent.sessionIds.sessionLabel')}
        value={ids.sessionId}
        display="truncate"
        copiedMessage={t('ccAgent.sessionIds.sessionCopied')}
      />
      {ids.intercomId && (
        <>
          <span aria-hidden className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
            ·
          </span>
          <IdPiece
            label={t('ccAgent.sessionIds.intercomLabel')}
            value={ids.intercomId}
            display="short"
            copiedMessage={t('ccAgent.sessionIds.intercomCopied')}
          />
        </>
      )}
    </div>
  );
}

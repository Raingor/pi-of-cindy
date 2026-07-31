/**
 * PiMark —— pi (pi.dev) harness 身份 mark:几何化 π 字形(顶部横梁 + 左右两腿),
 * 单色 currentColor,跟随主题/状态染色。与 ClaudeMark(实心像素脸)/ CodexMark
 * (描边花形 + `>_`)并列,用于 sidebar VendorIcon 与 ModelSelector 的 Agent 身份区分。
 *
 * 设计:实心填充(fill=currentColor)以在小尺寸(12px)保持与实心 Claude 像素脸
 * 一致的视觉重量;顶梁略出头、两腿等宽,右腿收一个小脚呼应经典 π 字形。
 * 无彩色 brand variant(pi 无官方彩标),渲染层按需用 colorClassName 染色。
 */

interface PiMarkProps {
  size?: number;
  className?: string;
}

export function PiMark({ size = 14, className }: PiMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* 顶部横梁 */}
      <rect x="3.5" y="5.5" width="17" height="2.8" rx="1.2" fill="currentColor" />
      {/* 左腿 */}
      <rect x="6.6" y="7.6" width="2.8" height="11" rx="1.2" fill="currentColor" />
      {/* 右腿(略窄的脚,收在底部) */}
      <path
        fill="currentColor"
        d="M14.2 7.6h2.8v8.2c0 .7.2 1 .8 1 .3 0 .6-.05.9-.16l.5 2.3c-.6.24-1.2.36-1.9.36-2 0-3-1.05-3-3.1z"
      />
    </svg>
  );
}

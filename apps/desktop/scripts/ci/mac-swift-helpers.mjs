/**
 * macOS Swift helper 的「精简打包」开关。
 *
 * 背景:Cindy 打包时要现场用 `swiftc` 编译 6 个 macOS 原生 helper(灵动岛、
 * 权限引导、语音输入 ×2、手柄、会话拖拽)。这要求打包机有**可用的**
 * Command Line Tools —— CLT 的编译器与 SDK 版本错配时(Apple 拆开升级导致)
 * 任何 Swift 编译都失败,整个打包被这一步卡死,即使用户根本不用这些功能。
 *
 * 本开关允许显式放弃指定 helper 换取「能打出包」:
 *
 *   CINDY_SKIP_MAC_SWIFT_HELPERS=all                       跳过全部
 *   CINDY_SKIP_MAC_SWIFT_HELPERS=agent-island,voice-input  跳过指定几个
 *
 * **代价必须知情**:被跳过的 helper 对应的功能在装出来的包里是**静默失效**的
 * —— packaged 应用只从 `resources/tools/` 读预编译产物(dev 模式才会运行时
 * 现场编译),用户机器上没有 swiftc,装完也救不回来。各 native host 都有
 * existsSync / catch 兜底,所以表现是「功能不工作 + 日志报错」,不是崩溃。
 *
 * 因此这**只适合本机自用 / 归档包**,不能作为对外发布产物 —— 与 versionless
 * (0.0.0)包的定位一致。真正的解法是修好 CLT:
 *   sudo softwareupdate --install "Command Line Tools for Xcode 26.x"
 *
 * iOS Simulator helper 不在本开关内:它已有自己的降级路径(SimulatorKit 缺失
 * 时策略层判 unsupported,应用回退 WDA/MJPEG),见
 * packages/ios-simulator-runtime/scripts/native-sidecar-build-policy.mjs。
 */

/** helper key → 跳过后失效的功能(warning 文案与 README 同源)。 */
export const MAC_SWIFT_HELPERS = {
  'agent-island': 'Dynamic Island (灵动岛悬浮窗与其交互)',
  'computer-permission-guide': '自动操作的系统权限引导弹窗',
  'voice-input': '语音输入(文本插入 + 修饰键监听)',
  'xbox-gamepad': 'Xbox 手柄操控',
  'session-drag-release': '会话拖拽释放预览',
};

const ALL_KEYS = Object.keys(MAC_SWIFT_HELPERS);

/** `all` / `1` / `true` 都表示「全部跳过」。 */
const SKIP_ALL_ALIASES = new Set(['all', '1', 'true', 'yes']);

/**
 * 解析开关值 → 要跳过的 helper 集合。
 *
 * 未知 key 直接抛错(不静默忽略):拼错时要么以为跳过了其实没跳(打包仍被
 * swiftc 卡死,错误指向 swiftc 而非拼写),要么以为保留了其实跳了(装出来
 * 缺功能却不知道)—— 两个方向都是坑,显式失败最省事。
 */
export function resolveSkippedMacSwiftHelpers(raw) {
  const value = raw?.trim();
  if (!value) return new Set();
  if (SKIP_ALL_ALIASES.has(value.toLowerCase())) return new Set(ALL_KEYS);
  const out = new Set();
  for (const token of value.split(/[,\s]+/).filter(Boolean)) {
    const key = token.toLowerCase();
    if (!(key in MAC_SWIFT_HELPERS)) {
      throw new Error(
        `[forge] CINDY_SKIP_MAC_SWIFT_HELPERS 含未知 helper "${token}";可选值:${ALL_KEYS.join(' / ')} 或 all`,
      );
    }
    out.add(key);
  }
  return out;
}

/** 打包结尾的汇总文案(每行一条被放弃的功能)。空集合返回空数组。 */
export function describeSkippedMacSwiftHelpers(skipped) {
  return ALL_KEYS.filter((key) => skipped.has(key)).map(
    (key) => `${key} — ${MAC_SWIFT_HELPERS[key]}`,
  );
}

/** 见 mac-swift-helpers.mjs 的头注:「精简打包」开关的类型面。 */

export const MAC_SWIFT_HELPERS: Record<string, string>;

export type MacSwiftHelperKey =
  | 'agent-island'
  | 'computer-permission-guide'
  | 'voice-input'
  | 'xbox-gamepad'
  | 'session-drag-release';

export function resolveSkippedMacSwiftHelpers(
  raw: string | undefined,
): Set<MacSwiftHelperKey>;

export function describeSkippedMacSwiftHelpers(
  skipped: ReadonlySet<MacSwiftHelperKey>,
): string[];

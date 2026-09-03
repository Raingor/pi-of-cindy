/**
 * 「精简打包」开关的口径锁(CINDY_SKIP_MAC_SWIFT_HELPERS)。
 *
 * 这个开关是知情放弃功能换取「能打出包」的旁路,两个方向都不能错:
 *   - 拼错 key 必须显式失败 —— 否则要么以为跳过了其实没跳(打包仍被 swiftc
 *     卡死,报错指向 swiftc 让人查错方向),要么以为保留了其实跳了(装出来
 *     缺功能却不知道);
 *   - 「语音输入」是一个功能两个 helper,必须共用同一个 key,不能出现只跳一半
 *     (文本插入没了但修饰键监听还在)的半残状态。
 */

import { describe, expect, it } from 'vitest';

import {
  MAC_SWIFT_HELPERS,
  describeSkippedMacSwiftHelpers,
  resolveSkippedMacSwiftHelpers,
} from '../../../scripts/ci/mac-swift-helpers.mjs';

describe('resolveSkippedMacSwiftHelpers', () => {
  it('缺省 / 空值不跳过任何 helper(完整包是默认行为)', () => {
    for (const raw of [undefined, '', '   ']) {
      expect(resolveSkippedMacSwiftHelpers(raw).size).toBe(0);
    }
  });

  it('all / 1 / true / yes 跳过全部', () => {
    for (const raw of ['all', 'ALL', '1', 'true', 'yes']) {
      expect(resolveSkippedMacSwiftHelpers(raw)).toEqual(
        new Set(Object.keys(MAC_SWIFT_HELPERS)),
      );
    }
  });

  it('逗号 / 空格分隔的具体 key', () => {
    expect(resolveSkippedMacSwiftHelpers('agent-island,voice-input')).toEqual(
      new Set(['agent-island', 'voice-input']),
    );
    expect(resolveSkippedMacSwiftHelpers('xbox-gamepad session-drag-release')).toEqual(
      new Set(['xbox-gamepad', 'session-drag-release']),
    );
  });

  it('未知 key 显式抛错,不静默忽略', () => {
    expect(() => resolveSkippedMacSwiftHelpers('agent-islandd')).toThrow(
      /未知 helper "agent-islandd"/,
    );
    // 混在合法值里也要抛 —— 部分生效比全不生效更难查。
    expect(() => resolveSkippedMacSwiftHelpers('voice-input,typo')).toThrow(/未知 helper/);
  });

  it('iOS Simulator helper 不属于本开关(它有自己的降级路径)', () => {
    expect(Object.keys(MAC_SWIFT_HELPERS)).not.toContain('ios-simulator');
    expect(() => resolveSkippedMacSwiftHelpers('ios-simulator')).toThrow(/未知 helper/);
  });
});

describe('describeSkippedMacSwiftHelpers', () => {
  it('每条都写明放弃了哪个功能', () => {
    const lines = describeSkippedMacSwiftHelpers(new Set(['agent-island']));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('agent-island');
    expect(lines[0]).toContain(MAC_SWIFT_HELPERS['agent-island']);
  });

  it('空集合返回空数组(完整包不打汇总)', () => {
    expect(describeSkippedMacSwiftHelpers(new Set())).toEqual([]);
  });
});

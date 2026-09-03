export const IOS_SIMULATOR_HELPER_BUILD_RESULT_FILENAME = "build-result.json";
export const IOS_SIMULATOR_HELPER_UNSUPPORTED_REASON =
  "simulator-kit-architecture-unavailable";
/**
 * SimulatorKit.framework 在 developer dir 里整个不存在(只装了 Command Line
 * Tools、没有完整 Xcode 的机器)。与上面那个 reason 刻意分开:上面表示
 * 「framework 在、但没有目标切片」,读侧据此要求架构列表非空;这里表示
 * 「framework 不在」,架构列表必然为空。混用一个 reason 会让读侧的
 * fail-closed 校验无法区分「真的没切片」和「探测本身没做成」。
 */
export const IOS_SIMULATOR_HELPER_FRAMEWORK_MISSING_REASON =
  "simulator-kit-framework-unavailable";

export function parseMachOArchitectures(value) {
  return [
    ...new Set(
      String(value ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];
}

function simulatorKitSupportsArchitecture(architectures, targetArchitecture) {
  if (targetArchitecture === "arm64") {
    return architectures.includes("arm64") || architectures.includes("arm64e");
  }
  return architectures.includes(targetArchitecture);
}

export function decideNativeSidecarBuild({
  outputMode,
  targetArchitecture,
  simulatorKitArchitectures,
}) {
  const targetArchitectures =
    targetArchitecture === "universal"
      ? ["x86_64", "arm64"]
      : [targetArchitecture];
  const missingArchitectures = targetArchitectures.filter(
    (candidate) =>
      !simulatorKitSupportsArchitecture(simulatorKitArchitectures, candidate),
  );

  if (missingArchitectures.length === 0) {
    return { action: "build", targetArchitectures };
  }

  if (
    outputMode === "helper" &&
    targetArchitecture === "x86_64" &&
    missingArchitectures.length === 1 &&
    missingArchitectures[0] === "x86_64"
  ) {
    return {
      action: "unsupported",
      targetArchitectures,
      // 空架构列表 = 探测发现 framework 整个不存在(CLT-only 机器),与
      // 「framework 在但缺 x86_64 切片」分开上报,读侧的校验口径不同。
      reason:
        simulatorKitArchitectures.length === 0
          ? IOS_SIMULATOR_HELPER_FRAMEWORK_MISSING_REASON
          : IOS_SIMULATOR_HELPER_UNSUPPORTED_REASON,
    };
  }

  throw new Error(
    `SimulatorKit is missing required architecture(s): ${missingArchitectures.join(", ")}`,
  );
}

# 进度日志

## 2026-08-29
- 完成计划设计和审批
- Phase 1: Main Process 基础设施 — 完成（piTypes, piReader, piUsageParser, IPC handlers）
- Phase 2: Pi Dashboard tab — 完成
- Phase 3: Pi Sessions tab — 完成
- Phase 4: Pi Memory tab — 完成
- Phase 5: Pi Subagents tab — 完成
- Phase 6: Pi Speed Test tab — 完成
- Phase 7: Pi Packages tab — 完成
- Phase 8: Config import/export — 完成
- Phase 9: Enabled Models panel + UI scaling — 完成
- 修复：pi-packages tab 缺失渲染块
- 修复：Magnify → Search icon（lucide-react 无 Magnify 导出）
- 修复：readSettings() 类型断言
- typecheck 通过

## 2026-08-29 第二轮（Pi-first 改造，接续 Qoder 会话 3f91578b）
- Phase 1: 隐藏 Settings 六个入口（usage / voice-input / im-bot / import / ghosts / builtin-tools）— 完成
  - tabLabels.ts 移除 TAB_IDS 条目；id 保留在类型与 TAB_LABEL_KEY 供旧深链
  - SettingsView.tsx 删对应渲染块与 legacy 重定向；旧深链经 isSettingsTab 自然回落 general
  - SettingsSidebarNav 清理 TAB_ICON；补测试断言六个入口不再渲染
  - 后端模块与组件文件全部保留未删
  - 验证：desktop typecheck 通过；pnpm test:unit:related 435 过 0 失败
- Phase 2: 移除 codex/claude OAuth 入口 — 完成
  - ProvidersSection：删除 AnthropicHeader；OpenAiHeader 改为仅管理图像平台 key 的
    OpenAiImagesHeader；anthropic 行整体不再占行，openai 仅在声明图像清单时占行
  - 移除 useCodexAuth / reconnect-required / Claude.ai 登录登出按钮与 CLI 检测建议中的
    anthropic/openai（RETIRED_OAUTH_PROVIDER_IDS）；?connect= 深链对下架渠道吞参数不开向导
  - AddProviderWizard：oauthChoices 只留 xai + 通用 OAuth；删除 anthropic/openai 授权、
    取消、设备码与 openai 收口 effect；handleAuthorize 去掉 mode 参数
  - 测试：删除 4 个 OpenAI 授权边界用例 + addProviderWizardOpenaiEntry.test.tsx（行为已下架）；
    深链/建议行/检测用例改写为断言下架行为
  - 验证：desktop typecheck 通过；pnpm test:unit:related 全过
- Phase 3: 本机 pi 探测 + 状态 IPC + resolvePiBinaryPath 改本机解析 — 完成
  - 新模块 main/pi-agent/localPi.ts：标准位置(~/.local/bin、~/.pi/bin、/opt/homebrew、
    /usr/local、Win 用户目录)+ PATH 探测，`--version` 验证，缓存 + 并发去重
  - resolvePiBinaryPath / pi-package-store / binary-version IPC 全部改读探测缓存；
    bootstrap 不再下载捆绑 pi（splash pi 段改为本机探测，失败不阻塞启动）
  - 新 IPC maker:pi-local:status（PI_LOCAL_STATUS，piAgentHandlers 注册，preload piLocal）
  - pi-harness.md §6 不变量按新决策重写；piBinaryDistribution 契约测试改钉新不变量
  - 验证：desktop typecheck 通过；pnpm test:unit:related 全过（含 localPi 5 个新单测）

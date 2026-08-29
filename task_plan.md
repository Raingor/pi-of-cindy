# Cindy → Pi-First 改造任务计划（第二轮）

## 目标（用户指令 2026-08-29）
1. codex 和 claude 的设置不再保留
2. 移除 Cindy 原带的：用量历史、语音输入、IM机器人、任务导入、插件、工具（仅隐藏 UI 入口，后端保留）
3. PI 扩展包页显示本机 pi 的扩展包（~/.pi/agent）
4. 不沿用 Cindy 捆绑的 PI，运行时只调用本机 pi；缺失时报错 + 引导安装
5. 登录界面：用户未安装 PI 时一键安装引导
6. pi-web-switch 的提供商与模型管理融入（读写 ~/.pi/agent 的 settings/models/auth）

## 用户已确认的决策（AskUserQuestion）
- 移除深度：**仅隐藏 UI 入口**，main 进程模块保留
- pi 二进制：**仅用本机 pi**，缺失时报错 + 引导安装（不用捆绑兜底）
- 数据目录：**全切到 ~/.pi/agent**（运行时 + 扩展包 + 会话共用一份真实数据）
- 供应商：**替换为 pi-web-switch 模型**（ProvidersSection 数据层换为 ~/.pi/agent JSON）

## 关键代码锚点（来自探索）
- `main/maker-host/pi-host.ts:738` `resolvePiBinaryPath()` = `getReadyBinaryPath('pi')`（要改）
- `main/maker-host/pi-host.ts:1618` `buildPiAgent()`、`:1642-1650` `resolvePiAgentHome` 注入（userData/pi-agent-home，要改 ~/.pi/agent）
- `main/agent-binaries/index.ts:197-207` pi CONFIG、`:234` getReadyBinaryPath、`:316` prepare
- `packages/maker-core/src/agents/pi/index.ts:1284` resolveAgentHome、`:2106` PI_CODING_AGENT_DIR=agentHome/run-tmp/<hex>、writeModelsJson 挂 `cindy` provider
- `main/maker-host/pi-package-store.ts:283` packageHome()=userData/pi-package-home、`:528` spawn env PI_CODING_AGENT_DIR
- `main/pi-agent/piReader.ts:58` PI_DIR=~/.pi/agent（移植的数据层，已对齐）
- `renderer/components/login/LoginPage.tsx` 登录页
- `renderer/components/settings/LocalOllamaInstall.tsx` 一键安装参考样板
- `renderer/hooks/useVendorAuthGate.ts:99-124` 'pi-binary-missing' 文案已存在
- ProvidersSection.tsx: codex block ~561、claude OAuth block ~465
- tabLabels.ts TAB_IDS :38-71；SettingsSidebarNav TAB_ICON :66-89

## 阶段

### Phase 1: 隐藏 Settings UI 入口 [in_progress]
- [ ] tabLabels.ts 移除：usage、voice-input、im-bot、import、ghosts、builtin-tools
- [ ] SettingsView.tsx 移除对应 import + 渲染块
- [ ] SettingsSidebarNav 图标条目（数据驱动，TAB_IDS 删了即隐藏，核对）
- [ ] 保留组件与后端模块不删
- [x] typecheck + test:unit:related

### Phase 2: 移除 codex/claude OAuth 入口 [done 2026-08-29]
- [x] ProvidersSection.tsx 移除 Anthropic OAuth 块（~465-560）与 OpenAI/Codex 块（~561+）
- [x] 核对 AddProviderWizard 目录里的 claude/codex 条目
- [x] typecheck

### Phase 3: 本机 pi 二进制解析 + 状态 IPC [done 2026-08-29]
- [x] 新模块：系统 pi 探测（PATH + ~/.local/bin + /opt/homebrew/bin），返回 {installed, path, version}
- [x] `resolvePiBinaryPath()` 改为仅返回本机 pi 路径（用户已确认的行为变更，更新相关注释）
- [x] 停用/跳过 pi 捆绑二进制的 prepare 下载
- [x] 新 IPC：`maker:pi-local:status` 供登录页与设置页查询
- [x] pi 缺失时任务创建报错 + 文案引导安装

### Phase 4: 登录页一键安装 PI [done 2026-08-29]
- [x] LoginPage 检测 pi 状态（挂载时查）
- [x] 未安装 → 安装引导卡片（参考 LocalOllamaInstall 样板）
- [x] 一键安装：下载 pi release（复用 agent-binaries 下载逻辑）→ 安装到 ~/.local/bin/pi → 验证
- [x] i18n 5 语言

### Phase 5: 数据目录全切 ~/.pi/agent [pending]
- [ ] `resolvePiAgentHome` 注入改为 ~/.pi/agent
- [ ] 处理 models.json 冲突：不得覆盖用户真实 models.json（评估合并/改名策略）
- [ ] pi-package-store packageHome 改 ~/.pi/agent，扩展包页显示本机扩展
- [ ] 会话落到 ~/.pi/agent/sessions（与 Pi Sessions tab 数据对齐）
- [ ] 真机验证：跑一个 pi 任务，确认数据落 ~/.pi/agent

### Phase 6: 供应商替换为 pi-web-switch 模型 [pending]
- [ ] main：读 ~/.pi/agent 的 settings/models/auth，内置目录来自 @earendil-works/pi-ai
- [ ] ProvidersSection 重构：列表/详情/启停模型全部走 JSON 文件
- [ ] 自定义供应商 9 种 API 格式（从 ProvidersModelsPage 移植）
- [ ] auth.json 密钥管理（注意：明文存 ~/.pi/agent，与 Cindy safeStorage 不同，需提示）
- [ ] enabledModels 与已移植的 EnabledModelsPanel 对齐

## 风险
1. **覆盖用户 models.json 是破坏性操作** —— Phase 5 必须先解决
2. pi-harness.md §6 上线门禁标注 resolvePiBinaryPath 不变量为"刻意如此" —— 用户已确认变更，改时更新代码注释说明新决策
3. Full access 下本机 pi 可读真实凭证（~/.pi/agent/auth.json）—— 这是用户选择本机 pi 的固有语义
4. 移除 tab 后深链（?tab=usage 等）要兜底到 general，不能白屏
5. 登录页安装需要网络下载 ~70MB，失败要有重试与手动安装指引

## 错误记录
| 错误 | 尝试 | 解决方案 |
|------|------|---------|
| (暂无) | | |

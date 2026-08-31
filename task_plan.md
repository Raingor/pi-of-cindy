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

### Phase 1: 隐藏 Settings UI 入口 [done 2026-08-29]
- [x] tabLabels.ts 移除：usage、voice-input、im-bot、import、ghosts、builtin-tools
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

### Phase 5: 数据目录全切 ~/.pi/agent [done 2026-08-29]
- [x] `resolvePiAgentHome` 注入改为 ~/.pi/agent
- [x] 处理 models.json 冲突：不得覆盖用户真实 models.json（评估合并/改名策略）
- [x] pi-package-store packageHome 改 ~/.pi/agent，扩展包页显示本机扩展
- [x] 会话落到 ~/.pi/agent/sessions（与 Pi Sessions tab 数据对齐）
- [x] 真机验证（2026-08-30，dev 沙箱实跑）：供应商区读写 ~/.pi/agent 全回路验证
      （列表 45 = 39 内置 + 6 自定义、模型开关写 settings.json、添加/删除写 models.json、
      密钥设置/移除写 auth.json 且 UI 只现打码值）；Pi 任务 tab 24 会话与磁盘一致

### Phase 6: 供应商替换为 pi-web-switch 模型 [done 2026-08-30]
- [x] main：新模块 pi-agent/piProviders.ts —— 内置目录从本机 pi 安装的
      @earendil-works/pi-ai dist/providers/data 读取(realpath 解析 symlink 后逐级向上)，
      语义化 CRUD 直接读写 ~/.pi/agent 的 models.json / auth.json / settings.json
- [x] IPC：maker:pi-providers:* 9 条语义化 channel(list/set-auth/remove-auth/
      save-model/remove-model/add/update/rename/remove)；list 只出打码 key，
      明文只进写路径，Renderer 永不回写打码值(密钥规则，见 credentials-and-local-storage.md)
- [x] ProvidersSection 重写：双栏保留，数据层整体切到 pi 文件(列表/详情/模型开关/
      密钥管理/添加/删除)；Cindy provider 注册表与 safeStorage 体系退出本页
- [x] 自定义供应商 9 种 API 格式(pi-web-switch 同款 API_TYPES)+ 端点拉取模型
      (piReader fetchProviderModels 升级：Ollama /api/tags、OpenRouter 富元数据、
      id 启发式、HTML 误配检测；testProvider/testModel/fetchModels 支持 providerId
      由 main 侧解析已存密钥)
- [x] auth.json 密钥管理：打码展示 + 设置/更换/移除 + 明文存储提示文案
- [x] enabledModels：模型开关 = settings.enabledModels 引用增删，与 EnabledModelsPanel 同一数据
- [x] 旧测试下架(3 个断言 Cindy store 行为的 ProvidersSection 测试删除)，
      新增 providersSectionPi.test.tsx + piProviders.test.ts(13 用例)
- [x] 真机目检 Light/Dark 双模式（2026-08-30 截图通过；真机发现并修复缺失的
      settings.providers.button.save key，改用已存在的 custom.save）
- [ ] renamePiCustomProvider 已实现并有 IPC，UI 未暴露重命名入口(可后续补)

## 风险
1. ~~覆盖用户 models.json 是破坏性操作~~ 已澄清为非问题:writeModelsJson 实际写每会话隔离的 agentHome/run-tmp/<hex>/models.json(PI_CODING_AGENT_DIR=configHome),从不碰 ~/.pi/agent/models.json 本体
2. pi-harness.md §6 上线门禁标注 resolvePiBinaryPath 不变量为"刻意如此" —— 用户已确认变更，改时更新代码注释说明新决策
3. Full access 下本机 pi 可读真实凭证（~/.pi/agent/auth.json）—— 这是用户选择本机 pi 的固有语义
4. 移除 tab 后深链（?tab=usage 等）要兜底到 general，不能白屏
5. 登录页安装需要网络下载 ~70MB，失败要有重试与手动安装指引

## 错误记录
| 错误 | 尝试 | 解决方案 |
|------|------|---------|
| (暂无) | | |

## 第三轮：只保留 Pi harness（用户指令 2026-08-31）

### 已拍板决策
- 存量 CC/Codex 会话：保留历史可看，继续对话走既有 agent-switch 链路转 pi（未收到答复，按推荐项执行）
- CC/Codex 本机 CLI 历史导入后端：暂保留（Settings 入口上轮已隐藏）
- 移除深度：彻底删 agent 类与入口；wire 协议按 append-only —— 停发旧值、parser 继续接受旧值
- 远程 SSH：pi 已有 maker-pi-manager daemon，删 CC/Codex 远端链不损能力

### 三个隐藏耦合点（删了就炸）
1. maker-host/index.ts:726-735 claude/codex binary 硬守卫
2. shared/agentKindConversion.ts normalizeDbAgentKind 非法值回落 'cc'
3. deviceLinkContract.ts AGENT_NOT_AUTHENTICATED_RE 错误模板（老 mobile 按它解析）

### 阶段
- [ ] Phase A：停止 claude/codex 二进制下载与硬守卫（agent-binaries CONFIG、bootstrap prepare、
      maker-host 守卫、ensure-agent-binaries、package.json scripts、tools/claude+codex pin、
      binary-version 白名单、splash payload）
- [ ] Phase B：删 maker-core agents/claude-code + agents/codex 及专项测试、barrel、
      maker-host 装配（:944/:1231/:1684/:2062/_codexAgent/AUTH 分支）；AgentKind 收缩为 'pi'，
      新增 legacy 值类型给 DB 读路径
- [ ] Phase C：UI 入口收口（newMakerDraft 默认 pi、ModelSelector 引擎 tab、SidebarFilter、
      CreateWorkerPopover/workerCreationPrefs、useVendorAuthGate codex 分支、SubagentModelSection、
      auxiliary-model 迁 pi、scheduleForm/hook-control 默认 pi、mobile NEW_SESSION_AGENT_OPTIONS）
- [ ] Phase D：协议兼容（deviceLinkContract 停发旧值、parser 不动；list-available-agents 随注册表自然 pi-only）
- [ ] Phase E：存量 cc/codex 会话救生通道（显示 legacy 徽标；继续→引导一键转 pi；
      ensure 不崩路径）

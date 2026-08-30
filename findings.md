# 发现记录

## 第二轮改造探索（2026-08-29）

### Settings tab 注册机制
- `tabLabels.ts` TAB_IDS (38-71) + TAB_LABEL_KEY (75-102) + SettingsTab 类型 (10-36)
- `SettingsSidebarNav.tsx` 数据驱动自 TAB_IDS；TAB_ICON 映射 66-89
- 移除一个 tab = 从 TAB_IDS / TAB_LABEL_KEY / 类型 / TAB_ICON 删除 + SettingsView 删渲染块

### 待隐藏 tab 的组件与专属后端
| tab | 组件 | 专属后端 | 备注 |
|-----|------|---------|------|
| usage | settings/usage/* | maker:usage:history + main/usage/usageHistory.ts | main/usage 其余文件服务计费卡片，勿删 |
| voice-input | VoiceInputSection.tsx | main/voice-input/ 全目录 | 麦克风可能也服务聊天语音，仅隐藏入口 |
| im-bot | ImBotSection + 6 平台子组件 | main/im/ 全目录 | 有 feishu-bot/slack-bot/tina 旧深链别名 |
| import | SessionImportSection | local-db:session-import:* | SettingsView 布局对 import 有特殊分支(269,280) |
| ghosts(插件) | SettingsCatalogPanel | main/plugin-market 等 | maker.plugins.* IPC 与 Tools 共享；另有独立 /plugins 路由 |
| builtin-tools | BuiltinToolsSection + McpServersSection | main/mcp-integrations/ | 同样用 maker.plugins.* |

### codex/claude 接线
- ProvidersSection.tsx: claude OAuth 块 ~465-560（claudeOAuthLogin/Logout/Cancel）；codex 块 ~561+（useCodexAuth）
- preload maker.claudeOAuth* :6449-6455；hooks: useCodexAuth.ts, codexAuthLogin.ts, useClaudeOAuthConnected.ts
- 内置供应商注册表：@cindy/model-providers 包；BUILTIN_REFRESHABLE_PROVIDER_IDS=['xd','anthropic','openai','xai']

### pi 运行时链路
- `pi-host.ts:738` resolvePiBinaryPath = getReadyBinaryPath('pi')（唯一来源，无 env 覆盖）
- `agent-binaries/index.ts`: dev 走 apps/pi-bin；打包版走 CDN manifest 下载到 userData/pi/<version>/
- `packages/maker-core/src/agents/pi/index.ts`: PiAgent(binaryPath) → spawn `pi --mode rpc`
- `pi-host.ts:1642-1650` resolvePiAgentHome 注入：本地 = userData/pi-agent-home
- `index.ts:2106` per-session PI_CODING_AGENT_DIR = agentHome/run-tmp/<hex>
- writeModelsJson：host 模型清单挂自建 `cindy` provider 写 <agentHome>/models.json，baseUrl=本地 anthropic-compat proxy
- **关键冲突(已澄清为非问题)**:writeModelsJson 的实参是 configHome = agentHome/run-tmp/<hex>(每会话隔离,PI_CODING_AGENT_DIR 指向它),models.json/settings.json 落在 run-tmp 内,从不写 ~/.pi/agent 根目录 —— 切 agentHome 到 ~/.pi/agent 不会覆盖用户真实 models.json

### pi 扩展包系统
- `pi-package-store.ts:283` packageHome() = userData/pi-package-home；spawn env 设 PI_CODING_AGENT_DIR
- IPC: maker:pi-packages:list/mutate (channels.ts:174-175)、register.ts:7019/7032
- 改为 ~/.pi/agent 即显示本机扩展

### 已移植数据层（第一轮）
- `main/pi-agent/piReader.ts:58` PI_DIR = ~/.pi/agent —— 与本轮目标天然对齐
- Pi Sessions/Memory/Subagents/Dashboard tabs 已读 ~/.pi/agent

### 登录页与安装样板
- `renderer/components/login/LoginPage.tsx`（+LoginStage.tsx）
- 样板：`settings/LocalOllamaInstall.tsx`（installInCindy 按钮 + 进度事件 + 轮询）
- `useVendorAuthGate.ts:99-124` 已有 'pi-binary-missing' 文案

### pi-web-switch 供应商模型
- `ProvidersModelsPage.tsx`：9 种 API_TYPES（openai-completions/responses, codex-responses, azure, anthropic-messages, google-generative-ai/vertex, bedrock, mistral）
- 存储：~/.pi/agent/settings.json（enabledModels: ["providerId/modelId"...]）、models.json（自定义 providers map）、auth.json（keys）
- 内置目录真实来源 @earendil-works/pi-ai（pi CLI 自带），pi-web-switch 经 /api/pi/builtin-providers 暴露

---

## 第一轮移植记录

## pi-web-switch 架构
- server/pi-reader.ts: 3019行，直接读写 ~/.pi/agent/ 下的 JSON 文件
- 使用 Vite middleware 暴露 API，也可独立作为 Node 模块
- 核心功能：settings/auth/models CRUD, session 解析, memory 读取, usage 聚合, subagent 读取, 包搜索, 连接测试

## Cindy 架构
- Settings 使用 tab 系统，TAB_IDS 定义在 tabLabels.ts
- 状态管理：module-level snapshot store + useSyncExternalStore + IPC
- Provider 数据：main process SQLite + safeStorage → IPC → renderer snapshot
- 已有用量追踪：UsageHistorySection + HomeUsageDashboard（基础版）

## 关键差异
- pi-web-switch 用 Zustand，Cindy 用 useSyncExternalStore
- pi-web-switch 直接文件 I/O，Cindy 用 IPC 分层
- pi-web-switch 有自己的 i18n，Cindy 有自己的 i18n
- pi-web-switch 用 Tailwind v4，Cindy 也用 Tailwind

### Phase 6 关键事实（2026-08-30）
- 内置目录来源：无需引入 @earendil-works/pi-ai npm 依赖——从本机 pi 安装位置
  realpath 后逐级向上找 node_modules/@earendil-works/pi-ai/dist/providers/data/*.json
  （本机 FlyEnv npm 全局安装验证通过）。localPi 探测缓存的是 symlink 路径，
  必须 realpath 否则向上查找失败（开发中实锤的 bug）。
- pi-web-switch 启停语义：模型行开关走 settings.enabledModels 引用（"pid/mid"），
  不是 models.json 的 model.enabled 字段；创建供应商时勾选的模型一次性批量写入。
- 密钥规则落地：list 投影打码、写路径语义化（setAuth/update 的 apiKey 只在用户
  输入新明文时携带，undefined 保持原值），避免 pi-web-switch「整文件回传」导致
  打码值覆盖真实密钥的问题。
- check:i18n-glossary 会把翻译里的 ~/.pi/agent 判成小写 agent 违规（词边界不含 /，
  路径不在 URL 白名单里）；翻译文案改说「pi 的数据目录」绕开。

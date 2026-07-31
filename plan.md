# Pi Harness 集成计划

## 当前状态：代码已提交，待推送到远程

- **分支**：`feat/pi-harness-integration`
- **最新 commit**：`8ba6ff57` — `fix: unify Pi as sole agent harness, fix status crash and provider sync`
- **DCO**：已签名 `Signed-off-by: HK-Company-Raingor <raingor00@gmail.com>`
- **门禁**：`pnpm test:unit` 全量通过（0 FAIL）、`desktop` + `@cindy/maker-core` typecheck 通过
- **远程**：`origin git@github.com:Raingor/pi-of-cindy.git` — SSH key (`kangxiang242`) 无写权限，改用 GitHub PAT 推送

---

## 背景

Cindy 项目需要把 pi.dev 作为唯一的 agent harness 集成到桌面客户端中。上一次会话（`cindy-0730.cshare`）完成了 pi 集成的基础代码改动。本次会话在此基础上完成了：移除 claude-code / codex harness、修复 Pi 会话发送消息时的 IPC 校验报错、修复状态栏 TypeError 崩溃、同步 Pi 供应商到设置页。

---

## 已完成的工作

### 第一阶段：Pi Harness 基础集成（cindy-0730 会话 + typecheck 修复）

以下文件在基础集成阶段已修改，构成 pi 集成的基础：

- `packages/maker-core/src/types/common.ts` — `AgentKind` 类型加 `'pi'`
- `packages/maker-core/src/types/events.ts` — 事件类型适配
- `packages/maker-core/src/agents/index.ts` — 导出 `PiAgent`
- `packages/maker-core/src/agents/pi/` — PiAgent 实现（translator、index、transport）
- `apps/desktop/src/main/maker-host/pi-host.ts` — **新建**：pi 二进制发现 + no-op auth/runtime config
- `apps/desktop/src/main/maker-host/index.ts` — pi agent 注册（条件注册，找不到二进制则跳过）
- `apps/desktop/src/main/maker-host/model-route-guard-live.ts` — pi 路由守卫
- `apps/desktop/src/main/maker-ipc/register.ts` — pi 在 IPC 层的 OPT-OUT 处理
- `apps/desktop/src/main/hook-control/defaults.ts` — pi 不参与 IM headless 派发
- `apps/desktop/src/main/goal-host/storage.ts` — pi 不参与目标续跑
- `apps/desktop/src/main/im/defaultSettingsStore.ts` — pi 默认设置
- `apps/desktop/src/shared/imDefaultSettings.ts` — `ImDefaultAgentKind` 加 `'pi'`
- `apps/desktop/src/renderer/hooks/useAgentCapabilities.ts` — renderer 侧 `AgentKind` 加 `'pi'`
- `apps/desktop/src/renderer/lib/makerChatStore.ts` — `SessionChatState.agentKind` 等放宽到 `AgentKind`
- DB-kind 映射层全面修复（`'cc' | 'codex'` → `'cc' | 'codex' | 'pi'`）：涉及 `agentHandoff.ts`、`messagePersistBroadcaster.ts`、`session-storage.ts`、`fork.ts`、`orcaTeamStore.ts`、`chatHistoryReader.ts`、`conversationSearch.ts`、`ccAgent.types.ts`、`sessionAgentSwitchHandler.ts`、`sessionRepo.ts` 等 20+ 文件
- DB 白名单与类型接口：`localDb/ipc/sessions.ts`、`messages.ts`、`pluginWorkspaceSessions.ts`、`mapper.ts` 等
- typecheck 11 个错误全部修复
- 单元测试门禁全部通过（含 desktop / mobile / maker-core 等）

### 第二阶段：移除 claude-code / codex，Pi 成为唯一 Agent（本次会话）

#### 2.1 移除 claude-code / codex harness 的 UI 入口

- `CreateWorkerPopover.tsx` — 移除 claude-code / codex 选项，只保留 Pi
- `ChatInput.tsx` — 移除 vendor 切换逻辑，直接使用 Pi
- `ModelSelector.tsx` — 移除多 vendor 逻辑，只展示 Pi 的模型
- `PermissionSelector.tsx` — 移除 codex 专属权限模式
- `VendorSegmentedSwitcher.tsx` — 移除多 vendor 切换器
- `NewMakerDraftRoute.tsx` — 适配 Pi-only 流程
- `SessionTabsBar.tsx` — 移除 vendor 图标切换
- `HookWorkspacePrefsEditor.tsx` — 适配 Pi-only 配置
- `ImDefaultSettingsSection.tsx` — 适配 Pi-only 设置
- `hookWorkspacePrefsLogic.ts` — 适配 Pi-only 逻辑
- `newMakerDraft.ts` — 适配 Pi-only 草稿
- 删除过时的测试文件 `modelSelectorTriggerVariant.test.ts`、精简 `CreateWorkerPopover.test.tsx`、`useOrcaWorkerSelection.test.tsx`

#### 2.2 修复 IPC 校验层 `agentKind 'pi' invalid` 报错

**问题**：发送消息时报 `Error: [INVALID_PARAMS] queued.createOpts.agentKind invalid`

**修复**：更新以下文件的 agentKind 枚举校验，允许 `'pi'` 通过：
- `apps/desktop/src/main/maker-ipc/register.ts` — `INPUT_ENQUEUE` 校验逻辑
- `apps/desktop/src/main/maker-ipc/sessionRequest.ts` — `readAgentKind` 允许 `'pi'`
- `apps/desktop/src/main/maker-ipc/title.ts` — `readSessionAgentKindFromDb` 允许 `'pi'`
- `apps/desktop/src/main/maker-ipc/authHandlers.ts` — agentKind 校验允许 `'pi'`
- `apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts` — 适配

#### 2.3 修复状态栏 TypeError 崩溃

**问题**：`TypeError: Cannot read properties of undefined (reading 'trim')` at `normalizeStaticStatus` → `localizeAgentStatus`

**根因**：Pi translator 在 `turn_start`、`turn_end`、`agent_start`、`agent_end`、`auto_retry_start` 等事件中 emit 的 `status` 事件只携带 `{ isRunning: boolean }`，缺少 `status` 文本字段。renderer 侧 `handleStatusUpdate` 把 `undefined` 写入 `agentStatus.status`，传入 `localizeAgentStatus` 时 `.trim()` 报错。

**两层修复**：
1. **防御层**（`localizeAgentStatus.ts`）：函数入口加 `if (!status || typeof status !== 'string') return ''` 守卫
2. **根因层**（`translator.ts`）：给所有 Pi `status` 事件补上 status 文本：
   - 运行中（`turn_start` / `agent_start` / `auto_retry_start`）→ `'Working…'`
   - 结束（`turn_end` / `agent_settled` / `agent_end`）→ `'Done'`
- 同步更新了 `translator.test.ts` 的断言

#### 2.4 Pi 供应商同步到设置页

- `ProvidersSection.tsx` — 新增从 `~/.pi/agent/auth.json` 读取 Pi 已配置供应商的逻辑，在设置页「模型供应商」板块展示
- `pi-settings-reader.ts` — 增强读取逻辑

#### 2.5 会话分享适配 Pi

- `sessionShareExport.ts` — 导出时 agentKind 适配 `'pi'`
- `sessionShareImport.ts` — 导入时 agentKind 类型和 fallback model 适配
- `xdtshareFormat.pure.ts` — 格式定义适配

#### 2.6 i18n 多语言适配

- `en/common.json`、`ja/common.json`、`ko/common.json`、`zh-CN/common.json` — 新增 Pi-only UI 文案 key

---

## 设计决策记录

Pi harness 的设计原则：

1. **复用本地 pi 二进制**：不随包自带、不进 agent-binaries 下载套。host 启动时探测 PATH + `~/.local/share/pi-node` 已知安装路径，找到才注册 PiAgent，找不到就跳过。
2. **pi 自管 provider/credentials**：Cindy 不注入任何凭证 env，pi 用 `~/.pi` 自配。AuthAdapter 是 no-op stub。
3. **pi 自管 memory**：`memoryEnabled: false`、`makerMemoryEnabled: false`，不经 Cindy memory 设置。
4. **pi 不参与 device-link**：不参与 New Maker 草稿镜像。
5. **pi 不参与 Orca**：不参与多 worker 协同。
6. **pi 不参与 goal-host**：不参与目标续跑。
7. **pi 不参与 IM headless 派发**：hook-control 对 pi 回落 claude-code。
8. **pi 不参与用量统计**：daily-model-usage 表 enum 不含 pi。

---

## 验证结果

| 门禁 | 结果 |
|------|------|
| `pnpm --filter desktop run typecheck` | ✅ 0 错误 |
| `pnpm --filter @cindy/maker-core run typecheck` | ✅ 0 错误 |
| `pnpm test:unit`（全量） | ✅ 全部通过，0 FAIL |
| DCO 签名 | ✅ `Signed-off-by` 与 author 一致 |
| Linter | ✅ 无错误 |

---

## 剩余工作

### 后续可选优化

- DB schema 迁移：如果未来 pi 需要参与 goal-host / scheduler / daily-model-usage，需要加 DB migration 扩展 enum 约束
- `ModelSelector` 中 Pi 的模型列表完整列出与切换验证
- Light / Dark 双模式实机目检

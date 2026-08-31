# Pi-only Harness 改造：余项清单（Remaining Work）

> 状态：权威余项台账（2026-09-01）。第三轮改造「只保留 Pi harness」的 A–E 主阶段
> 已完成（提交 1033bdad7 / 36fd180d / 7d991fe7，基线 b7067fcc7），本文记录尚未
> 收尾的余项、精确锚点与验收判据。逐项完成后请在此勾销并注明提交号。
> 背景与阶段记录见 `task_plan.md` 第三轮小节与 `progress.md`。

## 已完成阶段速览

| 阶段 | 内容 | 提交 |
|---|---|---|
| A | 停 claude/codex 二进制下载链 + 硬守卫 + splash 收口 + scripts/pin 删除 | `1033bdad7` |
| B | 删 ClaudeCodeAgent / CodexAgent 类与装配（净删 ~10.8 万行）；数据功能模块抽出保留 | `36fd180d` |
| C | 新建任务 / worker / 定时任务 / mobile 默认引擎 pi 化 | `7d991fe7` |
| D | wire 协议经构造自然满足（枚举与错误模板保持三值，停发旧值靠注册表收缩） | —（无代码） |
| E（部分） | legacy 会话保留可筛；切 pi 续跑走既有 agent-switch 链，已验证可行 | —（无新代码） |

## 余项清单

### R1 · Phase E 余项：legacy 会话发送报错缺引导文案

- **现象**：对存量 `claude-code` / `codex` 会话直接发送（未先切引擎）时，
  main 抛裸英文错误 `Agent 'claude-code' is not registered (available: pi)`
  （`packages/maker-core/src/maker.ts:1317` `requireAgent`）。
- **要做**：在 renderer 的发送错误路径把它映射成用户可读的引导文案
  （说明该引擎已退役、提示用 composer 模型选择器选 pi 续跑），或纳入统一
  IPC 错误协议（`apps/desktop/src/shared/ipc-errors.ts` 新错误码 + 五语文案）。
- **锚点**：`apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:2856`
  与 `:3099` 两个 `extractIpcError(err)` catch；错误文本正则可用
  `/Agent '(.+)' is not registered/` 匹配（maker-core 抛的是裸 Error，不走
  ipc-errors 协议——若走协议需先在 main 侧包一层）。
- **验收**：对 legacy 会话发送可见中文引导文案，不含裸 `'claude-code' is not
  registered` 字样；切 pi 后发送正常走 agent-switch 链。
- **注意**：文案遵循 `docs/product-rules/task-and-conversation-naming.md`
  （会话→任务措辞规则）；引擎/Agent 保留英文原词（glossary `agent` 条）。

### R2 · Phase C2：辅助 one-shot 链迁 pi

- **现象**：会话标题生成 / prompt 推荐的辅助 one-shot
  （`apps/desktop/src/main/utility-model/textOneshotPinOptions.ts` 与
  `oneShotCandidates.ts`、`apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts`）
  仍钉 `codex | claude-code` 路由。PiAgent 的 `oneShot` 已实现
  （`packages/maker-core/src/agents/pi/index.ts:2099`），但 pin 清单按 provider
  路由描述符过滤，pi 尚无路由描述符。当前行为：候选清单为空、help/摘要兜底
  best-effort 跳过，**不崩**（Phase C 有意留的中间态）。
- **要做**：
  1. 给 provider 目录的 pi 路由建 `OneshotRoute` 描述符（对齐
     `isRoutableForOneshot` 的 wire/鉴权判据——pi 走
     `openai-responses`/`anthropic-messages`/BYOM 原生块等 pi 支持的 wire）；
  2. `ONESHOT_ROUTE_AGENTS` / `ONESHOT_CAPABLE_AGENTS` 加入 `'pi'`
     （`textOneshotPinOptions.ts:39`、`oneShotCandidates.ts:71`）；
  3. `auxiliary-model-settings.ts` 的 `toWireOption` 守卫放开为含 `'pi'`；
  4. legacy 持久 pin 的展示标签分支
     （`auxiliary-model-settings.ts:84`/`:92` 的 `Codex / Claude Code` 硬编码）
     兼容 pi 解码值。
- **验收**：设置页「辅助模型」能选到 pi 可路由的模型；标题/推荐实际走 pi
  oneShot 成功；legacy pin（cc/codex）仍显示且可移除。
- **风险**：one-shot 执行器 `maker.oneShot(agentKind, …)` 会因 agents map 无
  cc/codex 而 throw——清单与执行判据必须同 PR 收口，不能只放开清单。

### R3 · 退坡结构清除（待消费方 retarget）

以下结构在 Phase B 被判「仍有活消费方」而保留，需先给消费方换目标再删：

- **`apps/desktop/src/main/maker-host/auth-adapters.ts` 的 claude/codex 段**：
  `desktopCodexAuthAdapter` 仍被 voice-input（ChatGPT token）、maker-ipc/auth
  +usage、createDesktopProviderService 消费；`desktopClaudeAuthAdapter` 被
  register/usage 消费；`readClaudeApiKey` 是 pi 网关路由与视觉桥的 key 读取器。
  删除前置：voice-input 与供应商区 auth IPC retarget/下线，pi 网关 key 读取器
  改指独立实现。
- **`deferredCodexRestart.ts` / `codex-credential-switch.ts` / `credential-mode.ts`**：
  结构保留、行为惰化（restart no-op）；错误类型守卫织入 6+ 个 pi 也在用的
  send/create 事务文件，删除需逐个解耦。
- **历史导入后端**（`maker-host/codex-local-sessions.ts` ~5,200 行、
  `claude-local-sessions.ts` ~1,100 行、`localDb/ipc/session-import.ts`）：
  Settings 入口已在第二轮隐藏；后端整体删除属数据功能下线，需单独决策
  （含「已导入数据保留展示」的兼容说明）。
- **anthropic-compat-proxy-host 相关**（`claude-gateway-config.ts`、
  `claude-rate-limit-headers-observer.ts`、`claude-fast-mode-log.ts` 等）：
  **不能删**——pi 的 cindy provider baseUrl 指向该 proxy；命名里的 claude 是
  wire 协议名（anthropic-messages），非 agent 残留。
- **`model-providers` 的 `unifiedSelection.ts` openai→codex / anthropic→claude-code
  root 映射**：模型目录投影语义，改动会让全量用户模型来源判错——除非做完整
  迁移评审，否则不动。

### R4 · 真机验证（发布前必做）

- [ ] 起 pi 任务全链路（新建/续跑/压缩/导出）；
- [ ] legacy cc/codex 会话：列表可见、筛选可用、切 pi 续跑成功、直接发送出现
      R1 的引导文案（R1 完成后）；
- [ ] 定时任务：新建默认 pi、历史 cc/codex 行不炸（回落 pi 执行或明确禁用提示）；
- [ ] mobile：新建入口只出 pi、被控端 list-available-agents 为 pi-only；
- [ ] Settings 供应商区（仓库版只读面板）、Pi 仪表盘/任务/扩展包各 tab 正常；
- [ ] Light/Dark 双模式目检（涉及 Phase C 改动的界面：新建弹窗、worker 弹窗、
      定时任务表单、mobile 新建页）。

## 原则约束（做余项时仍需遵守）

- **wire 协议 append-only**：`deviceLinkContract.ts` 的三值枚举与
  `AGENT_NOT_AUTHENTICATED_RE` 模板不收缩；停发旧值可以，parser 必须继续
  接受旧值（老 mobile 在野外）。见 `docs/dev-rules/protocol-compatibility.md`。
- **数据兼容**：`sessions.agent_kind` / `messages.agent_kind` 列与历史行
  原样保留；`shared/agentKindConversion.ts normalizeDbAgentKind` 对非法值
  的回落语义改动前必须先回答「存量 cc 行会落到哪」。
- **每项余项独立成 PR**，按仓库门禁（typecheck / test:unit:related /
  check:i18n-glossary / DCO）验证后合入。

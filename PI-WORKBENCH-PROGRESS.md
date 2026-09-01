# Pi 工作台迁移进度（pi-web-switch → Cindy Settings）

> 更新日期：2026-08-31。对应提交：`d5555da34`（已合入 main）+ 本轮修复（见下）。
> 需求来源：zcode 会话 `sess_94dbe0c3`（2026-08-28 ~ 08-31），九项需求清单。

## 需求总览与状态

| # | 需求 | 状态 |
|---|------|------|
| 1 | 供应商换成 pi-web-switch 的（面板展示本机 `~/.pi/agent` 的供应商与模型） | ✅ 已完成，布局已还原为 pi-web-switch 双栏式 |
| 2 | 用量计费换成仪表盘 | ✅ 已完成（含本轮数据修复） |
| 3 | 移除用量历史、语音输入、IM 机器人 | ✅ 已完成 |
| 4 | Pi 子代理板块右侧标题（piSubagents.title） | ✅ 已完成 |
| 5 | piSpeedtest.title 同样处理 | ✅ 已完成 |
| 6 | 加载本地 pi 扩展（按钮装卸，走 CLI） | ✅ 已完成 |
| 7 | 只保留本地 pi 的 harness | ⚠️ 仅 UI 层收窄（见「遗留」） |
| 8 | 未装 pi（`~/.pi/agent` 不存在）登录后弹窗提示安装 | ✅ 已完成 |
| 9 | 移除其他 harness | ⚠️ 仅 UI 层收窄（同 #7，被 binaryPath 硬依赖挡住） |

## 本轮（08-31 下午）修复内容

### 1. Pi 仪表盘数据为空的根因修复

`piUsageParser.ts` 从 pi-web-switch 移植时字段名全错——pi 会话 JSONL 实际写的是
`usage.input/output/cacheRead/cacheWrite` 与 `usage.cost.total`，而解析器读的是
Anthropic 风格的 `input_tokens` 等下划线名。字段对不上不报错，只静默归零（全量
13932 条记录解析出 0 token）。修复：

- token 四字段改读现行名，旧下划线名保留兼容；
- 成本优先取 `usage.cost.total`（供应商真实计费），整个 cost 字段缺失才回落
  按模型名估算；0 成本就是 0，不重新估算；
- provider/model 优先取每条 assistant 消息自带的 `provider`/`model`（比顺序推断
  `model_change` 准：子代理临时换模型不发 model_change，实测 395 条不一致）；
- `model_change` 的模型字段是 `modelId` 不是 `model`；
- 时间戳优先用消息内层（毫秒数），外层 ISO 串仅兜底。

### 2. 「今天」视图按小时聚合（此前恒为空）

`piReader.getUsageByRange()` 里 `hourlyBreakdown` 硬编码空数组，而仪表盘默认
视图只读这张表。现在 `PiUsageRecord` 携带 `hour`（中国时区 0-23）并按
日期+小时聚合。

### 3. 缓存命中率单位错误

原实现返回 0-1 比率（分母还只有 cacheRead+cacheWrite），UI 直接 `${value}%`
渲染——真实 99.9% 显示成「1%」。改为与 pi-web-switch 一致：
`(cacheRead+cacheWrite)/totalTokens*100`，保留一位小数。标题栏请求数也改用
真实 `totalRequests`（原用分组后的日志行数，与下方卡片自相矛盾）。

### 4. Pi 会话列表项目名整片空白

会话目录名（`--Users-mac-2312-r-...-pi-of-cindy--`）里单个 `-` 既是路径分隔符
又是名字里的连字符，从目录名反推路径有损；旧解码还把尾部 `--` 变成尾斜杠，
`split('/').pop()` 拿到空串。修复：项目路径优先读会话文件 `session` 行的
`cwd`（权威、无歧义），目录名只作兜底；会话名从 `session_info` 行读
（原来错读 `session_start`，该类型不存在）。

### 5. 本机 Pi 供应商面板布局还原 pi-web-switch

按 08-31 反馈把堆叠卡片式改为 pi-web-switch 的双栏布局：左侧供应商导轨
（图标 + 名称 + 密钥状态圆点），右侧详情（名称徽标、接口地址、接口协议、
**整池密钥列表并标出生效那把**、模型行带启用态开关、能力图标、价格/上下文
徽标）。主进程 `piCliPanel.ts` 新增 `PiCliApiKeyView`（每把 key 一条遮罩视图 +
active 标记），真值仍不出主进程。

### 6. 顺手修掉的上游洞（上轮已做，一并记录）

`PI_AGENT_EXPORT_CONFIG` 原样返回 `readAuth()`+`readModelsJson()`，把
`auth.json`/`models.json` 明文 key 全量交给 Renderer 并导出落盘。已改为剥密：
`auth` 整份省略，每个 provider 剥掉 `apiKey`/`apiKeys`/`activeKeyId`。

## 凭证边界（刻意偏离 pi-web-switch 的一点）

pi-web-switch 把明文 key 返回给前端（它的显形/编辑功能建立在这上面）。
Cindy 的 Renderer 会渲染 agent 输出、Markdown、插件面板与内置浏览器网页，
`electron-security-and-process-boundaries.md` 禁止 preload 返回凭文明文。
因此面板对等还原、但密钥只在主进程使用，界面显示遮罩串 + `hasApiKey` +
生效标记，**无明文显形入口**。

## 验证记录

- 新增测试 35 个用例（4 个文件）：`piUsageParser`（字段契约 9）、
  `piUsageAggregation`（命中率百分比/小时桶/请求数 6）、`piSessionListing`
  （项目归属/命名 5）、`piCliPanel`（剥密 + 密钥池投影 15）。
- `pnpm --filter desktop typecheck` 通过；`pnpm test:unit:related` PASS
  （42 个相关文件，120.8s）；`check-i18n` 五语一致（8645 key）；
  glossary 新增违规 0（HEAD 既有 44 处，与本次无关）。
- 实机 `DESKTOP_DEV_VERDICT=ready` 目检：仪表盘「今天」视图有数据
  （733 请求 / 1.11 亿 token / $339.56，与纯函数核验一致）；Pi 会话 14 个项目
  名全部显示；本机 Pi 供应商双栏布局 + 密钥池 + 生效标记渲染正常。
- **未目检**：供应商导轨手动切换第二家、Light/Dark 双模式切换
  （CDP click 在该页超时，工具问题非代码问题；交互为纯 React state，风险低）。

## 接下来要完成的

1. **供应商面板交互补验**：实机手动点导轨切换供应商、切 Light/Dark 双模式目检。
2. **需求 7/9 真拆 harness**（独立重构）:`base-agent.ts:1913` 构造期硬要求
   `binaryPath`，`getMaker()` 起动即要 Claude/Codex 二进制
   （`maker-host/index.ts:726`）。需先让两个 agent 支持 binaryPath 延迟解析，
   才能停掉预下载、真正只保留 pi harness。届时同步更新
   `localPiWorkbenchBoundary.test.ts` 的注释（现在记录了为什么锁不死）。
3. **glossary 既有 44 处违规**：✅ 已裁决（2026-09-01）。真错改文案（zh「子代理/代理」→
   全仓统一的 `Subagents`/`Agent` 保留英文、「折叠」→「收起」、ko「공급자」→「제공자」）；
   两类刻意保留走 glossary.json 的 exempt（不是 baseline）：
   - `session` 条目豁免 `settings.piSessions.*` 子树 + `tabs.piSessions`：Pi CLI 是外部
     工具，其原生会话文件保留「会话/會話」叫法，避免与 Cindy 任务混淆（类比
     task-and-conversation-naming.md §4.1 对 IM 平台会话的保留裁决）；
   - `agent` 条目豁免 `piSubagents.noAgentsDesc/noChainsDesc`：文案含字面路径
     `~/.pi/agent/...`，路径小写 `agent` 被大小写规则误伤（FILENAME_TOKEN 只剥带扩展名的
     文件名，不覆盖目录路径）。
   遗留：zh-TW 同一面板 tab 叫「Pi 工作階段」、面板标题叫「Pi 會話」，存量不一致
   （不在门禁范围），后续统一。另 18 处 proposed（harness/lead 大小写）不阻断，
   属术语未裁决状态，另行处理。
4. **测连接 / 拉取模型列表**：pi-web-switch 供应商详情有 Test Connection 与
   Fetch Models，当前 Cindy 面板是只读展示。若要补，主进程已有真值可发请求，
   Renderer 只收结果——设计上可行，未实现。
5. （远期）Pi 会话列表点击预览/回收站恢复的实机回归——本轮只改了分组命名，
   未动这些路径。

## 相关文件

- 主进程：`apps/desktop/src/main/pi-agent/{piCliPanel,piReader,piTypes,piUsageParser}.ts`
- IPC：`apps/desktop/src/main/maker-ipc/{channels,piAgentHandlers,register}.ts`
- 面板：`apps/desktop/src/renderer/components/settings/pi-providers/`、
  `pi-extensions/`、`pi-dashboard/`、`pi-install/`
- 测试：`apps/desktop/src/main/pi-agent/__tests__/`、
  `apps/desktop/src/main/__tests__/pi*.test.ts`

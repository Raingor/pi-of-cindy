# 本机 Pi 供应商：与 pi-web-switch 对齐的余项清单

> 状态：2026-09-01 晚。基线提交 `6d4a2bfaf`（第一轮语义对齐已合入 main）。
> 对照对象：`pi-web-switch` 仓库 `codex/web-pi-chat` 分支
> （`src/components/providers/ProvidersModelsPage.tsx` + `server/pi-reader.ts`）。
> 判据以 pi 自身实现为准（pi 0.84.3，
> `~/.local/share/pi-node/current/lib/node_modules/@earendil-works/pi-coding-agent/dist`），
> pi-web-switch 只作参照——两边不一致时以 pi 的实际行为为准。

## 本轮已完成（`6d4a2bfaf`）

| # | 问题 | 判据来源 |
|---|------|---------|
| 1 | `_disabledProviders` 未读，pi 停用的供应商在面板里凭空消失 | pi 把整块配置搬进该键，不删除 |
| 2 | 模型可用性错读 `models.json` 的 `enabled` 字段 | 该字段不在 pi 的 `ModelDefinitionSchema`（`dist/core/model-config.js`），加载即丢弃；真正的门是 `settings.json` 的 `enabledModels` 白名单，且**空白名单 = 不过滤** |
| 3 | `$VAR` 密钥引用当字面量发送 | pi 支持环境变量引用；未导出时应算「没有 key」而非回落字面量 |
| 4 | 探测请求不校验 URL scheme、超时报裸 `AbortError` | — |
| 5 | `fetchProviderModels` 只回裸 id | pi-web-switch 回完整元数据 + id 启发式推断 |
| 6 | 面板缺 `compat` 与 per-model `maxTokens` | pi-web-switch 详情区/表单有 |

## 追加交付

| # | 内容 | 提交 |
|---|------|------|
| 1 | 供应商面板支持**切换生效 key**（多把 key 的池出 radio，与 pi-web-switch 同语义：改 `activeKeyId` + `apiKey` 镜像原值；唯一写通道 `maker:pi-cli:switch-key` 只传 `providerId + keyId`，真值不出主进程） | `af5f981f5` |

## 余项清单

### R1 · Pi 测速面板读的配置键不存在，且明文 key 过 Renderer（P0）✅ 已修复

> **状态：已修复（2026-09-02）。** `loadProviders` 改走 `piAgent.listCliProviders()`
> （过滤 `hasApiKey && baseUrl`）；新增 `maker:pi-cli:test-model` 通道（签名
> `{ providerId, modelId }`，主进程 `testPiCliModel` 复用 `readPiCliProviderRuntimeConfig`
> 取真 key）；`fetchModelsForProvider` 改走既有 `fetchCliProviderModels(providerId)`；
> 旧 `PI_AGENT_TEST_MODEL` / `PI_AGENT_FETCH_MODELS` / `PI_AGENT_TEST_PROVIDER` 三个
> 「Renderer 传 baseUrl+apiKey」通道已从 channels / preload / d.ts / handler 全部删除。
> 边界契约测试锁在 `piCliPanelBoundary.test.ts`（speed test 无 `apiKey`、旧通道不得还魂、
> test-model 与测连接同口径）。真机验收（测速 tab 列出本机供应商并跑完 `RUNS_PER_MODEL`
> 轮）待应用侧目检。

- **现象**：`usePiSpeedTest.loadProviders()` 读 `settings.customProviders`
  （`apps/desktop/src/renderer/hooks/usePiSpeedTest.ts:45`）。**`~/.pi/agent/settings.json`
  里没有这个键**——供应商实际存在 `models.json` 的 `providers`。实机确认：Pi 测速 tab
  恒显示「无自定义供应商 / 在供应商标签页添加自定义供应商后即可开始测速」，而本机确有
  4 家供应商。该面板从移植至今**从未工作过**。
- **同时是凭证边界违规**：即使把键改对，现有数据流是
  `readSettings()` → renderer 拿到 `apiKey` 明文 → 再作为 IPC 参数传回
  （`usePiSpeedTest.ts:74` 的 `api.fetchModels(baseUrl, provider.apiKey)`、
  `:121` 的 `api.testModel(..., provider.apiKey)`）。这与
  `docs/dev-rules/electron-security-and-process-boundaries.md` 冲突，也和本轮
  `pi-cli:test-provider` / `pi-cli:fetch-models` 建立的「只传 providerId」口径相反。
- **要做**：
  1. `loadProviders` 改走 `piAgent.listCliProviders()`（已剥密，含 `baseUrl` / `api` /
     `hasApiKey` / `disabled`），过滤 `hasApiKey && baseUrl`；
  2. 新增 `maker:pi-cli:test-model` 通道（签名 `{ providerId, modelId }`），主进程内
     复用 `readPiCliProviderRuntimeConfig` 取真 key，与 `testPiCliProviderConnection`
     同一模式；`fetchModelsForProvider` 改用已有的 `fetchCliProviderModels(providerId)`；
  3. 旧的 `PI_AGENT_TEST_MODEL` / `PI_AGENT_FETCH_MODELS` / `PI_AGENT_TEST_PROVIDER`
     三个「Renderer 传 baseUrl+apiKey」通道在无消费方后删除
     （`piAgentHandlers.ts:306`/`:314`/`:323`、`preload.ts:7139` 附近）。
- **验收**：Pi 测速 tab 列出本机 4 家供应商；选一家能拉到模型并跑完
  `RUNS_PER_MODEL` 轮；`grep -rn "apiKey" apps/desktop/src/renderer/hooks/usePiSpeedTest.ts`
  无命中。
- **注意**：pi-web-switch 的测速结果存 localStorage（`speedtest:model-results` 等），
  Cindy 侧是否持久化属产品决策，本项不强制对齐。

### R2 · 配置导出/导入往返丢 `_disabledProviders`（P0，数据丢失）

- **现象**：`exportPiConfig()`（`piReader.ts:1239`）只投影 `models.providers`，
  `_disabledProviders` 整键不进快照；`importPiConfig()` 经 `writeModelsJson` **整文件
  覆盖**。用户「导出配置 → 导入配置」一个来回，所有被 pi 停用的供应商连同其模型与
  `activeKeyId` 一并消失，且没有任何提示。入口在设置页
  （`SettingsView.tsx:381` 的 `PiConfigImportExport`），是用户可达路径。
- **要做**：`exportPiConfig` 同样投影 `_disabledProviders`（逐 provider 剥
  `apiKey`/`apiKeys`/`activeKeyId`，与 `providers` 同一函数）；`PiConfig['modelsJson']`
  类型加可选 `_disabledProviders`；`readModelsJson()` 的返回类型
  （`piReader.ts:144`，当前是 `{ providers: Record<string, unknown> }`）一并放宽。
- **附带**：导出剥掉 key 后再导入会**清空**用户已配的密钥（`writeModelsJson` 覆盖式
  写入）。这是既有行为，不在本项范围，但应在导出/导入 UI 上写明「导出不含密钥，
  导入后需重新配置密钥」——否则用户会以为备份是完整的。建议与 R2 同 PR 补文案。
- **验收**：新增单测锁 `exportPiConfig` 在存在 `_disabledProviders` 时两个 bucket
  都出现且都无凭证字段；往返后停用供应商仍在。

### R3 · `fetchProviderModels` 缺 Ollama 分支与非 Bearer 鉴权头（P1）

- **现象**：本轮已补齐元数据推断与 OpenRouter 计价，但仍固定
  `GET {baseUrl}/models` + `Authorization: Bearer`。对照 pi-web-switch
  `server/pi-reader.ts:2833`：
  - **Ollama** 没有 `/models`，走 `GET /api/tags`（判据：hostname `localhost` +
    port `11434`），并可选 `POST /api/show` 补 `contextWindow`；
  - **Anthropic** 用 `x-api-key` + `anthropic-version: 2023-06-01`，不是 Bearer
    （pws 的 `makeHeaders()`，`server/pi-reader.ts` 约 :2825）；
  - **Google** 的 key 走 query param 而非 header。
- **影响面**：本机 `models.json` 现有 4 家都是 OpenAI 兼容端点，所以当前不暴露。
  但 `api` 字段支持 `anthropic-messages` / `google-generative-ai`
  （`piCliPanel.ts` 的 `toPiApi`），用户配了这类供应商时「拉取模型」会 401。
- **要做**：`fetchProviderModels` 接受 `api` 与 `providerId`，按 wire 选端点与鉴权头。
  签名扩展后 `fetchPiCliProviderModels` 把 `raw.api` 一并传下去
  （`resolveProviderRuntimeConfigFromRaw` 需增回 `api` 字段）。
- **验收**：单测覆盖三条鉴权分支的 header 构造 + Ollama 端点选择（用 fetch mock，
  不打真实网络）。

### R4 · `testModel` 硬编码 `/chat/completions`（P1）

- **现象**：`piReader.testModel()` 固定 POST `/chat/completions` 与 OpenAI 风格
  body。pi-web-switch 的 `/api/pi/model-test` 接受 `apiType` 参数（默认
  `openai-completions`）。`anthropic-messages` 供应商的单模型测试必然失败。
- **要做**：与 R3 同批处理——`testModel` 接受 `api`，按 wire 选路径与 body 形状。
- **依赖**：R1 会重建 testModel 的调用方（改走 providerId），建议 R1 → R4 顺序做，
  避免改两遍签名。

### R5 · 面板看不到 pi 内置供应商（P1，信息缺口）

- **现象**：`readPiCliProviders()` 只遍历 `models.json` 的两个 bucket。本机
  `auth.json` 里有 `opencode`、`ant-ling`（`type: api_key`）与 `openai-codex`
  （`type: oauth`，含 `access`/`refresh`/`expires`/`accountId`）三家已授权的
  **pi 内置供应商**，面板完全不列——而 `settings.json` 的
  `defaultProvider` 恰好就是 `openai-codex`。用户在 Cindy 里看不到自己 pi 的默认
  供应商，也看不到那三家已登录。
- **对照**：pi-web-switch 有 `GET /api/pi/builtin-providers`，从
  `@earendil-works/pi-ai/dist/providers/data/*.json` 读内置目录（本机 39 个文件，
  5 分钟缓存），`mergeProviders` 把 `auth.json` 的登录态并进去。**但它的
  `ProvidersModelsPage` 左栏只列 `type === "custom"`**——内置供应商在那个页面上
  也是不可见的，只用于设置页的默认供应商下拉与 chat 的模型选择器。
- **决策点（需先定再做）**：Cindy 的这个面板要不要列内置供应商？
  - 若要：新增只读的「已授权的 Pi 内置供应商」分组（读 `auth.json` 的 key 集合 +
    pi-ai 目录名），OAuth 条目只显示「已登录」不显示任何 token 派生信息；
  - 若不要：至少在面板底部一句话说明「此处只列 `models.json` 里的自建供应商，
    pi 内置供应商在 Pi CLI 内管理」——否则「4 家」这个数字与用户在 pi 里看到的不符。
- **注意**：`readPiBundledModels`（`maker-host/pi-host.ts:378`）已经通过跑
  `pi` 子命令拿内置目录，但那是给 catalog 用的、带占位 key 的探测路径，语义与
  面板展示不同，不要直接复用。

### R6 · 遗留文案不一致（P2）

- zh-TW 同一模块 tab 叫「Pi 工作階段」、面板标题叫「Pi 會話」（存量，不在
  `check:i18n-glossary` 门禁范围）。上一轮 `PI-WORKBENCH-PROGRESS.md` 已记，仍未统一。
- `check:i18n-glossary` 现有 4 处 `proposed` 告警（`lead` 2 / `harness` 2），
  属术语未裁决，不阻断。

## 做余项时的约束

- **凭证边界是硬线**：Renderer 只拿遮罩串 + `hasApiKey` + `active` 标记，不新增任何
  「读取完整 key」路径。新通道一律「Renderer 传 providerId，主进程现取真 key」。
  见 `docs/dev-rules/electron-security-and-process-boundaries.md`。
- **判据以 pi 为准**：改动涉及「pi 会不会用这个字段」时，去读
  `~/.local/share/pi-node/current/lib/.../pi-coding-agent/dist/core/model-config.js`
  的 schema 与 `settings-manager.js` / `agent-session.js` / `interactive-mode.js` 的
  消费点，不要照抄 pi-web-switch——本轮 6 个问题里有 2 个是 pi-web-switch 也不对的
  （它的 `Model.enabled` 双源真相、`removeCustomProvider` 不清理 `enabledModels`）。
- **本面板只读**：增删改归 Pi CLI。唯一允许的「活」动作是只读探测（测连接、拉取
  模型、测模型），它们不写 `~/.pi/agent` 任何文件。R2 的导入/导出是既有的例外入口，
  不要在此之外新增写路径。
- **每项独立成 PR**，按仓库门禁验证：`pnpm --filter desktop typecheck` +
  `pnpm test:unit:related` + `pnpm check:i18n` + `pnpm check:i18n-glossary` + DCO
  签名（`git commit -s`）。涉及界面的项补 Light/Dark 双模式说明（做不到实机目检
  时如实写明哪种模式未验证）。

## 相关文件

- 主进程投影：`apps/desktop/src/main/pi-agent/piCliPanel.ts`
  （面板视图 + 运行时投影 + 探测入口）
- 主进程 IO 与探测：`apps/desktop/src/main/pi-agent/piReader.ts`
  （`testProviderConnection` / `testModel` / `fetchProviderModels` / 导入导出）
- IPC：`apps/desktop/src/main/maker-ipc/{channels,piAgentHandlers}.ts`
- 面板：`apps/desktop/src/renderer/components/settings/pi-providers/PiCliProvidersSection.tsx`
- 测速：`apps/desktop/src/renderer/hooks/usePiSpeedTest.ts` +
  `components/settings/pi-speedtest/PiSpeedTestSection.tsx`
- 测试：`apps/desktop/src/main/pi-agent/__tests__/piCliPanel.test.ts`（30 用例）
- 上一阶段台账：`PI-WORKBENCH-PROGRESS.md`、`PI-ONLY-REMAINING-WORK.md`

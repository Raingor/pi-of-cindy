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
- Phase 4: 登录页一键安装 PI 引导 — 完成
  - main/pi-agent/piInstaller.ts：复用受管下载链(prepare('pi')，CDN+SHA256，dev 走
    apps/pi-bin)→ 落盘 ~/.pi/bin/pi-runtime → unix symlink ~/.pi/bin/pi（Win 无特权
    symlink 失败回落目录形态 ~/.pi/bin/pi/）→ force 重探校验
  - 新 IPC maker:pi-local:install（PiInstallError 三错误码进统一 IPC 错误协议，
    ipc-errors.ts 注册）；preload/d.ts 增加 piLocal.install
  - 登录页 PiInstallCard：挂载查状态，未安装才渲染；进度听 binary-download-progress
    (vendor=pi)；安装完成即隐。 LoginPage 挂载于 stage 内容之后
  - i18n 5 语新增 login.piInstall.*；顺带修复第一轮移植遗留的 44 处术语门禁违规
    （会话→任务、折叠→收起、子代理→Subagent/Agent、harness→Harness、lead→Lead、
    ko 공급자→제공자），pnpm check:i18n-glossary 恢复通过
  - 安装位置注记：~/.pi/bin 未必在 shell PATH，Cindy 探测覆盖该目录不依赖 PATH，
    终端可见性由卡片 manualHint 文案说明
  - 验证：desktop typecheck 通过；pnpm test:unit:related 全过；check:i18n-glossary 通过
- Phase 5: 数据目录全切 ~/.pi/agent — 完成（真机跑任务验证待做）
  - pi-host resolvePiAgentHome 本地分支 → ~/.pi/agent（远端分支不变）；会话/run-tmp/
    权限档随之落 ~/.pi/agent，与已移植的 Pi Sessions/Memory 等 tab 同一数据源
  - pi-package-store packageHome → ~/.pi/agent（electron app import 随之移除），
    mutation lock 改为 <home>/.pi/agent.mutation.lock；扩展包页显示本机 pi 扩展
  - 澄清:models.json/settings.json 每会话隔离写在 run-tmp/<hex>,不覆盖用户真实
    models.json —— findings.md 原判断有误,已更正;maker-core 无需合并写入改动
  - 测试:pi-package-store-security.test 钉 os.homedir 到临时目录并更新路径断言(73 过)
  - 验证:desktop typecheck / test:unit:related 全过;maker-core 2 个真 pi 二进制
    integration 用例在本机超时/残留失败,为存量环境问题,与本次无关

## 2026-08-30 第三轮（Phase 6：供应商区切 pi 数据层）
- Phase 6 完成：Settings 供应商区整体切到 ~/.pi/agent 真实文件(pi-web-switch 数据层)
  - main/pi-agent/piProviders.ts：内置目录从本机 pi 安装的 pi-ai dist/providers/data
    读取(getCachedLocalPiPath → realpath 解析 symlink → 逐级向上找 node_modules，
    兜底 ~/.pi/bin/pi-runtime 与 ~/.local/share/pi-node)；listPiProviders 合并语义
    与 pi-web-switch 一致(models.json 同 id 带 apiKey=独立自定义供应商，不带=override
    并入 builtin)；密钥投影只出打码值(maskProviderKey)
  - 9 条新 IPC maker:pi-providers:*(语义化 CRUD，Renderer 不能整文件回写)；
    testProvider/testModel/fetchModels 增加 providerId 参数由 main 解析已存密钥；
    fetchProviderModels 升级为 pi-web-switch 完整版(Ollama/OpenRouter/启发式/HTML 检测)
  - ProvidersSection 重写(2473 行 → 约 950 行)：保留双栏卡片与 EnabledModelsPanel；
    左栏 builtin+custom 列表，右栏详情(打码密钥行/模型开关/添加删除)；9 种 API 格式
    添加表单 + 端点拉取勾选 + 批量写 enabledModels；模型开关 = settings.enabledModels 引用
  - shared/piProviderTypes.ts 为类型正本，main/renderer 共用；远程 allowlist 判定：
    本页为 Desktop Settings 专属面，不进 REMOTE_INVOKE_ALLOWLIST
  - i18n 5 语言新增 settings.providers.pi.*(75 行/语言，文本插入不重排原格式)；
    ko 공급자→제공자(术语门禁)，翻译不裸写小写 agent 路径
  - 测试：删除 3 个断言 Cindy store 行为的旧测试(行为已随数据层替换下架)；
    新增 piProviders.test.ts(13 用例)+ providersSectionPi.test.tsx(4 用例，含
    明文密钥不进 DOM 断言)
  - 验证：desktop typecheck 通过；pnpm test:unit:related 435 过 0 失败；
    check:i18n-glossary 通过
  - 遗留：真机跑桌面端目检 Light/Dark 双模式；重命名入口 UI 未暴露(后端已就绪)

/**
 * Shared Settings tab definitions — single source of truth for tab IDs and their i18n keys.
 *
 * Used by SettingsView (sidebar labels) and HelpThreadView ("Open X tab" button label).
 *
 * Retired ids (`ghosts` / `agent-island` / `help` / `about` / `api-keys` / `connections` …)
 * stay on the type + TAB_LABEL_KEY so old deep links keep resolving to a label; only
 * TAB_IDS decides what is visible and routable.
 */

export type SettingsTab =
  | 'general'
  | 'billing'
  | 'usage'
  | 'personalization'
  | 'providers'
  | 'api-keys'
  | 'voice-input'
  | 'shortcuts'
  | 'agent-island'
  | 'import'
  | 'connections'
  | 'remote-control'
  | 'tina'
  | 'ghosts'
  | 'builtin-tools'
  | 'pi-extensions'
  | 'computer-use'
  | 'im-bot'
  | 'pi-dashboard'
  | 'pi-sessions'
  | 'pi-memory'
  | 'pi-subagents'
  | 'pi-speedtest'
  | 'pi-packages'
  | 'help'
  | 'about';

export const TAB_IDS = [
  'general',
  'personalization',
  'providers',
  // ── Pi Agent 工具集(pi-web-switch 移植)──
  // 2026-09-02 用户指令:Pi 是本分支的主工作台,整块上移到「模型供应商」之后,
  // 不再排在常规设置尾部。
  'pi-dashboard',
  'pi-sessions',
  'pi-memory',
  'pi-subagents',
  'pi-speedtest',
  'pi-packages',
  // 「计费」(billing)与「用量历史」(usage)已下架:本分支只跑本机 Pi harness,
  // 账单与网关计量不再适用,用量口径统一由 Pi 仪表盘(pi-dashboard)承担。
  // 两个 id 仍留在 SettingsTab 类型与 TAB_LABEL_KEY 中,供旧深链重定向。
  // 「工具密钥」(api-keys)已于 2026-07-13 下架:面板里最后一把 mivo key 随
  // XD Mivo 意识化改由意识设置页收单(官方别名映射同一存储键)。id 仍留在
  // SettingsTab 类型与 TAB_LABEL_KEY 保留,供旧深链重定向到插件分区。
  // 「语音输入」(voice-input)与「IM 机器人」(im-bot)同样下架:两者都依赖
  // Cindy 云端语音/机器人服务,不属于本机 Pi 工作台范围。
  'shortcuts',
  'import',
  // 「第三方平台」(connections)已于 2026-07-15 下架:Slack 官方 MCP 随 cindy-slack
  // 意识化收尾(Google/Jira/GitHub/GitLab 此前已迁意识)。id 仍留在 SettingsTab
  // 类型与 TAB_LABEL_KEY 保留,供旧深链重定向到插件分区。
  'remote-control',
  'builtin-tools',
  'computer-use',
  // 2026-09-03 用户指令:「灵动岛」「插件」「帮助」「关于」四项从设置下架。
  //   - agent-island:mac 灵动岛服务与原生 host 保留,只是没有设置入口;
  //   - ghosts:插件目录在主侧栏「插件」(/plugins)已有常驻入口,设置内嵌是重复入口;
  //   - help / about:Cindy 自有的上手指引与关于页,不属于本机 Pi 工作台。
  // 四个 id 仍留在 SettingsTab 类型与 TAB_LABEL_KEY 中,供旧深链回落到通用页。
] as const satisfies ReadonlyArray<SettingsTab>;

export type VisibleSettingsTab = (typeof TAB_IDS)[number];

export const TAB_LABEL_KEY: Record<SettingsTab, string> = {
  general: 'settings.tabs.general',
  billing: 'settings.tabs.billing',
  usage: 'settings.tabs.usage',
  personalization: 'settings.tabs.personalization',
  'api-keys': 'settings.tabs.apiKeys',
  'voice-input': 'settings.tabs.voiceInput',
  shortcuts: 'settings.tabs.shortcuts',
  'agent-island': 'settings.tabs.agentIsland',
  import: 'settings.tabs.import',
  connections: 'settings.tabs.connections',
  providers: 'settings.tabs.providers',
  'remote-control': 'settings.tabs.remoteControl',
  tina: 'settings.tabs.tina',
  ghosts: 'settings.tabs.ghosts',
  'builtin-tools': 'settings.tabs.builtinTools',
  'pi-extensions': 'settings.tabs.piExtensions',
  'computer-use': 'settings.tabs.computerUse',
  'im-bot': 'settings.tabs.imBot',
  'pi-dashboard': 'settings.tabs.piDashboard',
  'pi-sessions': 'settings.tabs.piSessions',
  'pi-memory': 'settings.tabs.piMemory',
  'pi-subagents': 'settings.tabs.piSubagents',
  'pi-speedtest': 'settings.tabs.piSpeedtest',
  'pi-packages': 'settings.tabs.piPackages',
  help: 'settings.tabs.help',
  about: 'settings.tabs.about',
};

// 只校验当前「可见/可路由」的 tab(即 TAB_IDS 里的项)。注意 `tina` 与
// `pi-extensions` 仍保留在 SettingsTab 类型与 TAB_LABEL_KEY 中,分别供旧深链
// 重定向和通用页内嵌管理面板复用；二者都不是独立可停靠的一级 tab。
export function isSettingsTab(value: string | null): value is SettingsTab {
  return value !== null && (TAB_IDS as ReadonlyArray<string>).includes(value);
}

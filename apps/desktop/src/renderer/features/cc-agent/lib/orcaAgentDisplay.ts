export type OrcaDisplayAgentKind = 'claude-code' | 'codex';
export type OrcaDisplayVendor = 'cc' | 'codex';

export function normalizeOrcaDisplayAgentKind(agentKind: unknown): OrcaDisplayAgentKind {
  // pi 使用 OpenAI 兼容协议(同 codex),归入 codex 显示路径。
  if (agentKind === 'codex' || agentKind === 'pi') return 'codex';
  if (agentKind === 'cc' || agentKind === 'claude-code') return 'claude-code';
  return 'claude-code';
}

export function orcaAgentLabel(agentKind: OrcaDisplayAgentKind): string {
  return agentKind === 'codex' ? 'Codex' : 'Claude';
}

export function orcaVendorForAgentKind(agentKind: OrcaDisplayAgentKind): OrcaDisplayVendor {
  return agentKind === 'codex' ? 'codex' : 'cc';
}

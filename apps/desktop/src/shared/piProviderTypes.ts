/**
 * Pi provider view types —— Settings 供应商区(pi-web-switch 数据层)的共享投影类型。
 *
 * 正本在此;main 侧 piTypes.ts re-export,renderer 侧组件直接 import。
 * keyMasked 是打码展示值;明文密钥永不跨过 IPC 边界进入 Renderer。
 */

export interface PiProviderModelView {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image' | 'audio')[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

/** 供应商条目在 Settings 列表中的投影。 */
export interface PiProviderView {
  id: string;
  name: string;
  type: 'builtin' | 'custom';
  api?: string;
  baseUrl?: string;
  /** 该供应商存在已保存的密钥(auth.json 或 models.json apiKey override)。 */
  hasAuth: boolean;
  /** 打码后的密钥展示值;无密钥为 null。 */
  keyMasked: string | null;
  /** 密钥实际所在文件;无密钥为 null。 */
  authSource: 'auth' | 'modelsJson' | null;
  /** builtin 条目上存在 models.json override 块(合并了额外模型/baseUrl 覆写)。 */
  isOverride: boolean;
  models: PiProviderModelView[];
  /** settings.enabledModels 里属于该供应商的 "providerId/modelId" 引用。 */
  enabledModels: string[];
}

/** 写路径载荷;apiKey 只在用户输入新明文时携带,undefined 表示保持原值。 */
export interface PiCustomProviderInput {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: PiProviderModelView[];
}

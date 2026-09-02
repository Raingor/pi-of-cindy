/**
 * 供应商粘贴批量导入解析 —— 与 pi-web-switch 的 parseProviderImport 逐行对齐。
 *
 * 识别形如以下的自由文本（标签支持半/全角冒号；无标签 token 走启发式）：
 *   tokenrouter baseurl：https://api.example.com/v1 key：sk-xxxx
 *   modelid：vendor/model-a, vendor/model-b
 *
 * 纯函数、无副作用，单测见 parseProviderImport.test.ts。
 */

export interface ParsedProviderImport {
  name: string;
  baseUrl: string;
  /** 首把 key（向后兼容字段）；全部密钥见 apiKeys。 */
  apiKey: string;
  /** 依出现顺序收集的全部密钥（key-1/key-2/… 标签、重复 key: 标签、无标签 sk- 启发式），已去重。 */
  apiKeys: string[];
  modelIds: string[];
}

// 标签支持编号形态：key-1 / key_2 / key 3 / 密钥1 等；多把密钥全部收集。
const IMPORT_LABEL_RE =
  /(?<![\w/.\-])(apikey\d*|api_key\d*|api-key\d*|key-?\d*|keys?\d*|token\d*|secret\d*|密钥\d*|金錀\d*|baseurl|base_url|base-url|url|endpoint|地址|接口|provider|name|名称|名稱|供应商|供應商|model_ids?|modelids?|models?|模型)\s*[:：](?!\/\/)/gi;

function importField(label: string): 'name' | 'baseUrl' | 'apiKey' | 'models' {
  const l = label.toLowerCase();
  if (/^(?:apikey\d*|api_key\d*|api-key\d*|key-?\d*|keys?\d*|token\d*|secret\d*|密钥\d*|金錀\d*)$/.test(l)) return 'apiKey';
  if (/^(?:baseurl|base_url|base-url|url|endpoint|地址|接口)$/.test(l)) return 'baseUrl';
  if (/^(?:provider|name|名称|名稱|供应商|供應商)$/.test(l)) return 'name';
  return 'models';
}

export function parseProviderImport(raw: string): ParsedProviderImport {
  const out: ParsedProviderImport = { name: '', baseUrl: '', apiKey: '', apiKeys: [], modelIds: [] };
  const pushKey = (value: string) => {
    // 一行 key 标签的值可能是逗号分隔的多把 key，逐段收集。
    for (const part of value.split(/[\s,，;；]+/)) {
      const v = part.trim();
      if (v && !out.apiKeys.includes(v)) out.apiKeys.push(v);
    }
  };
  const pushModels = (value: string) => {
    for (const part of value.split(/[\s,，;；]+/)) {
      const v = part.trim();
      if (v && !out.modelIds.includes(v)) out.modelIds.push(v);
    }
  };
  const assignFree = (text: string) => {
    for (const token of text.split(/\s+/)) {
      const v = token.replace(/[,，;；]+$/, '');
      if (!v) continue;
      if (/^https?:\/\//i.test(v)) {
        if (!out.baseUrl) out.baseUrl = v;
      } else if (/^sk-\S{8,}$/i.test(v)) {
        // 无标签的 sk- token 全部入池（用户可能直接粘贴多把 key）。
        if (!out.apiKeys.includes(v)) out.apiKeys.push(v);
      } else if (/^[A-Za-z0-9_-]{32,}$/.test(v)) {
        if (out.apiKeys.length === 0) pushKey(v);
      } else if (v.includes('/')) {
        pushModels(v);
      } else if (!out.name) {
        // 标签行如「百灵：」会留下尾部冒号，剥掉。
        out.name = v.replace(/[:：]\s*$/, '').trim();
      }
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const matches = [...line.matchAll(IMPORT_LABEL_RE)];
    const head = (matches.length ? line.slice(0, matches[0]!.index) : line).trim();
    if (head) assignFree(head);
    matches.forEach((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1]!.index! : line.length;
      const value = line.slice(start, end).trim().replace(/[,，;；]+$/, '');
      if (!value) return;
      const field = importField(m[1] ?? '');
      if (field === 'models') pushModels(value);
      else if (field === 'apiKey') pushKey(value);
      else if (!out[field]) out[field] = value;
    });
  }
  out.apiKey = out.apiKeys[0] ?? '';
  return out;
}

/** 与 pi-web-switch maskKey 一致的浅遮罩（本文件仅供表单回显已粘贴的值）。 */
export function previewMaskKey(key: string): string {
  if (key.startsWith('$')) return key; // 环境变量引用——非机密
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/** http(s) URL 校验（pws isValidHttpUrl 同口径）。 */
export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 与 pws 一致的 9 种 pi 原生接口形态（value 与 main 侧 PI_CLI_API_TYPES 相同）。 */
export const PI_API_TYPES: { value: string; label: string }[] = [
  { value: 'openai-completions', label: 'Chat Completions (/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-codex-responses', label: 'OpenAI Codex Responses' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'google-vertex', label: 'Google Vertex AI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
  { value: 'mistral-conversations', label: 'Mistral' },
];

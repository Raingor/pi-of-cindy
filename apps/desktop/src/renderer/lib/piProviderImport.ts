/**
 * pi-web-switch ProvidersModelsPage 的自由文本导入解析器移植。
 *
 * 识别形如下列的粘贴文本（标签大小写不敏感，支持半角/全角冒号）：
 *   tokenrouter baseurl：https://api.example.com/v1 key：sk-xxxx
 *   modelid：vendor/model-a, vendor/model-b
 * 无标签的自由 token 按启发式归类：URL → baseUrl，sk-…/长随机串 → apiKey，
 * 带 "/" 的 token → 模型 id，其余 → 供应商显示名。
 */

export interface ParsedProviderImport {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
}

const IMPORT_LABEL_RE =
  /(?<![\w/.\-])(apikey|api_key|api-key|keys?|token|secret|密钥|金鑰|baseurl|base_url|base-url|url|endpoint|地址|接口|provider|name|名称|名稱|供应商|供應商|model_ids?|modelids?|models?|模型)\s*[:：](?!\/\/)/gi;

function importField(label: string): 'name' | 'baseUrl' | 'apiKey' | 'models' {
  const l = label.toLowerCase();
  if (/^(apikey|api_key|api-key|keys?|token|secret|密钥|金鑰)$/.test(l)) return 'apiKey';
  if (/^(baseurl|base_url|base-url|url|endpoint|地址|接口)$/.test(l)) return 'baseUrl';
  if (/^(provider|name|名称|名稱|供应商|供應商)$/.test(l)) return 'name';
  return 'models';
}

export function sanitizeProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 空名或纯符号名回落到端点 hostname 的可读段，保证拿得到合法 id。 */
export function deriveProviderId(name: string, baseUrl: string): string {
  const fromName = sanitizeProviderId(name);
  if (fromName || !name.trim()) return fromName;
  try {
    const host = new URL(baseUrl.trim()).hostname;
    const skip = new Set(['api', 'www', 'app', 'gateway', 'open', 'openapi', 'platform']);
    const part = host.split('.').find((p) => p && !skip.has(p.toLowerCase()));
    return sanitizeProviderId(part ?? '');
  } catch {
    return '';
  }
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseProviderImport(raw: string): ParsedProviderImport {
  const out: ParsedProviderImport = { name: '', baseUrl: '', apiKey: '', modelIds: [] };
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
      } else if (/^sk-\S{8,}$/i.test(v) || /^[A-Za-z0-9_-]{32,}$/.test(v)) {
        if (!out.apiKey) out.apiKey = v;
      } else if (v.includes('/')) {
        pushModels(v);
      } else if (!out.name) {
        // 标签行（如「百灵：」）可能把行首名带尾冒号 —— 去掉
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
      else if (!out[field]) out[field] = value;
    });
  }
  return out;
}

/**
 * Codex citation 归一化的独立模块。
 *
 * pi-only 改造(2026-08-31):CodexAgent / translator 运行时已删,但 desktop main 的
 * 历史导入后端(codex-local-sessions)与 localDb worker 仍需要与流式 completed 完全
 * 同口径的 citation 归一化。实现自原 agents/codex/translator.ts 原样搬出,
 * 供 agents/index barrel re-export,避免为两个纯函数保留 2k+ 行 translator。
 */

import {
  stableInternalWebCitationBoundary,
  stripInternalWebCitations,
} from '@cindy/maker-shared/internal-citation';

/**
 * Codex 正文里的内部文件引用标记 `:codex-file-citation{path="..." ...}`——对用户
 * 是不可读的内部语法,归一化成行内代码的文件路径。没有 path 属性的畸形标记整个
 * 剥掉,不把内部语法漏给用户。
 */
// 属性区 = 「非引号非花括号字符 或 双引号串」的序列:双引号串内允许出现 { } ,
// 且支持反斜杠转义(\" 表示文件名里的引号)——路径含花括号 / 引号都不会让标记
// 匹配失败而把内部语法漏给用户。
const CODEX_FILE_CITATION_RE = /:codex-file-citation\{((?:[^"{}]|"(?:[^"\\]|\\.)*")*)\}/g;
const CODEX_FILE_CITATION_OPEN = ':codex-file-citation{';

/**
 * 路径包成 Markdown 行内代码:围栏取「比路径内最长反引号连跑多一个」的反引号数,
 * 路径以反引号开头/结尾时按 CommonMark 规则两侧补空格——路径自身含反引号也不会
 * 把 code span 撑破。
 */
function inlineCodePath(path: string): string {
  const longestRun = path.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const fence = '`'.repeat(longestRun + 1);
  // 补空格垫的两种情形:路径以反引号开头/结尾(隔开围栏),或首尾都是空格且非全空格
  // (CommonMark 渲染器对这种 code span 会各剥一个空格,不垫会把真实路径的首尾空白
  // 剥掉指向别的文件;单侧空格渲染器不剥,不垫)。
  const symmetricSpace = path.startsWith(' ') && path.endsWith(' ') && path.trim().length > 0;
  const pad = path.startsWith('`') || path.endsWith('`') || symmetricSpace ? ' ' : '';
  return `${fence}${pad}${path}${pad}${fence}`;
}

export function normalizeCodexFileCitations(text: string): string {
  if (!text.includes(CODEX_FILE_CITATION_OPEN)) return text;
  return text.replace(CODEX_FILE_CITATION_RE, (_all, attrs: string) => {
    const path = extractCitationPath(attrs);
    return path ? inlineCodePath(path) : '';
  });
}

/**
 * 属性区取 path 值并解码。
 * - 属性名要求完整边界(串首或空白后的 `path=`):`display_path=` 这类「以 path 结尾」
 *   的别名不当作 path,也不遮蔽其后真正的 path 属性(review 反馈)。
 * - 只解 \" 与 \\ 两种转义——Windows 原生路径(C:\Users\...)里的反斜杠不是转义
 *   前缀,全量 \\(.) 反转义会把路径毁成 C:Users...(review 反馈)。
 * - UNC 前缀:开头**恰好两个**反斜杠视为原生 UNC 本体整体保留(\\server\share);
 *   更长的开头连跑(如转义形态 \\\\server)与其余位置按转义对解码,转义 UNC 解出
 *   恰好两个分隔符(review 反馈)。
 * - 取出后不做 trim——文件名首尾空白是路径的一部分,悄悄改写会指向另一个文件。
 */
function extractCitationPath(attrs: string): string | undefined {
  const raw = /(?:^|\s)path="((?:[^"\\]|\\.)*)"/.exec(attrs)?.[1];
  if (raw === undefined) return undefined;
  const nativeUnc = raw.startsWith('\\\\') && raw[2] !== '\\';
  const head = nativeUnc ? '\\\\' : '';
  const tail = (nativeUnc ? raw.slice(2) : raw).replace(/\\([\\"])/g, '$1');
  return head + tail;
}

// 闭合扫描的两种「未找到」:UNFINISHED = 扫描到文本末尾仍未闭合(可能是尚未写完、
// 会被后续 update 补全的截断尾巴);POISONED = 属性区出现裸 `{`,正则永不匹配,该
// 标记已确定畸形且追加文本也不会改变这一判定。
const CITATION_UNFINISHED = -1;
const CITATION_POISONED = -2;

/**
 * 属性区闭合 `}` 的位置(与 CODEX_FILE_CITATION_RE 同一口径:双引号串内的花括号
 * 不算边界);找不到时区分 CITATION_UNFINISHED 与 CITATION_POISONED。
 */
function findCitationClose(text: string, attrsStart: number): number {
  let inQuote = false;
  for (let i = attrsStart; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote && ch === '\\') {
      i += 1; // 引号串内的转义对(如 \")整体跳过,与正则同口径。
    } else if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && ch === '}') {
      return i;
    } else if (!inQuote && ch === '{') {
      return CITATION_POISONED;
    }
  }
  return CITATION_UNFINISHED;
}

/**
 * 从左到右结构化扫描,返回第一个「扫描到文本末尾仍未闭合」的标记开头;没有 → -1。
 * 完整标记整体跳过——路径引号串里出现的 OPEN 字面量属于已消费标记的内部,不会被
 * 误认成新的开头(review 反馈:文件名本身含 `:codex-file-citation{` 时,按最后一个
 * 裸字面量定位会带着错误的引号状态把完整标记判成未完成)。裸 `{` 的畸形标记(正则
 * 永不匹配、追加文本也救不回来)原样透出:只跳过开头字面量继续扫,不吞它后面的正文。
 */
function findUnfinishedCitationOpen(text: string): number {
  let from = 0;
  for (;;) {
    const open = text.indexOf(CODEX_FILE_CITATION_OPEN, from);
    if (open === -1) return -1;
    const close = findCitationClose(text, open + CODEX_FILE_CITATION_OPEN.length);
    if (close === CITATION_UNFINISHED) return open;
    from = close === CITATION_POISONED ? open + CODEX_FILE_CITATION_OPEN.length : close + 1;
  }
}

/**
 * final 文本统一口径(流式 completed 与历史 rollout 导入共用):先剥「扫描到文本
 * 末尾仍未闭合」的确定截断残尾(它之后没有正文可吞),再做 citation 归一化。
 * 契约:只做 raw→final 的**单次**转换(两个调用点都满足)。无标记文本原样返回,
 * 但展示形不承诺严格幂等——路径本身解码出完整标记字面量的极端文件名,二次处理
 * 会把生成的 code span 内容再替换;去重指纹因此不复用展示形,走独立的不动点
 * 规范形(见 localDb worker 的 canonicalizeCodexCitations)。
 */
export function finalizeCodexCitationText(text: string): string {
  const fileOpenAt = findUnfinishedCitationOpen(text);
  const fileStableEnd = fileOpenAt === -1 ? text.length : fileOpenAt;
  const stableEnd = Math.min(fileStableEnd, stableInternalWebCitationBoundary(text));
  return stripInternalWebCitations(normalizeCodexFileCitations(text.slice(0, stableEnd)));
}

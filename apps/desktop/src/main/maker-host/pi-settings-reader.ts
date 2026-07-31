/**
 * pi-settings-reader — 读写 `~/.pi/agent/` 目录下的 pi 配置文件。
 *
 * pi 自管其配置（settings.json / auth.json / models.json）和 npm 扩展
 * （~/.pi/agent/npm/）。Cindy 不注入凭证，只提供 UI 供用户查看/编辑
 * pi 的设置和扩展、检查更新、导入导出配置。
 *
 * 安全边界：
 *  - 所有文件操作限制在 `~/.pi/agent/` 目录内
 *  - 不读取/返回 auth.json 的密钥明文（只返回 provider id 列表）
 *  - npm install 只在 ~/.pi/agent/npm/ 目录内执行
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PI_DIR = join(homedir(), '.pi', 'agent');

// ─── Types ──────────────────────────────────────────────

export interface PiSettings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  defaultProjectTrust?: string;
  theme?: 'light' | 'dark' | 'light/dark';
  hideThinkingBlock?: boolean;
  retry?: { enabled: boolean };
  packages?: string[];
  terminal?: { showTerminalProgress?: boolean };
  warnings?: Record<string, boolean>;
  treeFilterMode?: string;
  doubleEscapeAction?: string;
  enabledModels?: string[];
}

export interface PiAuthEntry {
  type: 'api_key' | 'oauth';
  /** Whether an API key is set (without revealing the key itself). */
  hasKey: boolean;
  env?: Record<string, string>;
}

export type PiAuth = Record<string, PiAuthEntry>;

export interface PiModelsJson {
  providers: Record<string, unknown>;
}

export interface PiConfigSnapshot {
  settings: PiSettings | null;
  /** Auth entries with key presence flags (never raw key material). */
  auth: PiAuth | null;
  modelsJson: PiModelsJson | null;
}

export interface PiPackageEntry {
  name: string;
  version: string;
}

export interface UpdateItem {
  name: string;
  installed: string;
  latest: string | null;
  hasUpdate: boolean;
}

export interface UpdateCheckResult {
  pi: UpdateItem | null;
  extensions: UpdateItem[];
  checkedAt: number;
}

export interface ApplyUpdateResult {
  name: string;
  success: boolean;
  message?: string;
}

// ─── Path helpers ───────────────────────────────────────

function piPath(filename: string): string {
  return join(PI_DIR, filename);
}

function readJson<T>(filename: string): T | null {
  const path = piPath(filename);
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Settings ───────────────────────────────────────────

export function readPiSettings(): PiSettings | null {
  return readJson<PiSettings>('settings.json');
}

export function writePiSettings(settings: PiSettings): boolean {
  try {
    const path = piPath('settings.json');
    const raw = JSON.stringify(settings, null, 2);
    writeFileSync(path, raw, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ─── Auth (key-presence only, never raw keys) ───────────

export function readPiAuthSafe(): PiAuth | null {
  const raw = readJson<Record<string, { type?: string; key?: string; env?: Record<string, string> }>>('auth.json');
  if (!raw) return null;
  const safe: PiAuth = {};
  for (const [providerId, entry] of Object.entries(raw)) {
    safe[providerId] = {
      type: (entry.type === 'oauth' ? 'oauth' : 'api_key'),
      hasKey: typeof entry.key === 'string' && entry.key.length > 0,
      ...(entry.env ? { env: entry.env } : {}),
    };
  }
  return safe;
}

// ─── Models (custom providers) ──────────────────────────

export function readPiModels(): PiModelsJson | null {
  return readJson<PiModelsJson>('models.json');
}

// ─── Config snapshot ────────────────────────────────────

export function readPiConfigSnapshot(): PiConfigSnapshot {
  return {
    settings: readPiSettings(),
    auth: readPiAuthSafe(),
    modelsJson: readPiModels(),
  };
}

// ─── Packages / Extensions ──────────────────────────────

const PI_NPM_DIR = join(PI_DIR, 'npm');

// ─── npm binary resolution ─────────────────────────────
// Electron launched from Finder/Dock inherits a minimal PATH (/usr/bin:/bin:…)
// that doesn't include nvm/homebrew/pnpm npm locations. Resolve npm once and
// cache it so subsequent install/uninstall calls don't re-shell-out each time.
let cachedNpmPath: string | null | undefined;

function resolveNpmPath(): string | null {
  if (cachedNpmPath !== undefined) return cachedNpmPath;

  // 1. Try `which npm` via a login shell — picks up nvm/homebrew/pnpm paths.
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const out = spawnSync(
      shell,
      ['-l', '-i', '-c', 'which npm'],
      { encoding: 'utf8', timeout: 10000 },
    );
    if (out.status === 0) {
      const p = out.stdout.trim();
      if (p && existsSync(p)) {
        cachedNpmPath = p;
        return p;
      }
    }
  } catch {
    // fall through to candidates
  }

  // 2. Try common npm binary locations.
  const candidates = [
    '/usr/local/bin/npm',        // Homebrew (Intel Mac)
    '/opt/homebrew/bin/npm',     // Homebrew (Apple Silicon)
    join(homedir(), '.npm-global/bin/npm'),
    join(homedir(), '.local/share/pnpm/npm'),
    join(homedir(), '.nvm/versions/node'),  // nvm — need to scan subdirs
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      // nvm dir needs subdirectory scan (e.g. ~/.nvm/versions/node/v22.23.1/bin/npm)
      if (c.endsWith('/node')) {
        try {
          const versions = readdirSync(c);
          for (const v of versions) {
            const npmBin = join(c, v, 'bin', 'npm');
            if (existsSync(npmBin)) {
              cachedNpmPath = npmBin;
              return npmBin;
            }
          }
        } catch {
          // ignore
        }
      } else {
        cachedNpmPath = c;
        return c;
      }
    }
  }

  // 3. Fall back to bare 'npm' — might work if PATH happens to include it.
  cachedNpmPath = null;
  return null;
}

function npmSpawnSync(args: string[], opts: { cwd: string; timeout: number }) {
  const npmPath = resolveNpmPath();
  const execCmd = npmPath ?? 'npm';
  return spawnSync(execCmd, args, { ...opts, encoding: 'utf8' });
}

export function listPiPackages(): PiPackageEntry[] {
  const manifest = readJsonFile<{ dependencies?: Record<string, string> }>(
    join(PI_NPM_DIR, 'package.json'),
  );
  if (!manifest?.dependencies) return [];
  return Object.keys(manifest.dependencies).map((name) => {
    const pkg = readJsonFile<{ version?: string }>(
      join(PI_NPM_DIR, 'node_modules', name, 'package.json'),
    );
    return { name, version: pkg?.version ?? 'unknown' };
  });
}

export function addPiPackage(name: string): boolean {
  try {
    const out = npmSpawnSync(
      ['install', name, '--no-audit', '--no-fund', '--legacy-peer-deps'],
      { cwd: PI_NPM_DIR, timeout: 120000 },
    );
    return out.status === 0;
  } catch {
    return false;
  }
}

export function removePiPackage(name: string): boolean {
  try {
    const out = npmSpawnSync(
      ['uninstall', name, '--no-audit', '--no-fund', '--legacy-peer-deps'],
      { cwd: PI_NPM_DIR, timeout: 60000 },
    );
    return out.status === 0;
  } catch {
    return false;
  }
}

// ─── Update Check (npm registry) ────────────────────────

const PI_CORE_PACKAGE = '@earendil-works/pi-coding-agent';
const REGISTRY_TIMEOUT_MS = 8000;

function getPiVersion(): string | null {
  const candidates = [
    process.env.PI_BINARY,
    'pi',
    `${homedir()}/.local/share/pnpm/pi`,
    `${homedir()}/.npm-global/bin/pi`,
    `${homedir()}/.npm-packages/bin/pi`,
  ].filter(Boolean) as string[];

  for (const bin of candidates) {
    try {
      const out = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (out.status === 0) {
        const v = out.stdout.trim();
        if (v) return v;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function isNewerVersion(installed: string, latest: string): boolean {
  const parse = (v: string) =>
    (v.replace(/^v/, '').split('-')[0] ?? '').split('.').map((s) => parseInt(s, 10) || 0);
  const a = parse(installed);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (bi > ai) return true;
    if (bi < ai) return false;
  }
  return false;
}

async function fetchLatestVersion(pkgName: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`,
      { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS), headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export async function checkPiUpdates(): Promise<UpdateCheckResult> {
  const piVersion = getPiVersion();
  const extensions = listPiPackages();

  const toItem = async (name: string, installed: string): Promise<UpdateItem> => {
    const latest = await fetchLatestVersion(name);
    return {
      name,
      installed,
      latest,
      hasUpdate: latest !== null && installed !== 'unknown' && isNewerVersion(installed, latest),
    };
  };

  const [piItem, ...extItems] = await Promise.all([
    piVersion ? toItem(PI_CORE_PACKAGE, piVersion) : Promise.resolve(null),
    ...extensions.map((e) => toItem(e.name, e.version)),
  ]);

  return {
    pi: piItem,
    extensions: extItems,
    checkedAt: Date.now(),
  };
}

export function applyPiExtensionUpdates(names: string[]): ApplyUpdateResult[] {
  const installed = new Set(listPiPackages().map((e) => e.name));
  return names.map((name) => {
    if (!installed.has(name)) {
      return { name, success: false, message: 'not an installed extension' };
    }
    try {
      const out = npmSpawnSync(
        ['install', `${name}@latest`, '--no-audit', '--no-fund', '--legacy-peer-deps'],
        { cwd: PI_NPM_DIR, timeout: 120000 },
      );
      if (out.status === 0) return { name, success: true };
      const stderr = (out.stderr || '').trim().split('\n').slice(-3).join(' ');
      return { name, success: false, message: stderr || `npm exited with ${out.status}` };
    } catch (e) {
      return { name, success: false, message: String(e) };
    }
  });
}

// ─── Import / Export ────────────────────────────────────

export interface PiExportPayload {
  version: string;
  exportedAt: string;
  config: {
    settings: PiSettings | null;
    auth: Record<string, unknown> | null;
    modelsJson: PiModelsJson | null;
  };
}

export function exportPiConfig(): PiExportPayload {
  const settings = readPiSettings();
  const auth = readJson<Record<string, unknown>>('auth.json');
  const modelsJson = readPiModels();
  return {
    version: '0.1.0',
    exportedAt: new Date().toISOString(),
    config: { settings, auth, modelsJson },
  };
}

export function importPiConfig(payload: PiExportPayload): boolean {
  try {
    if (payload.config.settings) {
      writePiSettings(payload.config.settings);
    }
    if (payload.config.auth && typeof payload.config.auth === 'object') {
      const path = piPath('auth.json');
      writeFileSync(path, JSON.stringify(payload.config.auth, null, 2), 'utf-8');
    }
    if (payload.config.modelsJson) {
      const path = piPath('models.json');
      writeFileSync(path, JSON.stringify(payload.config.modelsJson, null, 2), 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

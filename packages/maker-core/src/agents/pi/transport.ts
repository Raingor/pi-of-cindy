/**
 * PiStdioTransport — spawn `pi --mode rpc`, 接 stdin/stdout JSONL 流。
 *
 * 镜像 codex/app-server/stdioTransport.ts 的 spawn + onLine/onStderr/onClose
 * 模式，但两处针对 pi RPC 协议调整（见 pi docs/rpc.md "Framing"）：
 *  - args 用 `['--mode','rpc', ...extraArgs]`（不是 codex 的 `['app-server']`）
 *  - **不用 node:readline** —— pi rpc.md 明确 readline 不合规（在 U+2028 / U+2029
 *    切分，而它们在 JSON 字符串里合法）。改用 buffer + indexOf('\n') 手动切分，
 *    与 pi docs 的 Node 示例一致。
 *
 * Lifecycle 与 codex StdioTransport 一致：构造时 spawn，stdout 按行 fan-out，
 * stderr 按行 fan-out（诊断用），close() → stdin EOF 优先 + SIGTERM 兜底。
 *
 * LineHandler / StderrHandler / CloseHandler 类型从 codex transport 复用，保持
 * 与既有 maker-core 事件循环签名一致（host 侧无需为 pi 单独适配）。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  CloseHandler,
  LineHandler,
  StderrHandler,
} from '../codex/app-server/transport.js';

export interface PiStdioTransportOptions {
  /** `pi` 可执行文件绝对路径（host 已探测本地 pi，maker-core 不负责下载）。 */
  binaryPath: string;
  /** 子进程 cwd；不传则继承父进程。 */
  cwd?: string;
  /** 子进程 env（host 拼好的，已含 PATH 等）。 */
  env?: NodeJS.ProcessEnv;
  /** `--mode rpc` 之后的额外参数（如 --session-dir / --no-session / --name）。 */
  extraArgs?: string[];
}

export interface PiTransport {
  writeLine(line: string): Promise<void>;
  request(command: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  onLine(handler: LineHandler): () => void;
  onStderr(handler: StderrHandler): () => void;
  onClose(handler: CloseHandler): () => void;
  close(reason?: string): Promise<void>;
  /** 子进程 pid（诊断用，spawn 失败后为 null）。 */
  readonly pid: number | null;
}

export function createPiStdioTransport(opts: PiStdioTransportOptions): PiTransport {
  if (!opts.binaryPath) {
    throw new Error('createPiStdioTransport: binaryPath is required');
  }

  const lineHandlers = new Set<LineHandler>();
  const stderrHandlers = new Set<StderrHandler>();
  const closeHandlers = new Set<CloseHandler>();
  const pendingRequests = new Map<
    string,
    { resolve: (resp: Record<string, unknown>) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  let nextRequestId = 1;
  /**
   * pi 在 spawn 后、首个 onLine 订阅前就可能往 stdout 吐 line（ready 事件等）。
   * 先 buffer，首个订阅注册时按序 drain，避免竞态丢行。与 codex StdioTransport
   * 同款兜底。
   */
  const lineBuffer: string[] = [];
  let lineHandlerArmed = false;
  let closed = false;

  const args = ['--mode', 'rpc', ...(opts.extraArgs ?? [])];
  const child: ChildProcessWithoutNullStreams = spawn(opts.binaryPath, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // 不走 shell：pi 路径与参数都由 host 控制，走 shell 反而引入 env injection 风险。
    shell: false,
    // 与父进程同 process group，父进程退出时一并被收割。
    detached: false,
  });

  // stdout JSONL 解析：严格按 \n 切分（pi rpc.md 合规要求，不用 readline）。
  child.stdout.setEncoding('utf8');
  let stdoutBuffer = '';
  const dispatchLine = (rawLine: string) => {
    // 接受可选的 \r\n，剥掉尾部 \r（与 pi docs Node 示例一致）。
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    // 响应帧：若存在匹配的 pending request，resolve 它而非走 lineHandlers。
    if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line) as { type?: string; id?: string };
        if (parsed?.type === 'response' && parsed?.id) {
          const pending = pendingRequests.get(parsed.id);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRequests.delete(parsed.id);
            pending.resolve(parsed as Record<string, unknown>);
            return;
          }
        }
      } catch {
        // 非 JSON 或解析失败：继续走 lineHandlers
      }
    }
    if (!lineHandlerArmed) {
      lineBuffer.push(line);
      return;
    }
    for (const cb of lineHandlers) cb(line);
  };
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    // 循环切出所有完整行，剩余留在 buffer 等下个 chunk。
    while (true) {
      const idx = stdoutBuffer.indexOf('\n');
      if (idx === -1) break;
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      dispatchLine(line);
    }
  });
  child.stdout.on('end', () => {
    // EOF 时把残余 buffer（末行无换行的情况）也吐出去。
    if (stdoutBuffer.length > 0) dispatchLine(stdoutBuffer);
    stdoutBuffer = '';
  });

  // stderr 当诊断信息流，不参与协议。按行 fan-out，client 层做 ANSI 剥除 / 分级。
  child.stderr.setEncoding('utf8');
  let stderrBuffer = '';
  child.stderr.on('data', (chunk: string) => {
    stderrBuffer += chunk;
    const idx = stderrBuffer.lastIndexOf('\n');
    if (idx === -1) return;
    const lines = stderrBuffer.slice(0, idx).split('\n');
    stderrBuffer = stderrBuffer.slice(idx + 1);
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      for (const cb of stderrHandlers) cb(trimmed);
    }
  });

  const fireClose = (reason: string): void => {
    if (closed) return;
    closed = true;
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`pi transport closed (${reason})`));
    }
    pendingRequests.clear();
    for (const cb of closeHandlers) {
      try {
        cb({ reason });
      } catch {
        /* handler should not throw */
      }
    }
  };

  child.on('error', (err) => {
    fireClose(`child error: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    const reason = signal ? `signal=${signal}` : `exit code=${code ?? 'null'}`;
    fireClose(`child exited (${reason})`);
  });

  return {
    pid: child.pid ?? null,

    writeLine(line: string): Promise<void> {
      if (closed || !child.stdin.writable) {
        return Promise.reject(
          new Error('PiStdioTransport.writeLine after close'),
        );
      }
      return new Promise<void>((resolve, reject) => {
        child.stdin.write(line + '\n', 'utf8', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    request(command: Record<string, unknown>, timeoutMs = 30_000): Promise<Record<string, unknown>> {
      if (closed || !child.stdin.writable) {
        return Promise.reject(
          new Error('PiStdioTransport.request after close'),
        );
      }
      const id = `req-${nextRequestId++}`;
      const payload = { ...command, id };
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error(`pi request ${command.type as string} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pendingRequests.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify(payload) + '\n', 'utf8', (err) => {
          if (err) {
            clearTimeout(timer);
            pendingRequests.delete(id);
            reject(err);
          }
        });
      });
    },

    onLine(handler: LineHandler): () => void {
      lineHandlers.add(handler);
      // 首个订阅：drain buffer（spawn 到首订阅间收到的行）。
      if (!lineHandlerArmed) {
        lineHandlerArmed = true;
        if (lineBuffer.length > 0) {
          const drained = lineBuffer.splice(0);
          for (const line of drained) {
            for (const cb of lineHandlers) cb(line);
          }
        }
      }
      return () => {
        lineHandlers.delete(handler);
      };
    },

    onStderr(handler: StderrHandler): () => void {
      stderrHandlers.add(handler);
      return () => {
        stderrHandlers.delete(handler);
      };
    },

    onClose(handler: CloseHandler): () => void {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },

    async close(reason = 'PiStdioTransport.close()'): Promise<void> {
      if (closed) return;
      // 优雅关：先 stdin EOF（pi 看到会自己退），再 SIGTERM 兜底。
      try {
        child.stdin.end();
      } catch {
        /* swallow */
      }
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* swallow */
        }
      }
      fireClose(reason);
    },
  };
}

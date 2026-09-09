import { createHash } from 'node:crypto';

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  projectLiteralUserText,
  readAgentInputReferences,
  type AgentInputSessionReference,
} from '@cindy/maker-shared/agent-input-projection';

import type { AgentMeta } from '../../renderer/lib/ccAgent.types.js';
import { markSessionNeedsAttention } from '../appBadgeService.js';
import { getDbClient } from '../localDb/client/current.js';
import { getSelfDeviceId, remoteInvoke } from '../device-link/index.js';
import * as broadcastTap from '../device-link/broadcast-tap.js';
import { createMessage, updateAgentMeta } from '../localDb/ipc/messages.js';
import { messages, sessions } from '../localDb/schema.js';
import { createLogger } from '../logger.js';

const log = createLogger('taskNotifications');
const MAX_NOTIFICATION_BODY_CHARS = 4_000;

const sessionLocks = new Map<string, Promise<void>>();
type OwnerScope = ReturnType<typeof broadcastTap.captureDataOwnerBroadcastScope>;
type OwnerScopeGuard = () => boolean;

function captureOwnerScope(): OwnerScope | null | undefined {
  try {
    const capture = broadcastTap.captureDataOwnerBroadcastScope;
    return capture ? capture() : undefined;
  } catch {
    return undefined;
  }
}

function isOwnerScopeCurrent(scope: OwnerScope | null | undefined): boolean {
  if (scope === null) return true;
  if (scope === undefined) return false;
  try {
    return broadcastTap.isDataOwnerBroadcastScopeCurrent?.(scope) === true;
  } catch {
    return false;
  }
}

export async function withTaskNotificationSessionLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionLocks.set(sessionId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId);
  }
}

/** Acquire multiple session locks in a stable order to avoid A↔B mention deadlocks. */
export function withTaskNotificationSessionLocks<T>(
  sessionIds: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(sessionIds.filter(Boolean))].sort();
  const acquire = (index: number): Promise<T> =>
    index >= ordered.length
      ? operation()
      : withTaskNotificationSessionLock(ordered[index], () => acquire(index + 1));
  return acquire(0);
}

export interface TaskNotificationMeta {
  sourceSessionId: string;
  sourceMessageClientId: string;
  sourceDeviceId: string | null;
  sourceSessionTitle: string | null;
  targetSessionTitle: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface TaskNotificationChangedPayload {
  sessionId: string;
  unread: boolean;
}

interface ParsedNotificationSource {
  body: string;
  targetReferences: AgentInputSessionReference[];
}

export type TaskNotificationChangedBroadcaster = (
  payload: TaskNotificationChangedPayload,
) => void;

interface RemoteDeliveryInput {
  sourceSessionId: string;
  sourceMessageClientId: string;
  sourceDeviceId: string | null;
  sourceSessionTitle: string | null;
  targetSessionId: string;
  targetSessionTitle: string | null;
  body: string;
  createdAt: string;
}

function readRemoteDeliveryInput(value: unknown): RemoteDeliveryInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sourceSessionId !== 'string' ||
    !candidate.sourceSessionId ||
    typeof candidate.sourceMessageClientId !== 'string' ||
    !candidate.sourceMessageClientId ||
    typeof candidate.targetSessionId !== 'string' ||
    !candidate.targetSessionId ||
    typeof candidate.body !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) {
    return null;
  }
  return {
    sourceSessionId: candidate.sourceSessionId,
    sourceMessageClientId: candidate.sourceMessageClientId,
    sourceDeviceId: typeof candidate.sourceDeviceId === 'string' ? candidate.sourceDeviceId : null,
    sourceSessionTitle:
      typeof candidate.sourceSessionTitle === 'string' ? candidate.sourceSessionTitle : null,
    targetSessionId: candidate.targetSessionId,
    targetSessionTitle:
      typeof candidate.targetSessionTitle === 'string' ? candidate.targetSessionTitle : null,
    body: candidate.body.slice(0, MAX_NOTIFICATION_BODY_CHARS),
    createdAt: candidate.createdAt,
  };
}

function parsePersistedEnvelope(content: unknown): {
  text: string;
  quotesEncoded: boolean;
  agentReferences: unknown;
} | null {
  let parsed = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.text !== 'string') return null;
  return {
    text: envelope.text,
    quotesEncoded: envelope.quotesEncoded === true,
    agentReferences: envelope.agentReferences,
  };
}

/**
 * 从持久 user content 中读取任务 mention。引用跨度必须仍与正文里的深链逐字对应，
 * 校验沿用 maker-shared 的统一解析器；通知正文只保留用户自己写下的文字。
 */
export function parseTaskNotificationSource(content: unknown): ParsedNotificationSource | null {
  const envelope = parsePersistedEnvelope(content);
  if (!envelope) return null;
  const references = readAgentInputReferences(envelope.agentReferences, envelope.text);
  const targetReferences = references.filter(
    (reference): reference is AgentInputSessionReference => reference.kind === 'session',
  );
  if (targetReferences.length === 0) return null;
  const body = projectLiteralUserText({
    text: envelope.text,
    quotesEncoded: envelope.quotesEncoded,
    agentReferences: references,
  }).slice(0, MAX_NOTIFICATION_BODY_CHARS);
  return { body, targetReferences };
}

function notificationClientId(sourceSessionId: string, sourceMessageClientId: string): string {
  const digest = createHash('sha256')
    .update(`${sourceSessionId}\u0000${sourceMessageClientId}`)
    .digest('hex')
    .slice(0, 32);
  return `task-notification:${digest}`;
}

function parseAgentMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readTaskNotificationMeta(value: unknown): TaskNotificationMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sourceSessionId !== 'string' ||
    !candidate.sourceSessionId ||
    typeof candidate.sourceMessageClientId !== 'string' ||
    !candidate.sourceMessageClientId ||
    typeof candidate.body !== 'string' ||
    typeof candidate.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    sourceSessionId: candidate.sourceSessionId,
    sourceMessageClientId: candidate.sourceMessageClientId,
    sourceDeviceId: typeof candidate.sourceDeviceId === 'string' ? candidate.sourceDeviceId : null,
    sourceSessionTitle:
      typeof candidate.sourceSessionTitle === 'string' ? candidate.sourceSessionTitle : null,
    targetSessionTitle:
      typeof candidate.targetSessionTitle === 'string' ? candidate.targetSessionTitle : null,
    body: candidate.body.slice(0, MAX_NOTIFICATION_BODY_CHARS),
    createdAt: candidate.createdAt,
    readAt: typeof candidate.readAt === 'string' ? candidate.readAt : null,
  };
}

function referenceDeviceId(reference: AgentInputSessionReference): string | null {
  try {
    return new URL(reference.href).searchParams.get('device');
  } catch {
    return null;
  }
}

async function persistTaskNotificationUnlocked(
  input: RemoteDeliveryInput,
  broadcastChanged: TaskNotificationChangedBroadcaster,
  isOwnerCurrent: OwnerScopeGuard = () => true,
  ownerScope: OwnerScope | null | undefined = null,
): Promise<boolean> {
  if (!isOwnerCurrent()) return false;
  const db = getDbClient().drizzle;
  const [target] = await db
    .select({ title: sessions.title, agentKind: sessions.agentKind, clearedAt: sessions.clearedAt })
    .from(sessions)
    .where(and(eq(sessions.id, input.targetSessionId), ne(sessions.status, 'deleted')))
    .limit(1);
  if (!target) return false;
  const createdAtMs = Date.parse(input.createdAt);
  if (createdAtMs <= (target.clearedAt ?? -Infinity) || !isOwnerCurrent()) return false;
  const notification: TaskNotificationMeta = {
    sourceSessionId: input.sourceSessionId,
    sourceMessageClientId: input.sourceMessageClientId,
    sourceDeviceId: input.sourceDeviceId,
    sourceSessionTitle: input.sourceSessionTitle,
    targetSessionTitle: input.targetSessionTitle ?? (target.title?.trim() || null),
    body: input.body,
    createdAt: input.createdAt,
    readAt: null,
  };
  if (!isOwnerCurrent()) return false;
  const message = await createMessage(input.targetSessionId, {
    clientId: notificationClientId(input.sourceSessionId, input.sourceMessageClientId),
    role: 'assistant',
    content: '',
    agentKind: target.agentKind === 'codex' || target.agentKind === 'pi' ? target.agentKind : 'cc',
    agentMeta: { taskNotification: notification } as AgentMeta,
    createdAt: createdAtMs,
  }, {
    shouldBroadcast: isOwnerCurrent,
    broadcastOwnerScope: ownerScope ?? null,
  });
  const persisted = readTaskNotificationMeta(message.agentMeta?.taskNotification);
  if (!persisted || persisted.readAt !== null) return false;
  if (!isOwnerCurrent()) return false;
  markSessionNeedsAttention(input.targetSessionId);
  broadcastChanged({ sessionId: input.targetSessionId, unread: true });
  return true;
}

async function persistTaskNotification(
  input: RemoteDeliveryInput,
  broadcastChanged: TaskNotificationChangedBroadcaster,
): Promise<boolean> {
  const ownerScope = captureOwnerScope();
  const scopedBroadcast = (payload: TaskNotificationChangedPayload) => {
    if (isOwnerScopeCurrent(ownerScope)) broadcastChanged(payload);
  };
  return withTaskNotificationSessionLock(input.targetSessionId, () =>
    persistTaskNotificationUnlocked(
      input,
      scopedBroadcast,
      () => isOwnerScopeCurrent(ownerScope),
      ownerScope,
    ),
  );
}

export async function receiveTaskNotification(
  value: unknown,
  broadcastChanged: TaskNotificationChangedBroadcaster,
): Promise<{ delivered: boolean }> {
  const input = readRemoteDeliveryInput(value);
  if (!input) throw new Error('invalid task notification payload');
  return { delivered: await persistTaskNotification(input, broadcastChanged) };
}

/**
 * 来源 user 行 durable 后调用。函数重新读取来源行与 /clear 可见性，避免清空竞态把
 * 已被 rewind 的消息投递出去；目标只写 host-only assistant 卡，不创建/唤醒 Agent。
 */
async function isSourceMessageVisible(
  sourceSessionId: string,
  sourceMessageClientId: string,
): Promise<boolean> {
  const db = getDbClient().drizzle;
  const [source] = await db
    .select({ createdAt: messages.createdAt, rewindAt: messages.rewindAt, clearedAt: sessions.clearedAt })
    .from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(and(eq(messages.sessionId, sourceSessionId), eq(messages.clientId, sourceMessageClientId), eq(messages.role, 'user')))
    .limit(1);
  return Boolean(
    source &&
      source.rewindAt === null &&
      (source.clearedAt === null || source.createdAt > source.clearedAt),
  );
}

async function deliverTaskNotificationsFromUserMessageUnlocked(
  sourceSessionId: string,
  sourceMessageClientId: string,
  broadcastChanged: TaskNotificationChangedBroadcaster,
  isOwnerCurrent: OwnerScopeGuard = () => true,
  ownerScope: OwnerScope | null | undefined = null,
): Promise<number> {
  if (!isOwnerCurrent()) return 0;
  const db = getDbClient().drizzle;
  const [source] = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
      rewindAt: messages.rewindAt,
      clearedAt: sessions.clearedAt,
      title: sessions.title,
    })
    .from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(
      and(
        eq(messages.sessionId, sourceSessionId),
        eq(messages.clientId, sourceMessageClientId),
        eq(messages.role, 'user'),
      ),
    )
    .limit(1);
  if (
    !source ||
    source.rewindAt !== null ||
    (source.clearedAt !== null && source.createdAt <= source.clearedAt)
  ) {
    return 0;
  }

  const parsed = parseTaskNotificationSource(source.content);
  if (!parsed) return 0;
  const localReferences = parsed.targetReferences.filter((reference) => {
    const deviceId = referenceDeviceId(reference);
    return !deviceId || deviceId === getSelfDeviceId();
  });
  const targetIds = [
    ...new Set(
      localReferences
        .map((reference) => reference.sessionId)
        .filter((sessionId) => sessionId !== sourceSessionId),
    ),
  ];

  const uniqueRemoteReferences = new Map<string, AgentInputSessionReference>();
  for (const reference of parsed.targetReferences) {
    const deviceId = referenceDeviceId(reference);
    if (!deviceId || deviceId === getSelfDeviceId()) continue;
    uniqueRemoteReferences.set(`${deviceId}\u0000${reference.sessionId}`, reference);
  }
  const remoteReferences = [...uniqueRemoteReferences.values()];

  const targetRows = targetIds.length > 0
    ? await db
        .select({
          id: sessions.id,
          title: sessions.title,
          agentKind: sessions.agentKind,
        })
        .from(sessions)
        .where(and(inArray(sessions.id, targetIds), ne(sessions.status, 'deleted')))
    : [];
  const targetById = new Map(targetRows.map((row) => [row.id, row]));
  const createdAt = new Date().toISOString();
  let delivered = 0;

  for (const reference of remoteReferences) {
    const deviceId = referenceDeviceId(reference);
    if (!deviceId) continue;
    try {
      const response = await withTaskNotificationSessionLock(sourceSessionId, async () => {
        if (!isOwnerCurrent() || !(await isSourceMessageVisible(sourceSessionId, sourceMessageClientId))) return null;
        return remoteInvoke(deviceId, 'maker:task-notifications:receive', [
          {
            sourceSessionId,
            sourceMessageClientId,
            sourceDeviceId: getSelfDeviceId(),
            sourceSessionTitle: source.title?.trim() || null,
            targetSessionId: reference.sessionId,
            targetSessionTitle: reference.title?.trim() || null,
            body: parsed.body,
            createdAt,
          },
        ]);
      });
      if (response?.ok && (response.result as { delivered?: unknown } | null)?.delivered === true) {
        delivered += 1;
      }
    } catch (error) {
      log.warn('remote task notification delivery failed', {
        sourceSessionId,
        sourceMessageClientId,
        targetSessionId: reference.sessionId,
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const targetId of targetIds) {
    const target = targetById.get(targetId);
    if (!target || !(await isSourceMessageVisible(sourceSessionId, sourceMessageClientId))) continue;
    try {
      const persisted = await withTaskNotificationSessionLocks(
        [sourceSessionId, targetId],
        async () => {
          if (!isOwnerCurrent() || !(await isSourceMessageVisible(sourceSessionId, sourceMessageClientId))) return false;
          return persistTaskNotificationUnlocked(
            {
              sourceSessionId,
              sourceMessageClientId,
              sourceDeviceId: null,
              sourceSessionTitle: source.title?.trim() || null,
              targetSessionId: targetId,
              targetSessionTitle: target.title?.trim() || null,
              body: parsed.body,
              createdAt,
            },
            broadcastChanged,
            isOwnerCurrent,
            ownerScope,
          );
        },
      );
      if (persisted) delivered += 1;
    } catch (error) {
      // 来源消息已被 Agent 接受且 durable；单个目标投递失败不能把不可逆发送翻成失败。
      log.warn('task notification delivery failed', {
        sourceSessionId,
        sourceMessageClientId,
        targetSessionId: targetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return delivered;
}

export async function deliverTaskNotificationsFromUserMessage(
  sourceSessionId: string,
  sourceMessageClientId: string,
  broadcastChanged: TaskNotificationChangedBroadcaster,
): Promise<number> {
  const ownerScope = captureOwnerScope();
  const scopedBroadcast = (payload: TaskNotificationChangedPayload) => {
    if (isOwnerScopeCurrent(ownerScope)) broadcastChanged(payload);
  };
  return deliverTaskNotificationsFromUserMessageUnlocked(
    sourceSessionId,
    sourceMessageClientId,
    scopedBroadcast,
    () => isOwnerScopeCurrent(ownerScope),
    ownerScope,
  );
}

/** 持久未读真相：按目标任务聚合，不依赖 renderer 内存 attention store。 */
export async function listUnreadTaskNotificationSessionIds(): Promise<string[]> {
  const rows = await getDbClient()
    .drizzle.selectDistinct({ sessionId: messages.sessionId })
    .from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(
      and(
        eq(messages.role, 'assistant'),
        isNull(messages.rewindAt),
        ne(sessions.status, 'deleted'),
        sql`json_valid(${messages.agentMeta}) = 1`,
        sql`json_type(${messages.agentMeta}, '$.taskNotification') = 'object'`,
        sql`json_extract(${messages.agentMeta}, '$.taskNotification.readAt') IS NULL`,
        sql`(${sessions.clearedAt} IS NULL OR ${messages.createdAt} > ${sessions.clearedAt})`,
      ),
    );
  return rows.map((row) => row.sessionId);
}

/** 将一个目标任务里的全部可见通知原子语义地标为已读（逐行保留其它 agentMeta 字段）。 */
export async function markTaskNotificationsRead(
  sessionId: string,
  broadcastChanged: TaskNotificationChangedBroadcaster,
): Promise<{ updated: number }> {
  const ownerScope = captureOwnerScope();
  const scopedBroadcast = (payload: TaskNotificationChangedPayload) => {
    if (isOwnerScopeCurrent(ownerScope)) broadcastChanged(payload);
  };
  return withTaskNotificationSessionLock(sessionId, async () => {
    const isOwnerCurrent = () => isOwnerScopeCurrent(ownerScope);
    const db = getDbClient().drizzle;
    const rows = await db
    .select({
      clientId: messages.clientId,
      agentMeta: messages.agentMeta,
      createdAt: messages.createdAt,
      clearedAt: sessions.clearedAt,
    })
    .from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.role, 'assistant'),
        isNull(messages.rewindAt),
        sql`json_valid(${messages.agentMeta}) = 1`,
        sql`json_type(${messages.agentMeta}, '$.taskNotification') = 'object'`,
        sql`json_extract(${messages.agentMeta}, '$.taskNotification.readAt') IS NULL`,
      ),
    );
  const readAt = new Date().toISOString();
  let updated = 0;
  for (const row of rows) {
    if (row.clearedAt !== null && row.createdAt <= row.clearedAt) continue;
    const meta = parseAgentMeta(row.agentMeta);
    const notification = readTaskNotificationMeta(meta?.taskNotification);
    if (!meta || !notification || notification.readAt !== null) continue;
    if (!isOwnerCurrent()) return { updated };
    await updateAgentMeta(
      sessionId,
      row.clientId,
      JSON.stringify({
        ...meta,
        taskNotification: { ...notification, readAt },
      }),
    );
    updated += 1;
  }
    if (!isOwnerCurrent()) return { updated };
    const remaining = await listUnreadTaskNotificationSessionIds();
    if (isOwnerCurrent()) scopedBroadcast({ sessionId, unread: remaining.includes(sessionId) });
    return { updated };
  });
}

/** SQL consumer 共用：排除 host-only task notification 行，且损坏旧 JSON 不阻断查询。 */
export function notTaskNotificationAgentMetaSql() {
  return sql`(${messages.agentMeta} IS NULL OR CASE WHEN json_valid(${messages.agentMeta}) THEN json_type(${messages.agentMeta}, '$.taskNotification') END IS NULL)`;
}

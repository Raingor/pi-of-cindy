import { useSyncExternalStore } from 'react';

import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
  isDataOwnerPushCurrent,
  type DataOwnerGeneration,
} from '@/contexts/dataOwnerGeneration';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import { isDeviceLinkRemotePushCurrent } from '@/lib/remoteDataOwnerPushFence';

const localUnread = new Set<string>();
const remoteUnreadByDevice = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
let initialized = false;
let initializedOwner: DataOwnerGeneration | null = null;
let unsubscribeLocal: (() => void) | null = null;
let unsubscribeRemote: (() => void) | null = null;
let localRevision = 0;
const remoteRevisionByDevice = new Map<string, number>();

function rebuildSnapshot(): void {
  const next = new Set(localUnread);
  for (const unread of remoteUnreadByDevice.values()) {
    for (const sessionId of unread) next.add(sessionId);
  }
  if (next.size === snapshot.size && [...next].every((id) => snapshot.has(id))) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function applyChanged(
  payload: unknown,
  remoteDeviceId?: string,
): void {
  if (!payload || typeof payload !== 'object') return;
  const { sessionId, unread } = payload as { sessionId?: unknown; unread?: unknown };
  if (typeof sessionId !== 'string' || !sessionId || typeof unread !== 'boolean') return;
  if (remoteDeviceId) {
    remoteRevisionByDevice.set(
      remoteDeviceId,
      (remoteRevisionByDevice.get(remoteDeviceId) ?? 0) + 1,
    );
  } else {
    localRevision += 1;
  }
  const target = remoteDeviceId
    ? (remoteUnreadByDevice.get(remoteDeviceId) ?? new Set<string>())
    : localUnread;
  if (remoteDeviceId && !remoteUnreadByDevice.has(remoteDeviceId)) {
    remoteUnreadByDevice.set(remoteDeviceId, target);
  }
  if (unread) target.add(sessionId);
  else target.delete(sessionId);
  rebuildSnapshot();
}

function ensureInitialized(): void {
  if (typeof window === 'undefined') return;
  const owner = getDataOwnerGeneration();
  if (initialized && initializedOwner && isDataOwnerGenerationCurrent(initializedOwner)) return;
  if (initialized) {
    unsubscribeLocal?.();
    unsubscribeRemote?.();
    unsubscribeLocal = null;
    unsubscribeRemote = null;
    localRevision += 1;
    localUnread.clear();
    remoteUnreadByDevice.clear();
    remoteRevisionByDevice.clear();
    rebuildSnapshot();
  }
  initialized = true;
  initializedOwner = owner;
  const api = window.electronAPI?.maker?.taskNotifications;
  if (!api) return;
  const revisionAtRequest = localRevision;
  const ownerAtRequest = owner;
  void api
    .unread()
    .then(({ sessionIds }) => {
      if (
        !isDataOwnerGenerationCurrent(ownerAtRequest) ||
        localRevision !== revisionAtRequest
      ) return;
      localUnread.clear();
      for (const sessionId of sessionIds) {
        if (typeof sessionId === 'string' && sessionId) localUnread.add(sessionId);
      }
      rebuildSnapshot();
    })
    .catch(() => undefined);
  unsubscribeLocal = api.onChanged((payload, ownerStamp) => {
    if (!isDataOwnerPushCurrent(ownerStamp)) return;
    applyChanged(payload);
  });
  unsubscribeRemote = window.electronAPI.deviceLink?.onRemotePush?.((raw, localOwnerStamp) => {
    if (!isDataOwnerPushCurrent(localOwnerStamp)) return;
    const push = raw as {
      deviceId?: unknown;
      channel?: unknown;
      payload?: unknown;
      ownerStamp?: unknown;
    } | null;
    if (
      push?.channel !== 'maker:task-notification:changed' ||
      typeof push.deviceId !== 'string' ||
      !push.deviceId
    ) {
      return;
    }
    if (!isDeviceLinkRemotePushCurrent(
      { deviceId: push.deviceId, ownerStamp: push.ownerStamp },
      localOwnerStamp,
    )) return;
    applyChanged(push.payload, push.deviceId);
  }) ?? null;
}

export async function hydrateRemoteTaskNotificationUnread(deviceIds: readonly string[]): Promise<void> {
  ensureInitialized();
  const ownerAtRequest = getDataOwnerGeneration();
  await Promise.all(
    [...new Set(deviceIds.filter(Boolean))].map(async (deviceId) => {
      const revisionAtRequest = remoteRevisionByDevice.get(deviceId) ?? 0;
      try {
        const response = (await window.electronAPI.deviceLink.invoke(
          deviceId,
          'maker:task-notifications:unread',
          [],
        )) as { ok?: unknown; result?: unknown };
        const result = response.ok === true
          ? (response.result as { sessionIds?: unknown } | null)
          : null;
        if (response.ok !== true || !Array.isArray(result?.sessionIds)) return;
        const next = new Set<string>();
        for (const sessionId of result.sessionIds) {
          if (typeof sessionId === 'string' && sessionId) next.add(sessionId);
        }
        if (
          !isDataOwnerGenerationCurrent(ownerAtRequest) ||
          (remoteRevisionByDevice.get(deviceId) ?? 0) !== revisionAtRequest
        ) return;
        remoteUnreadByDevice.set(deviceId, next);
        rebuildSnapshot();
      } catch {
        // Remote device may be offline; retain the last pushed snapshot.
      }
    }),
  );
}

export function subscribeTaskNotificationUnread(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTaskNotificationUnreadSnapshot(): ReadonlySet<string> {
  ensureInitialized();
  return snapshot;
}

export function useTaskNotificationUnreadSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeTaskNotificationUnread,
    getTaskNotificationUnreadSnapshot,
    getTaskNotificationUnreadSnapshot,
  );
}

export async function markTaskNotificationsReadForSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  ensureInitialized();
  const ownerAtRequest = getDataOwnerGeneration();
  const deviceId = remoteProjectsStore.getSessionDeviceId(sessionId);
  if (deviceId) {
    const revisionAtRequest = remoteRevisionByDevice.get(deviceId) ?? 0;
    const response = await window.electronAPI.deviceLink.invoke(
      deviceId,
      'maker:task-notifications:mark-read',
      [sessionId],
    );
    if (
      (response as { ok?: unknown } | null)?.ok === true &&
      isDataOwnerGenerationCurrent(ownerAtRequest) &&
      (remoteRevisionByDevice.get(deviceId) ?? 0) === revisionAtRequest
    ) {
      applyChanged({ sessionId, unread: false }, deviceId);
    }
    return;
  }
  const revisionAtRequest = localRevision;
  await window.electronAPI.maker.taskNotifications.markRead(sessionId);
  if (
    isDataOwnerGenerationCurrent(ownerAtRequest) &&
    localRevision === revisionAtRequest
  ) {
    applyChanged({ sessionId, unread: false });
  }
}

/** Test/HMR cleanup without exporting mutable store internals to production callers. */
export function __resetTaskNotificationUnreadStoreForTest(): void {
  unsubscribeLocal?.();
  unsubscribeRemote?.();
  unsubscribeLocal = null;
  unsubscribeRemote = null;
  initialized = false;
  initializedOwner = null;
  localUnread.clear();
  remoteUnreadByDevice.clear();
  remoteRevisionByDevice.clear();
  localRevision = 0;
  snapshot = new Set();
  for (const listener of listeners) listener();
}

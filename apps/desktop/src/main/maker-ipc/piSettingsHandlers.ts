/**
 * piSettingsHandlers — maker:pi:* IPC handler bodies。
 *
 * handler body 是纯逻辑, 通过 deps 注入实际文件读写能力, 便于测试不 import Electron。
 */

import type { IpcHandlerRegistry } from './ipcHandlerRegistry.js';
import { MAKER_INVOKE } from './channels.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import type {
  PiConfigSnapshot,
  PiSettings,
  UpdateCheckResult,
  ApplyUpdateResult,
  PiPackageEntry,
  PiExportPayload,
} from '../maker-host/pi-settings-reader.js';

export interface PiSettingsHandlerDeps {
  readPiConfigSnapshot(): PiConfigSnapshot;
  writePiSettings(settings: PiSettings): boolean;
  listPiPackages(): PiPackageEntry[];
  addPiPackage(name: string): boolean;
  removePiPackage(name: string): boolean;
  checkPiUpdates(): Promise<UpdateCheckResult>;
  applyPiExtensionUpdates(names: string[]): ApplyUpdateResult[];
  exportPiConfig(): PiExportPayload;
  importPiConfig(payload: PiExportPayload): boolean;
}

export function registerPiSettingsHandlers(
  registry: IpcHandlerRegistry,
  deps: PiSettingsHandlerDeps,
): void {
  registry.handle(MAKER_INVOKE.PI_GET_CONFIG, async () => {
    return deps.readPiConfigSnapshot();
  });

  registry.handle(MAKER_INVOKE.PI_SAVE_SETTINGS, async (_e, settings: unknown) => {
    if (!settings || typeof settings !== 'object') {
      throwIpcError('INVALID_PARAMS', 'settings object required');
    }
    return deps.writePiSettings(settings as PiSettings);
  });

  registry.handle(MAKER_INVOKE.PI_LIST_PACKAGES, async () => {
    return deps.listPiPackages();
  });

  registry.handle(MAKER_INVOKE.PI_ADD_PACKAGE, async (_e, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throwIpcError('INVALID_PARAMS', 'package name required');
    }
    return deps.addPiPackage(name.trim());
  });

  registry.handle(MAKER_INVOKE.PI_REMOVE_PACKAGE, async (_e, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throwIpcError('INVALID_PARAMS', 'package name required');
    }
    return deps.removePiPackage(name.trim());
  });

  registry.handle(MAKER_INVOKE.PI_CHECK_UPDATES, async () => {
    return await deps.checkPiUpdates();
  });

  registry.handle(MAKER_INVOKE.PI_APPLY_UPDATES, async (_e, names: unknown) => {
    if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
      throwIpcError('INVALID_PARAMS', 'names must be string[]');
    }
    return deps.applyPiExtensionUpdates(names as string[]);
  });

  registry.handle(MAKER_INVOKE.PI_EXPORT_CONFIG, async () => {
    return deps.exportPiConfig();
  });

  registry.handle(MAKER_INVOKE.PI_IMPORT_CONFIG, async (_e, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throwIpcError('INVALID_PARAMS', 'payload object required');
    }
    return deps.importPiConfig(payload as PiExportPayload);
  });
}

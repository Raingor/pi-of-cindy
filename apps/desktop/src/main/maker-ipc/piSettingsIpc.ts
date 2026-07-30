/**
 * apps/desktop/src/main/maker-ipc/piSettingsIpc.ts
 *
 * maker:pi:* IPC 的 Electron adapter。
 * handler body 在 piSettingsHandlers.ts；实际文件读写能力在这里注入。
 */

import { createLogger } from '../logger.js';
import { createElectronIpcHandlerRegistry } from './electronIpcRegistry.js';
import { registerPiSettingsHandlers } from './piSettingsHandlers.js';
import {
  readPiConfigSnapshot,
  writePiSettings,
  listPiPackages,
  addPiPackage,
  removePiPackage,
  checkPiUpdates,
  applyPiExtensionUpdates,
  exportPiConfig,
  importPiConfig,
} from '../maker-host/pi-settings-reader.js';

const log = createLogger('maker-ipc:pi-settings');

export function registerPiSettingsIpc(): void {
  log.info('registering maker:pi:* IPC handlers');

  registerPiSettingsHandlers(createElectronIpcHandlerRegistry(), {
    readPiConfigSnapshot,
    writePiSettings,
    listPiPackages,
    addPiPackage,
    removePiPackage,
    checkPiUpdates,
    applyPiExtensionUpdates,
    exportPiConfig,
    importPiConfig,
  });

  log.info('pi settings IPC handlers registered');
}

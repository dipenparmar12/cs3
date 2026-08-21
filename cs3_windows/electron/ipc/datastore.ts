import { handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { app, dialog } from 'electron';

/**
 * Backup, restore, and raw settings access.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerDatastoreHandlers: RegisterHandlers = (services) => {
  const {
    datastore,
    getWindow,
  } = services;

  // --- datastore -----------------------------------------------------------------
  handleRaw('datastore:getSetting', async (key: string, defaultValue: any) => datastore.getString(key, defaultValue, true));

  handleRaw('datastore:setSetting', async (key: string, value: any) => {
    if (typeof value === 'boolean') {
      datastore.setBool(key, value, true);
    }
    datastore.setString(key, String(value), true);
  });

  handleRaw('datastore:getObject', async (key: string, defaultValue: any) => datastore.getObject(key, defaultValue));

  handleRaw('datastore:setObject', async (key: string, value: any) => {
    datastore.setObject(key, value);
  });

  handleRaw('datastore:importBackup', async (filePath: string) => datastore.importBackupFile(filePath));

  handleRaw('datastore:exportBackup', async () => datastore.exportBackup());

  handleRaw('dialog:selectDirectory', async () => {
    // Bound once rather than resolved twice: the dialog must be parented to the
    // window that was checked, and a second call could answer differently.
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  handleRaw('app:reload', async () => {
    getWindow()?.webContents.reload();
  });

  handleRaw('app:relaunch', async () => {
    app.relaunch();
    app.exit(0);
  });
};

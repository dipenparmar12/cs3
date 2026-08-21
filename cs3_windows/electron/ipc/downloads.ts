import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { DownloadTask } from '../../src/types/download';
import type { BatchDownloadRequest } from '../cs3/batchDownloader';
import { shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The download queue, batch downloads, and the viewer’s player preferences.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerDownloadHandlers: RegisterHandlers = (services) => {
  const {
    batchDownloader,
    datastore,
    downloadService,
  } = services;

  // --- downloads -----------------------------------------------------------------
  handleRaw('download:enqueue', async (task: DownloadTask) => downloadService.enqueue(task));
  handleRaw('download:pause', async (id: string) => downloadService.pause(id));
  handleRaw('download:resume', async (id: string) => downloadService.resume(id));
  handleRaw('download:remove', async (id: string, deleteFile?: boolean) => downloadService.remove(id, deleteFile === true));

  /**
   * How "Delete" should behave, remembered.
   *
   * Three values rather than a boolean, because "ask me" is a real answer and the
   * only safe default: removing a finished film from the list and deleting a
   * finished film off the disk are unrecoverably different, and guessing wrong in
   * the destructive direction cannot be undone. The prompt is where the user opts
   * out of being asked, and Settings is where they opt back in — a preference that
   * can only be set from a confirmation dialog is one nobody can reverse.
   */
  const DELETE_PREFERENCE_KEY = 'download_delete_behavior';
  type DeletePreference = 'ask' | 'list-only' | 'list-and-file';

  /**
   * Player preferences that belong to the viewer rather than to a film.
   *
   * Volume, mute and speed persist across media and across restarts because they
   * describe the room, not the title. Track *languages* persist for the same
   * reason; track **indices** deliberately do not — audio track 2 is the Hindi dub
   * on one release and the director's commentary on the next, so restoring an
   * index would confidently select the wrong thing on every file.
   */
  const PLAYER_PREFERENCES_KEY = 'player_preferences';

  interface StoredPlayerPreferences {
    volume: number;
    muted: boolean;
    speed: number;
    audioLanguage?: string;
    subtitleLanguage?: string;
  }

  const DEFAULT_PLAYER_PREFERENCES: StoredPlayerPreferences = {
    volume: 1,
    muted: false,
    speed: 1,
  };

  handle('player:getPreferences', async () => {
    const stored = datastore.getObject<StoredPlayerPreferences>(PLAYER_PREFERENCES_KEY, null);
    /**
     * Clamped on read, not just on write. A datastore edited by hand — or carried
     * in from an Android backup — can hold a volume of 40 or -1, and either one
     * makes the element throw `IndexSizeError` the moment it is assigned.
     */
    const preferences: StoredPlayerPreferences = {
      ...DEFAULT_PLAYER_PREFERENCES,
      ...(stored ?? {}),
    };
    preferences.volume = Math.min(1, Math.max(0, Number(preferences.volume) || 0));
    preferences.speed = Math.min(4, Math.max(0.25, Number(preferences.speed) || 1));
    preferences.muted = preferences.muted === true;
    return { preferences };
  });

  handle('player:setPreferences', async (patch: Partial<StoredPlayerPreferences>) => {
    const current =
      datastore.getObject<StoredPlayerPreferences>(PLAYER_PREFERENCES_KEY, null) ??
      DEFAULT_PLAYER_PREFERENCES;
    // Merged rather than replaced: the player writes volume/mute/speed while the
    // track panels write languages, and a whole-record write from either would
    // erase the other's choice.
    datastore.setObject(PLAYER_PREFERENCES_KEY, { ...current, ...patch }, true);
    return {};

  });

  handle('download:getDeletePreference', async () => {
    const stored = datastore.getString(DELETE_PREFERENCE_KEY, 'ask', true);
    const preference: DeletePreference =
      stored === 'list-only' || stored === 'list-and-file' ? stored : 'ask';
    return { preference };
  });

  handle('download:setDeletePreference', (preference: DeletePreference) => {
    // A bad value from the renderer is an answer, not an exception — and the
    // wrapper preserves it, because the payload spreads after `ok: true`.
    if (preference !== 'ask' && preference !== 'list-only' && preference !== 'list-and-file') {
      return { ok: false, error: `Unknown delete preference: ${preference}` };
    }
    datastore.setString(DELETE_PREFERENCE_KEY, preference, true);
    return { preference };
  });
  handleRaw('download:getQueue', async () => downloadService.getTasks());

  // Season and series downloads. Resolution runs here rather than in the
  // renderer so a long season survives the user navigating away mid-run.
  handle(
    'download:startBatch',
    async (request: BatchDownloadRequest) => {
      return { progress: await batchDownloader.start(request) };
    },
    { progress: null }
  );

  handleRaw('download:cancelBatch', async (batchId: string) => batchDownloader.cancel(batchId));

  handleRaw('download:getActiveBatches', async () => batchDownloader.getActive());

  handleRaw('download:revealInFolder', async (targetPath?: string) => {
    const defaultDir = path.join(os.homedir(), 'Downloads', 'CloudStream');
    const target = targetPath || defaultDir;
    try {
      const normalized = path.normalize(target);
      if (fs.existsSync(normalized)) {
        const stat = fs.statSync(normalized);
        if (stat.isDirectory()) {
          await shell.openPath(normalized);
        } else {
          shell.showItemInFolder(normalized);
        }
      } else {
        const parentDir = path.dirname(normalized);
        if (fs.existsSync(parentDir)) {
          await shell.openPath(parentDir);
        } else {
          fs.mkdirSync(defaultDir, { recursive: true });
          await shell.openPath(defaultDir);
        }
      }
    } catch (error) {
      console.warn('[main] revealInFolder failed:', error);
      try {
        fs.mkdirSync(defaultDir, { recursive: true });
        await shell.openPath(defaultDir);
      } catch {
        // Best effort fallback
      }
    }
  });
};

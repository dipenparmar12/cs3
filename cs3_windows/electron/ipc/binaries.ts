import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';

/**
 * The portable tools the app fetches on demand.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerBinaryHandlers: RegisterHandlers = (services) => {
  const {
    aria2,
    binaryDownloader,
    refreshFfmpegOptionSupport,
    getWindow,
  } = services;

  // --- binaries ------------------------------------------------------------------
  handleRaw('binary:check', async () => binaryDownloader.checkBinaries());
  handleRaw('binary:checkBinaries', async () => binaryDownloader.checkBinaries());

  handleRaw('binary:testAll', async () => binaryDownloader.testAllBinaries());

  handleRaw('binary:testOne', async (name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv') => {
    return await binaryDownloader.testBinary(name);
  });

  handle(
    'binary:remove',
    (name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv' | 'media' | 'downloads' | 'all') => ({
      // Whether the file went, not whether the attempt threw.
      ok: binaryDownloader.removeBinary(name),
    })
  );

  handle(
    'binary:setupAria2',
    async () => {
      const ok = await binaryDownloader.setupAria2((status, percent) => {
        getWindow()?.webContents.send('binary:setupProgress', { component: 'aria2c', status, percent });
      });
      if (ok) await aria2.start().catch(() => {});
      return { ok, message: ok ? 'aria2c ready' : 'aria2c installation failed' };
    },
    { ok: false, message: 'aria2c installation failed' }
  );

  handle(
    'binary:setupYtDlp',
    async () => {
      const ok = await binaryDownloader.setupYtDlp((status, percent) => {
        getWindow()?.webContents.send('binary:setupProgress', { component: 'yt-dlp', status, percent });
      });
      return { ok, message: ok ? 'yt-dlp ready' : 'yt-dlp installation failed' };
    },
    { ok: false, message: 'yt-dlp installation failed' }
  );

  /**
   * One-click FFmpeg. Progress is pushed so a ~100 MB download can show its
   * state rather than freezing a dialog.
   */
  handle(
    'binary:setupFfmpeg',
    async () => {
      const ok = await binaryDownloader.setupFfmpeg((status, percent) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('binary:setupProgress', { component: 'ffmpeg', status, percent });
        }
      });
      // A different binary may have arrived with a different option set.
      if (ok) refreshFfmpegOptionSupport();
      return {
        ok,
        message: ok
          ? 'Media components are installed.'
          : 'The media components could not be installed.',
      };
    },
    { message: 'The media components could not be installed.' }
  );

  handle(
    'binary:setupAll',
    async () => {
      const res = await binaryDownloader.setupAll((component, status, percent) => {
        getWindow()?.webContents.send('binary:setupProgress', { component, status, percent });
      });
      await aria2.start().catch(() => {});
      return { ...res };
    },
    { ok: false, message: 'Component setup failed' }
  );

  handleRaw('binary:setup', async () => {
    try {
      const aria2Ok = await binaryDownloader.setupAria2();
      const ytdlpOk = await binaryDownloader.setupYtDlp();
      if (aria2Ok) await aria2.start();

      return {
        success: aria2Ok || ytdlpOk,
        message: aria2Ok
          ? 'aria2c and yt-dlp downloaded and configured.'
          : ytdlpOk
            ? 'yt-dlp configured; aria2c setup failed.'
            : 'Binary setup failed.',
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Failed to set up binaries' };
    }
  });
};

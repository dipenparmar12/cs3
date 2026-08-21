import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { failure as fail } from './envelope.ts';
import type { NativeEngineCapability } from '../../src/types/media';
import type { MpvOpenRequest } from '../../src/types/mpv';
import {
  nativeEngineEmbeds,
  nativeEnginePolicy,
  setNativeEngineEmbeds,
  setNativeEnginePolicy,
} from '../media/nativeEnginePolicy';

/**
 * The mpv engine: transport, tracks, and how eagerly it is used.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerNativeEngineHandlers: RegisterHandlers = (services) => {
  const {
    binaryDownloader,
    contentService,
    datastore,
    diagnostics,
    logger,
    mpvEngine,
    playbackEngine,
    torrentEngine,
    getWindow,
  } = services;

  // --- native playback engine (mpv) ----------------------------------------------
  /**
   * The native engine's surface, and the one thing it does not have.
   *
   * There is deliberately **no** `mpv:play(url)` that takes a raw link. Everything
   * playable still comes out of `media:prepare`, which inspects first — the same
   * gate INV-RACE-1 puts in front of the `<video>` element. A second entry point
   * that skipped inspection would reintroduce the original bug in a new engine:
   * playback started against unclassified content, with the diagnosis arriving
   * afterwards if at all.
   */
  handle('mpv:status', async () => ({ status: await mpvEngine.status() }));


  /**
   * Whether the video should render inside the app window. On by default.
   *
   * A setting rather than a fixed behaviour because embedding is a *positioned
   * native child window*, not a composited surface, and there are real setups
   * where a separate window is better: a second monitor to put the film on, a
   * window manager that mishandles owned windows, an HDR path that only engages
   * for a top-level window. Those are not bugs this can fix, and a viewer who
   * hits one needs a way out that is not "stop using the engine".
   */

  handleRaw('mpv:open', async (request: MpvOpenRequest) => {
    /**
     * The bounds are stripped here rather than withheld by the renderer.
     *
     * The renderer always measures and always sends — it is the only side that
     * knows where the video area is — and this is the only side that knows
     * whether embedding is wanted. Absent bounds mean "open a window of your
     * own", which is exactly what turning the setting off should do.
     */
    if (!nativeEngineEmbeds(datastore)) request = { ...request, surfaceBounds: undefined };
    const result = await mpvEngine.open(request);
    if (!result.ok) {
      diagnostics.record({
        level: 'error',
        stage: 'playback',
        url: request?.url,
        source: 'mpv',
        message: result.error ?? 'The native engine could not open this source.',
      });
    }
    return result;
  });

  handleRaw('mpv:setPaused', async (paused: boolean) => mpvEngine.setPaused(paused));
  handleRaw('mpv:seek', async (seconds: number) => mpvEngine.seek(seconds));
  handleRaw('mpv:setVolume', async (volume: number) => mpvEngine.setVolume(volume));
  handleRaw('mpv:setMuted', async (muted: boolean) => mpvEngine.setMuted(muted));
  handleRaw('mpv:setSpeed', async (speed: number) => mpvEngine.setSpeed(speed));
  handleRaw('mpv:setFullscreen', async (on: boolean) => mpvEngine.setFullscreen(on));
  handleRaw('mpv:setAudioTrack', async (id: number | null) => mpvEngine.setAudioTrack(id));
  handleRaw('mpv:setSubtitleTrack', async (id: number | null) => mpvEngine.setSubtitleTrack(id));
  handleRaw('mpv:addSubtitle', async (url: string, title?: string, language?: string) => mpvEngine.addSubtitle(url, title, language));
  handleRaw('mpv:setSubtitleDelay', async (seconds: number) => mpvEngine.setSubtitleDelay(seconds));
  handleRaw('mpv:stop', async () => mpvEngine.stop());

  /**
   * The video rectangle, in CSS pixels relative to the window's content area.
   *
   * Sent by the renderer whenever the player's layout moves — which is often, and
   * has to be cheap: this is a `SetWindowPos` on a native child window, not a
   * restart of anything. mpv keeps rendering into the same handle throughout.
   */
  handle('mpv:setSurfaceBounds', async (bounds: { x: number; y: number; width: number; height: number }) => {
    mpvEngine.setSurfaceBounds(bounds);
    return {};

  });

  /** A pull for the current state, for a player that mounted mid-playback. */
  handle('mpv:snapshot', async () => ({ snapshot: mpvEngine.snapshot() }));

  handle('mpv:getPolicy', async () => ({
    policy: nativeEnginePolicy(datastore),
    available: mpvEngine.isAvailable(),
    embed: nativeEngineEmbeds(datastore),
    canEmbed: mpvEngine.canEmbed,
  }));

  handle('mpv:setEmbed', async (embed: boolean) => {
    setNativeEngineEmbeds(datastore, embed);
    /**
     * Restarted, not adjusted. `--wid` is a command-line argument: mpv decides
     * between rendering into a handle and creating a window once, at startup,
     * and there is no property that changes it afterwards.
     */
    await mpvEngine.shutdown();
    logger.info('mpv', 'embed_setting_changed', { embed });
    return { embed };
  });

  handle('mpv:setPolicy', (policy: NativeEngineCapability['policy']) => {
    if (policy !== 'off' && policy !== 'auto' && policy !== 'aggressive') {
      return { ok: false, error: `Unknown native engine policy: ${policy}` };
    }
    setNativeEnginePolicy(datastore, policy);
    /**
     * Every cached verdict was reached under the old policy and is now wrong in
     * whichever direction the policy moved. Without this, changing the setting
     * appears to do nothing for the next ten minutes on any source already seen.
     */
    playbackEngine.invalidateCapabilityCache();
    return { policy };
  });

  /**
   * Installs mpv on demand.
   *
   * Kept out of `binary:setupAll` on purpose — see `setupMpv`. It is the largest
   * download the app makes and it is only worth making for someone who actually
   * meets the streams that need it.
   */
  handle('binary:setupMpv', async () => {
    try {
      const ok = await binaryDownloader.setupMpv((status, percent) => {
        getWindow()?.webContents.send('binary:setupProgress', { component: 'mpv', status, percent });
      });
      /**
       * The engine that was absent a moment ago now exists, and every capability
       * record in the cache was decided on the assumption that it did not.
       */
      if (ok) playbackEngine.invalidateCapabilityCache();
      return { ok, status: await mpvEngine.status() };
    } catch (error) {
      // Keeps a local catch: the failure payload has to `await` the engine's
      // status, and a fallback is resolved synchronously — returning a promise
      // from one would spread a pending object into the reply.
      return { ...fail(error), status: await mpvEngine.status() };
    }
  });

  handleRaw('sources:getCacheStats', async () => contentService.getCache().stats());

  handle('sources:clearCache', async () => {
    contentService.getCache().clear();
    return {};
  });

  handleRaw('torrent:getStats', async (infoHash: string) => torrentEngine.getStats(infoHash));

  handleRaw('torrent:selectFile', async (infoHash: string, fileIndex: number) => torrentEngine.selectFile(infoHash, fileIndex));

  handleRaw('torrent:stopStream', async (infoHash: string, keepFiles?: boolean) => {
    await torrentEngine.stopStream(infoHash, keepFiles ?? false);
  });

  handleRaw('torrent:getActiveStreams', async () => torrentEngine.getActiveStreams());

  handle(
    'torrent:clearCache',
    async () => {
      return { removed: await torrentEngine.clearCache() };
    },
    { removed: 0 }
  );

  handleRaw('torrent:getCachePath', async () => torrentEngine.getCachePath());
};

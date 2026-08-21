import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { failure as fail } from './envelope.ts';
import type { PlaybackStreamRequest } from '../../src/types/media';
import { shell } from 'electron';

/**
 * Handing a stream to VLC or mpv, and driving it afterwards.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerExternalPlayerHandlers: RegisterHandlers = (services) => {
  const {
    diagnostics,
    externalPlayers,
    mpvEngine,
    playbackEngine,
    pluginManager,
  } = services;

  // --- external players ----------------------------------------------------------
  /**
   * Players already on this machine, and where to get one if there are none.
   *
   * `refresh` exists because someone who follows a download link will install a
   * player while the app is running, and being told to restart for it would be a
   * poor end to the sentence "we cannot play this, try VLC".
   */
  /**
   * Opens a link in the system browser.
   *
   * Scheme-checked here as well as in `setWindowOpenHandler`: this one is
   * reachable from the renderer with an arbitrary string, and `shell.openExternal`
   * will happily launch a `file:` or custom-protocol handler if allowed to.
   */
  handle('shell:openExternal', async (url: string) => {
    // Re-checked here because, unlike `setWindowOpenHandler`, this is reachable
    // from the renderer with an arbitrary string. The refusal is returned as an
    // answer, not thrown — hence its own `ok: false`, which survives the wrapper.
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Only http and https links can be opened.' };
    }
    await shell.openExternal(url);
    return {};
  });

  handle('player:listExternal', async (refresh?: boolean) => ({
    players: refresh ? externalPlayers.refresh() : externalPlayers.list(),
    downloads: externalPlayers.getDownloads(),
  }));

  /**
   * Hands a stream to an external player **and keeps a channel to it** where one
   * exists.
   *
   * The capability comes back with the result so the renderer knows which player
   * it got: one it can drive, or one it can only report as running. A UI that
   * offers a seek bar it cannot honour is worse than one that says so.
   */
  handleRaw('external:open', async (playerId: string, url: string) => {
    if (playerId === 'mpv') {
      /**
       * mpv is ours already. Routing it through `MpvEngine` instead of spawning a
       * second, dumber client gets the full contract — track lists, property
       * observation, seek that reports back — from code that is already tested.
       */
      const result = await mpvEngine.open({ url, title: 'CloudStream' });
      return { ...result, capability: result.ok ? 'full' : 'none', engine: 'mpv' };
    }
    const result = await externalPlayers.openControlled(playerId, url);
    if (!result.ok) {
      diagnostics.record({
        level: 'error',
        stage: 'playback',
        source: playerId,
        url,
        message: result.error ?? 'The external player could not be started.',
      });
    }
    return { ...result, engine: 'external' };
  });

  /**
   * Manual rollback, for an update that installed and then misbehaved in a way
   * the load check could not see — a scraper that returns nothing, rather than an
   * archive that will not link.
   */
  handle(
    'extension:rollback',
    async (repositoryUrl: string, internalName: string) => ({
      ...(await pluginManager.rollbackPlugin(repositoryUrl, internalName)),
    }),
    { message: 'The previous version could not be restored.' }
  );

  handle('extension:hasPreviousVersion', async (repositoryUrl: string, internalName: string) => ({
      available: pluginManager.hasPreviousVersion(repositoryUrl, internalName),
    }));

  handle('external:capability', async (playerId: string) => ({
    capability: playerId === 'mpv' ? (mpvEngine.isAvailable() ? 'full' : 'none') : externalPlayers.capabilityFor(playerId),
  }));

  handle('external:snapshot', async () => ({
    snapshot: externalPlayers.controller()?.current() ?? null,
  }));

  /**
   * Transport for a handed-off player.
   *
   * `ok` is whether the command *reached* something, not whether the app is
   * healthy: there may be no controller at all (MPC-HC, PotPlayer), or one whose
   * HTTP interface was built out. A `false` here is what stops the UI offering a
   * seek bar that silently does nothing, so it must not be flattened into the
   * wrapper's success.
   */
  handle('external:setPaused', async (paused: boolean) => ({
    ok: (await externalPlayers.controller()?.setPaused(paused)) ?? false,
  }));
  handle('external:seek', async (seconds: number) => ({
    ok: (await externalPlayers.controller()?.seek(seconds)) ?? false,
  }));
  handle('external:setVolume', async (percent: number) => ({
    ok: (await externalPlayers.controller()?.setVolume(percent)) ?? false,
  }));
  handle('external:setMuted', async (muted: boolean) => ({
    ok: (await externalPlayers.controller()?.setMuted(muted)) ?? false,
  }));
  handle('external:setSpeed', async (rate: number) => ({
    ok: (await externalPlayers.controller()?.setSpeed(rate)) ?? false,
  }));
  handle('external:setFullscreen', async () => ({
    ok: (await externalPlayers.controller()?.setFullscreen()) ?? false,
  }));
  handle('external:stop', async () => {
    await externalPlayers.shutdown();
    return {};
  });

  handleRaw('player:openExternal', async (playerId: string, url: string) => {
    const result = externalPlayers.open(playerId, url);
    if (!result.ok) {
      diagnostics.record({
        level: 'error',
        stage: 'playback',
        source: playerId,
        url,
        message: result.error ?? 'The external player could not be started.',
      });
    }
    return result;
  });


  /**
   * Classifies a source without starting anything.
   *
   * Used by the detail screen and by anything that wants to say what a source *is*
   * before committing to it — AC-COMPAT-10, which asks the UI to distinguish
   * downloadable from directly playable. A 25 GB HEVC 10-bit MKV downloads at full
   * speed and decodes nothing, and conflating the two is the root of PRD-37 §2.
   */
  handle(
    'media:inspect',
    async (request: Pick<PlaybackStreamRequest, 'url' | 'headers' | 'isM3u8' | 'refresh'>) => {
      return { capability: await playbackEngine.inspect(request) };
    },
    { capability: null }
  );

  /**
   * Inspect, decide, open — and only then hand back a URL to attach.
   *
   * This replaces a probe that ran *beside* playback. The renderer used to assign
   * `video.src` on mount and start an inspection in parallel; Chromium's parser
   * failed on an unsupported bitstream within ~150 ms, its `error` handler fired
   * while the probe was still in flight, and the fallback therefore ran `-c:v copy`
   * on video it knew nothing about — re-wrapping an undecodable HEVC stream into
   * MP4 and failing identically a second time. There is no longer a code path that
   * attaches an unclassified URL.
   */
  handle('media:prepare', async (request: PlaybackStreamRequest) => {
    try {
      return { ...(await playbackEngine.prepare(request)) };
    } catch (error) {
      // Keeps a local catch: the failure payload echoes the *requested* URL, and
      // a fallback argument is a sibling of the handler rather than inside it, so
      // `request` is not in scope there.
      return { ...fail(error), playbackUrl: request?.url ?? '', sessionId: '', subtitles: [] };
    }
  });

  handleRaw('media:switchAudio', async (sessionId: string, audioIndex: number, positionSeconds: number) => playbackEngine.switchAudio(sessionId, audioIndex, positionSeconds));

  handle('media:closeStream', async (sessionId: string) => {
    playbackEngine.close(sessionId);
    return {};
  });

  handle('media:getPlaybackDiagnostics', async (sessionId?: string) => ({
    events: playbackEngine.getDiagnostics(sessionId),
  }));
};

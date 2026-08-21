import { handle, } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { TorrentResult } from '../../src/types/torrent';
import type { SourceQuery } from '../contentService';

/**
 * Starting a stream, and the push-shaped playback session around it.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerPlaybackHandlers: RegisterHandlers = (services) => {
  const {
    contentService,
    diagnostics,
    playbackSessions,
  } = services;

  // --- torrent streaming ---------------------------------------------------------
  handle(
    'torrent:startStream',
    async (source: TorrentResult, season?: number, episode?: number) => {
      return { handle: await contentService.startStream(source, season, episode) };
    },
    { handle: null }
  );

  // Automatic start: tries the ranked sources in order until one actually
  // delivers bytes. This is what "next episode" and "play" use, so a dead swarm
  // costs a few seconds rather than dead-ending the viewer on a black screen.
  handle(
    'torrent:startBestStream',
    async (sources: TorrentResult[], season?: number, episode?: number) => {
      return { ...(await contentService.startBestStream(sources, season, episode)) };
    },
    { handle: null, source: null, attempts: [] }
  );

  handle(
    'torrent:autoPlay',
    async (request: SourceQuery) => {
      return { ...(await contentService.autoPlay(request)) };
    },
    { handle: null, source: null, attempts: [], query: null }
  );

  /**
   * Opens a playback session and returns immediately.
   *
   * The renderer shows the player on this return, not on a stream being ready;
   * everything after this point arrives as `playback:update` snapshots.
   */
  handle(
    'playback:start',
    async (request: SourceQuery, title: string, episodeTitle?: string) => {
      return { snapshot: playbackSessions.start(request, title, episodeTitle) };
    },
    { snapshot: null }
  );

  /**
   * The stream started but could not be played; move on.
   *
   * Distinct from `selectSource`, which is a deliberate choice and must not fail
   * over. This is the opposite: the viewer chose nothing and the app owes them
   * the next candidate.
   */
  handle(
    'playback:skipSource',
    async (sessionId: string, reason: string) => {
      diagnostics.record({
        level: 'warn',
        stage: 'playback',
        message: reason,
        detail: 'Source could not be played; advancing to the next.',
      });
      return { snapshot: await playbackSessions.skipCurrentSource(sessionId, reason) };
    },
    { snapshot: null }
  );

  handle(
    'playback:playNow',
    async (sessionId: string) => {
      return { snapshot: await playbackSessions.playNow(sessionId) };
    },
    { snapshot: null }
  );

  /**
   * Finds sources without starting one, for the detail screen's picker.
   *
   * Same session type and same `playback:update` stream as playing does, so the
   * picker gets progressive results, a progress count and a cancel for free —
   * rather than a second, worse copy of source discovery living in the renderer.
   */
  handle(
    'playback:startDiscovery',
    (
      request: SourceQuery,
      title: string,
      episodeTitle?: string,
      options?: { bypassCache?: boolean }) => {
      return {
        snapshot: playbackSessions.startDiscovery(request, title, episodeTitle, options ?? {}),
      };
    },
    { snapshot: null }
  );

  handle(
    'playback:selectSource',
    async (sessionId: string, infoHash: string) => {
      return { snapshot: await playbackSessions.selectSource(sessionId, infoHash) };
    },
    { snapshot: null }
  );

  handle(
    'playback:refreshSources',
    async (sessionId: string) => {
      return { snapshot: await playbackSessions.refresh(sessionId) };
    },
    { snapshot: null }
  );

  /**
   * Stops waiting for the remaining providers, keeping the sources already found.
   *
   * Synchronous on purpose: the answer is "stop", and making the viewer wait for
   * the search they are cancelling would be its own small joke.
   */
  handle(
    'playback:cancelSourceSearch',
    (sessionId: string) => {
      return { snapshot: playbackSessions.cancelDiscovery(sessionId) };
    },
    { snapshot: null }
  );

  handle('playback:stop', async (sessionId: string, keepFiles?: boolean) => {
    await playbackSessions.stop(sessionId, keepFiles ?? true);
    return {};
  });
};

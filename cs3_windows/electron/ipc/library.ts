import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { TorrentResult } from '../../src/types/torrent';
import { continueWatchingEnabled } from '../cs3/continueWatching';
import {
  LibraryStore,
  canonicalKey,
  storedSourceToTorrentResult,
  torrentResultToStoredSource,
} from '../cs3/libraryStore';
import type { WatchStatus } from '../cs3/libraryStore';
import { isLinkUsable, pickReplacement } from '../cs3/playedSource';
import { deadlineFromUrl } from '../sourceCache';

/**
 * Watch state, resume progress, and the source that actually played.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerLibraryHandlers: RegisterHandlers = (services) => {
  const {
    contentService,
    datastore,
    libraryStore,
    logger,
  } = services;

  // --- library, watch progress and source memory ---------------------------------
  handleRaw('library:getEntries', async (status?: WatchStatus) => libraryStore.getEntries(status));

  handleRaw('library:upsertEntry', async (input: Parameters<LibraryStore['upsertEntry']>[0]) => libraryStore.upsertEntry(input));

  handleRaw('library:setStatus', async (key: string, status: WatchStatus) => libraryStore.setStatus(key, status));

  handleRaw('library:setUserRating', async (key: string, rating?: number) => libraryStore.setUserRating(key, rating));

  handleRaw('library:removeEntry', async (key: string) => libraryStore.removeEntry(key));

  handleRaw('library:getEntryForUrl', async (mediaUrl: string) => libraryStore.getEntryForUrl(mediaUrl));

  handleRaw('library:recordProgress', async (input: Parameters<LibraryStore['recordProgress']>[0]) => libraryStore.recordProgress(input));

  handleRaw('library:getProgressForKey', async (key: string) => libraryStore.getProgressForKey(key));

  // Enforced in the main process: off means the rows are never assembled, not
  // merely not drawn. See `cs3/continueWatching.ts`.
  handleRaw('library:getContinueWatching', async (limit?: number) =>
    continueWatchingEnabled(datastore) ? libraryStore.getContinueWatching(limit) : []
  );

  /**
   * Removes one title from the row, keeping where it got to.
   *
   * A dismissal rather than a deletion: "take this off my home screen" and
   * "forget where I was" are different intentions, and the destructive reading of
   * the first is unrecoverable — someone tidying the row would silently lose the
   * resume point on a film they were halfway through.
   */
  handle(
    'library:dismissContinueWatching',
    async (key: string) => {
      const removed = libraryStore.dismissFromContinueWatching(key);
      logger.info('library', 'continue_watching_dismissed', { mediaId: key, removed });
      return { removed };
    },
    { removed: false }
  );

  handle(
    'library:clearContinueWatching',
    async () => {
      const cleared = libraryStore.clearContinueWatching();
      logger.info('library', 'continue_watching_cleared', { cleared });
      return { cleared };
    },
    { cleared: 0 }
  );

  // --- the source that actually played -------------------------------------------
  /**
   * Saving and re-opening the exact stream that worked.
   *
   * The library already remembers *what* was watched and the bookmarks remember
   * *which page* it came from. Neither remembers **which of thirty sources
   * actually delivered it** — so returning to a title meant picking again from a
   * list, with no record that the fourth one down is the only one that ever
   * played.
   *
   * The link is stored, but it is never the identity: a provider URL is a signed
   * address on someone else's CDN, good for minutes. What makes the record
   * durable is the `origin` query beside it, which is replayed to obtain a fresh
   * link for the same release when the stored one has died.
   */
  handle(
    'library:recordPlayedSource',
    async (input: {
        title: string;
        year?: number;
        mediaUrl: string;
        episodeTitle?: string;
        season?: number;
        episode?: number;
        source: TorrentResult;
        positionSeconds?: number;
        durationSeconds?: number;
      }) => {
      const key = canonicalKey(input.title, input.year);
      const stored = torrentResultToStoredSource(input.source);

      /**
       * The deadline is read from the URL now, while we have it.
       *
       * `SourceCache` already knows how to find one — CloudFront's `Expires`,
       * a JWT `exp`, and the handful of other schemes providers actually use.
       * Recording it here is what lets `isLinkUsable` answer later without
       * another request; without it every saved source would be re-resolved on
       * every open, which is the cost this feature exists to avoid.
       */
      if (stored.directUrl && stored.expiresAt === undefined) {
        const deadline = deadlineFromUrl(stored.directUrl);
        if (deadline) stored.expiresAt = deadline;
      }

      const record = libraryStore.recordPlayedSource({
        key,
        season: input.season,
        episode: input.episode,
        source: stored,
        origin: {
          mediaUrl: input.mediaUrl,
          title: input.title,
          year: input.year,
          episodeTitle: input.episodeTitle,
        },
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
      });
      return { record };
    },
    { record: null }
  );

  handle('library:getPlayedSource', async (key: string, season?: number, episode?: number) => ({
      record: libraryStore.getPlayedSource(key, season, episode),
    }));

  handle('library:listPlayedSources', async (limit?: number) => ({
    records: libraryStore.listPlayedSources(limit),
  }));

  handle('library:getPlayedSourcesForKey', async (key: string) => ({
    records: libraryStore.getPlayedSourcesForKey(key),
  }));

  handle('library:forgetPlayedSource', async (key: string, season?: number, episode?: number) => ({
      removed: libraryStore.forgetPlayedSource(key, season, episode),
    }));

  /**
   * Hands back a playable source for a saved record, refreshing it if it has died.
   *
   * Three outcomes, and the caller is told which — because they mean different
   * things to the viewer and a single "here is a stream" would hide the one that
   * matters:
   *
   * - `reused` — the stored link still holds. Instant; no provider was contacted.
   * - `refreshed` — the link had expired, so the *same release* was re-resolved
   *   from the same provider and the record updated in place.
   * - `unavailable` — the provider no longer offers that release. The record is
   *   marked rather than deleted, because "the one that used to work is gone" is
   *   more useful than an entry that silently vanishes, and the full source list
   *   comes back so the viewer can choose again.
   */
  handle(
    'library:resolvePlayedSource',
    async (key: string, season?: number, episode?: number) => {
      const record = libraryStore.getPlayedSource(key, season, episode);
      if (!record) {
        return { ok: false, error: 'No source has been saved for this item.', resolution: null };
      }

      if (isLinkUsable(record.source)) {
        return {
          resolution: 'reused' as const,
          record,
          source: storedSourceToTorrentResult(record.source),
          sources: [],
        };
      }

      /**
       * The saved link is dead, so the query that produced it is replayed.
       * `bypassCache` because a cached answer is what just failed.
       */
      const discovered = await contentService.getSources(
        {
          mediaUrl: record.origin.mediaUrl,
          titleOverride: record.origin.title,
          season: record.season,
          episode: record.episode,
        },
        undefined,
        { bypassCache: true }
      );

      const replacement = pickReplacement(record.source, discovered.sources);
      if (!replacement) {
        libraryStore.markPlayedSourceUnavailable(
          key,
          'The provider no longer offers this release.',
          season,
          episode
        );
        return {
          ok: false,
          resolution: 'unavailable' as const,
          error:
            'The exact source you saved is no longer offered by that provider. ' +
            'Pick another from the list below.',
          record,
          // The alternatives, so this is a choice rather than a dead end.
          sources: discovered.sources,
        };
      }

      const refreshed = torrentResultToStoredSource(replacement);
      const updated = libraryStore.updatePlayedSourceLink(
        key,
        {
          directUrl: refreshed.directUrl,
          directHeaders: refreshed.directHeaders,
          magnet: refreshed.magnet,
          isM3u8: refreshed.isM3u8,
          expiresAt: refreshed.directUrl ? deadlineFromUrl(refreshed.directUrl) ?? undefined : undefined,
        },
        season,
        episode
      );

      return {
        resolution: 'refreshed' as const,
        record: updated ?? record,
        source: replacement,
        sources: discovered.sources,
      };
    },
    { resolution: null, sources: [] }
  );
};

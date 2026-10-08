import type { Episode } from '../../types/api';
import { canonicalKey } from '../../../electron/cs3/libraryStore.ts';

/**
 * The series the player is currently inside.
 *
 * Kept in its own module rather than next to `EpisodePanel` so the panel file
 * exports only a component: mixing a component and a helper function in one file
 * breaks React Fast Refresh, which then full-reloads the app — and losing player
 * state on every edit is a poor way to work on a player.
 */

/** What the library knows about one episode's viewing history. */
export interface EpisodeWatchState {
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
}

/** Key used to look an episode up in `watchState`. */
export function episodeKey(season: number | undefined, episode: number | undefined): string {
  return `${season ?? 1}|${episode ?? 0}`;
}

export interface SeriesContext {
  title: string;
  posterUrl?: string;
  plot?: string;
  year?: number;
  rating?: number;
  tags?: string[];
  duration?: string;
  episodes: Episode[];
  /** URL of the episode currently playing, used to highlight and to seed next/prev. */
  currentEpisodeUrl?: string;
  /**
   * Canonical URL of the title/series detail page (e.g. detail.url),
   * used to reopen the title page rather than relying on an episode playback handle.
   */
  pageUrl?: string;
  /**
   * Watch history per episode, keyed by `episodeKey`.
   *
   * Without it the panel is just a list of names, and the viewer has to remember
   * where they got to — which is exactly the thing the app is supposed to know.
   */
  watchState?: Record<string, EpisodeWatchState>;
}

/**
 * Every episode's viewing history for one title, keyed by `episodeKey`.
 *
 * Two IPC calls rather than one because progress is keyed on the library's
 * canonical `title:year`, never on a URL — that is what lets one film from five
 * providers be one entry, and it means the URL has to be resolved to a key
 * first.
 *
 * Lives here rather than in the detail view because the *card* path needs it
 * too: quick-play started every series at episode one purely because this
 * lookup was in a file it could not reach.
 *
 * The title is the fallback, and it is not optional in practice. Progress is
 * written for anything played, but a library *entry* exists only for a title
 * someone added to a bucket — so a film started from History, Search or Home
 * and never filed anywhere had its position saved and never read back, and
 * every return to it began at 0:00. Measured on a real install: `Extraction
 * II` held 1,099s of 7,437 under `extraction-ii:2023` with no library entry
 * at all. The key is the same function the store writes with.
 */
export async function loadWatchState(
  mediaUrl: string,
  identity?: { title?: string; year?: number; key?: string }
): Promise<Record<string, EpisodeWatchState>> {
  if (!window.cloudstream) return {};

  // A caller holding the key already (a Continue watching row, a library card)
  // skips the address lookup: the row *is* the progress record.
  const entry = identity?.key ? null : await window.cloudstream.getLibraryEntryForUrl(mediaUrl);
  const key =
    identity?.key ??
    entry?.key ??
    (identity?.title ? canonicalKey(identity.title, identity.year) : null);
  if (!key) return {};

  const rows = await window.cloudstream.getProgressForKey(key);
  const state: Record<string, EpisodeWatchState> = {};
  for (const row of rows) {
    state[episodeKey(row.season, row.episode)] = {
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      completed: row.completed,
    };
  }
  return state;
}

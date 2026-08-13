import type { Episode } from '../../types/api';

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
   * Watch history per episode, keyed by `episodeKey`.
   *
   * Without it the panel is just a list of names, and the viewer has to remember
   * where they got to — which is exactly the thing the app is supposed to know.
   */
  watchState?: Record<string, EpisodeWatchState>;
}

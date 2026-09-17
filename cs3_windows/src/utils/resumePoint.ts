import type { Episode } from '../types/api';
import { episodeKey, type EpisodeWatchState } from '../components/player/seriesContext.ts';

/**
 * Which episode "Play" means, and where in it to start.
 *
 * Quick-play from a card always started a series at its first episode. That is
 * the correct answer exactly once — the first time — and wrong on every visit
 * after it: a viewer six episodes into a show pressed Play on the poster and
 * got the pilot. There is no error and nothing looks broken, so the failure is
 * absorbed as "this app does not remember where I was", which is the single
 * thing a streaming app is expected to do.
 *
 * Nothing had to be measured or fetched to fix it. The app already stored every
 * episode's progress and the detail page already read it; the card path simply
 * never asked. This is that lookup, as a pure function so it can be tested —
 * every branch of it is a wrong episode starting silently, which is the worst
 * kind of thing to leave unpinned.
 *
 * The rule, which is what every OTT app does:
 *
 *  - an episode started and not finished → resume it, at its stored position;
 *  - the furthest episode finished → start the one after it, from the top;
 *  - the last episode finished → the series is over; offer it again from its
 *    start rather than refusing to play anything;
 *  - nothing watched → the first episode.
 */

export interface ResumePoint {
  /** The episode to play, or null for a film. */
  episode: Episode | null;
  /** Seconds to seek to, or undefined to start at the beginning. */
  resumeAt?: number;
}

/** Season then episode, which is the order a viewer means by "next". */
export function inPlayOrder(episodes: readonly Episode[]): Episode[] {
  return [...episodes].sort(
    (a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 0) - (b.episode ?? 0)
  );
}

export function pickResumePoint(
  episodes: readonly Episode[],
  watchState: Record<string, EpisodeWatchState> | undefined,
  options: { isLive?: boolean } = {}
): ResumePoint {
  const ordered = inPlayOrder(episodes);
  if (ordered.length === 0) return { episode: null, resumeAt: resumeSeconds(watchState, null, options) };

  const state = watchState ?? {};

  /*
   * The *furthest* episode with any history, not the most recently updated one.
   * Rewatching episode 2 of a series someone has finished writes a fresh
   * timestamp on an early episode, and "continue" then means going backwards
   * through a show they have already seen. Position in the series is what a
   * viewer means by where they were.
   */
  let furthest = -1;
  for (let i = 0; i < ordered.length; i++) {
    if (state[episodeKey(ordered[i].season, ordered[i].episode)]) furthest = i;
  }

  if (furthest < 0) return { episode: ordered[0] };

  const seen = state[episodeKey(ordered[furthest].season, ordered[furthest].episode)];
  if (!seen.completed) {
    return {
      episode: ordered[furthest],
      resumeAt: resumeSeconds(state, ordered[furthest], options),
    };
  }

  const next = ordered[furthest + 1];
  // Past the end: the series is finished. Starting it again beats a Play button
  // that does nothing, and the viewer pressed Play.
  return { episode: next ?? ordered[0] };
}

/**
 * Where to resume an episode from, or undefined if it was finished, never
 * started, or is live.
 *
 * A live channel has no fixed timeline, so a stored position does not address
 * anything: yesterday's twenty minutes in is not a point in today's broadcast.
 * The seek either lands somewhere arbitrary or is refused, and both read as the
 * channel being broken.
 */
export function resumeSeconds(
  watchState: Record<string, EpisodeWatchState> | undefined,
  episode: Episode | null,
  options: { isLive?: boolean } = {}
): number | undefined {
  if (options.isLive) return undefined;
  const match = watchState?.[episodeKey(episode?.season, episode?.episode)];
  if (!match || match.completed) return undefined;
  return match.positionSeconds;
}

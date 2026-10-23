import { parseReleaseName } from '../torrent/releaseParser.ts';

/**
 * Which episode a request means, wherever an episode is picked from a list.
 *
 * Two places used to hand back the wrong episode rather than none: a provider
 * whose list lacked the episode was asked for its series page (most answer
 * with episode 1), and a season pack's indexer-given file was trusted for a
 * different episode than the one it was found for. Both now refuse, and
 * discovery moves on to a source that has it. Pure.
 */

/** A provider's episode handle for (season, episode), or null when it does not list it. */
export function pickEpisodeHandle(
  episodes: ReadonlyArray<{ url: string; season?: number; episode?: number }>,
  season: number | undefined,
  episode: number
): string | null {
  const exact = episodes.find((e) => e.episode === episode && (season === undefined || e.season === season));
  if (exact) return exact.url;
  // Episodes listed without a season: on a single-season show, or on a page
  // that is itself one season (anime sites publish each season as its own
  // page), the episode number is the whole key. A list that does carry
  // seasons is never guessed across them.
  const seasonless = episodes.length > 0 && episodes.every((e) => e.season === undefined);
  if (season === undefined || season === 1 || seasonless) {
    const unnumbered = episodes.find((e) => e.episode === episode && e.season === undefined);
    if (unnumbered) return unnumbered.url;
  }
  return null;
}

/**
 * Whether a torrent file may be the requested episode: true when its name says
 * so or says nothing, false when it names a different episode or season.
 */
export function fileFitsEpisode(fileName: string, season: number | undefined, episode: number | undefined): boolean {
  if (episode === undefined) return true;
  const parsed = parseReleaseName(fileName);
  if (parsed.episode === undefined && parsed.absoluteEpisode === undefined) return true;
  if (season !== undefined && parsed.season !== undefined && parsed.season !== season) return false;
  return parsed.episode === episode || parsed.absoluteEpisode === episode;
}

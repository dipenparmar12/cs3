import type { Episode } from '../../types/api.ts';

/**
 * Choosing episodes to download from a long series (download batch dialog).
 *
 * A series can list hundreds of episodes across many seasons, so the list is
 * grouped by season, each group foldable with a select-all of its own, and
 * filtered by number or name; a quality can be set per episode over the run's
 * default. Episodes are keyed by season and number (their address can repeat
 * across a provider's pages), falling back to the address. Pure.
 */

export function episodeKey(episode: Pick<Episode, 'season' | 'episode' | 'url'>): string {
  return episode.episode !== undefined ? `${episode.season ?? 1}:${episode.episode}` : `url:${episode.url}`;
}

export interface SeasonGroup {
  season: number;
  episodes: Episode[];
}

export function groupBySeason(episodes: Episode[]): SeasonGroup[] {
  const bySeason = new Map<number, Episode[]>();
  for (const episode of episodes) {
    const season = episode.season ?? 1;
    const list = bySeason.get(season) ?? [];
    list.push(episode);
    bySeason.set(season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, list]) => ({
      season,
      episodes: [...list].sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
    }));
}

/**
 * Episodes matching a filter: a bare number is an episode number (`3`), `s2`
 * a season, `s2e3` or `2x03` one episode, anything else words of the name.
 */
export function filterEpisodes(groups: SeasonGroup[], query: string): SeasonGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const se = /^s?(\d+)\s*(?:e|x)\s*(\d+)$/.exec(q);
  const seasonOnly = /^s(\d+)$/.exec(q);
  const number = /^\d+$/.test(q) ? Number(q) : null;
  const words = q.split(/\s+/).filter(Boolean);
  return groups
    .map((group) => ({
      season: group.season,
      episodes: group.episodes.filter((e) => {
        if (se) return group.season === Number(se[1]) && e.episode === Number(se[2]);
        if (seasonOnly) return group.season === Number(seasonOnly[1]);
        if (number !== null) return e.episode === number;
        const name = (e.name ?? '').toLowerCase();
        return words.every((w) => name.includes(w));
      }),
    }))
    .filter((group) => group.episodes.length > 0);
}

/** A season's select-all: every episode in it, some, or none. */
export function seasonState(group: SeasonGroup, selected: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const count = group.episodes.filter((e) => selected.has(episodeKey(e))).length;
  return count === 0 ? 'none' : count === group.episodes.length ? 'all' : 'some';
}

/** Ticks or unticks a whole season (only what is shown, when filtered). */
export function toggleSeason(group: SeasonGroup, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const on = seasonState(group, selected) !== 'all';
  for (const episode of group.episodes) {
    if (on) next.add(episodeKey(episode));
    else next.delete(episodeKey(episode));
  }
  return next;
}

/** The episodes to send, in season and episode order, each with its quality. */
export function batchEpisodes(
  episodes: Episode[],
  selected: ReadonlySet<string>,
  quality: ReadonlyMap<string, number>
): Array<{ url: string; name?: string; season?: number; episode?: number; maxResolution?: number }> {
  return groupBySeason(episodes)
    .flatMap((group) => group.episodes)
    .filter((e) => selected.has(episodeKey(e)))
    .map((e) => {
      const own = quality.get(episodeKey(e));
      return {
        url: e.url,
        name: e.name,
        season: e.season,
        episode: e.episode,
        ...(own !== undefined ? { maxResolution: own } : {}),
      };
    });
}

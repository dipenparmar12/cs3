import { TvType } from '../types/api.ts';
import type { Episode, SearchResponse } from '../types/api.ts';
import type { PageSnapshot } from '../../electron/cs3/pageSnapshot.ts';

/**
 * Drawing a detail page from the copy the app kept, and folding a live answer
 * over it.
 *
 * A plain module rather than part of `DetailView` for the reason
 * `settingsLevel.ts` is: JSX cannot load under Node's type-stripping test
 * runner, and the rule these functions implement — *a later load may add and
 * may correct, but may never blank* — is exactly the kind that is only ever
 * really pinned down by a test. It is the display-side half of `mergeSnapshot`
 * in the main process; the two must agree, and both say so.
 */

/**
 * The subset of a detail page this module reads and writes.
 *
 * Structurally identical to `DetailView`'s own `DetailData`, and deliberately
 * declared here rather than imported from it: importing would drag a `.tsx`
 * into a module that exists to be loadable without one.
 */
export interface SavedPageDetail {
  name: string;
  url: string;
  type: TvType;
  posterUrl?: string;
  year?: number;
  plot?: string;
  rating?: number;
  tags?: string[];
  duration?: string;
  episodes?: Episode[];
  imdbId?: string;
  isLive?: boolean;
  actors?: string[];
  recommendations?: SearchResponse[];
}

/**
 * Draws a page from the stored copy.
 *
 * Deliberately produces the same `DetailData` a provider would, so every
 * downstream consumer — the hero, the episode list, Play, Download, the source
 * picker — works on a restored page exactly as on a live one. The alternative,
 * a reduced "offline" rendering, would be a second page shape to keep in step
 * with the first and would quietly disable actions that work perfectly well:
 * source discovery keys on the address, and the address is what a snapshot has.
 */
export function detailFromSnapshot(snapshot: PageSnapshot, fallbackUrl: string): SavedPageDetail {
  return {
    name: snapshot.title,
    // `||`, not `??`: an empty string is an absent address, and a page drawn
    // at `""` addresses nothing — every action on it would fail with no reason.
    url: snapshot.routes[0] || snapshot.url || fallbackUrl,
    type: (snapshot.type as TvType) ?? TvType.Movie,
    posterUrl: snapshot.posterUrl,
    year: snapshot.year,
    plot: snapshot.plot,
    rating: snapshot.rating,
    tags: snapshot.tags,
    duration: snapshot.duration,
    episodes: snapshot.episodes,
    imdbId: snapshot.imdbId,
    isLive: snapshot.isLive,
    actors: snapshot.actors,
    recommendations: snapshot.recommendations,
  };
}

/**
 * Folds a live answer over the stored one, without letting it blank anything.
 *
 * The same rule as `mergeSnapshot` in the main process, applied at the point of
 * display: a provider that answers with a title and no poster has told us
 * nothing about the poster, and treating that silence as "there is no poster"
 * is what makes a page that used to be complete degrade every time it is
 * opened. A real value always wins, so a corrected field does update.
 */
export function mergeDetail<T extends SavedPageDetail>(live: T, stored: PageSnapshot | null): T {
  if (!stored) return live;
  const keep = <T,>(fresh: T | undefined, saved: T | undefined): T | undefined =>
    fresh === undefined || fresh === null || fresh === '' ? saved : fresh;
  const keepList = <T,>(fresh: T[] | undefined, saved: T[] | undefined): T[] | undefined =>
    fresh && fresh.length > 0 ? fresh : saved;

  return {
    ...live,
    name: live.name || stored.title,
    year: keep(live.year, stored.year),
    posterUrl: keep(live.posterUrl, stored.posterUrl),
    plot: keep(live.plot, stored.plot),
    rating: keep(live.rating, stored.rating),
    duration: keep(live.duration, stored.duration),
    imdbId: keep(live.imdbId, stored.imdbId),
    tags: keepList(live.tags, stored.tags),
    actors: keepList(live.actors, stored.actors),
    // Episodes are all-or-nothing: splicing a fresh partial listing into a
    // stored one would invent a season no provider offers.
    episodes: keepList(live.episodes, stored.episodes),
    recommendations: keepList(live.recommendations, stored.recommendations),
  };
}

/**
 * How old the saved copy is, in the terms someone would use out loud.
 *
 * Stated because it decides what the viewer does next: a copy from an hour ago
 * beside a failing provider means the provider is having a moment, and one from
 * eight months ago means the page is probably gone for good. A bare "saved
 * copy" leaves them unable to tell those apart.
 */
export function savedCopyAge(snapshot: PageSnapshot | null, now: number = Date.now()): string {
  if (!snapshot) return 'Saved earlier';
  const days = Math.floor((now - snapshot.verifiedAt) / 86_400_000);
  if (days < 1) return 'Saved today';
  if (days === 1) return 'Saved yesterday';
  if (days < 30) return `Saved ${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'Saved last month' : `Saved ${months} months ago`;
}


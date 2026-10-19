import type { CanonicalMediaIdentity, MediaRating } from '../../types/ratings.ts';

/**
 * What the masthead's ratings row shows, as each lookup lands.
 *
 * Pure, so the rules that keep the row from flickering are tested rather than
 * remembered (`detailStability.test.mts`):
 *
 * - The *work* (title, year, type) decides whose ratings these are; a different
 *   work starts empty. The ids (IMDb, TMDB) only refine the request.
 * - An answer for the same work replaces what is shown only when it has
 *   something — a refinement that came back empty, or failed, never blanks a
 *   filled row.
 * - Until the first answer for this work is in, the row holds one chip row of
 *   height; settled with nothing, it is omitted.
 */

export interface RatingsView {
  work: string;
  ratings: MediaRating[];
  settled: boolean;
}

export function ratingsWorkKey(identity: CanonicalMediaIdentity): string {
  return `${identity.title}|${identity.year ?? ''}|${identity.type ?? ''}`;
}

export function ratingsRequestKey(identity: CanonicalMediaIdentity): string {
  return `${ratingsWorkKey(identity)}|${identity.imdbId ?? ''}|${identity.tmdbId ?? ''}`;
}

export function emptyRatingsView(work: string): RatingsView {
  return { work, ratings: [], settled: false };
}

/** `found` is null when the lookup failed outright. */
export function settleRatings(current: RatingsView, work: string, found: MediaRating[] | null): RatingsView {
  const kept = current.work === work ? current.ratings : [];
  return { work, ratings: found && found.length > 0 ? found : kept, settled: true };
}

export type RatingsRowState = 'placeholder' | 'chips' | 'hidden';

export function ratingsRowState(view: RatingsView, work: string): RatingsRowState {
  if (view.work !== work) return 'placeholder';
  if (view.ratings.length > 0) return 'chips';
  return view.settled ? 'hidden' : 'placeholder';
}

/**
 * Hands out tickets so only the newest request may answer.
 *
 * Two lookups can be in flight for one row — the first by title, a second
 * once the IMDb id is known — and the slower one must not overwrite the
 * newer one's answer.
 */
export function latestOnly(): { issue(): number; isCurrent(ticket: number): boolean } {
  let latest = 0;
  return {
    issue: () => ++latest,
    isCurrent: (ticket) => ticket === latest,
  };
}

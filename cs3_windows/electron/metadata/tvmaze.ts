/**
 * TVmaze — the cast list for television, with photographs.
 *
 * The best keyless source in this set, and by some distance: `/shows/{id}/cast`
 * returns the performer *and* the character as two linked objects, each with
 * its own image, and `/shows/{id}/crew` returns crew with the job as the site
 * states it. No key, a published rate limit, and a stable shape.
 *
 * `metadataProvider.ts` has talked to TVmaze since long before this module and
 * reads none of it — it takes the show, the summary and the episode list, and
 * the two endpoints that carry the people were never called. This is not a new
 * dependency; it is a request to a host the app already uses.
 *
 * ## Scope, stated rather than discovered
 *
 * **Television only.** TVmaze is a TV database — that is the reason
 * `cinemeta.ts` exists and displaced it as the primary catalogue, because movie
 * searches through it never produced an IMDb id. A film asked for here answers
 * nothing, which is why `enrichmentService` routes films to Wikidata instead of
 * asking both and hoping.
 *
 * ## `self` and `voice` are not decoration
 *
 * A cast entry carries both flags. `self: true` is a person appearing as
 * themselves — a talk-show host, a documentary subject — and rendering
 * "Stephen Colbert as Stephen Colbert" is worse than rendering the name alone,
 * so the character is dropped for those. `voice: true` becomes `CreditRole.Voice`
 * rather than `Cast`, which is what stops an animated series listing its
 * performers as though they appeared on screen.
 */

import { HttpError, fetchJson } from '../torrent/http.ts';
import {
  CreditRole,
  MetadataSource,
  type CreditPerson,
} from '../../src/types/metadata.ts';
import { classifyJob } from './merge.ts';

const BASE = 'https://api.tvmaze.com';
const TIMEOUT_MS = 12_000;

/** Past this a cast list is scrolled rather than read. */
const MAX_CAST = 60;

interface TvMazeImage {
  medium?: string;
  original?: string;
}

interface TvMazePerson {
  id?: number;
  url?: string;
  name?: string;
  image?: TvMazeImage | null;
}

interface TvMazeCastEntry {
  person?: TvMazePerson;
  character?: TvMazePerson;
  self?: boolean;
  voice?: boolean;
}

interface TvMazeCrewEntry {
  type?: string;
  person?: TvMazePerson;
}

interface TvMazeLookup {
  id?: number;
}

/**
 * The medium image, deliberately, not the original.
 *
 * TVmaze's `original` is the full-resolution upload and `medium` is roughly
 * 210px wide — which is already larger than the 96px the cast rail draws. A
 * sixty-person cast at `original` is the same mistake `commonsThumbnail` exists
 * to prevent, from a different source.
 */
function thumbnail(image: TvMazeImage | null | undefined): string | undefined {
  return image?.medium || image?.original || undefined;
}

/** Cast rows to credits. Pure; the fetch is separate so this can be tested. */
export function parseCast(entries: TvMazeCastEntry[]): CreditPerson[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => entry.person?.name)
    .slice(0, MAX_CAST)
    .map<CreditPerson>((entry, index) => ({
      name: entry.person!.name as string,
      role: entry.voice ? CreditRole.Voice : CreditRole.Cast,
      // A person appearing as themselves has no character to name, and saying
      // "Stephen Colbert as Stephen Colbert" reads as a bug in the app.
      character: entry.self ? undefined : entry.character?.name || undefined,
      // TVmaze returns cast in billing order and publishes no ordinal, so the
      // position *is* the order. Recording it here is what lets the merge keep
      // that ordering when Wikidata's unordered set is folded in beside it.
      order: index,
      imageUrl: thumbnail(entry.person!.image),
      characterImageUrl: entry.self ? undefined : thumbnail(entry.character?.image),
      profileUrl: entry.person!.url || undefined,
      sources: [MetadataSource.TvMaze],
    }));
}

/** Crew rows to credits. `type` is the job, verbatim. */
export function parseCrew(entries: TvMazeCrewEntry[]): CreditPerson[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => entry.person?.name)
    .map<CreditPerson>((entry) => ({
      name: entry.person!.name as string,
      role: CreditRole.Crew,
      job: entry.type || undefined,
      department: classifyJob(entry.type),
      imageUrl: thumbnail(entry.person!.image),
      profileUrl: entry.person!.url || undefined,
      sources: [MetadataSource.TvMaze],
    }));
}

/**
 * The TVmaze id for an IMDb id, or null when TVmaze genuinely does not carry it.
 *
 * **Only a 404 is a null.** The first version of this caught everything and
 * answered null, which is the mistake this repository keeps having to undo: a
 * catch that converts a transport failure into a confident "nothing found".
 * `tools/e2e/metadata-e2e.mjs` caught it on its first run, reporting
 * *Breaking Bad* — one of the best-covered series TVmaze has — as "not a TVmaze
 * title" when the real answer was an HTTP 403 from a proxy.
 *
 * The consequence was not cosmetic. `enrichmentService` reads a null here as
 * the `empty` outcome, so an unreachable TVmaze would have been reported to the
 * viewer as "this series has no cast recorded" forever, with the actual cause
 * invisible in every diagnostic the app collects.
 *
 * A 404 really is an ordinary answer — it is what every film gets — so that one
 * stays a null, and everything else is raised for the caller to classify.
 */
export async function lookupByImdb(
  imdbId: string,
  signal?: AbortSignal
): Promise<number | null> {
  try {
    const show = await fetchJson<TvMazeLookup>(
      `${BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,
      { signal, timeoutMs: TIMEOUT_MS, retries: 0 }
    );
    return show?.id ?? null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Cast and crew for one show.
 *
 * Fetched together but settled independently: a show with no crew recorded
 * still has a cast, and letting the missing half reject would discard it.
 */
export async function fetchCredits(
  showId: number | string,
  signal?: AbortSignal
): Promise<CreditPerson[]> {
  const id = encodeURIComponent(String(showId));

  const [cast, crew] = await Promise.allSettled([
    fetchJson<TvMazeCastEntry[]>(`${BASE}/shows/${id}/cast`, {
      signal,
      timeoutMs: TIMEOUT_MS,
      retries: 0,
    }),
    fetchJson<TvMazeCrewEntry[]>(`${BASE}/shows/${id}/crew`, {
      signal,
      timeoutMs: TIMEOUT_MS,
      retries: 0,
    }),
  ]);

  return [
    ...(cast.status === 'fulfilled' ? parseCast(cast.value) : []),
    ...(crew.status === 'fulfilled' ? parseCrew(crew.value) : []),
  ];
}

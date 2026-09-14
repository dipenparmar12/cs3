/**
 * The half of Cinemeta's answer the app already pays for and throws away.
 *
 * `cinemeta.ts` reads nine fields off `/meta/{type}/{id}.json` and the response
 * carries roughly twice that. `director`, `writer`, `released`, `country`,
 * `awards`, `logo` and the trailer list are all in the body of a request the
 * app is *already making* on every catalogue detail page — so this is the
 * cheapest enrichment in the set: no new host, no new round trip, no new
 * failure mode, and it is the only one that works for a title with no Wikidata
 * entry and no TVmaze entry at all.
 *
 * It is deliberately a second module rather than a widening of `CinemetaDetail`.
 * That type feeds `LoadResponse` through `ContentService.fetchDetail`, which is
 * the *playback* path — it decides what gets searched for and what gets played,
 * and nothing in this file has any business there. Enrichment is a separate
 * record fetched on a separate schedule, and keeping the parse separate is what
 * keeps the two from drifting into one another.
 *
 * ## What it cannot do, and why the other sources exist
 *
 * `cast` is `string[]`. Names, in billing order, and nothing else — no
 * characters, no photographs, no IMDb person ids to look either up with. That
 * is the entire reason Wikidata and TVmaze are in this directory: Cinemeta can
 * tell you Timothée Chalamet is in Dune and cannot tell you he plays Paul
 * Atreides or what he looks like.
 *
 * So the credits here are emitted **without images and without characters**,
 * which is exactly the shape `mergeCredits` is built to absorb: a richer source
 * folds its character and its photograph onto this row rather than duplicating
 * it, and where no richer source answers, the names still appear.
 */

import {
  CreditRole,
  MetadataSource,
  type CreditPerson,
  type TitleRating,
  type TitleVideo,
} from '../../src/types/metadata.ts';
import { classifyJob } from './merge.ts';

/** Cinemeta returns full billed casts; past this it is a scroll, not a list. */
const MAX_CAST = 40;

/**
 * The response fields this module reads. Declared separately from
 * `cinemeta.ts`'s interface on purpose — that one describes what the playback
 * path needs, and widening it to carry these would put enrichment fields on the
 * type that decides what gets played.
 */
export interface CinemetaExtraFields {
  id?: string;
  imdb_id?: string;
  name?: string;
  cast?: string[];
  director?: string[] | string;
  writer?: string[] | string;
  country?: string[] | string;
  awards?: string;
  released?: string;
  releaseInfo?: string;
  imdbRating?: string;
  logo?: string;
  background?: string;
  slug?: string;
  trailers?: Array<{ source?: string; type?: string }>;
  trailerStreams?: Array<{ title?: string; ytId?: string }>;
}

export interface CinemetaExtras {
  people: CreditPerson[];
  ratings: TitleRating[];
  videos: TitleVideo[];
  countries: string[];
  awards: string[];
  releaseDate?: string;
  logoUrl?: string;
  backdropUrl?: string;
}

/**
 * Cinemeta is inconsistent about whether a single-valued field is a string or a
 * one-element array, and both forms appear across the corpus. Normalising here
 * rather than at each call site is the difference between "Denis Villeneuve"
 * and `["D","e","n","i","s", …]` — spreading a string is the failure this
 * prevents, and it is silent.
 */
export function asList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  if (typeof value === 'string' && value.trim()) {
    // Some entries pack several names into one comma-separated string.
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Awards arrive as one sentence — `"Won 6 Oscars. 171 wins & 286 nominations
 * total."` — rather than as a list. Split on sentence ends so each claim is its
 * own chip; do **not** try to parse counts out of it, because the phrasing
 * varies and a mis-parse would state a wrong number of Oscars with confidence.
 */
export function splitAwards(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  if (/^n\/?a$/i.test(raw.trim())) return [];
  return raw
    .split(/\.\s+/)
    .map((part) => part.replace(/\.$/, '').trim())
    .filter((part) => part.length > 0);
}

/**
 * An IMDb rating string to a rating on its published scale.
 *
 * Cinemeta sends `imdbRating` as a string and omits it entirely for an unrated
 * title, but also sends the literal `"N/A"` for some entries — which
 * `parseFloat` turns into `NaN`, and `NaN` compared against anything is false,
 * so an unguarded value survives every sanity check downstream and renders as
 * an empty score badge.
 */
export function parseImdbRating(
  raw: string | undefined,
  imdbId: string | undefined
): TitleRating | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return {
    source: MetadataSource.Cinemeta,
    kind: 'user',
    value,
    scaleMin: 0,
    scaleMax: 10,
    url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined,
  };
}

/** The fields `cinemeta.ts` does not read, as enrichment. Pure. */
export function parseCinemetaExtras(meta: CinemetaExtraFields | null | undefined): CinemetaExtras {
  const empty: CinemetaExtras = {
    people: [],
    ratings: [],
    videos: [],
    countries: [],
    awards: [],
  };
  if (!meta) return empty;

  const imdbId = meta.imdb_id || meta.id;
  const people: CreditPerson[] = [];

  asList(meta.cast)
    .slice(0, MAX_CAST)
    .forEach((name, index) => {
      if (!name.trim()) return;
      people.push({
        name: name.trim(),
        role: CreditRole.Cast,
        // Cinemeta publishes cast in billing order, so the position is the
        // order — the same reasoning as TVmaze, and what lets a richer source
        // merge onto these rows without losing where they sit.
        order: index,
        sources: [MetadataSource.Cinemeta],
      });
    });

  const addCrew = (names: string[], job: string) => {
    for (const name of names) {
      if (!name.trim()) continue;
      people.push({
        name: name.trim(),
        role: CreditRole.Crew,
        job,
        department: classifyJob(job),
        sources: [MetadataSource.Cinemeta],
      });
    }
  };
  addCrew(asList(meta.director), 'Director');
  addCrew(asList(meta.writer), 'Writer');

  const videos: TitleVideo[] = [];
  for (const stream of meta.trailerStreams ?? []) {
    if (!stream.ytId) continue;
    videos.push({
      title: stream.title || 'Trailer',
      url: `https://www.youtube.com/watch?v=${stream.ytId}`,
      kind: 'trailer',
      host: 'youtube',
    });
  }
  for (const trailer of meta.trailers ?? []) {
    if (!trailer.source) continue;
    videos.push({
      title: 'Trailer',
      url: `https://www.youtube.com/watch?v=${trailer.source}`,
      kind: trailer.type?.toLowerCase() === 'teaser' ? 'teaser' : 'trailer',
      host: 'youtube',
    });
  }

  const rating = parseImdbRating(meta.imdbRating, imdbId);

  return {
    people,
    ratings: rating ? [rating] : [],
    videos,
    countries: asList(meta.country),
    awards: splitAwards(meta.awards),
    // `released` is a full ISO timestamp where `releaseInfo` is only a year —
    // the debut date, which is the field the brief actually asked for.
    releaseDate: meta.released?.slice(0, 10) || undefined,
    logoUrl: meta.logo,
    backdropUrl: meta.background,
  };
}

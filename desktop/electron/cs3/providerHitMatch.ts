import { TvType, type SearchResponse } from '../../src/types/api.ts';
import { normaliseTitleForMatch, titleSimilarity } from '../torrent/releaseParser.ts';
import { parseReleaseTitle } from './titleEnricher.ts';

/**
 * Whether a provider's search hit is the work the viewer is watching.
 *
 * The widened search asks every installed provider for a title and opens each
 * one's first hits. A provider that does not carry the title still answers:
 * with a sequel (*Toy Story 2* for *Toy Story*), another season's page, or
 * whatever its home page is promoting. Opened unchecked, those became sources
 * for the wrong film (Playback Source Resolution PRD, Phase 1).
 *
 * Three answers, not two, because absent evidence is not a mismatch (AGENTS.md
 * §12). `unknown` is kept: a title this cannot read (non-Latin script, romaji
 * against English) is offered, never started, since the widened results are
 * offered anyway. Only `mismatch` is dropped, and only on a conflict a person
 * would call one.
 */
export type HitVerdict =
  | { kind: 'match'; basis: 'imdb' | 'title' }
  | { kind: 'unknown'; reason: string }
  | { kind: 'mismatch'; reason: string };

export interface WantedWork {
  title: string;
  /** Omit for anime: providers give the season's year, not the show's. */
  year?: number;
  type?: TvType;
  imdbId?: string;
  season?: number;
}

/**
 * Dice similarity above which two titles are one, read as release names.
 * Measured on the cases in the test: *The Little Prince* against *Little
 * Prince* is 1.0; *Avengers* against *Avengers: Endgame* is 0.67.
 */
const SAME_TITLE = 0.8;

/**
 * Numbers spelled out, so *Ocean's Eight* and *Ocean's 8*, or *Rocky II* and
 * *Rocky 2*, compare as one. `v`, `x` and `i` stay words (*V for Vendetta*).
 */
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9',
};

/**
 * Tokens that name an instalment. One side having one the other lacks is a
 * different work however similar the rest is: *Toy Story* against *Toy Story
 * 2* scores 0.8 on words alone.
 */
const INSTALMENT_WORDS = new Set(['part', 'chapter', 'vol', 'volume']);

function isInstalmentToken(token: string): boolean {
  return INSTALMENT_WORDS.has(token) || /^\d{1,2}$/.test(token);
}

/** Movie against series, only where both are definite. Anime types are not. */
function form(type: TvType | undefined): 'movie' | 'series' | undefined {
  if (type === TvType.Movie) return 'movie';
  if (type === TvType.TvSeries || type === TvType.AsianDrama) return 'series';
  return undefined;
}

function isAnimeType(type: TvType | undefined): boolean {
  return type === TvType.Anime || type === TvType.AnimeMovie || type === TvType.OVA;
}

/** `Season 3`, `S03`, `S3E04`. A bare number is not a season. */
function seasonIn(name: string): number | undefined {
  const match =
    name.match(/\bseason\s*0*(\d{1,2})\b/i) ?? name.match(/\bS0*(\d{1,2})(?:\s*E\d{1,3})?\b/i);
  return match ? Number(match[1]) : undefined;
}

/** Drops season markers so *Mirzapur Season 3* compares as *Mirzapur*. */
function withoutSeason(title: string): string {
  return title
    .replace(/\bseason\s*\d{1,2}\b/gi, ' ')
    .replace(/\bS\d{1,2}(?:\s*E\d{1,3})?\b/gi, ' ')
    .trim();
}

function tokens(title: string): Set<string> {
  return new Set(
    normaliseTitleForMatch(title)
      .split(' ')
      .filter(Boolean)
      .map((token) => NUMBER_WORDS[token] ?? token)
  );
}

type TitleVerdict = 'same' | 'instalment' | 'different' | 'unreadable';

function compareTitles(wanted: string, candidate: string, yearAgrees: boolean): TitleVerdict {
  const a = tokens(withoutSeason(wanted));
  const b = tokens(withoutSeason(candidate));
  if (a.size === 0 || b.size === 0) return 'unreadable';

  const onlyOneSide = [...a].filter((t) => !b.has(t)).concat([...b].filter((t) => !a.has(t)));
  if (onlyOneSide.length === 0) return 'same';
  if (onlyOneSide.some(isInstalmentToken)) return 'instalment';
  if (titleSimilarity([...a].join(' '), [...b].join(' ')) >= SAME_TITLE) return 'same';

  // *Spider-Man: Into the Spider-Verse* listed as *Into the Spider-Verse*: one
  // name inside the other is the same work only when a year says so, or
  // *Avengers* would pass for *Avengers: Endgame*.
  const contained = [...a].every((t) => b.has(t)) || [...b].every((t) => a.has(t));
  return contained && yearAgrees ? 'same' : 'different';
}

export function judgeProviderHit(
  wanted: WantedWork,
  hit: Pick<SearchResponse, 'name' | 'originalTitle' | 'year' | 'type' | 'imdbId'>
): HitVerdict {
  if (wanted.imdbId && hit.imdbId) {
    return wanted.imdbId === hit.imdbId
      ? { kind: 'match', basis: 'imdb' }
      : { kind: 'mismatch', reason: `a different title (${hit.imdbId})` };
  }

  const names = [hit.name, hit.originalTitle].filter((n): n is string => Boolean(n?.trim()));
  if (names.length === 0) return { kind: 'unknown', reason: 'the result has no name' };

  if (wanted.season !== undefined) {
    const season = seasonIn(hit.name);
    if (season !== undefined && season !== wanted.season) {
      return { kind: 'mismatch', reason: `season ${season}, not season ${wanted.season}` };
    }
  }

  const wantedForm = form(wanted.type);
  const hitForm = form(hit.type);
  if (wantedForm && hitForm && wantedForm !== hitForm) {
    return { kind: 'mismatch', reason: `a ${hitForm}, not a ${wantedForm}` };
  }

  const parsed = names.map((name) => parseReleaseTitle(name));
  const hitYear = hit.year ?? parsed.find((p) => p.year)?.year;
  // A series' pages carry the season's year; only a film's year identifies it.
  const yearsComparable =
    wanted.year !== undefined &&
    hitYear !== undefined &&
    wantedForm !== 'series' &&
    hitForm !== 'series';
  if (yearsComparable && Math.abs(hitYear! - wanted.year!) > 1) {
    return { kind: 'mismatch', reason: `${hitYear}, not ${wanted.year}` };
  }
  const yearAgrees = yearsComparable;

  const verdicts = parsed.map((p) => compareTitles(wanted.title, p.title || '', yearAgrees));
  if (verdicts.includes('same')) return { kind: 'match', basis: 'title' };
  if (verdicts.every((v) => v === 'unreadable')) {
    return { kind: 'unknown', reason: 'the title could not be compared' };
  }
  if (verdicts.includes('instalment')) {
    return { kind: 'mismatch', reason: `another instalment ("${hit.name}")` };
  }
  // Romaji against English (*Kimetsu no Yaiba*, *Demon Slayer*) is routine for
  // anime and has no word in common; it is not evidence of another work.
  if (isAnimeType(wanted.type) || isAnimeType(hit.type) || verdicts.includes('unreadable')) {
    return { kind: 'unknown', reason: 'the titles share no words' };
  }
  return { kind: 'mismatch', reason: `a different title ("${hit.name}")` };
}

/**
 * Why a search result is on screen when the query was a person's or company's
 * name: "Cast: John Cena", "Directed by Christopher Nolan", "Produced by Yash
 * Raj Films". Read from their credited work (`metadata:filmography`), never
 * guessed from the title, so a documentary *about* John Cena that does not
 * credit him says nothing. Pure.
 */
import type { SearchResponse, TvType } from '../types/api';
import type { Filmography, FilmographyRole, FilmographyWork } from '../types/filmography';
import { foldName } from './suggestionLayout.ts';

export interface MatchReason {
  /** One short line for the card. */
  label: string;
  /** The credit alone ("Cast", "Director"), where a heading already names them. */
  role: string;
  /** Every credit on that title, for the tooltip. */
  detail: string;
}

/** The credit a card names when there are several, headline first. */
const ROLE_ORDER: FilmographyRole[] = [
  'Directing',
  'Creator',
  'Acting',
  'Voice',
  'Writing',
  'Producing',
  'Production',
  'Music',
  'Cinematography',
  'Editing',
];

const NOUN: Record<FilmographyRole, string> = {
  Directing: 'Director',
  Creator: 'Creator',
  Acting: 'Cast',
  Voice: 'Voice',
  Writing: 'Writer',
  Producing: 'Producer',
  Production: 'Producer',
  Music: 'Music',
  Cinematography: 'Cinematography',
  Editing: 'Editor',
};

const PHRASE: Record<FilmographyRole, (name: string) => string> = {
  Directing: (name) => `Directed by ${name}`,
  Creator: (name) => `Created by ${name}`,
  Acting: (name) => `Cast: ${name}`,
  Voice: (name) => `Voice: ${name}`,
  Writing: (name) => `Written by ${name}`,
  Producing: (name) => `Produced by ${name}`,
  Production: (name) => `Produced by ${name}`,
  Music: (name) => `Music by ${name}`,
  Cinematography: (name) => `Cinematography: ${name}`,
  Editing: (name) => `Edited by ${name}`,
};

export function reasonFor(name: string, work: FilmographyWork): MatchReason | null {
  const roles = ROLE_ORDER.filter((role) => work.roles.includes(role));
  if (roles.length === 0) return null;
  const detail = roles
    .map((role) => (role === 'Acting' && work.character ? `Acting as ${work.character}` : role))
    .join(' · ');
  return { label: PHRASE[roles[0]](name), role: NOUN[roles[0]], detail };
}

/**
 * A credited work as a card. With an IMDb id it opens like any catalogue title;
 * without one its address is `search://<title>`, which callers turn into a search.
 */
export function workAsItem(work: FilmographyWork): SearchResponse {
  return {
    name: work.title,
    url: work.imdbId
      ? `cs3meta://cinemeta/${work.type === 'series' ? 'series' : 'movie'}/${work.imdbId}`
      : `search://${encodeURIComponent(work.title)}`,
    apiName: 'Cinemeta',
    type: (work.type === 'series' ? 'TvSeries' : 'Movie') as TvType,
    year: work.year,
    posterUrl: work.posterUrl,
    imdbId: work.imdbId,
  };
}

/** Catalogues disagree on a film's year by one often enough; more is another work. */
function yearsAgree(a?: number, b?: number): boolean {
  return a === undefined || b === undefined || Math.abs(a - b) <= 1;
}

/**
 * Each result credited to this person or company, keyed by `url`.
 *
 * An IMDb id decides when the result has one: a row with an id the credits do
 * not list is not their work, whatever it is called. Without one, the title
 * must match exactly after folding, with no year disagreement.
 */
export function matchReasons(items: readonly SearchResponse[], filmography: Filmography): Map<string, MatchReason> {
  const byImdb = new Map<string, FilmographyWork>();
  const byTitle = new Map<string, FilmographyWork[]>();
  for (const work of filmography.works) {
    if (work.imdbId) byImdb.set(work.imdbId, work);
    const key = foldName(work.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), work]);
  }

  const reasons = new Map<string, MatchReason>();
  for (const item of items) {
    if (!item.url) continue;
    const work = item.imdbId
      ? byImdb.get(item.imdbId)
      : [item.name, item.originalTitle]
          .filter((title): title is string => Boolean(title))
          .flatMap((title) => byTitle.get(foldName(title)) ?? [])
          .find((candidate) => yearsAgree(candidate.year, item.year));
    const reason = work && reasonFor(filmography.name, work);
    if (reason) reasons.set(item.url, reason);
  }
  return reasons;
}

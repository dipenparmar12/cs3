import { fetchJson } from '../torrent/http.ts';
import { commonsThumbnail, entityPageUrl, runQuery, type SparqlBinding, type SparqlResponse } from './wikidata.ts';
import type {
  Filmography,
  FilmographyRequest,
  FilmographyRole,
  FilmographyWork,
} from '../../src/types/filmography.ts';

/**
 * Everything else a person (or studio) made, without leaving the app.
 *
 * The detail page already names the director, the writers, the composer, the
 * studio — and every one of them was a dead end: the only way to see what else
 * Lana Wachowski directed was a browser. This answers it from the same keyless
 * catalogues the page's metadata came from.
 *
 * ## Identity before anything
 *
 * A name is not an identity: there are several actors called Chris Evans. A
 * person is resolved, in order, by:
 *
 *  1. the id in their profile link (Wikidata QID, TVmaze person id) — exact;
 *  2. otherwise, *the person called this who is credited on the title being
 *     viewed* (Wikidata, by that title's IMDb id) — exact for the question
 *     asked, which is "more from the person in this film";
 *  3. otherwise nothing. A filmography of the wrong Chris Evans is worse than
 *     none, so there is no search-by-name fallback.
 *
 * Works are returned with their IMDb id where known, so each opens as an
 * ordinary catalogue item and its sources are found by the viewer's providers.
 */

const ROLE_BY_PROPERTY: Record<string, FilmographyRole> = {
  P161: 'Acting',
  P725: 'Voice',
  P57: 'Directing',
  P58: 'Writing',
  P162: 'Producing',
  P86: 'Music',
  P344: 'Cinematography',
  P1040: 'Editing',
  P170: 'Creator',
  P272: 'Production',
};

const PERSON_PROPERTIES = ['P161', 'P725', 'P57', 'P58', 'P162', 'P86', 'P344', 'P1040', 'P170'];
const MAX_WORKS = 400;

const v = (row: Record<string, SparqlBinding>, key: string): string | undefined => {
  const raw = row[key]?.value?.trim();
  return raw ? raw : undefined;
};

/** `Q123` from a Wikidata page or entity URI. */
export function wikidataIdFrom(url: string | undefined): string | undefined {
  return url?.match(/wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i)?.[1];
}

/** The TVmaze person id from `https://www.tvmaze.com/people/123/name`. */
export function tvmazePersonIdFrom(url: string | undefined): string | undefined {
  return url?.match(/tvmaze\.com\/people\/(\d+)/i)?.[1];
}

/** Posters by IMDb id, from the image service Cinemeta itself uses. */
export function posterForImdb(imdbId: string | undefined): string | undefined {
  return imdbId && /^tt\d+$/.test(imdbId)
    ? `https://images.metahub.space/poster/medium/${imdbId}/img`
    : undefined;
}

/** A type label from Wikidata as the two kinds the app opens. Episodes are not works here. */
export function workType(typeLabel: string | undefined): 'movie' | 'series' | null {
  const label = (typeLabel ?? '').toLowerCase();
  if (label.includes('episode') || label.includes('season')) return null;
  if (/series|show|serial|sitcom|soap opera|anime television|web series/.test(label)) return 'series';
  return 'movie';
}

/**
 * One row per work, roles merged, newest first.
 *
 * Wikidata answers one row per (work, property, type), so a film someone wrote
 * and directed arrives as several rows; those become one entry with both roles.
 */
export function parseWorks(response: SparqlResponse): FilmographyWork[] {
  const byWork = new Map<string, FilmographyWork>();
  for (const row of response.results?.bindings ?? []) {
    const imdbId = v(row, 'imdb');
    const title = v(row, 'workLabel');
    const work = v(row, 'work');
    if (!work || !title || /^Q\d+$/.test(title)) continue;
    const type = workType(v(row, 'typeLabel'));
    if (!type) continue;
    const property = v(row, 'prop')?.match(/(P\d+)$/)?.[1];
    const role = property ? ROLE_BY_PROPERTY[property] : undefined;
    const year = Number(v(row, 'date')?.slice(0, 4)) || undefined;
    const existing = byWork.get(work);
    if (existing) {
      if (role && !existing.roles.includes(role)) existing.roles.push(role);
      if (!existing.year && year) existing.year = year;
      // Any series classification wins: a series typed as "film" too is still a series.
      if (type === 'series') existing.type = 'series';
      continue;
    }
    byWork.set(work, {
      title,
      year,
      type,
      imdbId,
      posterUrl: posterForImdb(imdbId),
      roles: role ? [role] : [],
      character: v(row, 'characterLabel'),
    });
  }
  return [...byWork.values()]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
    .slice(0, MAX_WORKS);
}

function worksQuery(qid: string, kind: FilmographyRequest['kind']): string {
  const properties = kind === 'studio' ? ['P272'] : PERSON_PROPERTIES;
  return `SELECT ?work ?workLabel ?imdb ?date ?prop ?typeLabel WHERE {
  VALUES ?prop { ${properties.map((p) => `wdt:${p}`).join(' ')} }
  ?work ?prop wd:${qid} .
  ?work wdt:P345 ?imdb .
  FILTER(STRSTARTS(?imdb, "tt"))
  OPTIONAL { ?work wdt:P577 ?date . }
  OPTIONAL { ?work wdt:P31 ?type . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 2000`;
}

function aboutQuery(qid: string): string {
  return `SELECT ?label ?description ?image WHERE {
  OPTIONAL { wd:${qid} rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { wd:${qid} schema:description ?description . FILTER(LANG(?description) = "en") }
  OPTIONAL { wd:${qid} wdt:P18 ?image . }
} LIMIT 1`;
}

/**
 * Everyone credited on the title with this IMDb id, with their English labels.
 *
 * Asked as "who is on this title" and matched by name here, rather than as
 * "who is called X" in SPARQL: the label lookup is an index scan across all of
 * Wikidata and timed out at 20 s for "Warner Bros.", while the credits of one
 * title are a few dozen rows.
 */
function creditsOnTitleQuery(imdbId: string, kind: FilmographyRequest['kind']): string {
  const properties = kind === 'studio' ? ['P272', 'P750'] : PERSON_PROPERTIES;
  return `SELECT DISTINCT ?who ?label WHERE {
  ?title wdt:P345 ${JSON.stringify(imdbId)} .
  VALUES ?prop { ${properties.map((p) => `wdt:${p}`).join(' ')} }
  ?title ?prop ?who .
  ?who rdfs:label ?label . FILTER(LANG(?label) = "en")
} LIMIT 500`;
}

/** Names compared without case, accents or punctuation. */
export function sameName(a: string, b: string): boolean {
  const norm = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return norm(a) === norm(b);
}

async function resolveWikidataId(request: FilmographyRequest, signal?: AbortSignal): Promise<string | undefined> {
  const direct = wikidataIdFrom(request.profileUrl);
  if (direct) return direct;
  if (!request.contextImdbId || !/^tt\d+$/.test(request.contextImdbId)) return undefined;
  const response = await runQuery(creditsOnTitleQuery(request.contextImdbId, request.kind), signal);
  const matches = (response.results?.bindings ?? [])
    .filter((row) => sameName(v(row, 'label') ?? '', request.name))
    .map((row) => v(row, 'who')?.match(/(Q\d+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
  // Two different people of one name on one title is ambiguous; say nothing.
  return new Set(matches).size === 1 ? matches[0] : undefined;
}

async function fromWikidata(request: FilmographyRequest, signal?: AbortSignal): Promise<Filmography | null> {
  const qid = await resolveWikidataId(request, signal);
  if (!qid) return null;
  const [works, about] = await Promise.all([
    runQuery(worksQuery(qid, request.kind), signal),
    runQuery(aboutQuery(qid), signal).catch(() => null),
  ]);
  const row = about?.results?.bindings?.[0] ?? {};
  return {
    name: v(row, 'label') ?? request.name,
    description: v(row, 'description'),
    imageUrl: commonsThumbnail(v(row, 'image'), 330),
    profileUrl: entityPageUrl(`http://www.wikidata.org/entity/${qid}`),
    source: 'wikidata',
    works: parseWorks(works),
  };
}

interface TvmazeCredit {
  _links?: { character?: { name?: string } };
  type?: string;
  _embedded?: {
    show?: {
      name?: string;
      premiered?: string | null;
      image?: { medium?: string; original?: string } | null;
      externals?: { imdb?: string | null };
    };
  };
}

interface TvmazePerson {
  name?: string;
  image?: { medium?: string; original?: string } | null;
  url?: string;
}

const TVMAZE_CREW_ROLES: Array<[RegExp, FilmographyRole]> = [
  [/director/i, 'Directing'],
  [/writer|screenplay|story|teleplay/i, 'Writing'],
  [/producer/i, 'Producing'],
  [/creator|developer/i, 'Creator'],
  [/composer|music/i, 'Music'],
  [/photograph|camera/i, 'Cinematography'],
  [/editor/i, 'Editing'],
];

export function parseTvmazeCredits(cast: TvmazeCredit[], crew: TvmazeCredit[]): FilmographyWork[] {
  const byShow = new Map<string, FilmographyWork>();
  const add = (credit: TvmazeCredit, role: FilmographyRole) => {
    const show = credit._embedded?.show;
    if (!show?.name) return;
    const key = show.externals?.imdb ?? show.name;
    const existing = byShow.get(key);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    const imdbId = show.externals?.imdb ?? undefined;
    byShow.set(key, {
      title: show.name,
      year: Number(show.premiered?.slice(0, 4)) || undefined,
      type: 'series',
      imdbId,
      posterUrl: show.image?.medium ?? posterForImdb(imdbId),
      roles: [role],
      character: credit._links?.character?.name,
    });
  };
  for (const credit of cast) add(credit, 'Acting');
  for (const credit of crew) {
    const role = TVMAZE_CREW_ROLES.find(([pattern]) => pattern.test(credit.type ?? ''))?.[1];
    if (role) add(credit, role);
  }
  return [...byShow.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

async function fromTvmaze(request: FilmographyRequest, signal?: AbortSignal): Promise<Filmography | null> {
  const id = tvmazePersonIdFrom(request.profileUrl);
  if (!id) return null;
  const base = `https://api.tvmaze.com/people/${id}`;
  const [person, cast, crew] = await Promise.all([
    fetchJson<TvmazePerson>(base, { signal, timeoutMs: 12_000 }).catch(() => null),
    fetchJson<TvmazeCredit[]>(`${base}/castcredits?embed=show`, { signal, timeoutMs: 12_000 }).catch(() => []),
    fetchJson<TvmazeCredit[]>(`${base}/crewcredits?embed=show`, { signal, timeoutMs: 12_000 }).catch(() => []),
  ]);
  return {
    name: person?.name ?? request.name,
    imageUrl: person?.image?.medium ?? undefined,
    profileUrl: person?.url ?? request.profileUrl,
    source: 'tvmaze',
    works: parseTvmazeCredits(cast ?? [], crew ?? []),
  };
}

/** Cached per request for the session: a person's work does not change between clicks. */
const cache = new Map<string, Promise<Filmography | null>>();

export function fetchFilmography(request: FilmographyRequest, signal?: AbortSignal): Promise<Filmography | null> {
  const key = JSON.stringify([request.kind, request.name, request.profileUrl ?? '', request.contextImdbId ?? '']);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    // TVmaze first for a TVmaze profile: it is the source that credited them.
    const tv = request.kind === 'person' ? await fromTvmaze(request, signal) : null;
    if (tv && tv.works.length > 0) return tv;
    return (await fromWikidata(request, signal)) ?? tv;
  })();
  cache.set(key, pending);
  // A failure is not remembered: the next click asks again.
  pending.catch(() => cache.delete(key));
  return pending;
}

/**
 * Wikidata — cast with characters, crew, and production facts, for **film**.
 *
 * ## Why this source at all
 *
 * The brief is for the cast list a media application shows: the performer, the
 * character they play, and a photograph. For television TVmaze answers that
 * completely and for anime AniList does. **For film, nothing keyless did** —
 * which is the gap that made this module worth writing rather than skipping.
 *
 * Cinemeta, already in the app, returns `cast` as a flat `string[]`: names,
 * no characters, no images, no crew beyond a `director` string. The databases
 * that do carry it — TMDB above all — all require an API key, and `discovery.ts`
 * settled why this app cannot ship one: a key embedded in a distributed GPL
 * client is a licence violation *and* a key that gets revoked, taking the
 * feature away from every user at once.
 *
 * Wikidata is the exception. It is CC0, keyless, has a public SPARQL endpoint,
 * and models exactly the shape needed: `P161` (cast member) is a *statement*
 * that carries `P453` (character role) as a qualifier, so the performer and the
 * part are one fact rather than two lists to be zipped together and got wrong.
 *
 * ## What it is not
 *
 * Coverage is uneven in a way TMDB's is not, and this should be said plainly
 * rather than discovered: a 1994 film has a complete billed cast, a 2024
 * direct-to-streaming release may have three names or none. That is the
 * `empty` outcome, and it is *not* a failure — reporting it as one would put an
 * error on a page that is simply about an obscure title. Same distinction
 * `providerAnalytics` draws between a provider that failed and one that had
 * nothing.
 *
 * ## Two things that would each have shipped as a visible bug
 *
 * **Commons images must be requested at a width.** `P18` resolves to
 * `Special:FilePath/<file>`, which serves the *original upload* — routinely
 * 3–8 MB for a professional headshot, and this module returns up to fifty of
 * them. A cast rail built from those is tens of megabytes for images displayed
 * at 96 pixels. `Special:FilePath` takes `?width=`, so it is always asked for
 * one, and the raw URL never reaches the renderer.
 *
 * **The native name is `P1559`, not a non-English `rdfs:label`.** The obvious
 * way to get "雨宮天 beside Sora Amamiya" is to select a label in another
 * language — which returns *one row per language Wikidata holds*, multiplying
 * a 40-person cast by 90 and timing the query out. `P1559` ("name in native
 * language") is a single monolingual value and is semantically the field asked
 * for rather than a proxy for it.
 *
 * ## Verification status
 *
 * The queries and the response shape here are written from Wikidata's
 * documented SPARQL/JSON contract and **have not been run against the live
 * endpoint from this session** — the container's egress proxy denies every
 * third-party host, so nothing in `electron/metadata/` could be measured the
 * way this repository's other adapters were. The *parsers* are pure and tested
 * against hand-built fixtures in that documented shape; the *queries* are not
 * verified. Run `node tools/e2e/metadata-e2e.mjs` on an ordinary network to
 * settle it — that is what the harness is for.
 */

import { fetchJson } from '../torrent/http.ts';
import {
  CreditRole,
  MetadataSource,
  type CreditPerson,
  type Organisation,
} from '../../src/types/metadata.ts';
import { classifyJob } from './merge.ts';

const ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Wikidata asks every automated client to identify itself and to be reachable.
 * A generic browser string here would be both a lie and the kind of traffic
 * their operators block wholesale.
 */
const USER_AGENT =
  'CloudStreamDesktop/1.0 (https://github.com/recloudstream/cloudstream; metadata enrichment)';

/** Headshots are rendered at ~96px; three times that covers a HiDPI panel. */
const IMAGE_WIDTH = 320;

/** Beyond this a cast list is scrolled, not read. Also bounds the response. */
const MAX_CREDITS = 60;

/** SPARQL is a shared public service and this is a background enrichment. */
const TIMEOUT_MS = 20_000;

interface SparqlBinding {
  type?: string;
  value?: string;
  'xml:lang'?: string;
  datatype?: string;
}

interface SparqlResponse {
  results?: { bindings?: Record<string, SparqlBinding>[] };
}

const value = (row: Record<string, SparqlBinding>, key: string): string | undefined => {
  const raw = row[key]?.value?.trim();
  return raw ? raw : undefined;
};

/**
 * A Commons file reference as a URL the renderer can afford to load.
 *
 * Also normalises the scheme: Wikidata publishes `http://` URIs in its data and
 * the app's CSP and proxy both expect https, so an unrewritten one fails to
 * load with nothing on screen saying why.
 */
export function commonsThumbnail(raw: string | undefined, width = IMAGE_WIDTH): string | undefined {
  if (!raw) return undefined;
  const https = raw.replace(/^http:\/\//i, 'https://');
  if (!/Special:FilePath/i.test(https)) return https;
  return `${https}${https.includes('?') ? '&' : '?'}width=${width}`;
}

/** `http://www.wikidata.org/entity/Q38111` → a page a person can actually open. */
export function entityPageUrl(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const match = uri.match(/\/entity\/(Q\d+)$/);
  return match ? `https://www.wikidata.org/wiki/${match[1]}` : undefined;
}

/** `Q38111` out of an entity URI, for `ExternalIds.wikidata`. */
export function entityId(uri: string | undefined): string | undefined {
  return uri?.match(/\/entity\/(Q\d+)$/)?.[1];
}

/**
 * The credits query.
 *
 * One query rather than eight, via `UNION` over the crew properties with the
 * job bound as a literal, so the parser reads one row shape and the job names
 * live beside the properties they come from instead of in a lookup table
 * somewhere else.
 *
 * `P1545` (series ordinal) is the billing order where a contributor has
 * recorded one; most films have none, which is exactly why `orderCredits`
 * refuses to invent it.
 */
function creditsQuery(imdbId: string): string {
  return `
SELECT ?person ?personLabel ?native ?image ?character ?characterLabel ?characterName ?job ?order WHERE {
  ?item wdt:P345 "${imdbId}" .
  {
    ?item p:P161 ?statement .
    ?statement ps:P161 ?person .
    OPTIONAL { ?statement pq:P453 ?character . }
    OPTIONAL { ?statement pq:P4633 ?characterName . }
    OPTIONAL { ?statement pq:P1545 ?order . }
    BIND("cast" AS ?job)
  }
  UNION { ?item wdt:P170 ?person . BIND("Creator" AS ?job) }
  UNION { ?item wdt:P57  ?person . BIND("Director" AS ?job) }
  UNION { ?item wdt:P58  ?person . BIND("Screenplay" AS ?job) }
  UNION { ?item wdt:P162 ?person . BIND("Producer" AS ?job) }
  UNION { ?item wdt:P86  ?person . BIND("Composer" AS ?job) }
  UNION { ?item wdt:P344 ?person . BIND("Director of Photography" AS ?job) }
  UNION { ?item wdt:P1040 ?person . BIND("Editor" AS ?job) }
  OPTIONAL { ?person wdt:P18 ?image . }
  OPTIONAL { ?person wdt:P1559 ?native . }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?person rdfs:label ?personLabel .
    ?character rdfs:label ?characterLabel .
  }
}
LIMIT ${MAX_CREDITS * 2}`;
}

/**
 * The facts query.
 *
 * `GROUP_CONCAT` rather than plain rows, because six independent optional
 * multi-values cross-product: a film with twenty awards, four countries, three
 * companies and two languages is 480 identical-but-for-one-column rows, and a
 * `LIMIT` over that truncates *systematically* — it would always lose the same
 * awards rather than a random few. Grouping asks the server to do the dedupe it
 * is far better placed to do.
 *
 * The label service is used in its explicit form, which is the form that works
 * under `GROUP BY`; the automatic one does not bind reliably there.
 */
function factsQuery(imdbId: string): string {
  return `
SELECT ?item ?date ?boxOffice ?cost ?duration ?originalTitle ?article
  (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries)
  (GROUP_CONCAT(DISTINCT ?languageLabel; separator="|") AS ?languages)
  (GROUP_CONCAT(DISTINCT ?companyLabel; separator="|") AS ?companies)
  (GROUP_CONCAT(DISTINCT ?awardLabel; separator="|") AS ?awards)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?certLabel; separator="|") AS ?certs)
  (GROUP_CONCAT(DISTINCT ?broadcasterLabel; separator="|") AS ?broadcasters)
WHERE {
  ?item wdt:P345 "${imdbId}" .
  OPTIONAL { ?item wdt:P577 ?date . }
  OPTIONAL { ?item wdt:P2142 ?boxOffice . }
  OPTIONAL { ?item wdt:P2130 ?cost . }
  OPTIONAL { ?item wdt:P2047 ?duration . }
  OPTIONAL { ?item wdt:P1476 ?originalTitle . }
  OPTIONAL { ?item wdt:P495 ?country . }
  OPTIONAL { ?item wdt:P364 ?language . }
  OPTIONAL { ?item wdt:P272 ?company . }
  OPTIONAL { ?item wdt:P166 ?award . }
  OPTIONAL { ?item wdt:P136 ?genre . }
  OPTIONAL { ?item wdt:P1657 ?cert . }
  OPTIONAL { ?item wdt:P449 ?broadcaster . }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
    ?country rdfs:label ?countryLabel .
    ?language rdfs:label ?languageLabel .
    ?company rdfs:label ?companyLabel .
    ?award rdfs:label ?awardLabel .
    ?genre rdfs:label ?genreLabel .
    ?cert rdfs:label ?certLabel .
    ?broadcaster rdfs:label ?broadcasterLabel .
  }
}
GROUP BY ?item ?date ?boxOffice ?cost ?duration ?originalTitle ?article
LIMIT 1`;
}

export interface WikidataFacts {
  entity?: string;
  /**
   * The English Wikipedia article about this exact item, from its sitelink.
   *
   * Carried here rather than searched for later, and that is the whole reason
   * Wikipedia is reachable at all: a search for "Dune production" finds an
   * article, and whether it is about the 2021 film, the 1984 one, the novel or
   * the desert is a guess. A sitelink is Wikidata asserting the identity, so
   * the prose attached to a title is prose about that title.
   */
  wikipediaUrl?: string;
  releaseDate?: string;
  originalTitle?: string;
  runtimeMinutes?: number;
  revenue?: number;
  budget?: number;
  countries: string[];
  spokenLanguages: string[];
  studios: Organisation[];
  awards: string[];
  /**
   * `P136`, verbatim.
   *
   * These are **keywords, not genres**, and the distinction is measured rather
   * than stylistic: Dune: Part Two answers "action film, adventure film,
   * science fiction film, epic film" and Breaking Bad answers "drama television
   * series, crime television series". That is a taxonomy — it names the medium
   * in every entry — where Cinemeta and TVmaze answer "Action" and "Crime".
   * Rendering Wikidata's form as the genre row would put the word "film" on
   * every chip of every film in the app.
   */
  keywords: string[];
  /** `P1657`, the MPA rating. Film only in practice; `PG-13`, `R`. */
  certifications: string[];
  /** `P449`, the original broadcaster. The network row, for television. */
  networks: Organisation[];
}

/**
 * Rows to credits.
 *
 * Pure, and separate from the fetch for the reason every parser in this
 * repository is: it is the half that can be wrong in a way nothing reports, and
 * the half a test can reach without a network.
 *
 * The label service answers an entity's *id* as its label when Wikidata has no
 * label in the requested language, so a row can come back with `personLabel`
 * literally `"Q38111"`. Rendering that is worse than dropping the credit —
 * it reads as data corruption — so those are filtered out here.
 */
export function parseCredits(response: SparqlResponse): CreditPerson[] {
  const rows = response.results?.bindings ?? [];
  const credits: CreditPerson[] = [];
  /**
   * One credit can arrive as several rows.
   *
   * `OPTIONAL { ?person wdt:P18 ?image }` multiplies the row out once per image
   * a person has on Commons, and plenty have two or three. Those fold in the
   * merge, but the cap below is applied *here* — so without this, a 60-person
   * cast where six actors have two photographs each would return 60 rows
   * describing 54 people and silently drop the last six, who would simply be
   * missing from the page with nothing saying why.
   */
  const seen = new Set<string>();

  for (const row of rows) {
    const name = value(row, 'personLabel');
    // An unlabelled entity, or the label service echoing the id back.
    if (!name || /^Q\d+$/.test(name)) continue;

    const job = value(row, 'job');
    const isCast = job === 'cast';

    const characterLabel = value(row, 'characterLabel');
    const character =
      characterLabel && !/^Q\d+$/.test(characterLabel)
        ? characterLabel
        : value(row, 'characterName');

    // The identity of the credit, not of the row: same person, same job, same
    // part is the same credit however many photographs Commons holds.
    const key = `${value(row, 'person') ?? name}|${job ?? ''}|${character ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawOrder = value(row, 'order');
    const parsedOrder = rawOrder === undefined ? Number.NaN : Number.parseInt(rawOrder, 10);

    credits.push({
      name,
      originalName: value(row, 'native'),
      role: isCast ? CreditRole.Cast : CreditRole.Crew,
      character: isCast ? character : undefined,
      job: isCast ? undefined : job,
      department: isCast ? undefined : classifyJob(job),
      order: Number.isFinite(parsedOrder) ? parsedOrder : undefined,
      imageUrl: commonsThumbnail(value(row, 'image')),
      profileUrl: entityPageUrl(value(row, 'person')),
      sources: [MetadataSource.Wikidata],
    });
  }

  return credits.slice(0, MAX_CREDITS);
}

/** `"Feature film|Science fiction"` back into a list, dropping the blanks. */
function splitConcat(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^Q\d+$/.test(part));
}

/** A number Wikidata published as a string, or nothing. Never `NaN`. */
function numeric(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The facts row to a record.
 *
 * Dates arrive as full XSD timestamps (`2021-10-22T00:00:00Z`) and are cut to
 * the date — a time of day on a release date is noise that Wikidata stores
 * because its model requires a precision, not because anyone knows the hour.
 */
export function parseFacts(response: SparqlResponse): WikidataFacts | null {
  const row = response.results?.bindings?.[0];
  if (!row) return null;

  return {
    entity: entityId(value(row, 'item')),
    wikipediaUrl: value(row, 'article'),
    releaseDate: value(row, 'date')?.slice(0, 10),
    originalTitle: value(row, 'originalTitle'),
    runtimeMinutes: numeric(value(row, 'duration')),
    revenue: numeric(value(row, 'boxOffice')),
    budget: numeric(value(row, 'cost')),
    countries: splitConcat(value(row, 'countries')),
    spokenLanguages: splitConcat(value(row, 'languages')),
    studios: splitConcat(value(row, 'companies')).map<Organisation>((name) => ({ name })),
    awards: splitConcat(value(row, 'awards')),
    keywords: splitConcat(value(row, 'genres')),
    certifications: splitConcat(value(row, 'certs')),
    networks: splitConcat(value(row, 'broadcasters')).map<Organisation>((name) => ({ name })),
  };
}

async function runQuery(query: string, signal?: AbortSignal): Promise<SparqlResponse> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  return fetchJson<SparqlResponse>(url, {
    signal,
    timeoutMs: TIMEOUT_MS,
    // One attempt. The endpoint answers 429 under load and a retry from every
    // client that got one is how a shared public service is taken down.
    retries: 0,
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
  });
}

export interface WikidataResult {
  credits: CreditPerson[];
  facts: WikidataFacts | null;
}

/**
 * Everything Wikidata has about one IMDb id.
 *
 * The two queries are independent, so a facts query that times out must not
 * cost the cast list — which is the half the viewer actually asked for.
 *
 * **But a total failure is raised, not returned as an empty result.** The first
 * version of this settled both queries and returned `{credits: [], facts: null}`
 * whatever happened, which made an unreachable endpoint indistinguishable from
 * a film Wikidata has never heard of. `tools/e2e/metadata-e2e.mjs` caught it on
 * its first run: every row read `OK — 0 credits` while the endpoint was in fact
 * answering 403.
 *
 * That distinction is the entire point of `MetadataSourceOutcome` carrying
 * `empty` separately from `failed`, and swallowing it here would have made the
 * outcome always say `empty` — reporting a dead host to the viewer as "this
 * film has no cast recorded", with nothing anywhere naming the real cause.
 *
 * So: either query succeeding is a result, because a partial answer is a real
 * answer. Both failing raises the first reason, because then nothing was
 * learned at all.
 */
export async function fetchWikidata(
  imdbId: string,
  signal?: AbortSignal
): Promise<WikidataResult> {
  if (!/^tt\d+$/.test(imdbId)) {
    // Guarded rather than escaped: the id is interpolated into a SPARQL string
    // literal, and an id that is not an IMDb id has no business reaching the
    // endpoint whatever it would do there.
    throw new Error(`Not an IMDb id: ${imdbId}`);
  }

  const [credits, facts] = await Promise.allSettled([
    runQuery(creditsQuery(imdbId), signal),
    runQuery(factsQuery(imdbId), signal),
  ]);

  if (credits.status === 'rejected' && facts.status === 'rejected') {
    throw credits.reason instanceof Error
      ? credits.reason
      : new Error(String(credits.reason));
  }

  return {
    credits: credits.status === 'fulfilled' ? parseCredits(credits.value) : [],
    facts: facts.status === 'fulfilled' ? parseFacts(facts.value) : null,
  };
}

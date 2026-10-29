import { fetchJson } from '../torrent/http.ts';
import { commonsThumbnail, runQuery, USER_AGENT, type SparqlBinding, type SparqlResponse } from './wikidata.ts';
import type { EntitySuggestion } from '../../src/types/api.ts';

/**
 * People and companies a search query names, for the autocomplete.
 *
 * Keyless, like the rest of the metadata: Wikidata's name search
 * (`wbsearchentities`), then one SPARQL query that keeps only what film and
 * television credit. A name alone is not enough. "Christopher Nolan" is also
 * an Irish poet and two researchers, and "John Cena" a song and a wrestling
 * match, so a hit is offered only as:
 *
 * - **a person**: a human (`P31 Q5`) credited on a work that has an IMDb id,
 *   in one of the roles `metadata/filmography.ts` reads;
 * - **a company**: not a human, and the production company (`P272`) of such
 *   a work.
 *
 * Picking one opens that filmography, resolved from the same QID, so what was
 * offered is exactly what opens. Measured live (2026-10-29): name search
 * 380–750 ms, the credit check 370–810 ms (2.4 s once, for "Nolan").
 */

/** Below this a name identifies nobody, and every keystroke would be two requests. */
export const ENTITY_MIN_LENGTH = 3;
const SEARCH_LIMIT = 8;
/** One or two people, one or two companies: an aid beside the titles, never a list that buries them. */
const MAX_ENTITIES = 3;
const TIMEOUT_MS = 6_000;

const CREDIT_PROPERTIES = ['P161', 'P725', 'P57', 'P58', 'P162', 'P86', 'P344', 'P1040', 'P170'];

export interface NameHit {
  id: string;
  label?: string;
  description?: string;
}

export interface GateRow {
  id: string;
  human: boolean;
  credited: boolean;
  produced: boolean;
  image?: string;
}

/** Names compared without case, accents or punctuation. */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Who to offer, best first. Wikidata's own order is kept (it ranks by how
 * well the name matches), and an exact name pushes out near ones of the same
 * kind: "John Cena" offers John Cena, not John Cenatiempo too.
 */
export function pickEntities(query: string, hits: NameHit[], gate: GateRow[]): EntitySuggestion[] {
  const byId = new Map(gate.map((row) => [row.id, row]));
  const wanted = foldName(query);
  const offered: EntitySuggestion[] = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row || !hit.label || /^Q\d+$/.test(hit.label)) continue;
    const kind = row.human ? (row.credited ? 'person' : null) : row.produced ? 'company' : null;
    if (!kind) continue;
    offered.push({
      kind,
      id: hit.id,
      name: hit.label,
      description: hit.description,
      imageUrl: commonsThumbnail(row.image, 96),
      profileUrl: `https://www.wikidata.org/wiki/${hit.id}`,
    });
  }
  const exactKinds = new Set(offered.filter((entity) => foldName(entity.name) === wanted).map((entity) => entity.kind));
  return offered
    .filter((entity) => !exactKinds.has(entity.kind) || foldName(entity.name) === wanted)
    .slice(0, MAX_ENTITIES);
}

/** Every word typed starts a word of the name: what a shorter query's answer still says about a longer one. */
export function entityStillMatches(entity: EntitySuggestion, query: string): boolean {
  const words = foldName(entity.name).split(' ');
  return foldName(query)
    .split(' ')
    .filter(Boolean)
    .every((typed) => words.some((word) => word.startsWith(typed)));
}

function gateQuery(ids: string[]): string {
  return `SELECT ?item ?image ?human ?credited ?produced WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item wdt:P18 ?image . }
  BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human)
  BIND(EXISTS { VALUES ?p { ${CREDIT_PROPERTIES.map((p) => `wdt:${p}`).join(' ')} } ?w ?p ?item . ?w wdt:P345 ?imdb . } AS ?credited)
  BIND(EXISTS { ?w2 wdt:P272 ?item . ?w2 wdt:P345 ?imdb2 . } AS ?produced)
}`;
}

export function parseGate(response: SparqlResponse): GateRow[] {
  const flag = (row: Record<string, SparqlBinding>, key: string) => row[key]?.value === 'true';
  const rows = new Map<string, GateRow>();
  for (const row of response.results?.bindings ?? []) {
    const id = row.item?.value?.match(/(Q\d+)$/)?.[1];
    if (!id) continue;
    // A person with several photos answers one row per photo; the first will do.
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      human: flag(row, 'human'),
      credited: flag(row, 'credited'),
      produced: flag(row, 'produced'),
      image: row.image?.value,
    });
  }
  return [...rows.values()];
}

export async function searchEntities(query: string, signal?: AbortSignal): Promise<EntitySuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < ENTITY_MIN_LENGTH) return [];
  const url =
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&type=item&format=json' +
    `&language=en&uselang=en&limit=${SEARCH_LIMIT}&search=${encodeURIComponent(trimmed)}`;
  const answer = await fetchJson<{ search?: NameHit[] }>(url, {
    signal,
    timeoutMs: TIMEOUT_MS,
    retries: 0,
    headers: { 'User-Agent': USER_AGENT },
  });
  const hits = (answer.search ?? []).filter((hit) => /^Q\d+$/.test(hit.id));
  if (hits.length === 0) return [];
  const gate = parseGate(await runQuery(gateQuery(hits.map((hit) => hit.id)), signal));
  return pickEntities(trimmed, hits, gate);
}

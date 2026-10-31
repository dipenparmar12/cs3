import { fetchJson, HttpError } from '../torrent/http.ts';
import { ChallengeError } from '../torrent/botChallenge.ts';
import { commonsThumbnail, runQuery, USER_AGENT, type SparqlBinding, type SparqlResponse } from './wikidata.ts';
import type { EntityRole, EntitySuggestion, SearchCategory } from '../../src/types/api.ts';
import { wantsEntities } from '../../src/utils/searchCategories.ts';

/**
 * People and companies a search query names, for the autocomplete.
 *
 * Keyless, like the rest of the metadata: Wikidata's name search
 * (`wbsearchentities`), then one SPARQL query that keeps only what film and
 * television credit. A name alone is not enough. "Christopher Nolan" is also
 * an Irish poet and two researchers, and "John Cena" a song and a wrestling
 * match, so a hit is offered only as:
 *
 * - **a person**: a human (`P31 Q5`) credited on a work that has an IMDb id.
 *   The roles they hold come from those credits (`ROLE_PROPERTIES`), never
 *   from a stated occupation, and the category chips filter on them;
 * - **a company**: not a human, and the production company (`P272`) of such
 *   a work.
 *
 * Picking one opens that filmography, resolved from the same QID, so what was
 * offered is exactly what opens. Measured live (2026-10-29): name search
 * 280–750 ms, the credit check 0.9–2.5 s.
 *
 * ## Pacing (2026-10-30)
 *
 * People "sometimes appeared and sometimes not" because Wikidata refused
 * them: one name search and one SPARQL query per keystroke is about 15
 * requests while "Christopher Nolan" is typed, and the API answers that
 * burst with HTTP 429 and `Retry-After: 22` for every request (measured), so
 * the next search offered nobody. Now a lookup waits for the typing to pause
 * (`PAUSE_MS`), answers are cached per query and the credit check per QID,
 * and a 429 stops all asking for `COOLDOWN_MS`. A refused or failed lookup
 * throws rather than answering "nobody", so the caller keeps what it showed.
 */

/** Below this a name identifies nobody, and every keystroke would be two requests. */
export const ENTITY_MIN_LENGTH = 3;
/** How long typing must pause before a name is looked up. */
export const PAUSE_MS = 300;
/** Wikidata asked for 22 s after a burst (measured); a little more is polite. */
const COOLDOWN_MS = 30_000;
const TIMEOUT_MS = 6_000;
/** Answers change as slowly as Wikidata does; an hour is plenty fresh for a search box. */
const ANSWER_TTL_MS = 60 * 60_000;
const ANSWER_LIMIT = 300;
const GATE_TTL_MS = 6 * 60 * 60_000;

/** One or two people, one or two companies beside the titles; more when a category asks for exactly that. */
const MAX_ENTITIES = 3;
const MAX_CATEGORY_ENTITIES = 6;
/** A category narrows the hits, so it needs a wider net to have anything left. */
const SEARCH_LIMIT = 8;
const CATEGORY_SEARCH_LIMIT = 20;

/** Which credit properties hold each role. Creator (`P170`) is a series' author, so it counts as writing. */
const ROLE_PROPERTIES: Record<EntityRole, string[]> = {
  cast: ['P161', 'P725'],
  director: ['P57'],
  writer: ['P58', 'P170'],
  producer: ['P162'],
  composer: ['P86'],
};
/** Credits that make someone a film person without a chip of their own (cinematographer, editor). */
const OTHER_CREDITS = ['P344', 'P1040'];
const ROLES = Object.keys(ROLE_PROPERTIES) as EntityRole[];

export interface NameHit {
  id: string;
  label?: string;
  description?: string;
}

export interface GateRow {
  id: string;
  human: boolean;
  /** Credited in any film or television role, chip or not. */
  credited: boolean;
  roles: EntityRole[];
  produced: boolean;
  image?: string;
}

/** Names compared without case, accents or punctuation. */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Who to offer, best first. Wikidata's own order is kept (it ranks by how
 * well the name matches), and an exact name pushes out near ones of the same
 * kind: "John Cena" offers John Cena, not John Cenatiempo too.
 *
 * With categories, a person must hold one of the selected roles (any of
 * them: Director + Writer is either) and a company is offered only for
 * Studio. Nothing selected is everything.
 */
export function pickEntities(
  query: string,
  hits: NameHit[],
  gate: GateRow[],
  categories: readonly SearchCategory[] = []
): EntitySuggestion[] {
  const byId = new Map(gate.map((row) => [row.id, row]));
  const wanted = foldName(query);
  const all = categories.length === 0;
  const roles = ROLES.filter((role) => categories.includes(role));
  const offered: EntitySuggestion[] = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row || !hit.label || /^Q\d+$/.test(hit.label)) continue;
    const kind = row.human ? (row.credited ? 'person' : null) : row.produced ? 'company' : null;
    if (!kind) continue;
    if (kind === 'person' && !all && !roles.some((role) => row.roles.includes(role))) continue;
    if (kind === 'company' && !all && !categories.includes('studio')) continue;
    offered.push({
      kind,
      id: hit.id,
      name: hit.label,
      description: hit.description,
      imageUrl: commonsThumbnail(row.image, 96),
      profileUrl: `https://www.wikidata.org/wiki/${hit.id}`,
      ...(kind === 'person' ? { roles: row.roles } : {}),
    });
  }
  const exactKinds = new Set(offered.filter((entity) => foldName(entity.name) === wanted).map((entity) => entity.kind));
  return offered
    .filter((entity) => !exactKinds.has(entity.kind) || foldName(entity.name) === wanted)
    .slice(0, all ? MAX_ENTITIES : MAX_CATEGORY_ENTITIES);
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
  const credit = (properties: string[]) =>
    `EXISTS { VALUES ?p { ${properties.map((p) => `wdt:${p}`).join(' ')} } ?w ?p ?item . ?w wdt:P345 [] . }`;
  return `SELECT ?item ?image ?human ?other ?produced ${ROLES.map((role) => `?${role}`).join(' ')} WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item wdt:P18 ?image . }
  BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human)
  ${ROLES.map((role) => `BIND(${credit(ROLE_PROPERTIES[role])} AS ?${role})`).join('\n  ')}
  BIND(${credit(OTHER_CREDITS)} AS ?other)
  BIND(EXISTS { ?w2 wdt:P272 ?item . ?w2 wdt:P345 [] . } AS ?produced)
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
    const roles = ROLES.filter((role) => flag(row, role));
    rows.set(id, {
      id,
      human: flag(row, 'human'),
      credited: roles.length > 0 || flag(row, 'other'),
      roles,
      produced: flag(row, 'produced'),
      image: row.image?.value,
    });
  }
  return [...rows.values()];
}

/** A lookup Wikidata refused or could not answer: not "nobody", so the caller keeps what it had. */
export class EntityLookupUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityLookupUnavailable';
  }
}

const answers = new Map<string, { at: number; rows: EntitySuggestion[] }>();
const gates = new Map<string, { at: number; row: GateRow }>();
const running = new Map<string, Promise<EntitySuggestion[]>>();
let blockedUntil = 0;

function answerKey(query: string, categories: readonly SearchCategory[]): string {
  return `${foldName(query)}|${[...categories].sort().join(',')}`;
}

/** This query's answer if it is already known: no request, no pause. */
export function cachedEntities(query: string, categories: readonly SearchCategory[] = []): EntitySuggestion[] | undefined {
  const hit = answers.get(answerKey(query, categories));
  return hit && Date.now() - hit.at < ANSWER_TTL_MS ? hit.rows : undefined;
}

/** For tests: forget every answer and any cooldown. */
export function resetEntityCache(): void {
  answers.clear();
  gates.clear();
  running.clear();
  blockedUntil = 0;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** A 429 from either Wikidata service stops all asking for a while; anything else is just this lookup failing. */
async function polite<T>(request: () => Promise<T>): Promise<T> {
  if (Date.now() < blockedUntil) throw new EntityLookupUnavailable('Wikidata asked to wait');
  try {
    return await request();
  } catch (error) {
    // `http.ts` reports a 429 as a rate-limit `ChallengeError`, a bare one as `HttpError`; both carry the status.
    if ((error instanceof HttpError || error instanceof ChallengeError) && error.status === 429) {
      blockedUntil = Date.now() + COOLDOWN_MS;
      throw new EntityLookupUnavailable('Wikidata asked to wait');
    }
    throw error;
  }
}

async function lookUp(query: string, categories: readonly SearchCategory[]): Promise<EntitySuggestion[]> {
  const limit = categories.length ? CATEGORY_SEARCH_LIMIT : SEARCH_LIMIT;
  const url =
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&type=item&format=json' +
    `&language=en&uselang=en&limit=${limit}&search=${encodeURIComponent(query)}`;
  const answer = await polite(() =>
    fetchJson<{ search?: NameHit[] }>(url, { timeoutMs: TIMEOUT_MS, retries: 0, headers: { 'User-Agent': USER_AGENT } })
  );
  const hits = (answer.search ?? []).filter((hit) => /^Q\d+$/.test(hit.id));
  // Only the QIDs not checked lately: consecutive keystrokes mostly find the same people.
  const now = Date.now();
  const unknown = hits.map((hit) => hit.id).filter((id) => !(now - (gates.get(id)?.at ?? 0) < GATE_TTL_MS));
  if (unknown.length) {
    const fresh = parseGate(await polite(() => runQuery(gateQuery(unknown))));
    const answered = new Set(fresh.map((row) => row.id));
    for (const row of fresh) gates.set(row.id, { at: now, row });
    // An item the query did not return at all has no statements worth offering.
    for (const id of unknown) if (!answered.has(id)) gates.set(id, { at: now, row: { id, human: false, credited: false, roles: [], produced: false } });
  }
  const gate = hits.map((hit) => gates.get(hit.id)?.row).filter((row): row is GateRow => Boolean(row));
  return pickEntities(query, hits, gate, categories);
}

/**
 * The people and companies `query` names, within `categories` (empty is All).
 *
 * Waits `PAUSE_MS` first unless the answer is cached, so typing sends
 * nothing until it stops; the caller's signal cancels the wait. The request
 * itself is shared by everyone asking the same thing and is not cancelled
 * with any one of them, since its answer is cached for the next.
 */
export async function searchEntities(
  query: string,
  options: { signal?: AbortSignal; categories?: readonly SearchCategory[] } = {}
): Promise<EntitySuggestion[]> {
  const trimmed = query.trim();
  const categories = options.categories ?? [];
  if (trimmed.length < ENTITY_MIN_LENGTH || !wantsEntities(categories)) return [];
  const cached = cachedEntities(trimmed, categories);
  if (cached) return cached;
  await pause(PAUSE_MS, options.signal);

  const key = answerKey(trimmed, categories);
  let pending = running.get(key);
  if (!pending) {
    pending = lookUp(trimmed, categories)
      .then((rows) => {
        answers.set(key, { at: Date.now(), rows });
        while (answers.size > ANSWER_LIMIT) answers.delete(answers.keys().next().value as string);
        return rows;
      })
      .finally(() => running.delete(key));
    running.set(key, pending);
  }
  const signal = options.signal;
  if (!signal) return pending;
  return Promise.race([
    pending,
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

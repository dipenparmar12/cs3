import path from 'path';
import { JsonFileStore } from '../util/jsonFileStore.ts';
import { canonicalKey } from './libraryStore.ts';
import type { Episode, SearchResponse, TvType } from '../../src/types/api';
import { prune } from '../util/prune.ts';

/**
 * The last detail page that actually worked, kept so it can be shown again.
 *
 * ## The failure this exists for
 *
 * A saved page and a library entry both address a title by URL, and both
 * re-fetch that URL when opened. The library row itself carries a title, a
 * poster and a year — copied at the moment it was added — so the list always
 * looks right. The page behind it carries nothing: it is drawn entirely from
 * whatever the provider answers *now*, and when the provider is switched off,
 * uninstalled, rate-limited, or has simply changed its page shape since
 * Tuesday, the answer is nothing. The user sees a full library row and then an
 * empty page, or one with fields missing, for content the app demonstrably knew
 * about — which reads, correctly, as the app having lost their data.
 *
 * It is not lost. It was never written down. This writes it down.
 *
 * ## What a snapshot is, and what it is not
 *
 * **It is the display copy of a page, plus how the user reached it.** Title,
 * poster, plot, cast, the episode list, the provider that served it, the
 * repository and extension behind that provider, and the search that surfaced
 * it. All of these are stable facts about a work — a provider's own handle for
 * a title does not change — and together they are enough to draw the page
 * without asking anyone.
 *
 * **It is not a source cache.** No playable link is stored here. Links expire
 * within the hour and a page that opens but cannot play is a worse failure than
 * one that has to re-resolve; `SourceCache` and `PlayedSource` own that problem
 * and own it with deadlines. A snapshot answers "what is this title", never
 * "where can I stream it".
 *
 * **It is not authoritative.** A live load always wins where it has an answer.
 * The snapshot only fills the gaps — see {@link mergeSnapshot} for the one rule
 * that matters: a fresh load may add a field and may correct a field, but it
 * may never blank one. A provider that returns a title and no poster must not
 * erase the poster we already had, because "the scrape missed a field" and "the
 * work has no poster" look identical from here and only one of them is common.
 *
 * ## Where it lives
 *
 * Its own file rather than the datastore. Episode lists run to hundreds of rows
 * for a long-running series, and the datastore is the small key/value store that
 * Android backups round-trip through — putting this there would grow every
 * user's backup by megabytes of data that is, by construction, re-derivable.
 * `BackupService` still carries it as its own section, because a restore that
 * brings back the library and not the pages behind it reproduces the exact
 * failure above on a new machine.
 */

/** Where a page came from, at every level that has a name. */
export interface PageSnapshotOrigin {
  /** The provider that served the page. */
  provider?: string;
  /** The archive that registered that provider. */
  extensionInternalName?: string;
  extensionName?: string;
  /** The repository that published that archive. */
  repositoryId?: string;
  repositoryName?: string;
  /** Cinemeta, TVmaze, AniList — set when the page came from a catalogue. */
  metadataSource?: string;
  /** The query that surfaced it, so the same search can be re-run. */
  searchQuery?: string;
}

export interface PageSnapshot {
  /** The address the page was loaded from; the primary identity. */
  url: string;
  /**
   * `canonicalKey(title, year)` — the identity that survives the address.
   *
   * A provider URL can rot, be rewritten, or turn out to have been a links
   * handle written into a library row by an older build. The title cannot, and
   * this is the key the library itself uses, so a snapshot captured under one
   * address is still findable for an entry that remembers a different one.
   */
  key: string;

  title: string;
  originalTitle?: string;
  year?: number;
  type?: TvType | string;
  /** The provider or catalogue name, as the row displayed it. */
  apiName?: string;
  posterUrl?: string;
  backdropUrl?: string;
  plot?: string;
  tags?: string[];
  rating?: number;
  duration?: string;
  imdbId?: string;
  isLive?: boolean;
  actors?: string[];
  episodes?: Episode[];
  recommendations?: SearchResponse[];

  /**
   * Every address known to reach this work, best first.
   *
   * A merged search row carries the other providers that returned the same
   * title, and `DetailView` already tries them in order when the first fails —
   * but only for as long as that row is on screen. Persisting them is what
   * makes the fallback survive a restart, which is precisely when it is needed:
   * the row is long gone and the saved page has one address, which is the one
   * that stopped working.
   */
  routes: string[];

  origin: PageSnapshotOrigin;

  /** First captured. */
  capturedAt: number;
  /** Last confirmed by a live load — the age the UI reports. */
  verifiedAt: number;
  /** Last read, for eviction ordering. */
  lastUsedAt: number;
  /**
   * Kept regardless of eviction pressure.
   *
   * Set when the user saves the page or adds the title to their library. The
   * cap exists to bound a cache; an explicitly saved page is not cache, and
   * evicting one would recreate this whole bug for the users most affected by
   * it — the ones with the largest libraries.
   */
  pinned?: boolean;
}

/** What a caller supplies to record a page. */
export interface PageSnapshotInput {
  url: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: TvType | string;
  apiName?: string;
  posterUrl?: string;
  backdropUrl?: string;
  plot?: string;
  tags?: string[];
  rating?: number;
  duration?: string;
  imdbId?: string;
  isLive?: boolean;
  actors?: string[];
  episodes?: Episode[];
  recommendations?: SearchResponse[];
  routes?: string[];
  origin?: PageSnapshotOrigin;
  /** False for a merge that did not come from a live load; see `verifiedAt`. */
  verified?: boolean;
}

/**
 * Cap on retained snapshots, excluding pinned ones.
 *
 * Generous because a snapshot is small next to what it saves — the alternative
 * to holding one is a scrape, or a dead page. Episode lists are the only part
 * with real weight and they are bounded separately.
 */
const MAX_SNAPSHOTS = 600;

/**
 * Cap on stored episodes per page.
 *
 * Long-running series run past a thousand episodes and nobody is scrolling a
 * saved copy of all of them; what the snapshot has to do is let the page draw
 * with a real season structure rather than an empty shell. Truncation is
 * visible in the UI as "showing a saved copy", which is honest — silently
 * presenting a partial episode list as complete would be the wrong trade.
 */
const MAX_EPISODES = 600;

/** Cap on remembered addresses per page. */
const MAX_ROUTES = 8;

/** Debounce for the file write; snapshots arrive in bursts as a page loads. */
const WRITE_DEBOUNCE_MS = 2_000;

export class PageSnapshotStore {
  private readonly snapshots = new Map<string, PageSnapshot>();
  /** Secondary index: canonical key → the addresses captured under it. */
  private readonly byKey = new Map<string, Set<string>>();
  private readonly file: JsonFileStore<PageSnapshot[]>;

  constructor(directory: string) {
    this.file = new JsonFileStore<PageSnapshot[]>(
      path.join(directory, 'page-snapshots.json'),
      WRITE_DEBOUNCE_MS,
      () => [...this.snapshots.values()]
    );
    for (const entry of this.file.load() ?? []) {
      if (!entry || typeof entry.url !== 'string' || !entry.url || !entry.title) continue;
      this.snapshots.set(entry.url, entry);
      this.index(entry);
    }
  }

  private index(entry: PageSnapshot): void {
    if (!entry.key) return;
    const set = this.byKey.get(entry.key) ?? new Set<string>();
    set.add(entry.url);
    this.byKey.set(entry.key, set);
  }

  /**
   * Records a page, merging over whatever is already known about it.
   *
   * Called from the one place every successful detail load passes through, so a
   * page is captured by being *looked at* — a user does not have to save
   * anything for the app to stop losing it. Saving only decides whether it
   * survives eviction.
   */
  public capture(input: PageSnapshotInput): PageSnapshot | null {
    const url = input.url?.trim();
    if (!url || !input.title?.trim()) return null;

    const now = Date.now();
    const existing = this.snapshots.get(url);
    const merged = mergeSnapshot(existing, input, now);

    this.snapshots.set(url, merged);
    this.index(merged);
    this.evict();
    this.file.schedule();
    return merged;
  }

  /**
   * The best snapshot for an address, or for the title behind it.
   *
   * The address is tried first because it is exact. The canonical key is the
   * fallback that makes a library entry work at all: entries collapse every
   * provider URL seen for a title into one row and open the first, which is not
   * necessarily the one whose page was captured — and for rows written before
   * the links-handle fix, is not a page address at all.
   */
  public find(query: { url?: string; title?: string; year?: number }): PageSnapshot | null {
    const direct = query.url ? this.snapshots.get(query.url.trim()) : undefined;
    if (direct) return this.touch(direct);

    // An address this page is known to reach, rather than the one it was
    // captured under: a merged row's alternates are exactly this case.
    if (query.url) {
      for (const entry of this.snapshots.values()) {
        if (entry.routes.includes(query.url)) return this.touch(entry);
      }
    }

    if (!query.title?.trim()) return null;
    const key = canonicalKey(query.title, query.year);
    const urls = this.byKey.get(key);
    if (!urls || urls.size === 0) return null;

    /*
     * Newest verification wins among several addresses for one work. Not
     * "pinned first": a pin says the user cares about the page, not that its
     * copy is the freshest, and showing them older data because they saved it
     * would be a strange reward for having done so.
     */
    let best: PageSnapshot | null = null;
    for (const url of urls) {
      const entry = this.snapshots.get(url);
      if (!entry) continue;
      // `>=`, not `>`: two captures can land in the same millisecond (a page
      // and its alternate resolving together), and insertion order is then the
      // only thing that says which reading is later.
      if (!best || entry.verifiedAt >= best.verifiedAt) best = entry;
    }
    return best ? this.touch(best) : null;
  }

  private touch(entry: PageSnapshot): PageSnapshot {
    entry.lastUsedAt = Date.now();
    this.file.schedule();
    return entry;
  }

  /**
   * Marks a page as explicitly kept, or releases it.
   *
   * Addressed by title as well as URL because the two stores that pin do not
   * agree on identity — bookmarks key on the address, the library on the
   * canonical title — and a pin that missed would be discovered only as an
   * eviction months later.
   */
  public setPinned(
    query: { url?: string; title?: string; year?: number },
    pinned: boolean
  ): boolean {
    const entry = this.find(query);
    if (!entry) return false;
    entry.pinned = pinned;
    this.file.schedule();
    return true;
  }

  public forget(url: string): boolean {
    const entry = this.snapshots.get(url);
    if (!entry) return false;
    this.snapshots.delete(url);
    this.byKey.get(entry.key)?.delete(url);
    this.file.schedule();
    return true;
  }

  public clearAll(): number {
    const count = this.snapshots.size;
    this.snapshots.clear();
    this.byKey.clear();
    this.file.schedule();
    return count;
  }

  public list(): PageSnapshot[] {
    return [...this.snapshots.values()];
  }

  public size(): number {
    return this.snapshots.size;
  }

  /** Replaces the whole set; used by a backup restore. */
  public replaceAll(entries: PageSnapshot[]): number {
    this.snapshots.clear();
    this.byKey.clear();
    let restored = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.url !== 'string' || !entry.url || !entry.title) continue;
      this.snapshots.set(entry.url, entry);
      this.index(entry);
      restored += 1;
    }
    this.file.schedule();
    return restored;
  }

  public flush(): void {
    this.file.flush();
  }

  /** Unpinned entries only, least recently used first. */
  private evict(): void {
    const unpinned = [...this.snapshots.values()].filter((entry) => !entry.pinned);
    if (unpinned.length <= MAX_SNAPSHOTS) return;
    unpinned.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const entry of unpinned.slice(0, unpinned.length - MAX_SNAPSHOTS)) {
      this.snapshots.delete(entry.url);
      this.byKey.get(entry.key)?.delete(entry.url);
    }
  }
}

/**
 * Folds a fresh reading into a stored one.
 *
 * **The rule: a later load may add and may correct, but may never blank.**
 *
 * This is the whole point of the store and it is worth being precise about.
 * When a provider answers with a title and no plot, two things could be true —
 * the work has no plot, or this scrape did not find one. From here they are
 * indistinguishable, and they are not equally likely: the second is routine
 * (a page shape changed, a field moved, a request was rate-limited) and the
 * first is nearly unheard of for anything that reached a library. Preferring
 * the stored value costs a stale plot in the rare case and prevents a blank
 * page in the common one.
 *
 * A non-empty incoming value always wins, so a genuinely corrected field does
 * update — this is "do not erase", not "first write wins".
 *
 * Exported for the tests, which are where the rule is actually pinned down.
 */
export function mergeSnapshot(
  existing: PageSnapshot | undefined,
  input: PageSnapshotInput,
  now: number
): PageSnapshot {
  const title = firstNonEmpty(input.title, existing?.title) ?? input.title;
  const year = input.year ?? existing?.year;

  return {
    url: input.url,
    // Recomputed rather than carried: a snapshot captured from a provider that
    // titled the work badly should re-key once a better title arrives, or the
    // library will never find it.
    key: canonicalKey(title, year),
    title,
    originalTitle: firstNonEmpty(input.originalTitle, existing?.originalTitle),
    year,
    type: input.type ?? existing?.type,
    apiName: firstNonEmpty(input.apiName, existing?.apiName),
    posterUrl: firstNonEmpty(input.posterUrl, existing?.posterUrl),
    backdropUrl: firstNonEmpty(input.backdropUrl, existing?.backdropUrl),
    plot: firstNonEmpty(input.plot, existing?.plot),
    tags: firstNonEmptyList(input.tags, existing?.tags),
    rating: input.rating ?? existing?.rating,
    duration: firstNonEmpty(input.duration, existing?.duration),
    imdbId: firstNonEmpty(input.imdbId, existing?.imdbId),
    isLive: input.isLive ?? existing?.isLive,
    actors: firstNonEmptyList(input.actors, existing?.actors),
    /*
     * An episode list is all-or-nothing rather than field-merged. Splicing two
     * partial listings together would invent a season that no provider actually
     * offers, and a viewer clicking an episode that is not there gets a failure
     * with no explanation anywhere.
     */
    episodes: capList(firstNonEmptyList(input.episodes, existing?.episodes), MAX_EPISODES),
    recommendations: capList(
      firstNonEmptyList(input.recommendations, existing?.recommendations),
      24
    ),
    routes: mergeRoutes(input.url, input.routes, existing?.routes),
    origin: { ...(existing?.origin ?? {}), ...prune(input.origin ?? {}) },
    capturedAt: existing?.capturedAt ?? now,
    // A merge that is not a live load leaves the age alone: it adds context,
    // not evidence that the page still works.
    verifiedAt: input.verified === false ? (existing?.verifiedAt ?? now) : now,
    lastUsedAt: now,
    pinned: existing?.pinned,
  };
}

/**
 * The page's own address first, then everything known, deduplicated.
 *
 * Order is the fallback order, so the address that just answered leads. Capped
 * because a title that has been found by fifteen providers over a year does not
 * need fifteen retries before reporting a failure.
 */
function mergeRoutes(
  url: string,
  incoming: string[] | undefined,
  existing: string[] | undefined
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const route of [url, ...(incoming ?? []), ...(existing ?? [])]) {
    const trimmed = route?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_ROUTES) break;
  }
  return out;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function firstNonEmptyList<T>(...values: Array<T[] | undefined>): T[] | undefined {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return undefined;
}

function capList<T>(value: T[] | undefined, max: number): T[] | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}


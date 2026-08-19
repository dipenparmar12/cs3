import type { TorrentResult } from '../src/types/torrent';
import type { DatastoreManager } from './datastore';

/**
 * Remembers which sources a title resolved to, so opening it again is instant.
 *
 * The governing rule is that **a resolved URL is a cached result, not the
 * source of truth**. The durable thing is the query that produced it — the
 * media URL plus season and episode — which is what a refresh replays. A cache
 * that stored only URLs would hand the player dead links and have no way to
 * recover.
 *
 * Expiry is per-source, not per-entry, because the two kinds of source age
 * completely differently:
 *
 * - A **magnet** never expires. Its infohash addresses content, not a server,
 *   and re-running discovery to "refresh" it is pure waste — the same magnet
 *   comes back. These are kept until the entry itself is evicted.
 * - A **provider link** is a temporary URL from someone else's CDN, frequently
 *   signed and typically valid for minutes to hours. These carry a deadline
 *   taken from the URL when it states one, and a conservative default when it
 *   does not.
 *
 * So a cache hit can be partially stale: the torrents in it are still good
 * while the provider links beside them have died. `read` reports exactly that,
 * and the caller refreshes only what actually needs refreshing.
 */

const KEY = 'source_cache_v1';

/**
 * How long a whole entry stays worth consulting. Beyond this, indexers have
 * likely picked up better releases and the entry is re-discovered from scratch.
 */
const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Assumed lifetime for a provider link whose URL states no deadline.
 * Deliberately short: serving a dead link costs a failed playback and a
 * confused viewer, while re-resolving costs one provider call.
 */
const DEFAULT_LINK_TTL_MS = 20 * 60 * 1000;

/**
 * How many ambiguous failures a source survives before it is dropped.
 *
 * Three, and the number matters in both directions. A source removed on its
 * first failure would be removed by any passing network blip — and the cache
 * exists precisely to survive those. A source never removed accumulates
 * permanently dead links that get tried first on every play, which is the
 * failure mode a cache is supposed to prevent.
 */
const MAX_VALIDATION_FAILURES = 3;

/**
 * Whether a failure means the source is *gone*, or merely that this attempt
 * did not work.
 *
 * The distinction is the whole invalidation policy: a definitive answer removes
 * the source immediately, while anything else only counts against it. Getting
 * this wrong in the eager direction empties the cache every time the wifi drops;
 * getting it wrong in the lazy direction keeps serving 404s forever.
 *
 * `410 Gone` and `404 Not Found` are the server saying so outright. `403` is
 * deliberately **not** here: expired signed URLs and hotlink protection both
 * answer 403, and both are recoverable by re-resolving the same query — the
 * expiry machinery already handles them. Timeouts, resets, DNS failures and 5xx
 * are the server or the network having a bad moment, and none of them are
 * evidence about whether the file exists.
 */
export function isDefinitiveFailure(status: number | undefined, reason?: string): boolean {
  if (status === 404 || status === 410) return true;
  return /\b(410 gone|404 not found|no longer (exists|available)|file (was )?(deleted|removed))\b/i.test(
    reason ?? ''
  );
}

/** Entries are small, but an unbounded cache in a JSON datastore is not free. */
const MAX_ENTRIES = 300;

interface CacheEntry {
  key: string;
  /** The query that produced these sources — replayed to refresh them. */
  query: { mediaUrl: string; season?: number; episode?: number };
  sources: TorrentResult[];
  /** Epoch millis per source infohash, for links that carry a deadline. */
  expiresAt: Record<string, number>;
  /**
   * When each source was last confirmed to work, and how many times running it
   * has failed for a reason that was not conclusive.
   *
   * Kept per source rather than per entry because they age independently — the
   * whole reason `read` splits fresh from expired. A source that plays resets
   * its own counter; one that keeps failing is dropped without taking its
   * neighbours with it.
   */
  validatedAt?: Record<string, number>;
  failures?: Record<string, number>;
  createdAt: number;
  lastUsedAt: number;
}

export interface CacheReadResult {
  /** Sources still believed good. May be empty even when an entry exists. */
  fresh: TorrentResult[];
  /** Sources whose links have expired and need re-resolving. */
  expired: TorrentResult[];
  /** True when an entry existed at all. */
  hit: boolean;
}

/** A source that plays from a magnet or infohash never needs refreshing. */
function isPermanent(source: TorrentResult): boolean {
  return !source.directUrl && Boolean(source.magnet || source.infoHash);
}

/**
 * Reads a deadline out of a signed URL.
 *
 * CDNs advertise expiry in the query string far more often than in a header,
 * and the handful of parameter names below cover the great majority of what
 * providers actually hand back. A JWT-style token is also checked, because
 * several providers sign links that way and the `exp` claim is authoritative.
 * Anything unrecognised falls back to a TTL rather than being assumed eternal.
 */
export function deadlineFromUrl(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Case-insensitively: CloudFront signs with `Expires` (capital E) and
  // `URLSearchParams.get` is case-sensitive, so a literal lookup misses the
  // single most common signed-URL scheme on the web.
  const params = new Map<string, string>();
  for (const [name, value] of parsed.searchParams) {
    if (!params.has(name.toLowerCase())) params.set(name.toLowerCase(), value);
  }

  for (const name of ['expires', 'expire', 'expiry', 'exp', 'e', 'valid_until', 'oe']) {
    const raw = params.get(name);
    if (!raw) continue;

    // Seconds and milliseconds are both used; hex appears in some CDN schemes.
    const asNumber = /^[0-9a-f]{8,}$/i.test(raw) && !/^\d+$/.test(raw)
      ? parseInt(raw, 16)
      : Number(raw);
    if (!Number.isFinite(asNumber) || asNumber <= 0) continue;

    const millis = asNumber > 1e12 ? asNumber : asNumber * 1000;
    // Guard against a parameter that merely looks like a timestamp.
    if (millis > Date.now() - 86_400_000 && millis < Date.now() + 365 * 86_400_000) {
      return millis;
    }
  }

  // JWT in the path or a token parameter: decode the payload's `exp` claim.
  const jwt = url.match(/eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\./);
  if (jwt) {
    try {
      const payload = JSON.parse(
        Buffer.from(jwt[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      ) as { exp?: number };
      if (typeof payload.exp === 'number' && payload.exp > 0) return payload.exp * 1000;
    } catch {
      // Not a JWT after all; the TTL fallback covers it.
    }
  }

  return null;
}

export class SourceCache {
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  private static keyFor(mediaUrl: string, season?: number, episode?: number): string {
    return `${mediaUrl}|${season ?? ''}|${episode ?? ''}`;
  }

  private load(): CacheEntry[] {
    const stored = this.datastore.getObject<CacheEntry[]>(KEY, []);
    return Array.isArray(stored) ? stored : [];
  }

  private save(entries: CacheEntry[]): void {
    const pruned = entries
      .filter((entry) => Date.now() - entry.createdAt < ENTRY_TTL_MS)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_ENTRIES);
    this.datastore.setObject(KEY, pruned);
  }

  /**
   * Returns what is cached for a query, split into usable and expired.
   *
   * Splitting rather than invalidating wholesale is the point: a title cached a
   * day ago typically still has perfectly good magnets sitting next to dead
   * provider links, and throwing both away would make the cache useless exactly
   * when it is most valuable.
   */
  public read(mediaUrl: string, season?: number, episode?: number): CacheReadResult {
    const key = SourceCache.keyFor(mediaUrl, season, episode);
    const entries = this.load();
    const entry = entries.find((e) => e.key === key);
    if (!entry) return { fresh: [], expired: [], hit: false };

    const now = Date.now();
    const fresh: TorrentResult[] = [];
    const expired: TorrentResult[] = [];

    for (const source of entry.sources) {
      if (isPermanent(source)) {
        fresh.push(source);
        continue;
      }
      const deadline = entry.expiresAt[source.infoHash];
      if (deadline && deadline > now) fresh.push(source);
      else expired.push(source);
    }

    entry.lastUsedAt = now;
    this.save(entries);

    return { fresh, expired, hit: true };
  }

  /**
   * The same split as {@link read}, without recording a use.
   *
   * `read` stamps `lastUsedAt` and writes the whole cache back, which is right
   * when something is about to be played from it and wrong for a question asked
   * speculatively. The prefetcher asks "would this be answered from cache?"
   * before deciding whether to scrape at all, and that question must not itself
   * cost a datastore write — nor should it promote an entry the user never
   * actually opened.
   */
  public peek(mediaUrl: string, season?: number, episode?: number): CacheReadResult {
    const key = SourceCache.keyFor(mediaUrl, season, episode);
    const entry = this.load().find((e) => e.key === key);
    if (!entry) return { fresh: [], expired: [], hit: false };

    const now = Date.now();
    const fresh: TorrentResult[] = [];
    const expired: TorrentResult[] = [];
    for (const source of entry.sources) {
      if (isPermanent(source)) {
        fresh.push(source);
        continue;
      }
      const deadline = entry.expiresAt[source.infoHash];
      if (deadline && deadline > now) fresh.push(source);
      else expired.push(source);
    }
    return { fresh, expired, hit: true };
  }

  /** Records the sources a discovery run produced. */
  public write(
    mediaUrl: string,
    sources: TorrentResult[],
    season?: number,
    episode?: number
  ): void {
    if (sources.length === 0) return;

    const key = SourceCache.keyFor(mediaUrl, season, episode);
    const now = Date.now();
    const expiresAt: Record<string, number> = {};

    for (const source of sources) {
      if (isPermanent(source)) continue;
      const stated = source.directUrl ? deadlineFromUrl(source.directUrl) : null;
      expiresAt[source.infoHash] = stated ?? now + DEFAULT_LINK_TTL_MS;
    }

    const entries = this.load().filter((e) => e.key !== key);
    entries.push({
      key,
      query: { mediaUrl, season, episode },
      sources,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
    });
    this.save(entries);
  }

  /**
   * Records that a source was just proved to work.
   *
   * Clears its failure count as well as stamping the time: a source that plays
   * has demonstrably recovered, and carrying two old failures forward would
   * have it dropped by the next unrelated blip.
   */
  public recordSuccess(
    mediaUrl: string,
    infoHash: string,
    season?: number,
    episode?: number
  ): void {
    const key = SourceCache.keyFor(mediaUrl, season, episode);
    const entries = this.load();
    const entry = entries.find((e) => e.key === key);
    if (!entry) return;

    entry.validatedAt = { ...(entry.validatedAt ?? {}), [infoHash]: Date.now() };
    if (entry.failures?.[infoHash]) {
      const failures = { ...entry.failures };
      delete failures[infoHash];
      entry.failures = failures;
    }
    this.save(entries);
  }

  /**
   * Records that a source failed, and drops it when that verdict is final.
   *
   * The two paths are the policy §2 asks for. A definitive answer — the server
   * saying the file is not there — removes the source now, because no amount of
   * retrying changes a 404. Anything else is counted: a timeout, a reset, a 5xx
   * or a 403 is the network or the host having a moment, and a cache that
   * forgets everything on the first bad minute is worse than no cache. Only
   * after {@link MAX_VALIDATION_FAILURES} such failures is the source dropped.
   *
   * Returns whether the source was removed, so the caller can say so.
   */
  public recordFailure(
    mediaUrl: string,
    infoHash: string,
    failure: { status?: number; reason?: string },
    season?: number,
    episode?: number
  ): boolean {
    const key = SourceCache.keyFor(mediaUrl, season, episode);
    const entries = this.load();
    const entry = entries.find((e) => e.key === key);
    if (!entry) return false;

    const definitive = isDefinitiveFailure(failure.status, failure.reason);
    const failures = { ...(entry.failures ?? {}) };
    failures[infoHash] = (failures[infoHash] ?? 0) + 1;

    if (definitive || failures[infoHash] >= MAX_VALIDATION_FAILURES) {
      entry.sources = entry.sources.filter((source) => source.infoHash !== infoHash);
      delete failures[infoHash];
      const expiresAt = { ...entry.expiresAt };
      delete expiresAt[infoHash];
      entry.expiresAt = expiresAt;
      entry.failures = failures;

      /**
       * An entry with nothing left in it is removed rather than kept as an
       * empty shell — otherwise `hit: true` reports a cache hit that can never
       * answer anything, and the caller skips the discovery it needs.
       */
      this.save(
        entry.sources.length === 0 ? entries.filter((e) => e.key !== key) : entries
      );
      return true;
    }

    entry.failures = failures;
    this.save(entries);
    return false;
  }

  /** Drops one entry, for when its sources turn out to be permanently dead. */
  public invalidate(mediaUrl: string, season?: number, episode?: number): void {
    const key = SourceCache.keyFor(mediaUrl, season, episode);
    this.save(this.load().filter((e) => e.key !== key));
  }

  public clear(): void {
    this.datastore.setObject(KEY, []);
  }

  public stats(): { entries: number; sources: number } {
    const entries = this.load();
    return {
      entries: entries.length,
      sources: entries.reduce((total, entry) => total + entry.sources.length, 0),
    };
  }
}

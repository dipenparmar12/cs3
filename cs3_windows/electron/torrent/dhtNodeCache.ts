import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * A DHT node that survives a restart.
 *
 * The second half of the "why is a hosted service instant" answer (the first is
 * in `torrentMetadata.ts`). A seedbox's DHT node has been running for weeks: its
 * routing table holds several hundred live contacts spread across the keyspace,
 * other nodes hold *it* in theirs, and a lookup for a fresh infohash converges
 * in two or three parallel rounds. A desktop client that starts cold has none of
 * that, and pays for it three times over:
 *
 *  1. **Bootstrap.** `k-rpc` ships three hardcoded bootstrap hosts, one of which
 *     (`dht.transmissionbt.com`) has been intermittently unresolvable for
 *     years. A cold start is a DNS lookup plus a UDP round trip to each, and if
 *     the reachable ones are slow, *everything* behind the DHT waits.
 *  2. **Convergence.** From three contacts, finding the ~8 nodes closest to a
 *     given infohash takes several sequential `find_node` rounds. From a warm
 *     table it takes roughly one.
 *  3. **Reachability.** A node id and a UDP port that both change every launch
 *     mean no other node's routing table ever holds a usable entry for us, so
 *     we are never queried, never learn peers passively, and never appear in
 *     anyone's `get_peers` response.
 *
 * All three are fixed by writing three things to disk and reading them back:
 * the node id, the port, and the contacts.
 *
 * **What is stored is deliberately not sensitive.** Contacts are `host:port`
 * pairs of arbitrary strangers running BitTorrent — the same addresses any
 * client learns within seconds of starting — and the node id is a random 20
 * bytes with no relationship to the user, the machine or anything watched. No
 * infohash is recorded here; that is the one thing in the DHT that *is*
 * revealing, and it is why this file holds contacts rather than a lookup cache.
 */

export interface DhtContact {
  host: string;
  port: number;
}

interface DhtCacheFile {
  version: number;
  nodeId?: string;
  nodes?: DhtContact[];
  savedAt?: number;
}

const FILE_VERSION = 1;

/**
 * How many saved contacts are handed back at startup.
 *
 * A routing table holds 8 nodes per bucket over 160 buckets, so a busy client
 * has far more than this — but bootstrap pings every contact it is given, and
 * several hundred simultaneous UDP probes at launch is a burst a home router's
 * NAT table notices. 200 is comfortably enough to converge in one round and
 * small enough to be a rounding error on the socket.
 */
export const MAX_PERSISTED_NODES = 200;

/**
 * Contacts older than this are dropped unread.
 *
 * A DHT contact is a residential IP with a DHCP lease. After a few days most of
 * a saved table is stale, and a stale contact is not free: it is a UDP probe
 * that will never be answered and a bootstrap round that waits for a timeout.
 * Past this age the hardcoded bootstrap hosts are the better bet.
 */
export const NODE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bootstrap hosts, several rather than `k-rpc`'s three.
 *
 * These are the entry points every BitTorrent client on the network already
 * uses; they are load-bearing infrastructure and the list is public. The reason
 * to carry our own is availability arithmetic: with three entries, one being
 * down is a third of the bootstrap capacity, and `dht.transmissionbt.com` has
 * been that one often enough to matter. There is no cost to listing more —
 * bootstrap probes run in parallel and the first answer is enough.
 */
export const DHT_BOOTSTRAP_NODES: readonly DhtContact[] = [
  { host: 'router.bittorrent.com', port: 6881 },
  { host: 'router.utorrent.com', port: 6881 },
  { host: 'dht.transmissionbt.com', port: 6881 },
  { host: 'dht.libtorrent.org', port: 25401 },
  { host: 'router.bitcomet.com', port: 6881 },
  { host: 'dht.aelitis.com', port: 6881 },
];

/**
 * The UDP port the DHT node binds, pinned rather than ephemeral.
 *
 * Same argument as `DEFAULT_TORRENT_PORT` in `swarmHealth.ts` and it is a
 * *different* port: WebTorrent's `dhtPort` defaults to 0, so even with the peer
 * port pinned the DHT moved every launch, which is exactly what makes a
 * persisted node id worth nothing. 6881 is the peer port, so the DHT takes the
 * next one by convention.
 */
export const DEFAULT_DHT_PORT = 6882;

/** Drops anything that is not a plausible contact, and de-duplicates. */
export function sanitiseContacts(raw: unknown, cap = MAX_PERSISTED_NODES): DhtContact[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: DhtContact[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const host = (entry as DhtContact).host;
    const port = (entry as DhtContact).port;

    if (typeof host !== 'string' || host.length === 0 || host.length > 255) continue;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) continue;

    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ host, port });

    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Saved contacts are **not** bootstrap entries, and an earlier revision of this
 * file exported a `bootstrapList()` that merged the two. It has been removed
 * rather than deprecated, because the merged list is not a slower version of
 * the right thing — it is actively worse than a cold start.
 *
 * `k-rpc` uses `bootstrap.length` as a threshold on every round of every
 * iterative lookup, comparing it against a set that can never exceed `k` (20).
 * A 200-entry list therefore pins that comparison true forever, which makes the
 * lookup discard the per-query node table it is supposed to converge through
 * and fire the whole bootstrap list at the socket in one unthrottled burst.
 *
 * The saved table goes in through `DHT.addNode()` instead — see
 * `TorrentEngine.seedDhtNodes`, which is where the reasoning is written out in
 * full. `DHT_BOOTSTRAP_NODES` above is what `bootstrap` receives, and it is
 * deliberately the length `k-rpc` expects.
 */

/**
 * The persisted half of a warm DHT node.
 *
 * Reads are total — a missing, truncated or foreign file means "cold start",
 * which is what the app did before this existed and is never an error worth
 * reporting.
 */
export class DhtNodeCache {
  private readonly file: string;
  private nodeId: string | null = null;
  private saved: DhtContact[] = [];

  constructor(file: string) {
    this.file = file;
  }

  public load(now = Date.now()): void {
    let parsed: DhtCacheFile;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DhtCacheFile;
    } catch {
      return;
    }

    if (!parsed || parsed.version !== FILE_VERSION) return;

    if (typeof parsed.nodeId === 'string' && /^[a-f0-9]{40}$/i.test(parsed.nodeId)) {
      this.nodeId = parsed.nodeId.toLowerCase();
    }

    // Contacts expire; the node id does not. Keeping a stable identity across a
    // long gap costs nothing and is the half that makes us findable again.
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (now - savedAt <= NODE_CACHE_TTL_MS) {
      this.saved = sanitiseContacts(parsed.nodes);
    }
  }

  /** A stable node id, generated once and reused for the life of the install. */
  public getNodeId(): string {
    if (!this.nodeId) this.nodeId = crypto.randomBytes(20).toString('hex');
    return this.nodeId;
  }

  /**
   * The contacts that came back from disk, to be pushed into the live routing
   * table with `DHT.addNode()`. Empty is the ordinary cold start, not an error.
   */
  public get warmContacts(): readonly DhtContact[] {
    return this.saved;
  }

  public save(nodes: unknown, now = Date.now()): void {
    const contacts = sanitiseContacts(nodes);
    // An empty routing table means the DHT never came up. Overwriting a good
    // saved table with it would make one bad launch poison every launch after.
    if (contacts.length === 0) return;

    this.saved = contacts;

    const payload: DhtCacheFile = {
      version: FILE_VERSION,
      nodeId: this.getNodeId(),
      nodes: contacts,
      savedAt: now,
    };

    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(payload));
      fs.renameSync(temp, this.file);
    } catch {
      // A cache that cannot be written costs a cold start, not correctness.
    }
  }
}

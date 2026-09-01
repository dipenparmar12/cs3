import path from 'path';
import fs from 'fs';
import os from 'os';
import WebTorrent, { type NodeServer, type Torrent, type TorrentFile } from 'webtorrent';
import type { TorrentFileEntry, TorrentStreamStats } from '../../src/types/torrent';
import { parseReleaseName } from './releaseParser';
import { DEFAULT_TRACKERS, mergeTrackers, trackersFromMagnet } from './indexers/base';
import {
  censusPeers,
  diagnoseSwarm,
  summariseSwarm,
  DEFAULT_TORRENT_PORT,
  MAX_CONNS_PER_TORRENT,
  MAX_WEB_CONNS,
  SWARM_PROFILES,
  type SwarmMode,
} from './swarmHealth';
import type { SwarmReport } from '../../src/types/torrent';
import { TorrentMetadataCache, metadataCacheUrls } from './torrentMetadata';
import { DhtNodeCache, DEFAULT_DHT_PORT, DHT_BOOTSTRAP_NODES } from './dhtNodeCache';

/**
 * Streaming torrent engine.
 *
 * Mirrors what the Android app achieves with its in-process `torrServer`: pieces
 * are fetched sequentially and exposed over a loopback HTTP server with range
 * support, so the player can start within seconds instead of waiting for the
 * whole file. The player never sees a magnet — it just gets an `http://127.0.0.1`
 * URL and treats it as an ordinary progressive source.
 *
 * These behaviours matter most for perceived reliability:
 *  - **A warm client.** Almost the whole gap between this and a hosted torrent
 *    service is paid before a single byte of the film is requested: binding the
 *    peer, DHT and HTTP sockets, bootstrapping the DHT from three hardcoded
 *    hosts, converging on the infohash, and pulling the info dictionary out of
 *    the swarm 16 KB at a time. A service pays that once, ever. `warmUp()`,
 *    `dhtNodeCache.ts` and `torrentMetadata.ts` are the three parts of not
 *    paying it on every Play.
 *  - **File selection inside season packs.** A pack contains every episode; we
 *    deselect all files and select only the requested one, otherwise the swarm
 *    bandwidth is spread across 10 files and nothing becomes playable.
 *  - **Head and tail priority.** Playback needs contiguous data from the start
 *    of the file (the container header lives there) *and* usually the last few
 *    megabytes: MP4s muxed for disk keep the `moov` atom at the end, and MKV
 *    cues live in the tail too. Fetching only the head leaves those containers
 *    stuck at "loading metadata" forever.
 *  - **Single-flight startup.** Two concurrent `startStream` calls used to each
 *    construct a client and an HTTP server, leaking the loser's port.
 *  - **Honest stall reporting.** A swarm that never produces a byte is a
 *    different problem from a slow one, and only the former should trigger a
 *    failover to another source.
 *  - **Streaming and downloading are not the same job.** Sequential fetching is
 *    what makes playback start in seconds, and it costs throughput: a peer that
 *    does not hold the exact next piece contributes nothing. A background
 *    download has no playhead and no reason to pay that, so it runs
 *    rarest-first. See `swarmHealth.ts` for the whole argument, including the
 *    part no client-side setting can fix.
 */

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv', '.webm',
  '.mpg', '.mpeg', '.m2ts', '.ts', '.ogv', '.3gp', '.divx', '.vob',
]);

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx']);

/**
 * Bytes of contiguous leading data required before playback is offered.
 *
 * Halved from 8 MB on 2026-08-28, and the reasoning is worth keeping because
 * the number is a trade rather than a fact. It gates two things: when the
 * player is handed a URL, and when the failover ladder stops asking. 8 MB is
 * roughly twelve seconds of a 5 Mbps encode, so on a healthy swarm the app sat
 * on a source that was already working — and on a slow one it spent the whole
 * budget proving what four megabytes had already shown.
 *
 * It cannot go much lower. Below a couple of megabytes the demuxer can open the
 * container and then immediately run out, which presents as a stall a second
 * after pressing play and sends the retry ladder off after a source that was
 * fine. 4 MB is comfortably past a container header plus a GOP, and the head
 * window below keeps fetching well ahead of it.
 */
const PLAYABLE_THRESHOLD_BYTES = 4 * 1024 * 1024;

/** Leading bytes fetched at top priority — enough for a container header plus a GOP. */
const HEAD_PRIORITY_BYTES = 16 * 1024 * 1024;

/** Trailing bytes fetched at top priority, for containers that index at the end. */
const TAIL_PRIORITY_BYTES = 4 * 1024 * 1024;

/**
 * The tail window for Matroska, which is smaller and for a different reason.
 *
 * MP4 muxed for disk keeps its `moov` atom at the end and **cannot be opened at
 * all** without it, so the tail is on the critical path. Matroska is not like
 * that: the header and track entries are at the front, and the trailing Cues
 * element only makes *seeking* accurate. Giving both containers the same 4 MB
 * spent a quarter of the opening burst on data MKV playback does not block on
 * — and MKV is the modal container in this corpus, so that was most streams.
 */
const MATROSKA_TAIL_BYTES = 1024 * 1024;

/**
 * Give up waiting for metadata.
 *
 * Was 45s. That is far longer than a live swarm ever takes and far longer than
 * anyone waits before pressing something else, and it is paid *per candidate*
 * by the failover ladder — three dead sources in a ranked list cost over two
 * minutes before the fourth was tried. The early bail below is what makes
 * shortening it safe.
 */
const METADATA_TIMEOUT_MS = 25_000;

/**
 * How long a torrent gets to learn about *any* peer before it is called dead.
 *
 * This is the cheap half of the failover decision. Metadata can legitimately
 * take twenty seconds on a swarm with few seeds — the info dictionary arrives
 * in 16 KB chunks from a peer that has to be found, dialled and handshaked
 * first. But a torrent that has not learned a single peer address from the DHT,
 * from any tracker or from PEX after this long is not slow, it is gone, and
 * every additional second spent on it is a second the next candidate does not
 * get.
 *
 * Deliberately measured on *known* peers rather than connected ones. A peer we
 * have heard of but cannot reach is a reachability problem — see
 * `swarmHealth.ts`, where that distinction is the whole diagnosis — and calling
 * it a dead swarm would send the reader looking for a different source when the
 * answer is a router setting.
 */
const DEAD_SWARM_BAIL_MS = 12_000;

/** How often the DHT routing table is written back to disk. */
const DHT_PERSIST_INTERVAL_MS = 5 * 60_000;

/** No new bytes for this long, with the file incomplete, counts as stalled. */
const STALL_THRESHOLD_MS = 45_000;

/** Give up waiting for the listening socket, so callers never hang on startup. */
const LISTEN_TIMEOUT_MS = 10_000;

export interface StreamRequest {
  /** Magnet URI, `.torrent` URL, or bare infohash. */
  torrentId: string;
  /** When set, the engine picks the matching episode file from a season pack. */
  season?: number;
  episode?: number;
  /** Explicit file index, overriding automatic selection. */
  fileIndex?: number;
  /** Filename the indexer expects; matched by name if the index is stale. */
  expectedFileName?: string;
  /** Overrides the engine-wide cache directory for this torrent only. */
  downloadPath?: string;
  /**
   * What the bytes are for. Defaults to `stream`, because that is the path a
   * mistake is least damaging on: a download fetched in order is merely slower,
   * where a stream fetched out of order does not play at all.
   */
  mode?: SwarmMode;
}

export interface StreamHandle {
  infoHash: string;
  streamUrl: string;
  fileName: string;
  fileSize: number;
  /** Absolute on-disk location of the selected file, for downloads. */
  diskPath: string;
  files: TorrentFileEntry[];
  /** Subtitle files found inside the torrent, served from the same loopback origin. */
  subtitleUrls: Array<{ name: string; url: string }>;
  mimeType: string;
}

/** Per-torrent liveness sample, used to tell "slow" apart from "dead". */
interface StreamWatch {
  startedAt: number;
  lastBytes: number;
  lastProgressAt: number;
}

function extensionOf(name: string): string {
  return path.extname(name).toLowerCase();
}

function isVideoFile(file: { name: string }): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(file.name));
}

/** Sample/extra files inside a release; never the feature the user asked for. */
function isJunkFile(file: { path: string; length: number }): boolean {
  return /(^|[/\\])(sample|extras?|featurettes?|trailers?)([/\\]|[-_. ])/i.test(file.path);
}

/**
 * How much of the file's tail to fetch before the body, by container.
 *
 * This used to be one number for everything, and it was the MP4 number. The
 * cost is paid at the worst possible moment — the tail window competes with the
 * head window for the opening seconds of swarm bandwidth, which is exactly the
 * data playback is blocked on — so getting it wrong for the common container
 * delays every stream.
 *
 *  - **MP4 family, and AVI.** A `moov` atom written after the media data, or an
 *    `idx1` chunk at the end, is *required* to open the file. Without the tail
 *    the demuxer reports the container as invalid, which reads as a dead source.
 *  - **Matroska.** Header, tracks and codec private data are all at the front.
 *    The trailing Cues element improves seek accuracy and playback does not
 *    block on it, so a smaller window is enough to make seeking work without
 *    starving the head.
 *  - **Everything else** — MPEG-TS, MPEG-PS, FLV, WebM-as-live. No trailing
 *    index exists, so the tail is ordinary media data and there is nothing to
 *    front-load. Fetching it would be pure delay.
 */
function tailPriorityBytes(ext: string): number {
  switch (ext) {
    case '.mp4':
    case '.m4v':
    case '.mov':
    case '.avi':
    case '.divx':
      return TAIL_PRIORITY_BYTES;
    case '.mkv':
    case '.webm':
      return MATROSKA_TAIL_BYTES;
    default:
      return 0;
  }
}

function mimeForExtension(ext: string): string {
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.ogv':
      return 'video/ogg';
    case '.mkv':
      // Chromium will attempt Matroska with supported internal codecs.
      return 'video/x-matroska';
    default:
      return 'video/mp4';
  }
}

export interface TorrentEngineOptions {
  /** Where pieces land. Defaults to a directory under the OS temp dir. */
  downloadPath?: string;
  /**
   * Where the engine's own persistent state lives — the DHT routing table and
   * the `.torrent` metadata cache. Separate from `downloadPath` because that
   * one is a cache the user is invited to clear, and clearing it must not throw
   * away warm-start state that has nothing to do with any particular film.
   */
  statePath?: string;
  /**
   * Whether a magnet may carry `xs` links to public `.torrent` mirrors.
   *
   * See `torrentMetadata.ts` for why this is defensible by default and why it
   * is a switch anyway.
   *
   * Accepts a **function** as well as a value, and that is the point: read once
   * at construction, the switch could only ever take effect after a restart,
   * which for a privacy control is close to not having one. Passed as a getter
   * it is consulted per magnet, so turning it off stops the next request.
   */
  httpMetadataCache?: boolean | (() => boolean);
}

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private server: NodeServer | null = null;
  private serverPort = 0;
  /** In-flight startup, so concurrent callers share one client and one server. */
  private starting: Promise<{ client: WebTorrent; port: number }> | null = null;
  private downloadPath: string;
  /** infoHash → the file index currently selected for streaming. */
  private selectedFile = new Map<string, number>();
  private lastError = new Map<string, string>();
  private watches = new Map<string, StreamWatch>();
  /** infoHash → what the bytes are for, which decides the piece strategy. */
  private modes = new Map<string, SwarmMode>();
  private readonly metadataCache: TorrentMetadataCache;
  private readonly dhtCache: DhtNodeCache;
  private readonly httpMetadataCache: () => boolean;
  private dhtPersistTimer: NodeJS.Timeout | null = null;

  constructor(options: TorrentEngineOptions | string = {}) {
    // A bare string is the original signature, kept for callers that only ever
    // set the cache directory.
    const opts: TorrentEngineOptions =
      typeof options === 'string' ? { downloadPath: options } : options;

    this.downloadPath =
      opts.downloadPath ?? path.join(os.tmpdir(), 'cloudstream-desktop', 'torrent-cache');

    const stateDir =
      opts.statePath ?? path.join(os.tmpdir(), 'cloudstream-desktop', 'torrent-state');
    this.metadataCache = new TorrentMetadataCache(path.join(stateDir, 'metadata'));
    this.dhtCache = new DhtNodeCache(path.join(stateDir, 'dht-nodes.json'));
    const mirrors = opts.httpMetadataCache ?? true;
    this.httpMetadataCache = typeof mirrors === 'function' ? mirrors : () => mirrors;
  }

  /**
   * The `.torrent` cache, shared rather than duplicated.
   *
   * `TorrentImportService` writes an imported file into it so the first Play
   * skips the BEP-9 metadata fetch entirely, and reads it back to render a
   * magnet's contents once this engine has resolved them. Both would work
   * against a second `TorrentMetadataCache` on the same directory — it is
   * content-addressed and holds no state — but then the directory would be
   * named in two places, and the day one moves is the day imports silently stop
   * warming playback.
   */
  public get metadata(): TorrentMetadataCache {
    return this.metadataCache;
  }

  public setDownloadPath(dir: string): void {
    this.downloadPath = dir;
  }

  /**
   * Brings the client up before anyone has asked for a stream.
   *
   * Everything else in this file makes a *torrent* faster. This makes the *app*
   * faster, and it is the single largest item: pressing Play on a cold process
   * pays a TCP bind, a uTP bind, a UDP bind for the DHT, a DNS lookup and round
   * trip to each bootstrap host, and an HTTP server bind — none of which has
   * anything to do with the film, and all of which used to happen while the
   * viewer watched a spinner. A hosted service never pays it because its client
   * has been up for weeks. There is no reason ours cannot be up for the length
   * of the session.
   *
   * Never awaited by a caller and never fatal: a warm-up that fails costs
   * exactly what the app cost before it existed, because the first `startStream`
   * still calls `ensureStarted` itself.
   */
  public async warmUp(): Promise<void> {
    await this.ensureStarted();
    // Cheap, and it wants to happen away from the first play rather than during
    // it: a sweep walks every entry in the metadata directory.
    this.metadataCache.sweep();
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Starts the client and loopback server, at most once.
   *
   * The single-flight promise is the point: `startStream` is called from IPC and
   * from the download service, and two overlapping calls previously each built a
   * client and bound a server, orphaning one of them along with its port.
   */
  private ensureStarted(): Promise<{ client: WebTorrent; port: number }> {
    if (this.client && !this.client.destroyed && this.server && this.serverPort > 0) {
      return Promise.resolve({ client: this.client, port: this.serverPort });
    }
    if (this.starting) return this.starting;

    this.starting = this.startOnce().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /**
   * Builds the client, preferring a pinned listening port.
   *
   * An OS-assigned port changes on every launch, which makes a router
   * forwarding rule impossible to write and forces UPnP to re-map each start.
   * Pinning one is the only thing this app can do about inbound reachability,
   * which is the largest single difference between a home connection and a
   * seedbox — see `swarmHealth.ts`.
   *
   * The fallback is not optional. `ConnPool` reports a failed `listen` as a
   * **client-level error that destroys the client**, so a port already in use
   * (a second copy of this app, or any other BitTorrent client) would take
   * torrents out entirely. A random port is strictly better than none.
   */
  private async createClient(): Promise<WebTorrent> {
    try {
      return await this.listenOn(DEFAULT_TORRENT_PORT, DEFAULT_DHT_PORT);
    } catch (error) {
      console.warn(
        `[torrent] ports ${DEFAULT_TORRENT_PORT}/${DEFAULT_DHT_PORT} unavailable (${
          error instanceof Error ? error.message : String(error)
        }); falling back to OS-assigned ports`
      );
      /**
       * Both ports fall back together, and the DHT one is why this comment
       * exists. WebTorrent wires `dht.once('error', err => this._destroy(err))`
       * — a UDP bind that fails does not degrade the DHT, it **destroys the
       * whole client**. So pinning `dhtPort` adds a second way for torrents to
       * be unavailable entirely, and the people most likely to hit it are the
       * ones already running qBittorrent or Transmission on the neighbouring
       * ports. Retrying with only the peer port relaxed would fail identically.
       *
       * The pinned pair buys inbound reachability, which is worth having and is
       * not worth the client. Ephemeral ports are exactly what this engine used
       * before either was pinned.
       */
      return this.listenOn(0, 0);
    }
  }

  private listenOn(torrentPort: number, dhtPort: number): Promise<WebTorrent> {
    const client = new WebTorrent({
      // Per torrent, not global. WebTorrent's default of 55 is conservative for
      // a desktop client: aggregate speed on BitTorrent is the sum of many slow
      // peers, and the per-peer request pipeline starts at two outstanding
      // blocks, so a connection cap is a speed cap.
      maxConns: MAX_CONNS_PER_TORRENT,
      /**
       * The bootstrap list stays **short**, and the saved routing table does
       * not go in it. This is not a style preference; a long `bootstrap` array
       * breaks the lookup it was meant to accelerate.
       *
       * `k-rpc` treats the list as a handful of well-known entry points and
       * uses its *length* as a threshold inside every iterative lookup
       * (`k-rpc/index.js`):
       *
       * ```js
       * var closest = table.closest(target, self.k)   // self.k = 20, so <= 20
       * if (!closest.length || closest.length < self.bootstrap.length) {
       *   closest = self.nodes.closest(target, self.k)
       *   if (!closest.length || closest.length < self.bootstrap.length) bootstrap()
       * }
       * ```
       *
       * Hand it 200 saved contacts and `closest.length < bootstrap.length` is
       * permanently true, on every round of every lookup. Two things follow and
       * both are bad. The per-lookup `table` — the *only* place nodes learned
       * from a `find_node` reply's compact node list are recorded, since
       * `self.nodes` is fed solely by peers that answered us directly — is
       * discarded and never queried, which removes the mechanism by which an
       * iterative lookup converges at all. And `bootstrap()` fires the whole
       * list in one burst through `socket.query` directly, bypassing the
       * concurrency gate `RPC.prototype.query` applies to everything else.
       *
       * So the warm table is seeded the way `bittorrent-dht` provides for
       * instead — `dht.addNode()`, after the client is up. See `seedDhtNodes`.
       */
      dht: { bootstrap: [...DHT_BOOTSTRAP_NODES] },
      /**
       * The node id, stable across launches.
       *
       * On its own this buys nothing; paired with `dhtPort` below it is what
       * makes other nodes' routing-table entries for us keep working, so we are
       * queried, and learn peers without having to ask for them first.
       */
      nodeId: this.dhtCache.getNodeId(),
      /**
       * The DHT's own UDP port, pinned like the peer port.
       *
       * WebTorrent defaults `dhtPort` to 0. Every launch therefore took a fresh
       * ephemeral port, which quietly cancels the persisted node id: an entry
       * naming the old port is dead, so nothing in the network could reach the
       * node it had recorded.
       *
       * A bind failure here destroys the client outright, so it falls back with
       * the peer port rather than being pinned on its own — see `createClient`.
       */
      dhtPort,
      lsd: true,
      webSeeds: true,
      /**
       * Peer exchange, which WebTorrent enables by default and which is stated
       * here so nobody removes it as noise. On a swarm whose tracker is slow or
       * dead, PEX is frequently how the peer list actually grows — one
       * connected peer becomes twenty without another announce.
       */
      utPex: true,
      torrentPort,
    });

    return new Promise<WebTorrent>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.removeListener('listening', onListening);
        client.removeListener('error', onError);
        fn();
      };

      const onListening = () => finish(() => resolve(client));

      /**
       * Only a *fatal* startup error may reject.
       *
       * A uTP server that cannot start emits `error` and then carries on
       * TCP-only — the client is still perfectly usable. Only a failed TCP
       * bind destroys the client, so `destroyed` is what separates the two.
       * Rejecting on both would throw away a working client and, worse, retry
       * on a random port for a problem the port never caused.
       */
      const onError = (err: Error | string) => {
        if (!client.destroyed) {
          console.warn(
            '[torrent] non-fatal startup error:',
            err instanceof Error ? err.message : err
          );
          return;
        }
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      };

      // A bind that neither succeeds nor errors would leave every caller of
      // `startStream` pending forever.
      const timer = setTimeout(
        () =>
          finish(() => {
            client.destroy();
            reject(new Error(`Timed out binding the torrent port (${torrentPort || 'automatic'})`));
          }),
        LISTEN_TIMEOUT_MS
      );

      client.on('listening', onListening);
      client.on('error', onError);
    });
  }

  private async startOnce(): Promise<{ client: WebTorrent; port: number }> {
    fs.mkdirSync(this.downloadPath, { recursive: true });

    // Before `createClient`, not after: `listenOn` reads the node id and the
    // saved routing table out of it, and a cache loaded afterwards would be a
    // warm start applied to the next launch instead of this one.
    this.dhtCache.load();

    const client = await this.createClient();

    client.on('error', (err) => {
      // Client-level errors are usually per-torrent and non-fatal; a throw here
      // would take down the main process.
      console.error('[torrent] client error:', err instanceof Error ? err.message : err);
    });

    /**
     * Every torrent that reaches metadata gets its `.torrent` written to disk.
     *
     * Hooked on the client rather than at the `add` sites because there are
     * three of those (stream, download, file-switch) and this must cover all of
     * them — including a torrent added by one path and reopened months later by
     * another. `torrent` fires once metadata is in hand, which is exactly when
     * `torrentFile` becomes readable.
     */
    client.on('torrent', (torrent) => this.rememberMetadata(torrent));

    // Last session's contacts, injected the way the DHT provides for rather
    // than through `bootstrap` — see the comment on the `dht` option above.
    this.seedDhtNodes(client);

    /**
     * The routing table is written back periodically, not only at exit.
     *
     * At exit alone would be worth much less than it looks: the table is at its
     * densest after an hour of use and the shutdown path is raced against a 5s
     * deadline (see `main.ts`), so the one write that matters is the one most
     * likely to be skipped — and a hard kill or a crash would save nothing at
     * all, which is precisely the session after which a fast restart matters.
     */
    this.armDhtPersistTimer();

    const server = client.createServer({ pathname: '/webtorrent' }, 'node');

    try {
      const port = await new Promise<number>((resolve, reject) => {
        // Error events live on the wrapped http.Server, not the wrapper.
        server.server.once('error', reject);

        // Port 0 = let the OS assign, matching Android's ephemeral-port approach.
        // Bind to loopback only: this server exposes file contents and must never
        // be reachable from the network.
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (address && typeof address === 'object') resolve(address.port);
          else reject(new Error('Torrent server did not report a port'));
        });
      });

      this.client = client;
      this.server = server;
      this.serverPort = port;
      return { client, port };
    } catch (error) {
      // A half-built client holds sockets; drop it rather than leaving it live.
      // The persist timer is armed before the bind, so it has to come down here
      // too — otherwise a failed start leaves an interval nothing will ever
      // clear (`destroy` only knows about the current one) and a retry arms a
      // second beside it.
      this.clearDhtPersistTimer();
      try {
        server.close();
      } catch {
        // Already closed.
      }
      client.destroy();
      throw error;
    }
  }

  private armDhtPersistTimer(): void {
    this.clearDhtPersistTimer();
    this.dhtPersistTimer = setInterval(() => this.persistDhtNodes(), DHT_PERSIST_INTERVAL_MS);
    // A cache write must never be the reason the process stays alive.
    this.dhtPersistTimer.unref?.();
  }

  private clearDhtPersistTimer(): void {
    if (!this.dhtPersistTimer) return;
    clearInterval(this.dhtPersistTimer);
    this.dhtPersistTimer = null;
  }

  /**
   * Puts last session's contacts into the live routing table.
   *
   * `addNode` with no id sends a ping through `RPC.prototype.query`, which is
   * the queued path — so 200 contacts arrive at the socket 16 at a time rather
   * than as one burst — and files each responder under its **real** node id.
   * That is what a warm routing table actually is; a list of addresses in
   * `bootstrap` is not the same object and, as the comment on that option
   * records, actively harms the lookup.
   *
   * Best-effort throughout. A contact that has moved simply never answers the
   * ping and is never added, which is the cold-start behaviour and costs
   * nothing.
   */
  private seedDhtNodes(client: WebTorrent): void {
    const dht = client.dht;
    if (!dht?.addNode) return;

    const contacts = this.dhtCache.warmContacts;
    if (contacts.length === 0) return;

    for (const contact of contacts) {
      try {
        dht.addNode(contact);
      } catch {
        // One unusable address must not cost the rest of the table.
      }
    }
    console.info(`[torrent] DHT seeded with ${contacts.length} saved contacts`);
  }

  /**
   * Files a torrent's own metadata so the next open needs no swarm at all.
   *
   * The write verifies the bytes against the infohash before storing them, so
   * this is safe to call on anything — including a torrent whose metadata came
   * from a third-party mirror over `xs`.
   */
  private rememberMetadata(torrent: Torrent): void {
    const bytes = torrent.torrentFile;
    if (bytes && bytes.length > 0) this.metadataCache.write(torrent.infoHash, bytes);
  }

  private persistDhtNodes(): void {
    const dht = this.client?.dht;
    if (!dht) return;
    try {
      this.dhtCache.save(dht.toJSON().nodes);
    } catch {
      // The routing table is a cache of strangers' addresses. Failing to write
      // it costs a colder next start and nothing else.
    }
  }

  // --- file selection ------------------------------------------------------

  /**
   * Chooses which file inside the torrent to play.
   *
   * Season packs are the interesting case: matching on the parsed episode number
   * of each *file name* is far more reliable than assuming the largest file, and
   * assuming largest is exactly how a user asking for E03 ends up watching E07.
   */
  private pickFile(torrent: Torrent, request: StreamRequest): TorrentFile | null {
    const allVideos = torrent.files.filter(isVideoFile);
    if (allVideos.length === 0) return null;
    if (allVideos.length === 1) return allVideos[0];

    // Samples and extras are video files too, and a 40 MB sample is exactly what
    // "pick the first video" lands on. Only fall back to them if there is
    // nothing else at all.
    const nonJunk = allVideos.filter((file) => !isJunkFile(file));
    const videos = nonJunk.length > 0 ? nonJunk : allVideos;

    // 1. Filename the indexer named. Most reliable: it survives the index
    //    drifting, which happens when a torrent is re-created with extra files.
    if (request.expectedFileName) {
      const wanted = request.expectedFileName.toLowerCase();
      const byName = videos.find(
        (file) => file.name.toLowerCase() === wanted || file.path.toLowerCase().endsWith(wanted)
      );
      if (byName) return byName;
    }

    // 2. Explicit index from the indexer.
    if (request.fileIndex !== undefined) {
      const explicit = torrent.files[request.fileIndex];
      if (explicit && isVideoFile(explicit)) return explicit;
    }

    if (request.episode !== undefined) {
      const matches = videos.filter((file) => {
        const parsed = parseReleaseName(file.name);
        if (request.season !== undefined && parsed.season !== undefined) {
          if (parsed.season !== request.season) return false;
        }
        return parsed.episode === request.episode || parsed.absoluteEpisode === request.episode;
      });

      if (matches.length > 0) {
        // Among equally-matching files prefer the largest (higher bitrate copy).
        return matches.reduce((a, b) => (b.length > a.length ? b : a));
      }

      // An episode was requested and no file matched. Returning the largest file
      // here is how "play S01E03" silently plays S01E07, so refuse instead — the
      // caller can fail over to another source.
      if (videos.length > 1) return null;
    }

    // No episode requested: the largest video file is the feature.
    return videos.reduce((a, b) => (b.length > a.length ? b : a));
  }

  /** Byte offset of a file inside the torrent's concatenated piece space. */
  private offsetOf(torrent: Torrent, target: TorrentFile): number {
    if (typeof target.offset === 'number') return target.offset;

    let offset = 0;
    for (const file of torrent.files) {
      if (file === target) break;
      offset += file.length;
    }
    return offset;
  }

  /**
   * Restricts download to the chosen file and front-loads the pieces playback
   * actually blocks on.
   *
   * Without the deselect, the client spreads bandwidth across every file in a
   * pack and nothing becomes playable quickly. Without the explicit head/tail
   * selection, a sequential strategy still walks the file from byte 0, which
   * never reaches the trailing `moov` atom that MP4s muxed for disk need before
   * the first frame can be decoded.
   */
  private focusOn(torrent: Torrent, target: TorrentFile, mode: SwarmMode): void {
    for (const file of torrent.files) {
      if (file !== target) {
        try {
          file.deselect();
        } catch {
          // Older builds throw when deselecting an already-deselected file.
        }
      }
    }
    target.select(1);

    const profile = SWARM_PROFILES[mode];
    // Settable at runtime and read live by WebTorrent's request loop, so a
    // stream promoted to a download switches without re-adding the torrent.
    torrent.strategy = profile.strategy;
    if (!profile.prioritiseHeadAndTail) return;

    const pieceLength = torrent.pieceLength;
    if (!pieceLength || pieceLength <= 0) return;

    const offset = this.offsetOf(torrent, target);
    const firstPiece = Math.floor(offset / pieceLength);
    const lastPiece = Math.floor((offset + target.length - 1) / pieceLength);

    const headEnd = Math.min(
      lastPiece,
      firstPiece + Math.ceil(HEAD_PRIORITY_BYTES / pieceLength)
    );

    try {
      // Priority 10 outranks the plain `select(1)` above, so these windows are
      // requested before the sequential walk reaches them.
      torrent.select(firstPiece, headEnd, 10);

      const tailBytes = tailPriorityBytes(extensionOf(target.name));
      if (tailBytes > 0) {
        const tailStart = Math.max(headEnd + 1, lastPiece - Math.ceil(tailBytes / pieceLength));
        if (tailStart <= lastPiece) torrent.select(tailStart, lastPiece, 9);
      }
    } catch {
      // Piece-range selection is best-effort; the file-level select still holds.
    }
  }

  private fileUrl(port: number, infoHash: string, file: TorrentFile): string {
    // The server routes /webtorrent/<infoHash>/<file path within torrent>.
    const encoded = file.path.split(/[/\\]/).map(encodeURIComponent).join('/');
    return `http://127.0.0.1:${port}/webtorrent/${infoHash}/${encoded}`;
  }

  // --- streaming -----------------------------------------------------------

  public async startStream(request: StreamRequest): Promise<StreamHandle> {
    const { client, port } = await this.ensureStarted();

    const torrent = await this.addTorrent(client, request);
    const file = this.pickFile(torrent, request);

    if (!file) {
      // Nothing here is playable, and failover will move on to another source —
      // so this torrent must not be left in the client holding sockets. It is
      // only dropped when no other stream is using it.
      if (!this.selectedFile.has(torrent.infoHash)) {
        await this.stopStream(torrent.infoHash, false);
      }

      const wanted =
        request.episode !== undefined
          ? `episode ${request.season !== undefined ? `S${request.season}` : ''}E${request.episode}`
          : 'a playable video file';
      throw new Error(`This torrent does not contain ${wanted}.`);
    }

    const mode = request.mode ?? 'stream';
    this.focusOn(torrent, file, mode);
    this.modes.set(torrent.infoHash, mode);
    this.selectedFile.set(torrent.infoHash, torrent.files.indexOf(file));
    this.lastError.delete(torrent.infoHash);
    this.watches.set(torrent.infoHash, {
      startedAt: Date.now(),
      lastBytes: file.downloaded,
      lastProgressAt: Date.now(),
    });

    return this.describeHandle(torrent, file, port);
  }

  private describeHandle(torrent: Torrent, file: TorrentFile, port: number): StreamHandle {
    return {
      infoHash: torrent.infoHash,
      streamUrl: this.fileUrl(port, torrent.infoHash, file),
      fileName: file.name,
      fileSize: file.length,
      // `file.path` is relative to the torrent root, which itself sits under the
      // torrent's download directory — joining both is the only way to get a
      // path that exists for multi-file releases.
      diskPath: path.join(torrent.path, file.path),
      files: this.describeFiles(torrent),
      subtitleUrls: torrent.files
        .filter((f) => SUBTITLE_EXTENSIONS.has(extensionOf(f.name)))
        .map((f) => ({ name: f.name, url: this.fileUrl(port, torrent.infoHash, f) })),
      mimeType: mimeForExtension(extensionOf(file.name)),
    };
  }

  /**
   * Blocks until enough leading data exists to start playback, or the swarm
   * proves itself dead.
   *
   * This is what makes automatic failover possible: a caller can commit to a
   * source only once it has produced real bytes, instead of handing the player a
   * URL that will spin forever.
   */
  public async waitUntilPlayable(
    infoHash: string,
    timeoutMs: number,
    /**
     * Abandons the wait early. Without this, a viewer who picks a different
     * source sits behind the remaining seconds of a wait whose answer is
     * already irrelevant — the single largest source of "it just keeps
     * loading" after an explicit choice.
     */
    signal?: AbortSignal
  ): Promise<{ playable: boolean; reason?: string; aborted?: boolean }> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) return { playable: false, aborted: true, reason: 'Superseded.' };

      const stats = await this.getStats(infoHash);
      if (!stats) return { playable: false, reason: 'The stream was closed before it started.' };
      if (stats.error) return { playable: false, reason: stats.error };
      if (stats.isPlayable) return { playable: true };

      // Polled in short slices so an abort is noticed promptly rather than
      // after the full sleep.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (signal?.aborted) return { playable: false, aborted: true, reason: 'Superseded.' };

    const stats = await this.getStats(infoHash);
    return {
      playable: false,
      reason:
        stats && stats.peers === 0
          ? 'No peers responded — the swarm looks dead.'
          : 'Timed out waiting for enough data to start playback.',
    };
  }

  /**
   * Normalises whatever the indexer gave us into something WebTorrent accepts.
   * A bare infohash carries no trackers, so a DHT-less network sees no peers at
   * all until one is attached.
   */
  private normaliseTorrentId(torrentId: string): string {
    const trimmed = torrentId.trim();
    const infoHash = this.extractInfoHash(trimmed);
    if (!infoHash) return trimmed;

    if (/^[a-f0-9]{40}$/i.test(trimmed)) {
      const params = [
        ...DEFAULT_TRACKERS.map((t) => `tr=${encodeURIComponent(t)}`),
        ...this.metadataSourceParams(infoHash),
      ];
      return `magnet:?xt=urn:btih:${infoHash}&${params.join('&')}`;
    }

    if (!/^magnet:/i.test(trimmed)) return trimmed;

    const sources = this.metadataSourceParams(infoHash);
    return sources.length > 0 ? `${trimmed}&${sources.join('&')}` : trimmed;
  }

  /**
   * `xs` ("exact source") parameters pointing at public `.torrent` mirrors.
   *
   * WebTorrent fetches these in parallel with the swarm and **refuses any
   * response whose infohash is not the one being resolved**, so the worst a
   * dead or hostile mirror can do is waste one request. What the best case buys
   * is the whole of the metadata phase: a few hundred milliseconds of HTTP
   * instead of a DHT lookup, a tracker announce, a peer dial, a handshake and a
   * chunked BEP-9 transfer.
   *
   * Nothing is appended when the option is off, and a magnet that already
   * carries its own `xs` keeps it — the parameter is a list.
   */
  private metadataSourceParams(infoHash: string): string[] {
    if (!this.httpMetadataCache()) return [];
    return metadataCacheUrls(infoHash).map((url) => `xs=${encodeURIComponent(url)}`);
  }

  /**
   * Adds a torrent and resolves once metadata is available.
   *
   * Reuses an existing torrent when the same infohash is already active, which
   * makes re-entering a title instant instead of re-bootstrapping the swarm.
   * A torrent that exists but is *not yet ready* is waited on rather than added
   * again — adding a duplicate makes WebTorrent throw and used to surface as a
   * spurious "could not start the stream".
   */
  private async addTorrent(client: WebTorrent, request: StreamRequest): Promise<Torrent> {
    const torrentId = this.normaliseTorrentId(request.torrentId);
    const knownHash = this.extractInfoHash(torrentId);

    if (knownHash) {
      const existing = await Promise.resolve(client.get(knownHash));
      if (existing) {
        if (existing.ready) return existing;
        return this.awaitReady(existing, client);
      }
    }

    /**
     * The metadata this machine already has, if it has it.
     *
     * This is the whole point of the cache and it is worth being precise about
     * what it removes: handed a `.torrent`, `add()` has the file list, the piece
     * length and every piece hash *synchronously*, so `ready` fires on the next
     * tick and the swarm is only ever needed for the bytes. Handed a magnet, all
     * of that has to be found on the network first, and everything else — file
     * selection, head/tail prioritisation, the playable-bytes count, the file
     * list on screen — is blocked behind it.
     *
     * Verified against the infohash on read, so a corrupt or substituted entry
     * is discarded rather than trusted.
     */
    const cached = knownHash ? this.metadataCache.read(knownHash) : null;

    let torrent: Torrent;
    try {
      torrent = client.add(cached ?? torrentId, {
        path: request.downloadPath ?? this.downloadPath,
        strategy: SWARM_PROFILES[request.mode ?? 'stream'].strategy,
        /**
         * The magnet's own trackers travel with it — and on the cache-hit path
         * they are the *only* way they can, because handing `add()` a buffer
         * discards the magnet entirely.
         *
         * That asymmetry is the bug this closes. A source whose magnet named a
         * tracker outside `DEFAULT_TRACKERS` worked on the first open and lost
         * that tracker on every later one, which is precisely the open the
         * cache exists to make faster — a swarm that got quieter the second
         * time reads as the release dying, not as a cache.
         */
        announce: mergeTrackers(DEFAULT_TRACKERS, trackersFromMagnet(torrentId)),
        // WebTorrent's default is 4. A web seed is plain HTTP and its
        // throughput scales with parallel requests like any other download, so
        // 4 is a ceiling the server never asked for — and a web seed is the one
        // peer that is never NAT-limited and never choking.
        maxWebConns: MAX_WEB_CONNS,
        // Nothing is downloaded until `focusOn` picks a file. Without this the
        // client starts pulling every file in a season pack the moment metadata
        // lands, and the episode the user asked for gets a fraction of the swarm.
        deselect: true,
      });
    } catch (error) {
      // WebTorrent throws synchronously on a duplicate; recover by adopting the
      // torrent that is already there.
      const message = error instanceof Error ? error.message : String(error);
      if (knownHash && /duplicate/i.test(message)) {
        const existing = await Promise.resolve(client.get(knownHash));
        if (existing) return existing.ready ? existing : this.awaitReady(existing, client);
      }
      throw error instanceof Error ? error : new Error(message);
    }

    return this.awaitReady(torrent, client);
  }

  /**
   * Waits for a torrent's metadata, cleaning up on failure.
   *
   * The cleanup is the important half: a timed-out torrent that stays in the
   * client blocks every later attempt at the same infohash as a duplicate, so
   * retrying a flaky source used to fail permanently until restart.
   */
  private awaitReady(torrent: Torrent, client: WebTorrent): Promise<Torrent> {
    if (torrent.ready) return Promise.resolve(torrent);

    return new Promise<Torrent>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(probe);
        torrent.removeAllListeners('ready');
        torrent.removeAllListeners('error');
      };

      /** Drops the dead torrent so the same magnet can be tried again. */
      const abandon = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          client.remove(torrent, { destroyStore: false }, () => undefined);
        } catch {
          // Already gone.
        }
        reject(new Error(message));
      };

      const timer = setTimeout(
        () =>
          abandon(
            'Timed out fetching torrent metadata. The swarm may be dead or unreachable — try a source with more seeders.'
          ),
        METADATA_TIMEOUT_MS
      );

      /**
       * The early exit, which is what the shortened overall timeout rests on.
       *
       * An indexer's seeder count is a number it scraped at some point in the
       * past, so a top-ranked release with a dead swarm looks exactly like a
       * healthy one until the network says otherwise. This is the network
       * saying otherwise as early as it honestly can: after
       * `DEAD_SWARM_BAIL_MS`, a torrent that knows of no peer at all has been
       * told nothing by the DHT, by any tracker, or by PEX, and waiting the
       * remaining thirteen seconds cannot change that.
       *
       * `_peers` rather than `numPeers`, deliberately. Knowing of peers we
       * cannot connect to is a *reachability* symptom with its own diagnosis
       * (`swarmHealth.ts`) and its own remedy; reporting it as an empty swarm
       * would send the reader off to find another source when the source was
       * fine.
       */
      const startedAt = Date.now();
      const probe = setInterval(() => {
        if (settled || Date.now() - startedAt < DEAD_SWARM_BAIL_MS) return;
        if (torrent.numPeers > 0 || (torrent._peers?.size ?? 0) > 0) return;
        abandon('No peers answered for this torrent — the swarm looks dead.');
      }, 2_000);
      probe.unref?.();

      torrent.on('ready', () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(torrent);
      });

      torrent.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        const message = err instanceof Error ? err.message : String(err);
        this.lastError.set(torrent.infoHash, message);
        reject(new Error(message));
      });

      // `ready` may already have fired between the guard above and the listener.
      if (torrent.ready && !settled) {
        settled = true;
        cleanup();
        resolve(torrent);
      }
    });
  }

  private extractInfoHash(torrentId: string): string | null {
    if (/^[a-f0-9]{40}$/i.test(torrentId)) return torrentId.toLowerCase();
    const magnet = torrentId.match(/xt=urn:btih:([a-f0-9]{40})/i);
    return magnet ? magnet[1].toLowerCase() : null;
  }

  private describeFiles(torrent: Torrent): TorrentFileEntry[] {
    const selected = this.selectedFile.get(torrent.infoHash);
    return torrent.files.map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      length: file.length,
      isVideo: isVideoFile(file),
      isSelected: index === selected,
    }));
  }

  /**
   * Counts contiguous downloaded bytes from the start of the selected file.
   *
   * This is the number that decides whether playback can begin. Overall torrent
   * progress is misleading: a torrent can be 40% complete with a hole at byte 0,
   * which plays as an immediate error.
   */
  private computeReadyBytes(torrent: Torrent, file: TorrentFile): number {
    const pieceLength = torrent.pieceLength;
    if (!pieceLength || !Array.isArray(torrent.pieces)) {
      return Math.round(file.progress * file.length);
    }

    const offset = this.offsetOf(torrent, file);
    const firstPiece = Math.floor(offset / pieceLength);
    const lastPiece = Math.floor((offset + file.length - 1) / pieceLength);

    let contiguous = 0;
    for (let i = firstPiece; i <= lastPiece; i++) {
      // webtorrent nulls out the entry for pieces it already has.
      if (torrent.pieces[i] === null) contiguous += pieceLength;
      else break;
    }

    return Math.max(0, Math.min(file.length, contiguous - (offset % pieceLength)));
  }

  public async getStats(infoHash: string): Promise<TorrentStreamStats | null> {
    if (!this.client) return null;

    const torrent = await Promise.resolve(this.client.get(infoHash));
    if (!torrent) return null;

    const index = this.selectedFile.get(infoHash) ?? 0;
    const file = torrent.files[index] ?? torrent.files[0];
    if (!file) return null;

    const readyBytes = this.computeReadyBytes(torrent, file);
    const stalledMs = this.updateWatch(infoHash, file);

    return {
      infoHash,
      name: torrent.name,
      streamUrl: this.fileUrl(this.serverPort, infoHash, file),
      fileName: file.name,
      fileSize: file.length,
      downloaded: file.downloaded,
      progress: file.progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      peers: torrent.numPeers,
      // webtorrent does not separate seeds from peers; report the swarm size.
      seeds: torrent.numPeers,
      readyBytes,
      isPlayable: readyBytes >= Math.min(PLAYABLE_THRESHOLD_BYTES, file.length * 0.02),
      timeRemainingMs: Number.isFinite(torrent.timeRemaining) ? torrent.timeRemaining : 0,
      isPaused: torrent.paused,
      stalledMs,
      isStalled: stalledMs >= STALL_THRESHOLD_MS && file.progress < 1,
      error: this.lastError.get(infoHash),
    };
  }

  /**
   * Tracks how long a torrent has gone without producing a byte.
   *
   * Speed alone is a poor signal — it dips to zero constantly between pieces.
   * Time since the last increase in downloaded bytes is what distinguishes a
   * slow swarm from one that is never going to deliver.
   */
  private updateWatch(infoHash: string, file: TorrentFile): number {
    const now = Date.now();
    const watch = this.watches.get(infoHash);

    if (!watch) {
      this.watches.set(infoHash, { startedAt: now, lastBytes: file.downloaded, lastProgressAt: now });
      return 0;
    }

    if (file.downloaded > watch.lastBytes) {
      watch.lastBytes = file.downloaded;
      watch.lastProgressAt = now;
      return 0;
    }

    return now - watch.lastProgressAt;
  }

  public async selectFile(infoHash: string, fileIndex: number): Promise<StreamHandle | null> {
    if (!this.client) return null;

    const torrent = await Promise.resolve(this.client.get(infoHash));
    if (!torrent) return null;

    const file = torrent.files[fileIndex];
    if (!file || !isVideoFile(file)) return null;

    this.focusOn(torrent, file, this.modes.get(infoHash) ?? 'stream');
    this.selectedFile.set(infoHash, fileIndex);
    // Switching files restarts the liveness clock; the new file has no bytes yet.
    this.watches.set(infoHash, {
      startedAt: Date.now(),
      lastBytes: file.downloaded,
      lastProgressAt: Date.now(),
    });

    return this.describeHandle(torrent, file, this.serverPort);
  }

  /**
   * Changes what a live torrent is being fetched for.
   *
   * The case this exists for is a stream the user then chooses to download.
   * Nothing about the swarm has changed, but the ordering requirement has
   * disappeared, and staying sequential would keep paying for a playhead that
   * no longer exists. WebTorrent reads `strategy` on every request round, so
   * this takes effect without re-adding the torrent or losing a byte.
   */
  public async setMode(infoHash: string, mode: SwarmMode): Promise<boolean> {
    if (!this.client) return false;

    const torrent = await Promise.resolve(this.client.get(infoHash));
    if (!torrent) return false;

    this.modes.set(infoHash, mode);

    const index = this.selectedFile.get(infoHash);
    const file = index !== undefined ? torrent.files[index] : undefined;
    if (file) this.focusOn(torrent, file, mode);
    else torrent.strategy = SWARM_PROFILES[mode].strategy;

    return true;
  }

  /**
   * How this torrent is connected, and what is limiting it.
   *
   * The peer census is the part worth having. `numPeers` cannot tell a peer we
   * dialled from one that dialled us, and that difference is the answer to the
   * question people actually ask — why the same magnet is faster on a seedbox.
   * See `swarmHealth.ts`; the reasoning lives there so it can be tested.
   */
  public async getSwarmReport(infoHash: string): Promise<SwarmReport | null> {
    if (!this.client) return null;

    const torrent = await Promise.resolve(this.client.get(infoHash));
    if (!torrent) return null;

    const census = censusPeers(torrent._peers?.values() ?? []);
    const mode = this.modes.get(infoHash) ?? 'stream';
    const watch = this.watches.get(infoHash);
    const findings = diagnoseSwarm({
      census,
      ageMs: watch ? Date.now() - watch.startedAt : 0,
      mode,
      utpAvailable: WebTorrent.UTP_SUPPORT !== false && this.client.utp !== false,
      listenPort: this.client.torrentPort,
      maxConns: this.client.maxConns,
    });

    return {
      infoHash,
      census,
      findings,
      summary: summariseSwarm(findings, census),
      mode,
      listenPort: this.client.torrentPort,
      utpAvailable: WebTorrent.UTP_SUPPORT !== false && this.client.utp !== false,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
    };
  }

  public async pause(infoHash: string): Promise<void> {
    const torrent = this.client ? await Promise.resolve(this.client.get(infoHash)) : null;
    torrent?.pause();
  }

  public async resume(infoHash: string): Promise<void> {
    const torrent = this.client ? await Promise.resolve(this.client.get(infoHash)) : null;
    if (!torrent) return;
    torrent.resume();
    // A paused torrent makes no progress by definition; do not count the pause
    // against the stall clock when it comes back.
    const watch = this.watches.get(infoHash);
    if (watch) watch.lastProgressAt = Date.now();
  }

  /**
   * Stops a stream. `keepFiles` is honoured so a torrent promoted to a download
   * is not wiped when the player closes.
   */
  public async stopStream(infoHash: string, keepFiles = false): Promise<void> {
    if (!this.client) return;

    const torrent = await Promise.resolve(this.client.get(infoHash));
    if (!torrent) return;

    this.selectedFile.delete(infoHash);
    this.lastError.delete(infoHash);
    this.watches.delete(infoHash);
    this.modes.delete(infoHash);

    await new Promise<void>((resolve) => {
      this.client?.remove(torrent, { destroyStore: !keepFiles }, () => resolve());
      // Never let a hung teardown block the caller.
      setTimeout(resolve, 5_000);
    });
  }

  public async getActiveStreams(): Promise<TorrentStreamStats[]> {
    if (!this.client) return [];
    const stats = await Promise.all(
      this.client.torrents.map((t) => this.getStats(t.infoHash))
    );
    return stats.filter((s): s is TorrentStreamStats => s !== null);
  }

  public getCachePath(): string {
    return this.downloadPath;
  }

  /** Clears the on-disk piece cache for torrents that are no longer active. */
  public async clearCache(): Promise<number> {
    const activeNames = new Set(this.client?.torrents.map((t) => t.name) ?? []);
    let removed = 0;

    if (!fs.existsSync(this.downloadPath)) return 0;

    for (const entry of fs.readdirSync(this.downloadPath)) {
      if (activeNames.has(entry)) continue;
      try {
        fs.rmSync(path.join(this.downloadPath, entry), { recursive: true, force: true });
        removed++;
      } catch {
        // A locked file just stays; not worth failing the whole sweep.
      }
    }
    return removed;
  }

  public async destroy(): Promise<void> {
    // Before the client is dropped: this is the densest the routing table will
    // ever be, and it is the write that makes the *next* launch warm.
    this.persistDhtNodes();
    this.clearDhtPersistTimer();

    const client = this.client;
    const server = this.server;
    this.client = null;
    this.server = null;
    this.serverPort = 0;
    this.selectedFile.clear();
    this.watches.clear();
    this.modes.clear();

    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      setTimeout(resolve, 3_000);
    });

    await new Promise<void>((resolve) => {
      if (!client || client.destroyed) return resolve();
      client.destroy(() => resolve());
      setTimeout(resolve, 5_000);
    });
  }
}

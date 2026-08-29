/**
 * Minimal ambient declarations for `webtorrent@3`, which ships no types and has
 * no `@types` package. Only the surface this project actually uses is declared;
 * keeping it narrow means a WebTorrent API change surfaces as a compile error
 * here rather than as a runtime failure in the player.
 */
declare module 'webtorrent' {
  import type { Server } from 'http';
  import type { Readable } from 'stream';

  export interface TorrentFile {
    name: string;
    path: string;
    length: number;
    downloaded: number;
    progress: number;
    /** Byte offset of this file within the torrent's concatenated piece space. */
    offset?: number;
    select(priority?: number): void;
    deselect(): void;
    createReadStream(opts?: { start?: number; end?: number }): Readable;
    streamURL: string;
  }

  export interface Torrent {
    infoHash: string;
    magnetURI: string;
    name: string;
    length: number;
    downloaded: number;
    uploaded: number;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    numPeers: number;
    timeRemaining: number;
    done: boolean;
    paused: boolean;
    files: TorrentFile[];
    pieces: Array<unknown | null>;
    pieceLength: number;
    strategy: 'rarest' | 'sequential';
    path: string;
    ready: boolean;
    /**
     * The `.torrent` bytes, once metadata has arrived. This is what makes the
     * metadata cache possible: it is the whole info dictionary in its original
     * encoding, so it can be written to disk and handed straight back to
     * `add()` on the next open.
     */
    torrentFile?: Uint8Array | null;
    /**
     * Every peer this torrent knows, keyed by address. Internal, and read here
     * for one reason nothing public offers: `numPeers` cannot tell an incoming
     * connection from an outgoing one, and that distinction is the whole
     * reachability diagnosis. See `swarmHealth.ts`.
     */
    _peers?: Map<string, { type?: string }> | null;

    select(start: number, end: number, priority?: number, notify?: () => void): void;
    deselect(start: number, end: number): void;
    pause(): void;
    resume(): void;
    destroy(opts?: { destroyStore?: boolean }, cb?: (err?: Error) => void): void;
    on(event: 'ready' | 'done' | 'noPeers' | 'metadata', listener: () => void): this;
    on(event: 'error', listener: (err: Error | string) => void): this;
    on(event: 'download' | 'upload', listener: (bytes: number) => void): this;
    on(event: 'wire', listener: (wire: unknown, addr?: string) => void): this;
    removeAllListeners(event?: string): this;
  }

  export interface TorrentOptions {
    path?: string;
    strategy?: 'rarest' | 'sequential';
    announce?: string[];
    maxWebConns?: number;
    deselect?: boolean;
    destroyStoreOnDestroy?: boolean;
  }

  /**
   * A DHT contact. Passed to `bittorrent-dht` as `bootstrap`, which replaces
   * `k-rpc`'s hardcoded three rather than adding to them — so the caller has to
   * include the well-known hosts itself. See `dhtNodeCache.bootstrapList`.
   */
  export interface DhtNode {
    host: string;
    port: number;
  }

  export interface DhtOptions {
    bootstrap?: DhtNode[] | boolean;
  }

  /**
   * The live DHT node, present unless `dht: false`.
   *
   * `toJSON()` is the routing table as `{ host, port }` pairs — the thing worth
   * persisting, because a table rebuilt from disk converges in about one round
   * where a cold one takes several.
   */
  export interface DhtClient {
    toJSON(): { nodes: Array<{ host: string; port: number }> };
    /**
     * Files a contact in the live routing table. Given no `id` it pings the
     * address first — through the RPC layer's *queued* path, so a few hundred
     * of these are throttled rather than fired at once — and adds the node
     * under whatever id answers.
     *
     * This, not the `bootstrap` option, is how a saved routing table is
     * restored. See `TorrentEngine.seedDhtNodes` for why the distinction is
     * load-bearing.
     */
    addNode(node: { host: string; port: number; id?: string | Uint8Array }): void;
    listening: boolean;
    on(event: 'ready' | 'listening', listener: () => void): this;
  }

  export interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean | DhtOptions;
    /**
     * The DHT node id, hex. Random per process unless given, which is why it is
     * given: an identity that changes every launch is one no other node's
     * routing table can hold, so we are never queried and never learn a peer
     * without asking first.
     */
    nodeId?: string;
    utPex?: boolean;
    lsd?: boolean;
    webSeeds?: boolean;
    utp?: boolean;
    downloadLimit?: number;
    uploadLimit?: number;
    torrentPort?: number;
    dhtPort?: number;
    tracker?: boolean | Record<string, unknown>;
  }

  /**
   * WebTorrent's `NodeServer` **wraps** an `http.Server` rather than extending
   * it — the real server is at `.server`, and `listen`/`close` are rebound onto
   * the wrapper. Treating it as an `http.Server` fails at runtime with
   * "server.on is not a function".
   */
  export interface NodeServer {
    server: Server;
    pathname: string;
    listen(port: number, host?: string, cb?: () => void): Server;
    close(cb?: () => void): void;
    destroy(cb?: () => void): void;
    address(): { port: number; address: string; family: string } | string | null;
  }

  export default class WebTorrent {
    /** False when the optional `utp-native` binding could not be loaded. */
    static UTP_SUPPORT: boolean;

    constructor(opts?: WebTorrentOptions);
    torrents: Torrent[];
    /** The port actually bound, which is not the requested one after a fallback. */
    torrentPort: number;
    /** Cleared by the client itself if the uTP server errors after starting. */
    utp: boolean;
    listening: boolean;
    maxConns: number;
    /** Absent when the client was constructed with `dht: false`. */
    dht?: DhtClient;
    dhtPort: number;
    downloadSpeed: number;
    uploadSpeed: number;
    progress: number;
    destroyed: boolean;

    add(
      torrentId: string | Buffer,
      opts?: TorrentOptions,
      cb?: (torrent: Torrent) => void
    ): Torrent;
    get(torrentId: string): Promise<Torrent | null> | Torrent | null;
    remove(
      torrentId: string | Torrent,
      opts?: { destroyStore?: boolean },
      cb?: (err?: Error) => void
    ): void;
    createServer(opts?: { pathname?: string }, force?: 'node' | 'browser'): NodeServer;
    destroy(cb?: (err?: Error) => void): void;
    on(event: 'error', listener: (err: Error | string) => void): this;
    on(event: 'torrent', listener: (torrent: Torrent) => void): this;
    on(event: 'listening', listener: () => void): this;
    once(event: 'error', listener: (err: Error | string) => void): this;
    once(event: 'listening', listener: () => void): this;
    removeListener(event: string, listener: (...args: never[]) => void): this;
  }
}

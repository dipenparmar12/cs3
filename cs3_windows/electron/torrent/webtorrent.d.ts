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

    select(start: number, end: number, priority?: number, notify?: () => void): void;
    deselect(start: number, end: number): void;
    pause(): void;
    resume(): void;
    destroy(opts?: { destroyStore?: boolean }, cb?: (err?: Error) => void): void;
    on(event: 'ready' | 'done' | 'noPeers', listener: () => void): this;
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

  export interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean;
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
    constructor(opts?: WebTorrentOptions);
    torrents: Torrent[];
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
  }
}

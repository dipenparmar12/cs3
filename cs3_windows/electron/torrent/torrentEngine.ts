import path from 'path';
import fs from 'fs';
import os from 'os';
import WebTorrent, { type NodeServer, type Torrent, type TorrentFile } from 'webtorrent';
import type { TorrentFileEntry, TorrentStreamStats } from '../../src/types/torrent';
import { parseReleaseName } from './releaseParser';
import { DEFAULT_TRACKERS } from './indexers/base';

/**
 * Streaming torrent engine.
 *
 * Mirrors what the Android app achieves with its in-process `torrServer`: pieces
 * are fetched sequentially and exposed over a loopback HTTP server with range
 * support, so the player can start within seconds instead of waiting for the
 * whole file. The player never sees a magnet — it just gets an `http://127.0.0.1`
 * URL and treats it as an ordinary progressive source.
 *
 * Two behaviours matter most for perceived quality:
 *  - **File selection inside season packs.** A pack contains every episode; we
 *    deselect all files and select only the requested one, otherwise the swarm
 *    bandwidth is spread across 10 files and nothing becomes playable.
 *  - **Leading-bytes readiness.** Playback needs contiguous data from the start
 *    of the file (the container header/index lives there), so readiness is
 *    measured as contiguous leading pieces, not overall percentage.
 */

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv', '.webm',
  '.mpg', '.mpeg', '.m2ts', '.ts', '.ogv', '.3gp', '.divx', '.vob',
]);

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx']);

/** Bytes of contiguous leading data required before playback is offered. */
const PLAYABLE_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Give up waiting for metadata; usually means a dead swarm. */
const METADATA_TIMEOUT_MS = 45_000;

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
}

export interface StreamHandle {
  infoHash: string;
  streamUrl: string;
  fileName: string;
  fileSize: number;
  files: TorrentFileEntry[];
  /** Subtitle files found inside the torrent, served from the same loopback origin. */
  subtitleUrls: Array<{ name: string; url: string }>;
  mimeType: string;
}

function extensionOf(name: string): string {
  return path.extname(name).toLowerCase();
}

function isVideoFile(file: { name: string }): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(file.name));
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

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private server: NodeServer | null = null;
  private serverPort = 0;
  private downloadPath: string;
  /** infoHash → the file index currently selected for streaming. */
  private selectedFile = new Map<string, number>();
  private lastError = new Map<string, string>();

  constructor(downloadPath?: string) {
    this.downloadPath =
      downloadPath ?? path.join(os.tmpdir(), 'cloudstream-desktop', 'torrent-cache');
  }

  public setDownloadPath(dir: string): void {
    this.downloadPath = dir;
  }

  // --- lifecycle -----------------------------------------------------------

  private async ensureStarted(): Promise<{ client: WebTorrent; port: number }> {
    if (this.client && !this.client.destroyed && this.server && this.serverPort > 0) {
      return { client: this.client, port: this.serverPort };
    }

    fs.mkdirSync(this.downloadPath, { recursive: true });

    this.client = new WebTorrent({
      maxConns: 100,
      dht: true,
      lsd: true,
      webSeeds: true,
    });

    this.client.on('error', (err) => {
      // Client-level errors are usually per-torrent and non-fatal; a throw here
      // would take down the main process.
      console.error('[torrent] client error:', err instanceof Error ? err.message : err);
    });

    this.server = this.client.createServer({ pathname: '/webtorrent' }, 'node');

    this.serverPort = await new Promise<number>((resolve, reject) => {
      const wrapper = this.server;
      if (!wrapper) return reject(new Error('Failed to create torrent server'));

      // Error events live on the wrapped http.Server, not the wrapper.
      wrapper.server.once('error', reject);

      // Port 0 = let the OS assign, matching Android's ephemeral-port approach.
      // Bind to loopback only: this server exposes file contents and must never
      // be reachable from the network.
      wrapper.listen(0, '127.0.0.1', () => {
        const address = wrapper.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Torrent server did not report a port'));
      });
    });

    return { client: this.client, port: this.serverPort };
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
    const videos = torrent.files.filter(isVideoFile);
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];

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
    }

    // No episode requested, or nothing matched: the largest video file is the
    // feature rather than a sample/extra.
    return videos.reduce((a, b) => (b.length > a.length ? b : a));
  }

  /**
   * Restricts download to the chosen file. Without this the client spreads
   * bandwidth across every file in a pack and nothing becomes playable quickly.
   */
  private focusOn(torrent: Torrent, target: TorrentFile): void {
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
  }

  private fileUrl(port: number, infoHash: string, file: TorrentFile): string {
    // The server routes /webtorrent/<infoHash>/<file path within torrent>.
    const encoded = file.path.split(/[/\\]/).map(encodeURIComponent).join('/');
    return `http://127.0.0.1:${port}/webtorrent/${infoHash}/${encoded}`;
  }

  // --- streaming -----------------------------------------------------------

  public async startStream(request: StreamRequest): Promise<StreamHandle> {
    const { client, port } = await this.ensureStarted();

    const torrent = await this.addTorrent(client, request.torrentId);
    const file = this.pickFile(torrent, request);

    if (!file) {
      throw new Error('This torrent contains no playable video file.');
    }

    this.focusOn(torrent, file);
    this.selectedFile.set(torrent.infoHash, torrent.files.indexOf(file));

    const subtitleUrls = torrent.files
      .filter((f) => SUBTITLE_EXTENSIONS.has(extensionOf(f.name)))
      .map((f) => ({ name: f.name, url: this.fileUrl(port, torrent.infoHash, f) }));

    return {
      infoHash: torrent.infoHash,
      streamUrl: this.fileUrl(port, torrent.infoHash, file),
      fileName: file.name,
      fileSize: file.length,
      files: this.describeFiles(torrent),
      subtitleUrls,
      mimeType: mimeForExtension(extensionOf(file.name)),
    };
  }

  /**
   * Adds a torrent and resolves once metadata is available.
   * Reuses an existing torrent when the same infohash is already active, which
   * makes re-entering a title instant instead of re-bootstrapping the swarm.
   */
  private async addTorrent(client: WebTorrent, torrentId: string): Promise<Torrent> {
    const existingHash = this.extractInfoHash(torrentId);
    if (existingHash) {
      const existing = await Promise.resolve(client.get(existingHash));
      if (existing && existing.ready) return existing;
    }

    return new Promise<Torrent>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            'Timed out fetching torrent metadata. The swarm may be dead or unreachable — try a source with more seeders.'
          )
        );
      }, METADATA_TIMEOUT_MS);

      const finish = (error: Error | null, torrent?: Torrent) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (torrent) resolve(torrent);
      };

      let torrent: Torrent;
      try {
        torrent = client.add(
          torrentId,
          {
            path: this.downloadPath,
            strategy: 'sequential',
            announce: [...DEFAULT_TRACKERS],
          },
          (added) => finish(null, added)
        );
      } catch (error) {
        return finish(error instanceof Error ? error : new Error(String(error)));
      }

      torrent.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError.set(torrent.infoHash, message);
        finish(new Error(message));
      });

      if (torrent.ready) finish(null, torrent);
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

    // `file.offset` is not in our type surface; derive the start offset from the
    // preceding files, which is how webtorrent lays them out.
    let offset = 0;
    for (const candidate of torrent.files) {
      if (candidate === file) break;
      offset += candidate.length;
    }

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
      error: this.lastError.get(infoHash),
    };
  }

  public async selectFile(infoHash: string, fileIndex: number): Promise<StreamHandle | null> {
    if (!this.client) return null;

    const torrent = await Promise.resolve(this.client.get(infoHash));
    if (!torrent) return null;

    const file = torrent.files[fileIndex];
    if (!file || !isVideoFile(file)) return null;

    this.focusOn(torrent, file);
    this.selectedFile.set(infoHash, fileIndex);

    return {
      infoHash,
      streamUrl: this.fileUrl(this.serverPort, infoHash, file),
      fileName: file.name,
      fileSize: file.length,
      files: this.describeFiles(torrent),
      subtitleUrls: torrent.files
        .filter((f) => SUBTITLE_EXTENSIONS.has(extensionOf(f.name)))
        .map((f) => ({ name: f.name, url: this.fileUrl(this.serverPort, infoHash, f) })),
      mimeType: mimeForExtension(extensionOf(file.name)),
    };
  }

  public async pause(infoHash: string): Promise<void> {
    const torrent = this.client ? await Promise.resolve(this.client.get(infoHash)) : null;
    torrent?.pause();
  }

  public async resume(infoHash: string): Promise<void> {
    const torrent = this.client ? await Promise.resolve(this.client.get(infoHash)) : null;
    torrent?.resume();
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
    const client = this.client;
    const server = this.server;
    this.client = null;
    this.server = null;
    this.serverPort = 0;
    this.selectedFile.clear();

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

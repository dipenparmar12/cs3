import fs from 'fs';
import path from 'path';

import { JsonFileStore } from '../util/jsonFileStore.ts';
import { TorrentMetadataCache } from './torrentMetadata.ts';
import { decodeTorrentFile, parseMagnet, type TorrentFileInfo } from './torrentFile.ts';
import { readTorrentContents, type TorrentContents } from './torrentContents.ts';

/**
 * Opening a `.torrent` or a magnet as *content*, rather than as a download.
 *
 * A torrent client answers "how fast is this downloading". This has to answer
 * "what is in here, and which one do I want" — so the whole flow is arranged
 * around never fetching a byte of payload before the viewer has chosen.
 *
 * ## An imported `.torrent` is written into the metadata cache
 *
 * That is the load-bearing integration and it is nearly free. `TorrentEngine`
 * already looks in `TorrentMetadataCache` before going to the swarm, and a
 * `.torrent` handed to `add()` carries the file list, the piece length and every
 * piece hash *synchronously* — so the swarm is needed only for bytes. Importing
 * a file therefore does more than open a page: it turns the first Play on that
 * torrent from a 5–30 second BEP-9 metadata fetch into an immediate one.
 *
 * The cache verifies bytes against the infohash they are filed under, so this
 * cannot poison it.
 *
 * ## A magnet is not resolved on import
 *
 * A `.torrent` is self-describing; a magnet is a promise that someone in the
 * swarm has the metadata. Resolving one means joining the swarm and waiting,
 * which is exactly the wait this feature exists to avoid — and it fails, on a
 * dead swarm, after a long silence.
 *
 * So a magnet import records what the URI itself states (hash, display name,
 * trackers) and reports `pending`. The page opens immediately with the name,
 * and the metadata arrives — or does not — through the engine, which already
 * owns swarm timeouts, the dead-swarm bail and the `xs` mirror race. Building a
 * second resolver beside that one would mean a second set of timeouts to keep
 * correct.
 *
 * ## Identity is the infohash, everywhere
 *
 * Re-importing the same torrent reopens the page it already has. Not merely a
 * convenience: the infohash is what the library, the download queue and the
 * engine all key on, so two records for one torrent would be two library
 * entries, two progress rows and two swarms for one film.
 */

/** How an import got here, which is worth keeping — the two behave differently. */
export type TorrentImportOrigin = 'file' | 'magnet';

export interface TorrentImportRecord {
  infoHash: string;
  name: string;
  origin: TorrentImportOrigin;
  importedAt: number;
  lastOpenedAt: number;
  /** Absent for a magnet whose metadata has not arrived yet. */
  totalSize?: number;
  fileCount?: number;
  /** The magnet URI or the original file path, for re-resolving. */
  source?: string;
  trackers?: string[];
  /** False while a magnet is still only a promise. */
  resolved: boolean;
}

export interface TorrentImportResult {
  ok: boolean;
  infoHash?: string;
  /** True when the metadata is already here and the page can render contents. */
  resolved?: boolean;
  /** Already imported — the caller should reopen rather than re-add. */
  duplicate?: boolean;
  error?: string;
}

interface StoredImports {
  version: 1;
  records: TorrentImportRecord[];
}

/** Enough for a browsing history; the metadata cache is bounded separately. */
const MAX_RECORDS = 200;

export class TorrentImportService {
  private metadata: TorrentMetadataCache;
  private store: JsonFileStore<StoredImports>;
  private records = new Map<string, TorrentImportRecord>();
  /**
   * Decoded torrents, in memory only.
   *
   * The `.torrent` bytes are the durable artefact and they are already cached
   * on disk by infohash; this is a parse of them. Persisting the parse as well
   * would add a second thing to invalidate whenever the classifier changes —
   * and re-decoding is microseconds.
   */
  private parsed = new Map<string, TorrentFileInfo>();

  constructor(metadata: TorrentMetadataCache, dataDir: string) {
    this.metadata = metadata;
    this.store = new JsonFileStore<StoredImports>(
      path.join(dataDir, 'torrent-imports.json'),
      500,
      () => ({ version: 1, records: [...this.records.values()] })
    );

    const loaded = this.store.load();
    for (const record of loaded?.records ?? []) {
      if (record?.infoHash) this.records.set(record.infoHash, record);
    }
  }

  /** Reads a `.torrent` from disk and files it under its own infohash. */
  public importFile(filePath: string): TorrentImportResult {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(filePath);
    } catch (error) {
      return {
        ok: false,
        error: `That file could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    return this.importBytes(bytes, filePath);
  }

  /**
   * The same, from bytes already in hand — a drop, or a download.
   *
   * `source` is kept for the report only. The bytes are the artefact and they
   * are cached content-addressed, so the original path may be gone tomorrow
   * without the import breaking.
   */
  public importBytes(bytes: Uint8Array, source?: string): TorrentImportResult {
    const info = decodeTorrentFile(bytes);
    if (!info) {
      return {
        ok: false,
        error: 'That is not a readable .torrent file.',
      };
    }

    // Before the record, so a Play that races the page open already finds it.
    this.metadata.write(info.infoHash, bytes);
    this.parsed.set(info.infoHash, info);

    const existing = this.records.get(info.infoHash);
    this.remember({
      infoHash: info.infoHash,
      name: info.name,
      origin: 'file',
      importedAt: existing?.importedAt ?? Date.now(),
      lastOpenedAt: Date.now(),
      totalSize: info.totalSize,
      fileCount: info.files.length,
      source: source ?? existing?.source,
      trackers: info.trackers,
      resolved: true,
    });

    return { ok: true, infoHash: info.infoHash, resolved: true, duplicate: Boolean(existing) };
  }

  /**
   * Records a magnet without joining its swarm.
   *
   * Answers `resolved: true` when the `.torrent` is already cached — which is
   * the common case for anything opened before — so the page renders its
   * contents with no network at all.
   */
  public importMagnet(uri: string): TorrentImportResult {
    const magnet = parseMagnet(uri);
    if (!magnet) {
      return {
        ok: false,
        error:
          'That is not a magnet link this app can open. Only BitTorrent v1 magnets ' +
          '(`xt=urn:btih:`) are supported.',
      };
    }

    const cached = this.load(magnet.infoHash);
    const existing = this.records.get(magnet.infoHash);

    this.remember({
      infoHash: magnet.infoHash,
      // A cached torrent's own name beats the magnet's display name: `dn` is
      // whoever built the link's description of it, and the torrent's `name` is
      // what the files are actually under.
      name: cached?.name ?? magnet.name ?? existing?.name ?? magnet.infoHash,
      origin: 'magnet',
      importedAt: existing?.importedAt ?? Date.now(),
      lastOpenedAt: Date.now(),
      totalSize: cached?.totalSize ?? existing?.totalSize,
      fileCount: cached?.files.length ?? existing?.fileCount,
      source: uri,
      trackers: magnet.trackers.length > 0 ? magnet.trackers : existing?.trackers,
      resolved: Boolean(cached),
    });

    return {
      ok: true,
      infoHash: magnet.infoHash,
      resolved: Boolean(cached),
      duplicate: Boolean(existing),
    };
  }

  /**
   * The decoded torrent, from memory or from the on-disk cache.
   *
   * Null means the metadata is genuinely not here yet, which for a magnet is an
   * ordinary state rather than a failure — the page says "resolving" and the
   * engine is what resolves it.
   */
  public load(infoHash: string): TorrentFileInfo | null {
    const held = this.parsed.get(infoHash);
    if (held) return held;

    const bytes = this.metadata.read(infoHash);
    if (!bytes) return null;

    const info = decodeTorrentFile(bytes);
    if (!info) return null;
    this.parsed.set(infoHash, info);

    /*
     * A magnet whose metadata has arrived since it was imported.
     *
     * `TorrentEngine` already writes every resolved `.torrent` into this same
     * cache, so noticing here is the whole handshake — an explicit "tell the
     * import service" call from the engine would be a second path to the same
     * fact, and the kind that gets forgotten on one of its call sites.
     */
    const record = this.records.get(infoHash);
    if (record && !record.resolved) {
      this.remember({
        ...record,
        name: info.name,
        totalSize: info.totalSize,
        fileCount: info.files.length,
        trackers: info.trackers.length > 0 ? info.trackers : record.trackers,
        resolved: true,
      });
    }
    return info;
  }

  /** What is in the torrent, browsable. Null while metadata is still absent. */
  public contents(infoHash: string): TorrentContents | null {
    const info = this.load(infoHash);
    return info ? readTorrentContents(info) : null;
  }

  public get(infoHash: string): TorrentImportRecord | null {
    return this.records.get(infoHash) ?? null;
  }

  /** Most recently opened first — the order a "recent torrents" list wants. */
  public list(): TorrentImportRecord[] {
    return [...this.records.values()].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  public touch(infoHash: string): void {
    const record = this.records.get(infoHash);
    if (!record) return;
    this.remember({ ...record, lastOpenedAt: Date.now() });
  }

  /**
   * Forgets an import.
   *
   * The cached `.torrent` is deliberately left alone. It is content-addressed,
   * small, swept on its own schedule, and keeping it means re-adding the same
   * magnet later still starts warm — removing a row from a list is not a
   * request to make the next open slower.
   */
  public remove(infoHash: string): boolean {
    const existed = this.records.delete(infoHash);
    this.parsed.delete(infoHash);
    if (existed) this.store.schedule();
    return existed;
  }

  public shutdown(): void {
    this.store.flush();
  }

  private remember(record: TorrentImportRecord): void {
    this.records.set(record.infoHash, record);

    if (this.records.size > MAX_RECORDS) {
      const oldest = [...this.records.values()].sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);
      for (const stale of oldest.slice(0, this.records.size - MAX_RECORDS)) {
        this.records.delete(stale.infoHash);
        this.parsed.delete(stale.infoHash);
      }
    }
    this.store.schedule();
  }
}

/**
 * What a dropped or opened path is, before anything is read.
 *
 * Extension only, and deliberately: this decides which *handler* runs, and the
 * handlers themselves verify. `importBytes` refuses anything that does not
 * decode, and the media path probes rather than trusting a name — so a
 * mislabelled file gets a real answer from the code that can give one, instead
 * of being rejected here on the strength of its name.
 */
export function classifyDroppedPath(filePath: string): 'torrent' | 'media' {
  return path.extname(filePath).toLowerCase() === '.torrent' ? 'torrent' : 'media';
}

/** Whether a pasted string is a magnet this app can open. */
export function looksLikeMagnet(text: string): boolean {
  return parseMagnet(text) !== null;
}

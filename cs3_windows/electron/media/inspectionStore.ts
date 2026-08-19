import type { DatastoreManager } from '../datastore';
import type { DrmConfiguration, MediaMetadata, MediaTransport } from '../../src/types/media';

/**
 * Remembers what is *inside* a stream, so opening it again does not re-measure it.
 *
 * The distinction that makes this safe is between a **measurement** and a
 * **verdict**. What ffprobe reports — container, codecs, bit depth, resolution,
 * the track list — is a fact about the file, and files do not change. Which
 * strategy that implies is a function of the measurement *and* this machine:
 * the renderer's decoders, whether a GPU encoder exists, whether mpv is
 * installed, which routing policy is set. All four of those move.
 *
 * So only the measurement is stored, and `decideStrategy` runs again on every
 * play. Caching the verdict instead would be the classic stale-cache bug in its
 * most expensive form: install mpv, and every previously-played title keeps
 * being re-encoded because a record from last week says so.
 *
 * What this buys is the probe itself, which is the slow part. Measured against
 * real provider streams in `native-engine-matrix.mjs`: 1.6–1.7 seconds per
 * source, on a remote file, before a single frame can be attached. That is paid
 * once per link now rather than once per play.
 */

const KEY = 'media_inspection_v1';

/**
 * Thirty days, and the number is about the *link*, not the file.
 *
 * A file's codecs never change, so the measurement never goes stale on its own.
 * What ages is the assumption that this URL still addresses that file — hosts
 * re-use paths, and a provider can repoint one at a different encode. A month
 * is long enough that a rewatched series is free and short enough that a
 * repointed URL corrects itself without anyone having to know why.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bounded like every other cache here; this one holds a few KB per entry. */
const MAX_ENTRIES = 400;

interface StoredInspection {
  /** The provider's URL, before proxying. See {@link InspectionStore.keyFor}. */
  key: string;
  metadata: MediaMetadata;
  transport: MediaTransport;
  drm: DrmConfiguration;
  at: number;
  lastUsedAt: number;
}

export class InspectionStore {
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  /**
   * The origin URL, in full.
   *
   * Deliberately **not** normalised by stripping the query. Signed links carry
   * their credentials there, so dropping it would make every expiring URL from
   * one host collapse onto one key — and two different films behind the same
   * path template would then be served each other's codec list, which surfaces
   * as a stream that plays with the wrong audio or refuses to decode at all.
   * A signed URL simply misses and is re-probed; that is the correct trade.
   *
   * The proxied loopback address is never a key: its port and token are
   * assigned per session, so it would miss on every restart while looking like
   * it should hit.
   */
  private static keyFor(originUrl: string): string {
    return originUrl;
  }

  private load(): StoredInspection[] {
    const stored = this.datastore.getObject<StoredInspection[]>(KEY, []);
    return Array.isArray(stored) ? stored : [];
  }

  private save(entries: StoredInspection[]): void {
    const now = Date.now();
    const live = entries.filter((entry) => now - entry.at < TTL_MS);
    const pruned =
      live.length > MAX_ENTRIES
        ? [...live].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ENTRIES)
        : live;
    this.datastore.setObject(KEY, pruned);
  }

  public read(
    originUrl: string
  ): { metadata: MediaMetadata; transport: MediaTransport; drm: DrmConfiguration } | null {
    const key = InspectionStore.keyFor(originUrl);
    const entries = this.load();
    const entry = entries.find((candidate) => candidate.key === key);
    if (!entry) return null;
    if (Date.now() - entry.at >= TTL_MS) return null;

    entry.lastUsedAt = Date.now();
    this.save(entries);
    return { metadata: entry.metadata, transport: entry.transport, drm: entry.drm };
  }

  public write(
    originUrl: string,
    metadata: MediaMetadata,
    transport: MediaTransport,
    drm: DrmConfiguration
  ): void {
    /**
     * Only a successful measurement is stored. A failed probe says nothing
     * about the file — it says the link was refused, timed out, or expired —
     * and remembering that for a month would keep a working source unplayable
     * long after the host recovered.
     */
    if (!metadata) return;

    const key = InspectionStore.keyFor(originUrl);
    const now = Date.now();
    const entries = this.load().filter((entry) => entry.key !== key);
    entries.push({ key, metadata, transport, drm, at: now, lastUsedAt: now });
    this.save(entries);
  }

  /** Drops one entry, for a link that turned out not to be what it claimed. */
  public invalidate(originUrl: string): void {
    const key = InspectionStore.keyFor(originUrl);
    this.save(this.load().filter((entry) => entry.key !== key));
  }

  public clear(): void {
    this.datastore.setObject(KEY, []);
  }

  public stats(): { entries: number } {
    return { entries: this.load().length };
  }
}

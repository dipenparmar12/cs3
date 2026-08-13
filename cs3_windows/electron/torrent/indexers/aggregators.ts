import { fetchJson, postJson } from '../http';
import { buildMagnet, parseIntSafe, parseSize, type RawTorrent, type TorrentIndexer } from './base';
import type { IndexerConfig, IndexerQuery } from '../../../src/types/torrent';

/**
 * Aggregator indexers — the ones that actually work behind ISP DNS blocks.
 *
 * Individual torrent sites (YTS, Nyaa, EZTV, 1337x) are widely DNS-blocked and
 * rotate domains constantly. The adapters here are not:
 *
 *  - **Stremio addons** (Torrentio, MediaFusion, Jackettio…) query dozens of
 *    indexers server-side and answer on a single Cloudflare-fronted host, keyed
 *    by IMDb id. They also return `fileIdx`, telling us exactly which file in a
 *    season pack to play — which almost no other source provides.
 *  - **Knaben** is a metasearch index over ~40 trackers with a plain JSON API
 *    and free-text search, so it covers the queries an IMDb-keyed addon cannot.
 *  - **apibay** is The Pirate Bay's own JSON API and also takes free text.
 *  - **Torrents-CSV** is a static, community-maintained dataset served from one
 *    host; it has no scraping to break and answers in milliseconds.
 *
 * Between them they cover both query shapes, which is why they are the defaults.
 */

// ---------------------------------------------------------------------------
// Stremio addon protocol (Torrentio, MediaFusion, Jackettio, Comet, …)
// ---------------------------------------------------------------------------

interface StremioStream {
  name?: string;
  title?: string;
  description?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: { filename?: string; bingeGroup?: string };
}

interface StremioResponse {
  streams?: StremioStream[];
}

/**
 * Stremio addons encode their metadata in the `title` string, one field per line:
 *
 *   Movie:  `<release name>\n👤 433 💾 29.26 GB ⚙️ TorrentGalaxy`
 *   Series: `<pack name>\n<file name>.mkv\n👤 84 💾 5.19 GB ⚙️ ThePirateBay`
 *
 * The stats line is always last; a middle line, when present, names the exact
 * file — which is what we want to parse for season/episode, not the pack name.
 * Emoji vary between addons (MediaFusion uses 🌱 for seeders, 📦 for size), so
 * every known marker is accepted.
 */
function parseStremioTitle(title: string): {
  releaseName: string;
  fileName?: string;
  seeders: number;
  sizeBytes: number;
  source?: string;
} {
  const lines = title.split('\n').map((l) => l.trim()).filter(Boolean);
  const statsLine = lines.find((l) => /👤|💾|⚙️|🌱|📦|🔗/.test(l)) ?? '';
  const contentLines = lines.filter((l) => l !== statsLine);

  const seeders = parseIntSafe(
    statsLine.match(/(?:👤|🌱)\s*([\d,]+)/)?.[1]?.replace(/,/g, '')
  );
  const sizeBytes = parseSize(
    statsLine.match(/(?:💾|📦)\s*([\d.,]+\s*[KMGT]i?B)/i)?.[1]
  );
  const source = statsLine.match(/⚙️\s*(.+?)\s*$/)?.[1];

  return {
    releaseName: contentLines[0] ?? title,
    // A second content line is the specific file inside a multi-file torrent.
    fileName: contentLines.length > 1 ? contentLines[contentLines.length - 1] : undefined,
    seeders,
    sizeBytes,
    source,
  };
}

/**
 * Generic client for any Stremio stream addon.
 *
 * The protocol is a single documented GET — `/stream/{type}/{id}.json` — so one
 * adapter reaches every addon in the ecosystem. That matters because the useful
 * ones differ mainly in which trackers they aggregate and whether they front a
 * debrid account, and a user who has a working addon URL should be able to paste
 * it rather than wait for a per-addon adapter to be written here.
 */
export class StremioAddonIndexer implements TorrentIndexer {
  readonly id: string;
  readonly name: string;
  readonly specialises = 'any' as const;

  private readonly mirrors: readonly string[];

  constructor(id: string, name: string, mirrors: readonly string[]) {
    this.id = id;
    this.name = name;
    this.mirrors = mirrors.map(StremioAddonIndexer.normaliseBase);
  }

  /** Accepts a manifest URL, since that is what addon sites hand out. */
  static normaliseBase(url: string): string {
    return url.trim().replace(/\/+$/, '').replace(/\/manifest\.json$/i, '');
  }

  static fromConfig(config: IndexerConfig): StremioAddonIndexer | null {
    if (!config.baseUrl) return null;
    return new StremioAddonIndexer(config.id, config.name, [config.baseUrl]);
  }

  canHandle(query: IndexerQuery): boolean {
    // Stremio addons are addressed purely by IMDb id; free text is not supported.
    return Boolean(query.imdbId) && this.mirrors.length > 0;
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const imdb = query.imdbId?.startsWith('tt') ? query.imdbId : `tt${query.imdbId}`;

    // Series are addressed as `tt123:season:episode`; movies by bare id.
    const isEpisodic = query.season !== undefined && query.episode !== undefined;
    const routePath = isEpisodic
      ? `series/${imdb}:${query.season}:${query.episode}`
      : `movie/${imdb}`;

    let lastError: unknown = new Error(`No ${this.name} mirror responded`);

    for (const base of this.mirrors) {
      try {
        const response = await fetchJson<StremioResponse>(
          `${base}/stream/${routePath}.json`,
          { signal, timeoutMs: 25_000 }
        );

        return (response.streams ?? [])
          .filter((stream): stream is StremioStream => Boolean(stream?.infoHash))
          .map<RawTorrent>((stream) => {
            const meta = parseStremioTitle(
              stream.title ?? stream.description ?? stream.name ?? ''
            );
            const fileName = stream.behaviorHints?.filename ?? meta.fileName;
            const infoHash = (stream.infoHash as string).toLowerCase();

            return {
              title: meta.releaseName,
              infoHash,
              magnet: buildMagnet(infoHash, meta.releaseName),
              sizeBytes: meta.sizeBytes,
              seeders: meta.seeders,
              leechers: 0,
              fileIndex: stream.fileIdx,
              expectedFileName: fileName,
              category: meta.source,
            };
          });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

export class TorrentioIndexer extends StremioAddonIndexer {
  constructor() {
    super('torrentio', 'Torrentio', [
      'https://torrentio.strem.fun',
      'https://torrentio.deno.dev',
    ]);
  }
}

export class MediaFusionIndexer extends StremioAddonIndexer {
  constructor() {
    super('mediafusion', 'MediaFusion', ['https://mediafusion.elfhosted.com']);
  }
}

// ---------------------------------------------------------------------------
// Knaben — metasearch across ~40 trackers, JSON API, free text
// ---------------------------------------------------------------------------

interface KnabenHit {
  id?: string;
  title?: string;
  hash?: string;
  magnetUrl?: string;
  link?: string;
  peers?: number;
  seeders?: number;
  bytes?: number;
  size?: number | string;
  date?: string;
  tracker?: string;
  category?: string;
  categoryId?: number[] | number;
}

interface KnabenResponse {
  hits?: KnabenHit[];
  total?: number;
}

/**
 * Knaben aggregates roughly forty trackers behind one JSON endpoint and, unlike
 * the Stremio addons, takes free text — so it answers for titles that never got
 * an IMDb id resolved, which is the single most common reason a search came back
 * empty before.
 */
export class KnabenIndexer implements TorrentIndexer {
  readonly id = 'knaben';
  readonly name = 'Knaben';
  readonly specialises = 'any' as const;

  private static readonly ENDPOINT = 'https://api.knaben.org/v1';

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    // Knaben has no structured season/episode filter; fold it into the text.
    const terms = [query.query];
    if (query.season !== undefined && query.episode !== undefined) {
      terms.push(
        `S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`
      );
    } else if (query.season !== undefined) {
      terms.push(`S${String(query.season).padStart(2, '0')}`);
    }

    const response = await postJson<KnabenResponse>(
      KnabenIndexer.ENDPOINT,
      {
        search_type: 'score',
        search_field: 'title',
        query: terms.join(' '),
        order_by: 'seeders',
        order_direction: 'desc',
        from: 0,
        size: Math.min(query.limit ?? 100, 300),
        hide_unsafe: true,
        hide_xxx: true,
      },
      { signal, timeoutMs: 20_000 }
    );

    return (response.hits ?? [])
      .map((hit): RawTorrent | null => {
        const title = String(hit.title ?? '').trim();
        if (!title) return null;

        const infoHash = hit.hash?.toLowerCase();
        const magnet = hit.magnetUrl;
        if (!infoHash && !magnet) return null;

        const published = hit.date ? Date.parse(hit.date) : NaN;

        return {
          title,
          infoHash: infoHash && /^[a-f0-9]{40}$/.test(infoHash) ? infoHash : undefined,
          magnet,
          sizeBytes: parseSize(hit.bytes ?? hit.size),
          seeders: parseIntSafe(hit.seeders),
          // Knaben reports total swarm size as `peers`.
          leechers: Math.max(0, parseIntSafe(hit.peers) - parseIntSafe(hit.seeders)),
          publishedAt: Number.isNaN(published) ? undefined : published,
          category: hit.tracker ?? hit.category,
        };
      })
      .filter((r): r is RawTorrent => r !== null);
  }
}

// ---------------------------------------------------------------------------
// Torrents-CSV — static community dataset, one stable host
// ---------------------------------------------------------------------------

interface TorrentsCsvRow {
  infohash?: string;
  name?: string;
  size_bytes?: number | string;
  created_unix?: number;
  seeders?: number | string;
  leechers?: number | string;
}

interface TorrentsCsvResponse {
  torrents?: TorrentsCsvRow[];
}

/**
 * Torrents-CSV is a flat, versioned dataset rather than a live scraper, which
 * makes it the most predictable source here: it never CAPTCHAs, never rotates
 * domains and never rate-limits. The trade-off is staleness — its seeder counts
 * lag reality — so the ranker's seeder weighting does the rest.
 */
export class TorrentsCsvIndexer implements TorrentIndexer {
  readonly id = 'torrentscsv';
  readonly name = 'Torrents-CSV';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = ['https://torrents-csv.com'] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const terms = [query.query];
    if (query.season !== undefined && query.episode !== undefined) {
      terms.push(
        `S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`
      );
    }

    const size = Math.min(query.limit ?? 50, 100);
    let lastError: unknown = new Error('Torrents-CSV did not respond');

    for (const base of TorrentsCsvIndexer.MIRRORS) {
      try {
        const response = await fetchJson<TorrentsCsvResponse | TorrentsCsvRow[]>(
          `${base}/service/search?q=${encodeURIComponent(terms.join(' '))}&size=${size}`,
          { signal, timeoutMs: 20_000 }
        );

        // The service has returned both a bare array and a `{torrents}` wrapper
        // across versions; accept either rather than break on an upgrade.
        const rows = Array.isArray(response) ? response : (response.torrents ?? []);

        return rows
          .map((row): RawTorrent | null => {
            const infoHash = row.infohash?.toLowerCase();
            const title = String(row.name ?? '').trim();
            if (!title || !infoHash || !/^[a-f0-9]{40}$/.test(infoHash)) return null;

            return {
              title,
              infoHash,
              magnet: buildMagnet(infoHash, title),
              sizeBytes: parseSize(row.size_bytes),
              seeders: parseIntSafe(row.seeders),
              leechers: parseIntSafe(row.leechers),
              publishedAt: row.created_unix ? row.created_unix * 1000 : undefined,
            };
          })
          .filter((r): r is RawTorrent => r !== null);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

// ---------------------------------------------------------------------------
// apibay (The Pirate Bay API)
// ---------------------------------------------------------------------------

interface ApiBayItem {
  id?: string;
  name?: string;
  info_hash?: string;
  seeders?: string;
  leechers?: string;
  size?: string;
  num_files?: string;
  added?: string;
  category?: string;
  imdb?: string;
}

export class ApiBayIndexer implements TorrentIndexer {
  readonly id = 'apibay';
  readonly name = 'The Pirate Bay';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = ['https://apibay.org'] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    // Fold season/episode into the query text; apibay has no structured filter.
    const terms = [query.query];
    if (query.season !== undefined && query.episode !== undefined) {
      terms.push(
        `S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`
      );
    } else if (query.season !== undefined) {
      terms.push(`S${String(query.season).padStart(2, '0')}`);
    }

    let lastError: unknown = new Error('No apibay mirror responded');

    for (const base of ApiBayIndexer.MIRRORS) {
      try {
        const items = await fetchJson<ApiBayItem[]>(
          `${base}/q.php?q=${encodeURIComponent(terms.join(' '))}`,
          { signal, timeoutMs: 20_000 }
        );
        if (!Array.isArray(items)) return [];

        return items
          .filter(
            (item) =>
              item?.name &&
              item.info_hash &&
              // apibay returns a single sentinel row when nothing matched.
              item.info_hash !== '0000000000000000000000000000000000000000'
          )
          .map<RawTorrent>((item) => {
            const infoHash = (item.info_hash as string).toLowerCase();
            const name = item.name as string;
            return {
              title: name,
              infoHash,
              magnet: buildMagnet(infoHash, name),
              sizeBytes: parseSize(item.size),
              seeders: parseIntSafe(item.seeders),
              leechers: parseIntSafe(item.leechers),
              publishedAt: item.added ? parseIntSafe(item.added) * 1000 : undefined,
              category: item.category,
            };
          });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

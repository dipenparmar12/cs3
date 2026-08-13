import { XMLParser } from 'fast-xml-parser';
import { fetchJson, fetchText } from '../http';
import {
  buildMagnet,
  parseIntSafe,
  parseSize,
  type RawTorrent,
  type TorrentIndexer,
} from './base';
import type { IndexerQuery } from '../../../src/types/torrent';

/**
 * Built-in public indexers.
 *
 * Every adapter carries a **mirror list** rather than a single hard-coded host.
 * These sites rotate domains frequently and are DNS-blocked by many ISPs, so a
 * single host is guaranteed to break; `tryMirrors` walks the list and reports a
 * useful error only when every mirror fails. Users behind a block should prefer
 * the Torznab adapter pointed at a local Jackett/Prowlarr instance, which can
 * carry its own proxy and FlareSolverr configuration.
 */

async function tryMirrors<T>(
  mirrors: readonly string[],
  attempt: (base: string) => Promise<T>
): Promise<T> {
  let lastError: unknown = new Error('No mirrors configured');

  for (const base of mirrors) {
    try {
      return await attempt(base);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// ---------------------------------------------------------------------------
// YTS — movies only, public JSON API
// ---------------------------------------------------------------------------

interface YtsTorrent {
  hash?: string;
  quality?: string;
  type?: string;
  size_bytes?: number;
  seeds?: number;
  peers?: number;
  video_codec?: string;
  date_uploaded_unix?: number;
}

interface YtsMovie {
  title?: string;
  title_long?: string;
  year?: number;
  torrents?: YtsTorrent[];
}

interface YtsResponse {
  data?: { movies?: YtsMovie[] };
}

export class YtsIndexer implements TorrentIndexer {
  readonly id = 'yts';
  readonly name = 'YTS';
  readonly specialises = 'movie' as const;

  private static readonly MIRRORS = [
    'https://yts.mx',
    'https://yts.rs',
    'https://yts.lt',
    'https://yts.am',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    // YTS carries no series content; skip it for episode-scoped queries.
    return query.season === undefined && query.episode === undefined;
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const limit = Math.min(query.limit ?? 30, 50);

    return tryMirrors(YtsIndexer.MIRRORS, async (base) => {
      const url =
        `${base}/api/v2/list_movies.json` +
        `?query_term=${encodeURIComponent(query.query)}` +
        `&limit=${limit}&sort_by=seeds&order_by=desc`;

      const response = await fetchJson<YtsResponse>(url, { signal });
      const movies = response.data?.movies ?? [];
      const out: RawTorrent[] = [];

      for (const movie of movies) {
        const baseTitle = movie.title_long || movie.title;
        if (!baseTitle) continue;

        for (const torrent of movie.torrents ?? []) {
          if (!torrent.hash) continue;

          // YTS exposes quality as structured fields rather than a release name,
          // so synthesise one the release parser can read.
          const parts = [
            baseTitle,
            torrent.quality,
            torrent.type?.toUpperCase(),
            torrent.video_codec,
            'YTS',
          ].filter(Boolean);
          const title = parts.join(' ');

          out.push({
            title,
            infoHash: torrent.hash.toLowerCase(),
            magnet: buildMagnet(torrent.hash, title),
            sizeBytes: torrent.size_bytes ?? 0,
            seeders: torrent.seeds ?? 0,
            leechers: torrent.peers ?? 0,
            publishedAt: torrent.date_uploaded_unix
              ? torrent.date_uploaded_unix * 1000
              : undefined,
            category: 'Movies',
          });
        }
      }
      return out;
    });
  }
}

// ---------------------------------------------------------------------------
// EZTV — TV only; the API is keyed on IMDb id
// ---------------------------------------------------------------------------

interface EztvTorrent {
  title?: string;
  hash?: string;
  magnet_url?: string;
  torrent_url?: string;
  size_bytes?: string | number;
  seeds?: number;
  peers?: number;
  date_released_unix?: number;
}

interface EztvResponse {
  torrents?: EztvTorrent[];
}

export class EztvIndexer implements TorrentIndexer {
  readonly id = 'eztv';
  readonly name = 'EZTV';
  readonly specialises = 'tv' as const;

  private static readonly MIRRORS = [
    'https://eztvx.to',
    'https://eztv.re',
    'https://eztv.wf',
    'https://eztv.tf',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    // The EZTV API only supports IMDb-id lookup — there is no free-text search.
    return Boolean(query.imdbId);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const imdb = (query.imdbId ?? '').replace(/^tt/i, '');
    if (!imdb) return [];

    const limit = Math.min(query.limit ?? 50, 100);

    return tryMirrors(EztvIndexer.MIRRORS, async (base) => {
      const url = `${base}/api/get-torrents?imdb_id=${encodeURIComponent(imdb)}&limit=${limit}`;
      const response = await fetchJson<EztvResponse>(url, { signal });

      return (response.torrents ?? [])
        .filter((t: EztvTorrent) => t.title && (t.hash || t.magnet_url))
        .map<RawTorrent>((t: EztvTorrent) => ({
          title: t.title as string,
          infoHash: t.hash?.toLowerCase(),
          magnet: t.magnet_url,
          torrentUrl: t.torrent_url,
          sizeBytes: parseSize(t.size_bytes),
          seeders: parseIntSafe(t.seeds),
          leechers: parseIntSafe(t.peers),
          publishedAt: t.date_released_unix ? t.date_released_unix * 1000 : undefined,
          category: 'TV',
        }));
    });
  }
}

// ---------------------------------------------------------------------------
// Nyaa — anime, RSS only
// ---------------------------------------------------------------------------

/**
 * AnimeTosho — anime, JSON API mirroring Nyaa/AniDex with richer metadata.
 *
 * Worth having alongside Nyaa for two reasons: it answers on a single stable
 * host rather than a rotating one, and it exposes `num_files`, which lets the
 * ranker tell a batch release apart from a single episode without guessing from
 * the title.
 */
interface AnimeToshoItem {
  id?: number;
  title?: string;
  torrent_name?: string;
  info_hash?: string;
  magnet_uri?: string;
  torrent_url?: string;
  seeders?: number;
  leechers?: number;
  total_size?: number;
  timestamp?: number;
  num_files?: number;
}

export class AnimeToshoIndexer implements TorrentIndexer {
  readonly id = 'animetosho';
  readonly name = 'AnimeTosho';
  readonly specialises = 'anime' as const;

  private static readonly MIRRORS = ['https://feed.animetosho.org'] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    // Anime is numbered absolutely far more often than by season, so the plain
    // zero-padded episode number matches more releases than S01E05 would.
    const terms = [query.query];
    if (query.episode !== undefined) terms.push(String(query.episode).padStart(2, '0'));

    return tryMirrors(AnimeToshoIndexer.MIRRORS, async (base) => {
      const url =
        `${base}/json?q=${encodeURIComponent(terms.join(' '))}` +
        `&only_tor=1&limit=${Math.min(query.limit ?? 50, 100)}`;
      const items = await fetchJson<AnimeToshoItem[]>(url, { signal, timeoutMs: 20_000 });
      if (!Array.isArray(items)) return [];

      return items
        .map((item): RawTorrent | null => {
          const title = String(item.torrent_name ?? item.title ?? '').trim();
          const infoHash = item.info_hash?.toLowerCase();
          if (!title) return null;
          if (!item.magnet_uri && !(infoHash && /^[a-f0-9]{40}$/.test(infoHash))) return null;

          return {
            title,
            infoHash: infoHash && /^[a-f0-9]{40}$/.test(infoHash) ? infoHash : undefined,
            magnet: item.magnet_uri,
            torrentUrl: item.torrent_url,
            sizeBytes: parseSize(item.total_size),
            seeders: parseIntSafe(item.seeders),
            leechers: parseIntSafe(item.leechers),
            publishedAt: item.timestamp ? item.timestamp * 1000 : undefined,
            category: 'Anime',
          };
        })
        .filter((r): r is RawTorrent => r !== null);
    });
  }
}

export class NyaaIndexer implements TorrentIndexer {
  readonly id = 'nyaa';
  readonly name = 'Nyaa';
  readonly specialises = 'anime' as const;

  private static readonly MIRRORS = ['https://nyaa.si', 'https://nyaa.iss.one'] as const;

  canHandle(): boolean {
    return true;
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    // Build a query that includes the episode number when one was requested;
    // Nyaa has no structured season/episode filter.
    const terms = [query.query];
    if (query.episode !== undefined) {
      terms.push(String(query.episode).padStart(2, '0'));
    }
    const search = encodeURIComponent(terms.join(' '));

    return tryMirrors(NyaaIndexer.MIRRORS, async (base) => {
      // c=1_2 restricts to "Anime - English-translated".
      const url = `${base}/?page=rss&q=${search}&c=1_2&f=0`;
      const body = await fetchText(url, { signal });
      const doc = xml.parse(body);
      const items = asArray<Record<string, unknown>>(doc?.rss?.channel?.item);

      return items
        .map((item): RawTorrent | null => {
          const title = String(item.title ?? '').trim();
          const infoHash = String(item['nyaa:infoHash'] ?? '').toLowerCase();
          if (!title || !/^[a-f0-9]{40}$/.test(infoHash)) return null;

          const pubDate = String(item.pubDate ?? '');
          const parsedDate = pubDate ? Date.parse(pubDate) : NaN;

          return {
            title,
            infoHash,
            magnet: buildMagnet(infoHash, title),
            torrentUrl: typeof item.link === 'string' ? item.link : undefined,
            sizeBytes: parseSize(String(item['nyaa:size'] ?? '')),
            seeders: parseIntSafe(item['nyaa:seeders']),
            leechers: parseIntSafe(item['nyaa:leechers']),
            publishedAt: Number.isNaN(parsedDate) ? undefined : parsedDate,
            category: String(item['nyaa:category'] ?? 'Anime'),
          };
        })
        .filter((r): r is RawTorrent => r !== null);
    });
  }
}

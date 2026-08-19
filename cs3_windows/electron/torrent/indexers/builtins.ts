import { XMLParser } from 'fast-xml-parser';
import { fetchJson, fetchText } from '../http';
import {
  buildMagnet,
  infoHashFromMagnet,
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
    'https://yts.do',
    'https://yts.nz',
    'https://yts.torrentbay.to',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    // YTS carries no series content; skip it for episode-scoped queries.
    return query.season === undefined && query.episode === undefined;
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const limit = Math.min(query.limit ?? 30, 50);

    return tryMirrors(YtsIndexer.MIRRORS, async (base) => {
      let movies: YtsMovie[] = [];

      // If an IMDb id is provided, query by IMDb id first for exact matching
      if (query.imdbId) {
        try {
          const imdb = query.imdbId.startsWith('tt') ? query.imdbId : `tt${query.imdbId}`;
          const url =
            `${base}/api/v2/list_movies.json` +
            `?query_term=${encodeURIComponent(imdb)}` +
            `&limit=${limit}&sort_by=seeds&order_by=desc`;
          const response = await fetchJson<YtsResponse>(url, { signal, timeoutMs: 12_000 });
          movies = response.data?.movies ?? [];
        } catch {
          // Fallback to text query below
        }
      }

      if (movies.length === 0 && query.query) {
        const url =
          `${base}/api/v2/list_movies.json` +
          `?query_term=${encodeURIComponent(query.query)}` +
          `&limit=${limit}&sort_by=seeds&order_by=desc`;

        const response = await fetchJson<YtsResponse>(url, { signal, timeoutMs: 20_000 });
        movies = response.data?.movies ?? [];
      }

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
// EZTV — TV only; queries by IMDb id or query text with multi-mirror fallback
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
    'https://eztv.li',
    'https://eztv.yt',
    'https://eztv.unblockit.click',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.imdbId || query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const imdb = (query.imdbId ?? '').replace(/^tt/i, '');
    const limit = Math.min(query.limit ?? 50, 100);

    const terms = [query.query];
    if (query.season !== undefined && query.episode !== undefined) {
      terms.push(
        `S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`
      );
    } else if (query.season !== undefined) {
      terms.push(`S${String(query.season).padStart(2, '0')}`);
    }

    return tryMirrors(EztvIndexer.MIRRORS, async (base) => {
      let torrents: EztvTorrent[] = [];

      if (imdb) {
        try {
          const url = `${base}/api/get-torrents?imdb_id=${encodeURIComponent(imdb)}&limit=${limit}`;
          const response = await fetchJson<EztvResponse>(url, { signal, timeoutMs: 12_000 });
          torrents = response.torrents ?? [];
        } catch {
          // Fallback to text query below
        }
      }

      // If no torrents found via IMDb or no IMDb id, attempt EZTV ezrss search
      if (torrents.length === 0 && terms.join(' ').trim()) {
        try {
          const rssUrl = `${base}/ezrss.xml?search=${encodeURIComponent(terms.join(' '))}`;
          const body = await fetchText(rssUrl, { signal, timeoutMs: 15_000 });
          const doc = xml.parse(body);
          const items = asArray<Record<string, unknown>>(doc?.rss?.channel?.item);

          return items
            .map((item): RawTorrent | null => {
              const title = String(item.title ?? '').trim();
              const magnet = typeof item.link === 'string' && item.link.startsWith('magnet:') ? item.link : (item['torrent:magnetURI'] as string | undefined);
              const torrentUrl = typeof item.link === 'string' && !item.link.startsWith('magnet:') ? item.link : (item['torrent:fileName'] as string | undefined);
              const infoHash = item['torrent:infoHash'] ? String(item['torrent:infoHash']).toLowerCase() : (magnet ? infoHashFromMagnet(magnet) : undefined);
              if (!title || (!magnet && !infoHash)) return null;

              return {
                title,
                infoHash,
                magnet: magnet || (infoHash ? buildMagnet(infoHash, title) : undefined),
                torrentUrl,
                sizeBytes: parseSize(String(item['torrent:contentLength'] ?? '')),
                seeders: parseIntSafe(item['torrent:seeds']),
                leechers: parseIntSafe(item['torrent:peers']),
                publishedAt: item.pubDate ? Date.parse(String(item.pubDate)) : undefined,
                category: 'TV',
              };
            })
            .filter((r): r is RawTorrent => r !== null);
        } catch {
          // Fallback to JSON get-torrents return below
        }
      }

      return torrents
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
// AnimeTosho — anime, JSON API mirroring Nyaa/AniDex with richer metadata
// ---------------------------------------------------------------------------

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

  private static readonly MIRRORS = [
    'https://feed.animetosho.org',
    'https://animetosho.org',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
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

// ---------------------------------------------------------------------------
// Nyaa — anime, RSS with multi-mirror fallback
// ---------------------------------------------------------------------------

export class NyaaIndexer implements TorrentIndexer {
  readonly id = 'nyaa';
  readonly name = 'Nyaa';
  readonly specialises = 'anime' as const;

  private static readonly MIRRORS = [
    'https://nyaa.si',
    'https://nyaa.iss.one',
    'https://nyaa.land',
    'https://nyaa.net',
    'https://nyaa.moe',
  ] as const;

  canHandle(): boolean {
    return true;
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const terms = [query.query];
    if (query.episode !== undefined) {
      terms.push(String(query.episode).padStart(2, '0'));
    }
    const search = encodeURIComponent(terms.join(' '));

    return tryMirrors(NyaaIndexer.MIRRORS, async (base) => {
      // c=1_2 restricts to "Anime - English-translated".
      const url = `${base}/?page=rss&q=${search}&c=1_2&f=0`;
      const body = await fetchText(url, { signal, timeoutMs: 20_000 });
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

// ---------------------------------------------------------------------------
// SubsPlease — direct anime release group JSON API
// ---------------------------------------------------------------------------

interface SubsPleaseDownload {
  res?: string;
  magnet?: string;
}

interface SubsPleaseEpisode {
  time?: string;
  release_date?: string;
  show?: string;
  episode?: string;
  downloads?: SubsPleaseDownload[];
}

export class SubsPleaseIndexer implements TorrentIndexer {
  readonly id = 'subsplease';
  readonly name = 'SubsPlease';
  readonly specialises = 'anime' as const;

  private static readonly MIRRORS = ['https://subsplease.org'] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    return tryMirrors(SubsPleaseIndexer.MIRRORS, async (base) => {
      const url = `${base}/api/?f=search&tz=UTC&s=${encodeURIComponent(query.query)}`;
      const data = await fetchJson<Record<string, SubsPleaseEpisode | unknown>>(url, { signal, timeoutMs: 20_000 });
      if (!data || typeof data !== 'object') return [];

      const out: RawTorrent[] = [];

      for (const [key, value] of Object.entries(data)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as SubsPleaseEpisode;
        const downloads = Array.isArray(entry.downloads) ? entry.downloads : [];
        const show = entry.show ?? key;
        const ep = entry.episode ? ` - ${entry.episode}` : '';

        for (const dl of downloads) {
          if (!dl.magnet) continue;
          const infoHash = infoHashFromMagnet(dl.magnet);
          const resStr = dl.res ? ` [${dl.res}p]` : '';
          const title = `[SubsPlease] ${show}${ep}${resStr}`;

          out.push({
            title,
            infoHash,
            magnet: dl.magnet,
            seeders: 15,
            leechers: 2,
            category: 'Anime',
          });
        }
      }

      return out;
    });
  }
}

// ---------------------------------------------------------------------------
// LimeTorrents — public RSS search across movies, TV, anime & general
// ---------------------------------------------------------------------------

export class LimeTorrentsIndexer implements TorrentIndexer {
  readonly id = 'limetorrents';
  readonly name = 'LimeTorrents';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = [
    'https://www.limetorrents.lol',
    'https://www.limetorrents.co',
    'https://www.limetorrents.info',
    'https://www.limetorrents.cc',
    'https://limetorrents.pro',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const terms = [query.query];
    if (query.season !== undefined && query.episode !== undefined) {
      terms.push(
        `S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`
      );
    } else if (query.season !== undefined) {
      terms.push(`S${String(query.season).padStart(2, '0')}`);
    }

    return tryMirrors(LimeTorrentsIndexer.MIRRORS, async (base) => {
      const url = `${base}/search/rss/${encodeURIComponent(terms.join(' '))}/`;
      const body = await fetchText(url, { signal, timeoutMs: 20_000 });
      const doc = xml.parse(body);
      const items = asArray<Record<string, unknown>>(doc?.rss?.channel?.item);

      return items
        .map((item): RawTorrent | null => {
          const title = String(item.title ?? '').trim();
          if (!title) return null;

          const enclosure = item.enclosure as { '@_url'?: string; '@_length'?: string | number } | undefined;
          const torrentUrl = enclosure?.['@_url'] || (typeof item.link === 'string' ? item.link : undefined);
          const desc = String(item.description ?? '');

          const seedsMatch = desc.match(/Seeds\s*:\s*([\d,]+)/i);
          const leechsMatch = desc.match(/Leechs?\s*:\s*([\d,]+)/i);
          const sizeMatch = desc.match(/Size\s*:\s*([\d.,]+\s*[KMGT]i?B)/i);

          const hashMatch = torrentUrl?.match(/\b([a-f0-9]{40})\b/i);
          const infoHash = hashMatch ? hashMatch[1].toLowerCase() : undefined;
          const magnet = infoHash ? buildMagnet(infoHash, title) : undefined;

          if (!infoHash && !torrentUrl) return null;

          return {
            title,
            infoHash,
            magnet,
            torrentUrl,
            sizeBytes: parseSize(sizeMatch?.[1] || enclosure?.['@_length']),
            seeders: parseIntSafe(seedsMatch?.[1]?.replace(/,/g, '')),
            leechers: parseIntSafe(leechsMatch?.[1]?.replace(/,/g, '')),
            publishedAt: item.pubDate ? Date.parse(String(item.pubDate)) : undefined,
            category: 'LimeTorrents',
          };
        })
        .filter((r): r is RawTorrent => r !== null);
    });
  }
}


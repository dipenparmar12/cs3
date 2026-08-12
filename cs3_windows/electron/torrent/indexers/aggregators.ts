import { fetchJson } from '../http';
import { buildMagnet, parseIntSafe, parseSize, type RawTorrent, type TorrentIndexer } from './base';
import type { IndexerQuery } from '../../../src/types/torrent';

/**
 * Aggregator indexers — the ones that actually work behind ISP DNS blocks.
 *
 * Individual torrent sites (YTS, Nyaa, EZTV, 1337x) are widely DNS-blocked and
 * rotate domains constantly. These two are not:
 *
 *  - **Torrentio** queries dozens of indexers server-side and answers on a
 *    single Cloudflare-fronted host, keyed by IMDb id. It also returns
 *    `fileIdx`, telling us exactly which file in a season pack to play — which
 *    no other source here provides.
 *  - **apibay** is The Pirate Bay's own JSON API and takes free text, so it
 *    still works when no IMDb id could be resolved.
 *
 * Between them they cover both query shapes, which is why they are the defaults.
 */

// ---------------------------------------------------------------------------
// Torrentio
// ---------------------------------------------------------------------------

interface TorrentioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: { filename?: string; bingeGroup?: string };
}

interface TorrentioResponse {
  streams?: TorrentioStream[];
}

/**
 * Torrentio encodes its metadata in the `title` string, one field per line:
 *
 *   Movie:  `<release name>\n👤 433 💾 29.26 GB ⚙️ TorrentGalaxy`
 *   Series: `<pack name>\n<file name>.mkv\n👤 84 💾 5.19 GB ⚙️ ThePirateBay`
 *
 * The stats line is always last; a middle line, when present, names the exact
 * file — which is what we want to parse for season/episode, not the pack name.
 */
function parseTorrentioTitle(title: string): {
  releaseName: string;
  fileName?: string;
  seeders: number;
  sizeBytes: number;
  source?: string;
} {
  const lines = title.split('\n').map((l) => l.trim()).filter(Boolean);
  const statsLine = lines.find((l) => /👤|💾|⚙️/.test(l)) ?? '';
  const contentLines = lines.filter((l) => l !== statsLine);

  const seeders = parseIntSafe(statsLine.match(/👤\s*([\d,]+)/)?.[1]?.replace(/,/g, ''));
  const sizeBytes = parseSize(statsLine.match(/💾\s*([\d.,]+\s*[KMGT]i?B)/i)?.[1]);
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

export class TorrentioIndexer implements TorrentIndexer {
  readonly id = 'torrentio';
  readonly name = 'Torrentio';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = [
    'https://torrentio.strem.fun',
    'https://torrentio.deno.dev',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    // Torrentio is addressed purely by IMDb id; free text is not supported.
    return Boolean(query.imdbId);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const imdb = query.imdbId?.startsWith('tt') ? query.imdbId : `tt${query.imdbId}`;

    // Series are addressed as `tt123:season:episode`; movies by bare id.
    const isEpisodic = query.season !== undefined && query.episode !== undefined;
    const path = isEpisodic
      ? `series/${imdb}:${query.season}:${query.episode}`
      : `movie/${imdb}`;

    let lastError: unknown = new Error('No Torrentio mirror responded');

    for (const base of TorrentioIndexer.MIRRORS) {
      try {
        const response = await fetchJson<TorrentioResponse>(
          `${base}/stream/${path}.json`,
          { signal, timeoutMs: 25_000 }
        );

        return (response.streams ?? [])
          .filter((stream): stream is TorrentioStream => Boolean(stream?.infoHash))
          .map<RawTorrent>((stream) => {
            const meta = parseTorrentioTitle(stream.title ?? stream.name ?? '');
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

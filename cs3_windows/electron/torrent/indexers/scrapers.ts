import * as cheerio from 'cheerio';
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
 * Site-specific indexers that require HTML scraping or a bespoke JSON route.
 *
 * These are shipped **disabled by default** and that is a deliberate policy, not
 * an oversight. They break in two ways the aggregator adapters do not: their
 * domains rotate (so a hard-coded host eventually 404s or, worse, lands on a
 * parked page), and their markup changes without notice (so a selector that
 * works today silently returns zero rows tomorrow). Users on unfiltered
 * connections get real value from them; users behind an ISP block get nothing
 * but timeouts, and defaults should serve the second group.
 *
 * Every adapter here therefore:
 *  - walks a mirror list rather than trusting one host,
 *  - treats a page that parses to zero rows as a failure, so the registry's
 *    circuit breaker trips instead of the UI reporting "nothing matched".
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

/** Folds a season/episode into free text, which is all these sites accept. */
function withEpisodeTerms(query: IndexerQuery): string {
  const terms = [query.query];
  if (query.season !== undefined && query.episode !== undefined) {
    terms.push(
      `S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`
    );
  } else if (query.season !== undefined) {
    terms.push(`S${String(query.season).padStart(2, '0')}`);
  }
  return terms.join(' ');
}

// ---------------------------------------------------------------------------
// 1337x — HTML, two hops (list page then detail page for the magnet)
// ---------------------------------------------------------------------------

/** Detail pages fetched per search. Each is a request; the list is ranked already. */
const X1337_DETAIL_LIMIT = 20;

export class X1337Indexer implements TorrentIndexer {
  readonly id = '1337x';
  readonly name = '1337x';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = [
    'https://1337x.to',
    'https://1337x.st',
    'https://1337x.ws',
    'https://1337x.eu',
    'https://1337x.so',
    'https://1337xx.to',
    'https://1337x.tw',
    'https://1337x.is',
    'https://1337x.unblockit.click',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const search = encodeURIComponent(withEpisodeTerms(query));

    return tryMirrors(X1337Indexer.MIRRORS, async (base) => {
      let listing = '';
      try {
        listing = await fetchText(
          `${base}/sort-search/${search}/seeders/desc/1/`,
          { signal, timeoutMs: 20_000 }
        );
      } catch {
        listing = await fetchText(
          `${base}/search/${search}/1/`,
          { signal, timeoutMs: 20_000 }
        );
      }

      const $ = cheerio.load(listing);
      const rows: Array<{ title: string; detailUrl: string; seeders: number; leechers: number; sizeBytes: number; publishedAt?: number }> = [];

      $('table.table-list tbody tr').each((_, element) => {
        const row = $(element);
        // The name cell holds two links: a category icon and the title.
        const link = row.find('td.coll-1.name a').last();
        const href = link.attr('href');
        const title = link.text().trim();
        if (!href || !title) return;

        // The size cell also contains a nested <span> with the seeder count on
        // some mirrors; taking the cell's own first text node avoids "1.4 GB29".
        const sizeCell = row.find('td.coll-4').first().clone();
        sizeCell.find('span').remove();

        const dateText = row.find('td.coll-date').first().text().trim();
        const published = dateText ? Date.parse(dateText) : NaN;

        rows.push({
          title,
          detailUrl: href.startsWith('http') ? href : `${base}${href}`,
          seeders: parseIntSafe(row.find('td.coll-2').first().text().trim()),
          leechers: parseIntSafe(row.find('td.coll-3').first().text().trim()),
          sizeBytes: parseSize(sizeCell.text().trim()),
          publishedAt: Number.isNaN(published) ? undefined : published,
        });
      });

      if (rows.length === 0) {
        throw new Error('1337x returned a page with no result rows (markup changed or blocked)');
      }

      // Magnets only exist on the detail pages, so those must be fetched. Bounded
      // and parallel: sequential fetches would blow the per-indexer timeout, and
      // unbounded ones would fire 50 requests at a site that rate-limits.
      const wanted = rows.slice(0, Math.min(query.limit ?? X1337_DETAIL_LIMIT, X1337_DETAIL_LIMIT));
      const detailed = await Promise.all(
        wanted.map(async (row): Promise<RawTorrent | null> => {
          try {
            const page = await fetchText(row.detailUrl, { signal, timeoutMs: 15_000, retries: 0 });
            const magnet = cheerio.load(page)('a[href^="magnet:"]').first().attr('href');
            if (!magnet) return null;

            return {
              title: row.title,
              infoHash: infoHashFromMagnet(magnet),
              magnet,
              sizeBytes: row.sizeBytes,
              seeders: row.seeders,
              leechers: row.leechers,
              publishedAt: row.publishedAt,
              category: '1337x',
            };
          } catch {
            // One unreachable detail page should not lose the other nineteen.
            return null;
          }
        })
      );

      const results = detailed.filter((r): r is RawTorrent => r !== null);
      if (results.length === 0) {
        throw new Error('1337x listed results but no magnet could be read from any detail page');
      }
      return results;
    });
  }
}

// ---------------------------------------------------------------------------
// BitSearch — HTML, magnets inline on the results page
// ---------------------------------------------------------------------------

export class BitSearchIndexer implements TorrentIndexer {
  readonly id = 'bitsearch';
  readonly name = 'BitSearch';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = [
    'https://bitsearch.to',
    'https://bitsearch.unblockit.click',
    'https://bitsearch.org',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const search = encodeURIComponent(withEpisodeTerms(query));

    return tryMirrors(BitSearchIndexer.MIRRORS, async (base) => {
      const page = await fetchText(`${base}/search?q=${search}&sort=seeders`, {
        signal,
        timeoutMs: 20_000,
      });

      const $ = cheerio.load(page);
      const results: RawTorrent[] = [];

      // Magnets sit inline on the results page, so one request is enough — which
      // is exactly why this is worth keeping alongside 1337x.
      $('li.search-result, li.card').each((_, element) => {
        const card = $(element);
        const title = card.find('h5.title a, h5 a').first().text().trim();
        const magnet = card.find('a[href^="magnet:"]').first().attr('href');
        if (!title || !magnet) return;

        // The stats row is a flat list of divs: size, seeders, leechers, date.
        const stats = card
          .find('div.stats div')
          .map((_i, el) => $(el).text().trim())
          .get();

        results.push({
          title,
          infoHash: infoHashFromMagnet(magnet),
          magnet,
          sizeBytes: parseSize(stats.find((s) => /\d\s*[KMGT]i?B/i.test(s))),
          seeders: parseIntSafe(stats[1]),
          leechers: parseIntSafe(stats[2]),
          category: 'BitSearch',
        });
      });

      if (results.length === 0) {
        throw new Error('BitSearch returned no parseable results (markup changed or blocked)');
      }
      return results;
    });
  }
}

// ---------------------------------------------------------------------------
// TheRARBG — RARBG successor, JSON route
// ---------------------------------------------------------------------------

interface RarbgItem {
  eid?: string;
  name?: string;
  short_name?: string;
  info_hash?: string;
  size?: number | string;
  seeders?: number | string;
  leechers?: number | string;
  category?: string;
  category_str?: string;
  timestamp?: number;
  added?: string;
}

interface RarbgResponse {
  results?: RarbgItem[];
}

export class TheRarbgIndexer implements TorrentIndexer {
  readonly id = 'therarbg';
  readonly name = 'TheRARBG';
  readonly specialises = 'any' as const;

  private static readonly MIRRORS = [
    'https://therarbg.to',
    'https://therarbg.com',
    'https://therarbg.org',
    'https://therarbg.me',
  ] as const;

  canHandle(query: IndexerQuery): boolean {
    return Boolean(query.query);
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const search = encodeURIComponent(withEpisodeTerms(query));

    return tryMirrors(TheRarbgIndexer.MIRRORS, async (base) => {
      const response = await fetchJson<RarbgResponse | RarbgItem[]>(
        `${base}/get-posts/keywords:${search}/?format=json`,
        { signal, timeoutMs: 20_000 }
      );

      const items = Array.isArray(response) ? response : (response.results ?? []);
      const results = items
        .map((item): RawTorrent | null => {
          const title = String(item.name ?? item.short_name ?? '').trim();
          const infoHash = item.info_hash?.toLowerCase();
          if (!title || !infoHash || !/^[a-f0-9]{40}$/.test(infoHash)) return null;

          return {
            title,
            infoHash,
            magnet: buildMagnet(infoHash, title),
            sizeBytes: parseSize(item.size),
            seeders: parseIntSafe(item.seeders),
            leechers: parseIntSafe(item.leechers),
            publishedAt: item.timestamp ? item.timestamp * 1000 : undefined,
            category: item.category_str ?? item.category,
          };
        })
        .filter((r): r is RawTorrent => r !== null);

      if (results.length === 0 && items.length > 0) {
        throw new Error('TheRARBG returned rows in an unrecognised shape');
      }
      return results;
    });
  }
}

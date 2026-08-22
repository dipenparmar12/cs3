import { parseDetailMagnet, parseSearchResults, type ExtToRow } from './extToParser';
import { buildMagnet, type RawTorrent } from '../../torrent/indexers/base';
import type { AccessScope } from '../../access/humanGateway';
import type {
  ExtensionContext,
  ExtensionManifest,
  ProviderExtension,
} from '../runtime';
import type { IndexerQuery } from '../../../src/types/torrent';

/**
 * EXT Torrents — the reference implementation for the desktop extension standard.
 *
 * Chosen deliberately, and not because it is the easiest site to scrape. It is
 * the opposite: it sits behind Cloudflare, and a plain HTTP client gets `403`
 * with `cf-mitigated: challenge` rather than a results page. That is exactly
 * what makes it the right first extension — it exercises the one thing this
 * ecosystem exists to provide and no `.cs3` Android provider can do at all.
 *
 * ## Read how little of this file knows about that
 *
 * `search()` asks `context.http.get` for a URL and parses what comes back.
 * There is no Cloudflare code here, no cookie handling, no browser, no retry
 * policy, no session, no User-Agent. When the site challenges the request, the
 * platform decides — from policy and from whether this call came from a user
 * action or a background prefetch — whether to put the site's own page in front
 * of the user, and the same lines run unchanged afterwards.
 *
 * That is the whole architectural claim, and this file is the evidence for it.
 * The next extension is written the same way and inherits all of it.
 *
 * ## What has and has not been verified
 *
 * The request shape and the parser are written from the documented search
 * interface and from the structure every torrent index shares. **They have not
 * been run against the live site**: `ext.to` is blocked by the egress policy of
 * the environment this was built in, and guessing at a site's markup and then
 * reporting it as tested would be worse than useless. `tools/e2e/extension-e2e.mjs`
 * drives the whole path — request, challenge classification, parse, magnet — and
 * is the thing to run from a machine that can reach it.
 */

/**
 * Mirrors, tried in order.
 *
 * Not decoration: these domains rotate, and a hard-coded host eventually 404s
 * or — worse — lands on a parked page that parses to zero rows and reads as "no
 * results". The working one is remembered in extension storage so the next
 * launch does not re-derive it.
 */
const MIRRORS = ['https://ext.to', 'https://extto.com', 'https://ext.to.prx.im'];

const MIRROR_KEY = 'mirror';

/** Detail pages fetched per search, for rows whose list entry had no magnet. */
const DETAIL_LIMIT = 12;

export const EXT_TO_SCOPE: AccessScope = {
  id: 'extto',
  name: 'EXT Torrents',
  origins: MIRRORS,
};

export const EXT_TO_MANIFEST: ExtensionManifest = {
  id: 'extto',
  name: 'EXT Torrents',
  version: '1.0.0',
  description:
    'Torrent index with per-category browsing, seeder counts and hash search. Behind a ' +
    'Cloudflare browser check, which you complete yourself the first time.',
  expectsHumanVerification: true,
};

/** Folds season/episode into the free-text query, which is all the site takes. */
function queryText(query: IndexerQuery): string {
  const terms = [query.query];
  if (query.season !== undefined && query.episode !== undefined) {
    terms.push(`S${String(query.season).padStart(2, '0')}E${String(query.episode).padStart(2, '0')}`);
  } else if (query.season !== undefined) {
    terms.push(`S${String(query.season).padStart(2, '0')}`);
  }
  return terms.join(' ').trim();
}

function searchUrl(base: string, query: IndexerQuery, page: number): string {
  const params = new URLSearchParams({
    q: queryText(query),
    // Seeders descending is the ranking that matters for playability, and
    // asking the site for it is far cheaper than fetching ten pages to sort
    // locally. `ranker.ts` still has the final say.
    order: 'seeders',
    sort: 'desc',
  });
  if (page > 1) params.set('p', String(page));
  return `${base}/search/?${params.toString()}`;
}

export class ExtToProvider implements ProviderExtension {
  readonly manifest = EXT_TO_MANIFEST;
  readonly scope = EXT_TO_SCOPE;

  public async search(query: IndexerQuery, context: ExtensionContext): Promise<RawTorrent[]> {
    const { base, rows } = await this.firstPage(query, context);

    const pages = Math.max(1, Math.min(3, Math.ceil((query.limit ?? 30) / 30)));
    for (let page = 2; page <= pages && rows.length >= 20; page++) {
      if (context.signal?.aborted) break;

      const response = await context.http.get(searchUrl(base, query, page));
      if (!response.ok) break;

      const parsed = parseSearchResults(await response.text(), base);
      if (parsed.length === 0) break;
      rows.push(...parsed);
      if (parsed.length < 20) break;
    }

    await this.fillMissingMagnets(rows, context);

    return rows
      .filter((row) => row.magnet || row.infoHash)
      .map((row) => this.toRawTorrent(row));
  }

  /**
   * Fetches page one, walking mirrors until one answers.
   *
   * Page one and mirror selection are the same request, deliberately. Probing a
   * mirror and then asking it the same question again doubles every search
   * against a site that is already suspicious of us — and doubling requests is
   * how a scraper earns the rate limit that costs the *next* search too.
   *
   * A challenge is **not** a reason to try the next mirror. It means the site
   * is up and asking a question; walking on would ask the same question at the
   * next domain, and three windows for one search is worse than one.
   */
  private async firstPage(
    query: IndexerQuery,
    context: ExtensionContext
  ): Promise<{ base: string; rows: ExtToRow[] }> {
    const remembered = context.storage.get(MIRROR_KEY);
    const order = remembered
      ? [remembered, ...MIRRORS.filter((mirror) => mirror !== remembered)]
      : [...MIRRORS];

    let lastError: Error = new Error('No mirror answered');

    for (const base of order) {
      if (context.signal?.aborted) break;

      let response;
      try {
        response = await context.http.get(searchUrl(base, query, 1));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }

      if (response.challenge) {
        context.storage.set(MIRROR_KEY, base);
        /**
         * The whole reason this extension exists, and it must travel out rather
         * than being swallowed into an empty list. `loadLinks` returning a bare
         * `[]` is the mistake this codebase has already paid for once — one
         * sentence covering a timeout, a block, and a site that genuinely has
         * nothing.
         */
        throw new AccessBlocked(
          response.challenge.reason ?? 'This site is not answering automated requests.',
          response.challenge.type
        );
      }

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} from ${base}`);
        continue;
      }

      const rows = parseSearchResults(await response.text(), base);
      if (rows.length === 0) {
        /**
         * A page that parses to nothing is a failure, not an answer. The markup
         * moved, or this is a parked domain that returns 200 for everything —
         * and treating either as "no results" is precisely what makes a broken
         * scraper invisible. Move to the next mirror.
         */
        lastError = new Error(`${base} returned a page with no results in it`);
        continue;
      }

      context.storage.set(MIRROR_KEY, base);
      return { base, rows };
    }

    throw lastError;
  }

  private toRawTorrent(row: ExtToRow): RawTorrent {
    return {
      title: row.title,
      infoHash: row.infoHash,
      // A magnet the site built carries its own tracker list, which is better
      // than the default set; only synthesise one when there was none.
      magnet: row.magnet ?? (row.infoHash ? buildMagnet(row.infoHash, row.title) : undefined),
      sizeBytes: row.sizeBytes,
      seeders: row.seeders,
      leechers: row.leechers,
      publishedAt: row.publishedAt,
      category: row.category,
    };
  }

  /**
   * Second hop for rows that only linked to a detail page.
   *
   * Bounded, and ordered by seeders, because each one is a request to a site
   * that is already suspicious of us. Twelve detail pages for the twelve most
   * seeded rows is worth it; a hundred is how a scraper gets a rate limit that
   * costs the *next* search too.
   */
  private async fillMissingMagnets(rows: ExtToRow[], context: ExtensionContext): Promise<void> {
    const needing = rows
      .filter((row) => !row.magnet && !row.infoHash && row.detailUrl)
      .sort((a, b) => b.seeders - a.seeders)
      .slice(0, DETAIL_LIMIT);

    for (const row of needing) {
      if (context.signal?.aborted) return;
      try {
        const response = await context.http.get(row.detailUrl!);
        if (!response.ok) continue;
        const found = parseDetailMagnet(await response.text());
        row.magnet = found.magnet;
        row.infoHash = found.infoHash;
      } catch (error) {
        context.logger.debug(`detail page failed: ${row.detailUrl}`, error);
      }
    }
  }
}

/**
 * A refusal that a person could do something about.
 *
 * Distinguished from an ordinary error so the layer above can offer the verify
 * action instead of reporting "the indexer failed" — which is true, useless,
 * and the reason the site would otherwise look permanently broken.
 */
export class AccessBlocked extends Error {
  readonly intervention: string;

  constructor(message: string, intervention: string) {
    super(message);
    this.name = 'AccessBlocked';
    this.intervention = intervention;
  }
}

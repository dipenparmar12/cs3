import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { infoHashFromMagnet, parseSize } from '../../torrent/indexers/base.ts';

/**
 * Reading a torrent index page without depending on one site's class names.
 *
 * ## Why this is written structurally rather than with exact selectors
 *
 * Two reasons, and the second is the honest one.
 *
 * The first is the same reason `scrapers.ts` walks mirror lists: these sites
 * change their markup without notice, and a selector that works today returns
 * zero rows tomorrow. A parser pinned to `td.coll-2 span.seeds` fails silently
 * and reports "no results", which is indistinguishable from a site that has
 * nothing — the worst failure mode available, because nobody investigates it.
 *
 * The second: **the live markup could not be checked from the environment this
 * was written in.** `ext.to` is blocked by the egress policy here (the proxy
 * answers 403 to CONNECT), so every selector below is derived from the shape
 * every torrent index shares rather than from that site's HTML. A parser
 * written to guessed class names would be a guess dressed as a fact. A parser
 * written to structure — a row that contains a magnet or a torrent link, a cell
 * that parses as a size, integers beside it — is a weaker assumption that is
 * far more likely to hold, and it degrades to "no rows" rather than to a wrong
 * answer.
 *
 * To verify against the real site, run the harness in
 * `tools/e2e/extension-e2e.mjs` from a machine that can reach it. It prints the
 * first parsed rows beside the raw row HTML, which is what makes a selector
 * mistake visible.
 *
 * Pure: HTML in, rows out. No network, no session, no Electron.
 */

export interface ExtToRow {
  title: string;
  magnet?: string;
  infoHash?: string;
  /** Absolute URL of the torrent's own page, when the row only links to one. */
  detailUrl?: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  category?: string;
  publishedAt?: number;
}

/** Anything that reads as a byte size. Deliberately loose; `parseSize` is strict. */
const SIZE_RE = /^\s*[\d.,]+\s*[kmgt]?i?b\s*$/i;

const INTEGER_RE = /^\s*[\d,]+\s*$/;

/**
 * Candidate row containers, most specific first.
 *
 * A table is what every one of these sites has used for twenty years; the card
 * and list forms are the modern redesigns. Trying them in order and keeping the
 * first that yields rows is the same shape as `tryMirrors` — a site that
 * redesigns does not break the parser, it moves it to the next candidate.
 */
const ROW_SELECTORS = [
  'table tbody tr',
  'table tr',
  '[class*="torrent-list"] [class*="row"]',
  '[class*="tl-row"]',
  'ul[class*="torrent"] li',
  '[class*="search-result"]',
];

function text(node: cheerio.Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, ' ').trim();
}

function toInt(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

/**
 * Pulls the display name out of a magnet URI.
 *
 * Worth preferring over the link text when both exist: `dn` is what the
 * uploader named the release, where the anchor may have been truncated with an
 * ellipsis for the layout. `releaseParser` reads quality, codec and episode out
 * of that string, and a truncated one loses the tail — which is where the group
 * and often the resolution live.
 */
export function displayNameFromMagnet(magnet: string): string | undefined {
  const match = magnet.match(/[?&]dn=([^&]+)/i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() || undefined;
  } catch {
    return match[1];
  }
}

function absolute(href: string, baseUrl: string): string | undefined {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * Reads one row, or decides it is not a result row at all.
 *
 * A row qualifies only if it points at a torrent — a magnet, a `.torrent`, or a
 * link into the site's own torrent detail path. Header rows, pagination rows,
 * and advertising blocks all live in the same table and all parse into
 * plausible-looking garbage otherwise.
 */
function parseRow(
  $: cheerio.CheerioAPI,
  element: AnyNode,
  baseUrl: string
): ExtToRow | null {
  const row = $(element);

  const magnetHref = row.find('a[href^="magnet:"]').first().attr('href');
  const torrentHref = row.find('a[href$=".torrent"], a[href*=".torrent?"]').first().attr('href');
  const detailHref = row
    .find('a[href*="/torrent/"], a[href*="/t/"], a[href*="/download/"]')
    .first()
    .attr('href');

  if (!magnetHref && !torrentHref && !detailHref) return null;

  // Cells, whether the layout uses a table or not.
  const cells = row.find('td').length > 0 ? row.find('td') : row.children();

  let sizeBytes = 0;
  let sizeIndex = -1;
  cells.each((index, cell) => {
    if (sizeIndex >= 0) return;
    const value = text($(cell));
    if (SIZE_RE.test(value)) {
      sizeBytes = parseSize(value);
      sizeIndex = index;
    }
  });

  /**
   * Seeders and leechers.
   *
   * Class names are tried first because they are unambiguous where they exist.
   * The positional fallback — the first two integer cells after the size — is
   * the convention every one of these tables follows, and it is why the size
   * cell is located first even though the size itself is the least important
   * field here.
   */
  let seeders = 0;
  let leechers = 0;

  const byClass = (pattern: RegExp): number | undefined => {
    const found = row.find('[class]').filter((_, node) => pattern.test($(node).attr('class') ?? ''));
    if (found.length === 0) return undefined;
    const value = text(found.first());
    return INTEGER_RE.test(value) ? toInt(value) : undefined;
  };

  const classSeeders = byClass(/seed|\bsl-s\b|green/i);
  const classLeechers = byClass(/leech|peer|\bsl-l\b|red/i);

  if (classSeeders !== undefined || classLeechers !== undefined) {
    seeders = classSeeders ?? 0;
    leechers = classLeechers ?? 0;
  } else if (sizeIndex >= 0) {
    const numbers: number[] = [];
    cells.each((index, cell) => {
      if (index <= sizeIndex || numbers.length >= 2) return;
      const value = text($(cell));
      if (INTEGER_RE.test(value)) numbers.push(toInt(value));
    });
    [seeders = 0, leechers = 0] = numbers;
  }

  const magnet = magnetHref?.trim();
  const infoHash = magnet ? infoHashFromMagnet(magnet) : undefined;

  /**
   * The title.
   *
   * The magnet's `dn` wins; then a link's `title` attribute, which sites use to
   * carry the full name when the visible text is truncated; then the longest
   * anchor text in the row, because the release name is reliably the longest
   * link there and the short ones are the category, the uploader and the
   * download icon.
   */
  let title = magnet ? displayNameFromMagnet(magnet) : undefined;
  if (!title) {
    const titled = row.find('a[title]').first().attr('title');
    if (titled && titled.trim().length > 3) title = titled.trim();
  }
  if (!title) {
    let longest = '';
    row.find('a').each((_, anchor) => {
      const value = text($(anchor));
      if (value.length > longest.length) longest = value;
    });
    title = longest;
  }

  if (!title || title.length < 2) return null;

  const detailUrl = detailHref ? absolute(detailHref, baseUrl) : undefined;
  const torrentUrl = torrentHref ? absolute(torrentHref, baseUrl) : undefined;

  return {
    title,
    magnet,
    infoHash,
    // A `.torrent` URL is as good as a detail page for the next hop, and better:
    // it needs no second parse.
    detailUrl: torrentUrl ?? detailUrl,
    sizeBytes,
    seeders,
    leechers,
  };
}

export function parseSearchResults(html: string, baseUrl: string): ExtToRow[] {
  const $ = cheerio.load(html);

  for (const selector of ROW_SELECTORS) {
    const rows: ExtToRow[] = [];
    $(selector).each((_, element) => {
      const row = parseRow($, element, baseUrl);
      if (row) rows.push(row);
    });
    if (rows.length > 0) return dedupe(rows);
  }

  return [];
}

/**
 * One release, once.
 *
 * A results page routinely lists the same torrent under two categories, and a
 * row that appears twice becomes two sources offering identical bytes. The
 * infohash is the identity where there is one; the title is the fallback, which
 * is weaker but still better than nothing.
 */
function dedupe(rows: ExtToRow[]): ExtToRow[] {
  const seen = new Set<string>();
  const out: ExtToRow[] = [];
  for (const row of rows) {
    const key = row.infoHash ?? `${row.title}|${row.sizeBytes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Finds the magnet on a torrent's own page.
 *
 * Second hop, taken only for rows whose list entry carried no magnet. 1337x
 * works the same way and for the same reason — the list page links to the
 * detail page and the magnet lives there.
 */
export function parseDetailMagnet(html: string): { magnet?: string; infoHash?: string } {
  const $ = cheerio.load(html);
  const href = $('a[href^="magnet:"]').first().attr('href');
  if (href) return { magnet: href.trim(), infoHash: infoHashFromMagnet(href) };

  const infoHash = findInfoHash(html);
  return infoHash ? { infoHash } : {};
}

/**
 * Finds a bare infohash printed on a page.
 *
 * Two details here are the difference between working and not, and both were
 * found by a test rather than reasoned about:
 *
 * - **The raw HTML is searched, not the rendered text.** `text()` concatenates
 *   adjacent elements with no separator, so `<dt>Info hash</dt><dd>aaaa…</dd>`
 *   becomes `Info hashaaaa…` and a `\b` boundary before the hash never matches.
 *   In markup the hash is always delimited by `>`, `"` or `<`, none of which is
 *   a hex character.
 * - **Only a run of *exactly* forty hex characters counts.** A `\b`-anchored
 *   match happily takes the first forty characters of a 64-character SHA-256
 *   checksum, which is a different number that looks entirely plausible and
 *   produces a magnet for a torrent that does not exist.
 */
function findInfoHash(html: string): string | undefined {
  const runs = html.match(/[a-f0-9]{40,}/gi) ?? [];
  const exact = runs.find((run) => run.length === 40);
  return exact?.toLowerCase();
}

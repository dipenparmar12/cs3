import {
  TvType,
  type ExactMedia,
  type SearchAlternate,
  type SearchResponse,
} from '../src/types/api';
import { normaliseTitleForMatch, titleSimilarity } from './torrent/releaseParser';
import { parseCinemetaUrl } from './cinemeta';

/**
 * Collapses duplicate results within each provider / source down to one row.
 *
 * Each responding provider (e.g. Castle TV, 4KHD hub, Movie box) remains its own
 * distinct result entry on the search grid with its own poster card, allowing the
 * viewer to choose specific providers directly and test their sources.
 *
 * Within the same provider, duplicate rows are deduplicated:
 *
 * - **IMDb id** is exact. Two rows from the same provider carrying the same one
 *   are the same work.
 * - **Normalised title + year** is the fallback, and it is deliberately strict
 *   about the year. "Dune (1984)" and "Dune (2021)" stay separate.
 * - **Normalised title alone** is used only to absorb a row from the same provider
 *   that has *no* year into a yeared row from that provider.
 *
 * Direct links (magnets, torrents) and distinct providers are kept separate.
 */

/** Rows the merger will never touch: they are the query, not a match for it. */
function isDirectLink(result: SearchResponse): boolean {
  return result.url.startsWith('magnet:') || result.type === TvType.Torrent;
}

function imdbIdOf(result: SearchResponse): string | undefined {
  if (result.imdbId) return result.imdbId;
  return parseCinemetaUrl(result.url)?.imdbId;
}

/**
 * How much a row is worth keeping as the row the viewer clicks.
 *
 * A merged row exposes exactly one URL to the detail view, so this decides
 * which ecosystem a title resolves through by default. Catalogue rows win:
 * they carry an IMDb id, and that id is what unlocks torrent indexers,
 * subtitles and episode lists. An extension row that loses here is not
 * discarded — it becomes an alternate, and the source layer still asks it.
 */
function primacy(result: SearchResponse): number {
  let score = 0;
  if (imdbIdOf(result)) score += 100;
  if (result.url.startsWith('cs3meta://')) score += 20;
  if (result.year !== undefined) score += 10;
  if (result.posterUrl) score += 5;
  // A longer plot-bearing name is usually the official spelling rather than a
  // scraper's truncation, and it is what the viewer reads.
  score += Math.min(result.name.length, 40) / 100;
  return score;
}

interface Group {
  best: SearchResponse;
  /** Insertion order of the first member, so merging does not reshuffle results. */
  rank: number;
  members: SearchResponse[];
}

/**
 * Catalogues disagree about a release year by a year all the time — theatrical
 * versus festival, US versus original territory, air date versus production.
 * Demanding exactness would throw away correct matches.
 */
const YEAR_TOLERANCE = 1;

/**
 * Title similarity above which two names are treated as the same work.
 *
 * Deliberately high. This gate exists to *reject* franchise siblings, and
 * "Spider-Man" against "Spider-Man: No Way Home" already scores 0.5 on token
 * overlap — anything permissive puts back exactly the noise the viewer
 * eliminated by picking a row.
 */
const EXACT_TITLE_THRESHOLD = 0.95;

/**
 * Does this result name the work the viewer picked?
 *
 * An IMDb id settles it outright, in both directions: two different ids are a
 * definite no, which is what separates the three different films simply called
 * "The Killers".
 */
export function matchesExact(result: SearchResponse, exact: ExactMedia): boolean {
  const resultImdb = imdbIdOf(result);
  if (exact.imdbId && resultImdb) return exact.imdbId === resultImdb;

  if (titleSimilarity(result.name, exact.title) < EXACT_TITLE_THRESHOLD) return false;

  // A missing year cannot contradict one. Extension providers rarely publish a
  // year, and rejecting them for it would undo the point of asking them.
  if (result.year === undefined || exact.year === undefined) return true;
  return Math.abs(result.year - exact.year) <= YEAR_TOLERANCE;
}

/**
 * Narrows a result set to the one work the viewer selected from the dropdown.
 *
 * The search still runs wide, because extension providers only accept text and
 * will answer with whatever their site matched. Filtering afterwards is what
 * turns that back into the specific answer that was asked for.
 *
 * The selected row is guaranteed to survive even when nothing returned it —
 * a suggestion the catalogues agreed on is real, and showing an empty page for
 * something the user just saw and clicked would be the worst outcome here.
 */
export function restrictToExact(
  results: SearchResponse[],
  exact: ExactMedia
): SearchResponse[] {
  const exactMatches: SearchResponse[] = [];
  const otherMatches: SearchResponse[] = [];

  for (const item of results) {
    if (matchesExact(item, exact)) {
      exactMatches.push({ ...item, isExactMatch: true });
    } else {
      otherMatches.push(item);
    }
  }

  if (exactMatches.length === 0 && exact.url) {
    exactMatches.push({
      name: exact.title,
      url: exact.url,
      apiName: 'Catalogue',
      type: exact.type,
      year: exact.year,
      posterUrl: exact.posterUrl,
      isExactMatch: true,
      ...(exact.imdbId ? { imdbId: exact.imdbId } : {}),
    });
  }

  return [...exactMatches, ...otherMatches];
}

export function mergeSearchResults(results: SearchResponse[]): SearchResponse[] {
  const groups: Group[] = [];
  const byImdb = new Map<string, Group>();
  const byTitleYear = new Map<string, Group>();
  /** Title-only index, consulted solely to place rows that carry no year. */
  const byTitle = new Map<string, Group>();

  const attach = (group: Group, result: SearchResponse) => {
    group.members.push(result);
    if (primacy(result) > primacy(group.best)) group.best = result;
  };

  const index = (group: Group, result: SearchResponse) => {
    const providerKey = (result.apiName ?? '').toLowerCase().trim();
    const imdb = imdbIdOf(result);
    const title = normaliseTitleForMatch(result.name);
    if (imdb) byImdb.set(`${providerKey}|${imdb}`, group);
    if (title) {
      if (result.year !== undefined) byTitleYear.set(`${providerKey}|${title}|${result.year}`, group);
      // First writer wins: the earliest row for a title is the best-ranked one,
      // and a year-less straggler should join it rather than redirect it.
      if (!byTitle.has(`${providerKey}|${title}`)) byTitle.set(`${providerKey}|${title}`, group);
    }
  };

  for (const result of results) {
    if (isDirectLink(result)) {
      groups.push({ best: result, rank: groups.length, members: [result] });
      continue;
    }

    const providerKey = (result.apiName ?? '').toLowerCase().trim();
    const imdb = imdbIdOf(result);
    const title = normaliseTitleForMatch(result.name);

    /**
     * A row without a year folds into the title's group, and a group whose own
     * best has no year accepts a yeared row. What must never happen is two
     * *different* years merging: that is Dune 1984 swallowing Dune 2021.
     */
    const sameTitle = title ? byTitle.get(`${providerKey}|${title}`) : undefined;
    const yearCompatible =
      sameTitle &&
      (result.year === undefined ||
        sameTitle.best.year === undefined ||
        sameTitle.best.year === result.year);

    const existing =
      (imdb ? byImdb.get(`${providerKey}|${imdb}`) : undefined) ??
      (title && result.year !== undefined
        ? byTitleYear.get(`${providerKey}|${title}|${result.year}`)
        : undefined) ??
      (yearCompatible ? sameTitle : undefined);

    if (existing) {
      attach(existing, result);
      index(existing, result);
      continue;
    }

    const group: Group = { best: result, rank: groups.length, members: [result] };
    groups.push(group);
    index(group, result);
  }

  return groups
    .sort((a, b) => a.rank - b.rank)
    .map((group) => {
      const best = group.best;
      const imdb = imdbIdOf(best) ?? group.members.map(imdbIdOf).find(Boolean);

      // Alternates are deduped by URL, not by provider: one extension can
      // legitimately return two routes to the same title.
      const seen = new Set([best.url]);
      const alternates: SearchAlternate[] = [];
      for (const member of group.members) {
        if (seen.has(member.url)) continue;
        seen.add(member.url);
        alternates.push({ apiName: member.apiName, url: member.url });
      }

      return {
        ...best,
        // Fields the winner happens to lack are filled from whichever member
        // has them — a catalogue row with no poster next to a provider row with
        // one should show the poster.
        posterUrl: best.posterUrl ?? group.members.find((m) => m.posterUrl)?.posterUrl,
        year: best.year ?? group.members.find((m) => m.year !== undefined)?.year,
        type: best.type ?? group.members.find((m) => m.type)?.type,
        ...(imdb ? { imdbId: imdb } : {}),
        ...(alternates.length > 0 ? { alternates } : {}),
      };
    });
}

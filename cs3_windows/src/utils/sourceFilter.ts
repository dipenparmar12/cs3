import type { TorrentResult } from '../types/torrent';
import { Resolution } from '../types/torrent';

export type ResolutionFilterValue = 'all' | '4k' | '1440p' | '1080p' | '720p' | '480p';
export type SizeFilterValue = 'all' | 'under1gb' | '1to3gb' | '3to8gb' | 'over8gb';
export type LanguageFilterValue = 'all' | 'en' | 'dual_multi' | 'de' | 'fr' | 'es' | 'ja' | 'hi' | 'other';
export type SortOption = 'score' | 'seeders' | 'size_desc' | 'size_asc' | 'res_desc';

export interface SourceFilterState {
  searchQuery: string;
  resolution: ResolutionFilterValue;
  size: SizeFilterValue;
  language: LanguageFilterValue;
  /**
   * Which source produced the row — a torrent indexer, or the host an extension
   * provider resolved a link from. `'all'` means no restriction.
   *
   * The dimension the filter bar was missing. With a dozen indexers and several
   * extension providers answering the same query, "only show me results from the
   * one that actually plays" was not expressible, and the whole list had to be
   * read to find them.
   */
  source: string;
  sortBy: SortOption;
}

export const DEFAULT_FILTER_STATE: SourceFilterState = {
  searchQuery: '',
  resolution: 'all',
  size: 'all',
  language: 'all',
  source: 'all',
  sortBy: 'score',
};

/**
 * Regex patterns for non-standard resolutions when `parsed.resolution` is missing or unknown.
 */
const RES_REGEX_PATTERNS: Array<[RegExp, '4k' | '1440p' | '1080p' | '720p' | '480p']> = [
  [/\b(?:2160p?|4k|uhd|3840x2160|2160)\b/i, '4k'],
  [/\b(?:1440p?|2560x1440|qhd|1440)\b/i, '1440p'],
  [/\b(?:1080[pi]?|1920x1080|fhd|fullhd|1080)\b/i, '1080p'],
  [/\b(?:720p?|1280x720|hd|720)\b/i, '720p'],
  [/\b(?:480[pi]?|576[pi]?|640x480|720x480|720x576|sd|480|360p?|240p?)\b/i, '480p'],
];

/**
 * Detects resolution category using parsed.resolution first, falling back to regex scanning on release title.
 */
export function detectResolutionCategory(source: TorrentResult): '4k' | '1440p' | '1080p' | '720p' | '480p' | 'unknown' {
  const resNum = source.parsed?.resolution;
  if (resNum === Resolution.UHD_4K) return '4k';
  if (resNum === Resolution.QHD) return '1440p';
  if (resNum === Resolution.FHD) return '1080p';
  if (resNum === Resolution.HD) return '720p';
  if (resNum === Resolution.SD || resNum === Resolution.LD) return '480p';

  const title = (source.title || '').toLowerCase();
  for (const [pattern, category] of RES_REGEX_PATTERNS) {
    if (pattern.test(title)) return category;
  }

  return 'unknown';
}

export function matchesSize(source: TorrentResult, sizeFilter: SizeFilterValue): boolean {
  if (sizeFilter === 'all') return true;
  const bytes = source.sizeBytes || 0;
  if (bytes <= 0) return true; // Don't discard unknown sizes unless strict

  const gb = bytes / (1000 * 1000 * 1000);
  switch (sizeFilter) {
    case 'under1gb':
      return gb < 1;
    case '1to3gb':
      return gb >= 1 && gb <= 3;
    case '3to8gb':
      return gb > 3 && gb <= 8;
    case 'over8gb':
      return gb > 8;
    default:
      return true;
  }
}

export function matchesLanguage(source: TorrentResult, langFilter: LanguageFilterValue): boolean {
  if (langFilter === 'all') return true;
  const p = source.parsed;
  const title = (source.title || '').toLowerCase();
  const langs = (p?.languages || []).map((l) => l.toLowerCase());

  if (langFilter === 'dual_multi') {
    return (
      Boolean(p?.isDualAudio) ||
      Boolean(p?.isMultiAudio) ||
      /\b(?:multi|multi-?audio|dual|dual-?audio|dubbed|multi-?sub)\b/i.test(title)
    );
  }

  if (langFilter === 'en') {
    if (langs.includes('en') || langs.includes('english')) return true;
    if (/\b(?:eng|english)\b/i.test(title)) return true;
    const foreignMatches = /\b(?:german|ger|deutsch|french|vostfr|fr|spanish|esp|latino|ita|italian|jap|japanese|hindi|hin)\b/i.test(title);
    return !foreignMatches || Boolean(p?.isMultiAudio) || Boolean(p?.isDualAudio);
  }

  if (langFilter === 'de') {
    return langs.includes('de') || langs.includes('german') || /\b(?:german|deutsch|ger)\b/i.test(title);
  }
  if (langFilter === 'fr') {
    return langs.includes('fr') || langs.includes('french') || /\b(?:french|francais|vostfr|vff|vfq)\b/i.test(title);
  }
  if (langFilter === 'es') {
    return langs.includes('es') || langs.includes('spanish') || /\b(?:spanish|espanol|castellano|latino|esp)\b/i.test(title);
  }
  if (langFilter === 'ja') {
    return langs.includes('ja') || langs.includes('japanese') || /\b(?:japanese|jap|jpn)\b/i.test(title);
  }
  if (langFilter === 'hi') {
    return langs.includes('hi') || langs.includes('hindi') || /\b(?:hindi|hin)\b/i.test(title);
  }
  if (langFilter === 'other') {
    return langs.length > 0 || /\b(?:german|ger|french|vostfr|spanish|esp|italian|ita|russian|rus|korean|kor|chinese|chs|cht|arabic|ara)\b/i.test(title);
  }

  return true;
}

export function matchesSearchText(source: TorrentResult, text: string): boolean {
  if (!text || !text.trim()) return true;
  const q = text.trim().toLowerCase();
  const title = (source.title || '').toLowerCase();
  const indexer = (source.indexerName || '').toLowerCase();
  const group = (source.parsed?.releaseGroup || '').toLowerCase();
  const codec = (source.parsed?.videoCodec || '').toLowerCase();
  const sourceFmt = (source.parsed?.source || '').toLowerCase();

  return (
    title.includes(q) ||
    indexer.includes(q) ||
    group.includes(q) ||
    codec.includes(q) ||
    sourceFmt.includes(q)
  );
}

export function sortSources(sources: TorrentResult[], sortBy: SortOption): TorrentResult[] {
  return [...sources].sort((a, b) => {
    if (sortBy === 'seeders') return b.seeders - a.seeders;
    if (sortBy === 'size_desc') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
    if (sortBy === 'size_asc') return (a.sizeBytes || 0) - (b.sizeBytes || 0);
    if (sortBy === 'res_desc') {
      const resA = a.parsed?.resolution || 0;
      const resB = b.parsed?.resolution || 0;
      if (resA !== resB) return resB - resA;
    }
    return (b.score || 0) - (a.score || 0);
  });
}

export function sourceNameOf(source: TorrentResult): string {
  return source.indexerName || 'Unknown source';
}

/** The dimensions that offer a list of choices, as opposed to free text. */
export type FacetDimension = 'resolution' | 'size' | 'language' | 'source';

/** Does one source match one value of one dimension? */
function matchesDimension(source: TorrentResult, dimension: FacetDimension, value: string): boolean {
  switch (dimension) {
    case 'resolution':
      return detectResolutionCategory(source) === value;
    case 'size':
      return matchesSize(source, value as SizeFilterValue);
    case 'language':
      return matchesLanguage(source, value as LanguageFilterValue);
    case 'source':
      return sourceNameOf(source) === value;
  }
}

/**
 * Applies every active filter, optionally holding one dimension out.
 *
 * The hold-out is what makes the counts on the facet menus mean something: a
 * facet has to be counted against the *other* filters, not against itself, or
 * picking "1080p" would report every other resolution as having zero results.
 */
function passes(
  source: TorrentResult,
  state: SourceFilterState,
  except?: FacetDimension
): boolean {
  if (state.searchQuery && !matchesSearchText(source, state.searchQuery)) return false;
  for (const dimension of ['resolution', 'size', 'language', 'source'] as const) {
    if (dimension === except) continue;
    const value = state[dimension];
    if (value !== 'all' && !matchesDimension(source, dimension, value)) return false;
  }
  return true;
}

export function filterAndSortSources(
  sources: TorrentResult[],
  filterState: SourceFilterState
): TorrentResult[] {
  return sortSources(
    sources.filter((source) => passes(source, filterState)),
    filterState.sortBy
  );
}

export interface FacetCount {
  value: string;
  label: string;
  count: number;
}

const FIXED_OPTIONS: Record<Exclude<FacetDimension, 'source'>, Array<[string, string]>> = {
  resolution: [
    ['4k', '4K (2160p)'],
    ['1440p', '1440p'],
    ['1080p', '1080p'],
    ['720p', '720p'],
    ['480p', '480p / SD'],
  ],
  size: [
    ['under1gb', 'Under 1 GB'],
    ['1to3gb', '1 – 3 GB'],
    ['3to8gb', '3 – 8 GB'],
    ['over8gb', 'Over 8 GB'],
  ],
  language: [
    ['en', 'English'],
    ['dual_multi', 'Dual / multi audio'],
    ['de', 'German'],
    ['fr', 'French'],
    ['es', 'Spanish'],
    ['ja', 'Japanese'],
    ['hi', 'Hindi'],
    ['other', 'Other foreign'],
  ],
};

/**
 * The options worth offering for one dimension, with live counts.
 *
 * Options that would leave nothing are dropped. A menu of forty providers where
 * thirty-eight lead to an empty list is not information, it is a maze — and the
 * two that matter are exactly what the user is looking for.
 */
export function buildFacet(
  sources: TorrentResult[],
  state: SourceFilterState,
  dimension: FacetDimension
): FacetCount[] {
  const base = sources.filter((source) => passes(source, state, dimension));

  if (dimension === 'source') {
    const counts = new Map<string, number>();
    for (const source of base) {
      const name = sourceNameOf(source);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }

  return FIXED_OPTIONS[dimension]
    .map(([value, label]) => ({
      value,
      label,
      count: base.filter((source) => matchesDimension(source, dimension, value)).length,
    }))
    .filter((option) => option.count > 0);
}

export function isFilterActive(state: SourceFilterState): boolean {
  return (
    Boolean(state.searchQuery.trim()) ||
    state.resolution !== 'all' ||
    state.size !== 'all' ||
    state.language !== 'all' ||
    state.source !== 'all' ||
    state.sortBy !== 'score'
  );
}

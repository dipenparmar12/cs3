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
  sortBy: SortOption;
}

export const DEFAULT_FILTER_STATE: SourceFilterState = {
  searchQuery: '',
  resolution: 'all',
  size: 'all',
  language: 'all',
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

export function filterAndSortSources(
  sources: TorrentResult[],
  filterState: SourceFilterState
): TorrentResult[] {
  const filtered = sources.filter((s) => {
    if (filterState.searchQuery && !matchesSearchText(s, filterState.searchQuery)) return false;

    if (filterState.resolution !== 'all') {
      const detected = detectResolutionCategory(s);
      if (detected !== filterState.resolution) return false;
    }

    if (filterState.size !== 'all' && !matchesSize(s, filterState.size)) return false;

    if (filterState.language !== 'all' && !matchesLanguage(s, filterState.language)) return false;

    return true;
  });

  return sortSources(filtered, filterState.sortBy);
}

export function isFilterActive(state: SourceFilterState): boolean {
  return (
    Boolean(state.searchQuery.trim()) ||
    state.resolution !== 'all' ||
    state.size !== 'all' ||
    state.language !== 'all' ||
    state.sortBy !== 'score'
  );
}

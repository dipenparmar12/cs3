import { useMemo, useState, useEffect } from 'react';
import type { SitePlugin, ProviderTreeRepository } from '../../types/plugin';
import type { OfficialRepository } from '../../../electron/officialRepositories';

/**
 * Filtering for the extensions screen.
 *
 * ## Tags are multi-select, and they are derived
 *
 * The screen this replaces filtered content type through a single `<select>`
 * with three hardcoded options — Movies, TV Series, Anime — and no way to pick
 * two. Both halves of that were wrong.
 *
 * *Single-select* does not match the question people have. "Anime or series"
 * and "everything except adult" are the ordinary asks, and neither is
 * expressible by choosing one value.
 *
 * *Hardcoded* is worse, because it silently dropped the rest. Providers declare
 * their own `TvType`s and upstream ships far more than three — `NSFW`, `Live`,
 * `Documentary`, `AsianDrama`, `Cartoon`, `Torrent`, `AnimeMovie` and others. A
 * fixed list of three meant a filter that quietly excluded whole categories the
 * user could see in front of them but not select. Tags are therefore collected
 * from what is actually installed, with live counts, so the filter can never
 * offer a tag with nothing behind it or hide one that exists.
 */

export type StatusFilter =
  | 'all'
  | 'installed'
  | 'available'
  | 'enabled'
  | 'disabled'
  | 'problems';

export interface FilterState {
  query: string;
  tags: Set<string>;
  languages: Set<string>;
  categories: Set<string>;
  status: StatusFilter;
}

/** A selectable tag with the number of things currently carrying it. */
export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Display names for upstream's `TvType` values.
 *
 * Only a relabelling — an unlisted type still appears, spelled as the provider
 * declared it, because a tag the user can see in a row must be selectable.
 */
const TAG_LABELS: Record<string, string> = {
  MOVIE: 'Movies',
  TVSERIES: 'TV Series',
  ANIME: 'Anime',
  ANIMEMOVIE: 'Anime Films',
  ONA: 'ONA',
  OVA: 'OVA',
  CARTOON: 'Cartoons',
  DOCUMENTARY: 'Documentary',
  ASIANDRAMA: 'Asian Drama',
  LIVE: 'Live TV',
  TORRENT: 'Torrent',
  OTHERS: 'Other',
  NSFW: '18+ Adult',
  AUDIOBOOK: 'Audiobooks',
  AUDIO: 'Audio',
  PODCAST: 'Podcasts',
  MUSIC: 'Music',
  CUSTOMMEDIA: 'Custom Media',
};

export function tagLabel(tag: string): string {
  return TAG_LABELS[tag.toUpperCase()] ?? tag;
}

export function isAdultTag(tag: string): boolean {
  return tag.toUpperCase() === 'NSFW';
}

/** Language codes seen in the corpus, mapped to something readable. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ar: 'Arabic',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  tr: 'Turkish',
  ru: 'Russian',
  pl: 'Polish',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Chinese',
  uk: 'Ukrainian',
  fa: 'Persian',
  he: 'Hebrew',
  ro: 'Romanian',
  cs: 'Czech',
  el: 'Greek',
  bn: 'Bengali',
  ml: 'Malayalam',
  mr: 'Marathi',
  kn: 'Kannada',
  universal: 'Universal',
  multi: 'Multi-language',
};

export function languageLabel(code: string): string {
  if (!code) return 'Unknown';
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

function bump(counts: Map<string, number>, key: string | undefined | null): void {
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toOptions(
  counts: Map<string, number>,
  label: (value: string) => string
): FacetOption[] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function useExtensionFilters(
  tree: ProviderTreeRepository[],
  plugins: SitePlugin[],
  officialRepos: OfficialRepository[],
  installedPluginNames: Set<string>
) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [languages, setLanguages] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusFilter>('all');

  // Typing must not re-filter hundreds of rows on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 150);
    return () => clearTimeout(timer);
  }, [query]);

  /**
   * Facets counted across everything the user can currently see — installed
   * extensions and catalogue entries alike — so a tag's count means "this many
   * things carry it", which is the number that makes the chip worth clicking.
   */
  const facets = useMemo(() => {
    const tagCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();

    for (const repo of tree) {
      for (const extension of repo.extensions) {
        for (const tag of extension.tvTypes ?? []) bump(tagCounts, tag.toUpperCase());
        bump(languageCounts, extension.language?.toLowerCase());
      }
    }
    for (const plugin of plugins) {
      if (installedPluginNames.has(plugin.internalName)) continue;
      for (const tag of plugin.tvTypes ?? []) bump(tagCounts, String(tag).toUpperCase());
      bump(languageCounts, plugin.language?.toLowerCase());
    }
    for (const repo of officialRepos) bump(categoryCounts, repo.category);

    return {
      tags: toOptions(tagCounts, tagLabel),
      languages: toOptions(languageCounts, languageLabel),
      categories: toOptions(categoryCounts, (value) => value),
    };
  }, [tree, plugins, officialRepos, installedPluginNames]);

  const activeCount =
    tags.size +
    languages.size +
    categories.size +
    (status !== 'all' ? 1 : 0) +
    (query ? 1 : 0);

  const reset = () => {
    setQuery('');
    setTags(new Set());
    setLanguages(new Set());
    setCategories(new Set());
    setStatus('all');
  };

  const toggleIn = (
    current: Set<string>,
    apply: (next: Set<string>) => void,
    value: string
  ) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  /**
   * Memoised, and it has to be.
   *
   * The views memoise their filtering on this object, and a fresh literal every
   * render would invalidate that memo every render — re-filtering hundreds of
   * tree nodes on each keystroke, which is precisely the cost the debounce above
   * was added to avoid.
   */
  const state: FilterState = useMemo(
    () => ({ query: debouncedQuery, tags, languages, categories, status }),
    [debouncedQuery, tags, languages, categories, status]
  );

  return {
    // raw inputs
    query,
    setQuery,
    status,
    setStatus,
    tags,
    toggleTag: (value: string) => toggleIn(tags, setTags, value),
    languages,
    toggleLanguage: (value: string) => toggleIn(languages, setLanguages, value),
    categories,
    toggleCategory: (value: string) => toggleIn(categories, setCategories, value),
    facets,
    activeCount,
    reset,
    state,
  };
}

// --- matchers ---------------------------------------------------------------

/**
 * Tag matching is OR within the tag set, and AND across different facets.
 *
 * Selecting Movies and Anime means "either", because they are alternatives at
 * the same level. Selecting Anime *and* German means "both", because they are
 * different questions. That is the behaviour of every faceted filter people
 * already use, and getting it backwards makes multi-select feel broken.
 */
export function matchesTags(itemTags: string[] | undefined, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  if (!itemTags || itemTags.length === 0) return false;
  return itemTags.some((tag) => selected.has(String(tag).toUpperCase()));
}

export function matchesLanguages(
  language: string | undefined,
  selected: Set<string>
): boolean {
  if (selected.size === 0) return true;
  return !!language && selected.has(language.toLowerCase());
}

export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  return fields.some((field) => field && field.toLowerCase().includes(query));
}

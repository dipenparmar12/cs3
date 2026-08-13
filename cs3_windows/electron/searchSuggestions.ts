import { fetchJson, postJson } from './torrent/http';
import { TvType, type SearchSuggestion } from '../src/types/api';
import { normaliseTitleForMatch, titleSimilarity } from './torrent/releaseParser';
import { buildCinemetaUrl } from './cinemeta';
import { buildMetadataUrl } from './metadataProvider';

/**
 * Title autocomplete for the search box.
 *
 * Content search answers "what can I stream"; this answers the question that
 * comes first — "what is this thing actually called". Typing `spidrman` into a
 * torrent indexer returns nothing and gives no hint why, because indexers match
 * release names literally. Catalogues do not: they are built for human queries
 * and forgive misspellings, so resolving the typo *before* the content search
 * runs is what turns a dead end into a result.
 *
 * Three catalogues are consulted rather than one, because their blind spots do
 * not overlap: Cinemeta is IMDb-backed and strong on films but literal about
 * spelling; TVmaze is television-only with genuinely fuzzy matching; AniList
 * resolves romaji/English anime titles neither of the others index well. A
 * title returned by more than one is very unlikely to be a fuzzy near-miss, so
 * agreement is scored as confidence.
 *
 * Results are merged on normalised title + year, per the rule that two rows
 * naming the same title and year are the same work no matter which catalogue
 * produced them.
 */

/** Suggestions race the user's next keystroke; a slow catalogue is a dropped one. */
const SUGGEST_TIMEOUT_MS = 4_000;

/** Enough to fill the dropdown twice over, so merging still leaves a full list. */
const PER_SOURCE_LIMIT = 12;
const MAX_SUGGESTIONS = 10;

/** Backspacing through a word must not re-issue requests already answered. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 60;

interface Candidate {
  title: string;
  year?: number;
  type?: TvType;
  posterUrl?: string;
  plot?: string;
  genres: string[];
  url: string;
  imdbId?: string;
  source: string;
}

interface CacheEntry {
  at: number;
  suggestions: SearchSuggestion[];
}

interface CinemetaSuggestMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  poster?: string;
  description?: string;
  releaseInfo?: string;
  genres?: string[];
}

interface TvMazeSuggestShow {
  id?: number;
  name?: string;
  premiered?: string;
  summary?: string;
  genres?: string[];
  type?: string;
  image?: { medium?: string; original?: string };
  externals?: { imdb?: string | null };
}

interface AniListSuggestMedia {
  id?: number;
  title?: { romaji?: string; english?: string };
  startDate?: { year?: number };
  description?: string;
  genres?: string[];
  format?: string;
  coverImage?: { large?: string; medium?: string };
}

function parseYear(value: string | undefined): number | undefined {
  const match = value?.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Catalogue plots arrive as HTML; the dropdown renders plain text. */
function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

/**
 * Character-bigram (Sørensen–Dice) similarity, 0..1.
 *
 * `titleSimilarity` compares whole-word token sets, which is right for release
 * names but scores a misspelling at exactly zero — "spidrman" and "spider man"
 * share no tokens. Since forgiving typos is the entire point of this feature,
 * ranking needs a measure that degrades smoothly instead of falling off a
 * cliff, and bigram overlap does that without the cost of an edit-distance
 * matrix per row.
 */
function bigramSimilarity(a: string, b: string): number {
  const bigrams = (value: string): Map<string, number> => {
    const out = new Map<string, number>();
    const clean = value.replace(/\s+/g, ' ');
    for (let i = 0; i < clean.length - 1; i++) {
      const pair = clean.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };

  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const [pair, count] of left) {
    shared += Math.min(count, right.get(pair) ?? 0);
  }

  const total = [...left.values()].reduce((s, n) => s + n, 0) +
    [...right.values()].reduce((s, n) => s + n, 0);
  return (2 * shared) / total;
}

function cinemetaType(type: 'movie' | 'series', genres: string[] | undefined): TvType {
  const isAnime = (genres ?? []).some((g) => /animation|anime/i.test(g));
  if (type === 'series') return isAnime ? TvType.Anime : TvType.TvSeries;
  return isAnime ? TvType.AnimeMovie : TvType.Movie;
}

export class SearchSuggestionService {
  private cache = new Map<string, CacheEntry>();

  /**
   * Returns the titles a query most plausibly means.
   *
   * Never rejects: an empty dropdown is a fine outcome for a search box, and a
   * catalogue outage must not surface as an error on every keystroke.
   */
  public async suggest(query: string, signal?: AbortSignal): Promise<SearchSuggestion[]> {
    const trimmed = query.trim();
    // One or two characters match nearly everything; the round trip buys nothing.
    if (trimmed.length < 2) return [];

    const cacheKey = trimmed.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.suggestions;

    const settled = await Promise.allSettled([
      this.fromCinemeta(trimmed, signal),
      this.fromTvMaze(trimmed, signal),
      this.fromAniList(trimmed, signal),
    ]);

    const candidates = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
    const suggestions = this.merge(candidates, trimmed);

    this.remember(cacheKey, suggestions);
    return suggestions;
  }

  private remember(key: string, suggestions: SearchSuggestion[]): void {
    this.cache.set(key, { at: Date.now(), suggestions });
    if (this.cache.size > CACHE_MAX_ENTRIES) {
      // Insertion-ordered: the oldest key is the first one Map yields.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  // --- catalogues ----------------------------------------------------------

  private async fromCinemeta(query: string, signal?: AbortSignal): Promise<Candidate[]> {
    const encoded = encodeURIComponent(query);
    const base = 'https://v3-cinemeta.strem.io';

    const [movies, series] = await Promise.allSettled([
      fetchJson<{ metas?: CinemetaSuggestMeta[] }>(
        `${base}/catalog/movie/top/search=${encoded}.json`,
        { signal, timeoutMs: SUGGEST_TIMEOUT_MS }
      ),
      fetchJson<{ metas?: CinemetaSuggestMeta[] }>(
        `${base}/catalog/series/top/search=${encoded}.json`,
        { signal, timeoutMs: SUGGEST_TIMEOUT_MS }
      ),
    ]);

    const out: Candidate[] = [];
    const collect = (
      settled: PromiseSettledResult<{ metas?: CinemetaSuggestMeta[] }>,
      type: 'movie' | 'series'
    ) => {
      if (settled.status !== 'fulfilled') return;
      for (const meta of (settled.value.metas ?? []).slice(0, PER_SOURCE_LIMIT)) {
        const imdbId = meta.imdb_id || meta.id;
        if (!imdbId?.startsWith('tt') || !meta.name) continue;
        out.push({
          title: meta.name,
          year: parseYear(meta.releaseInfo),
          type: cinemetaType(type, meta.genres),
          posterUrl: meta.poster,
          plot: stripHtml(meta.description),
          genres: meta.genres ?? [],
          url: buildCinemetaUrl(type, imdbId),
          imdbId,
          source: 'Cinemeta',
        });
      }
    };

    collect(movies, 'movie');
    collect(series, 'series');
    return out;
  }

  private async fromTvMaze(query: string, signal?: AbortSignal): Promise<Candidate[]> {
    const raw = await fetchJson<Array<{ show?: TvMazeSuggestShow }>>(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
      { signal, timeoutMs: SUGGEST_TIMEOUT_MS }
    );
    if (!Array.isArray(raw)) return [];

    return raw
      .slice(0, PER_SOURCE_LIMIT)
      .map(({ show }) => show)
      .filter((show): show is TvMazeSuggestShow => Boolean(show?.id && show.name))
      .map<Candidate>((show) => ({
        title: show.name as string,
        year: show.premiered ? parseInt(show.premiered.slice(0, 4), 10) : undefined,
        type: /animation/i.test(show.type ?? '') ? TvType.Anime : TvType.TvSeries,
        posterUrl: show.image?.original || show.image?.medium,
        plot: stripHtml(show.summary),
        genres: show.genres ?? [],
        url: buildMetadataUrl('tvmaze', show.id as number),
        imdbId: show.externals?.imdb ?? undefined,
        source: 'TVmaze',
      }));
  }

  private async fromAniList(query: string, signal?: AbortSignal): Promise<Candidate[]> {
    const body = {
      query: `
        query ($search: String, $perPage: Int) {
          Page(perPage: $perPage) {
            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
              id
              title { romaji english }
              startDate { year }
              description
              genres
              format
              coverImage { large medium }
            }
          }
        }
      `,
      variables: { search: query, perPage: PER_SOURCE_LIMIT },
    };

    const response = await postJson<{ data?: { Page?: { media?: AniListSuggestMedia[] } } }>(
      'https://graphql.anilist.co',
      body,
      { signal, timeoutMs: SUGGEST_TIMEOUT_MS }
    );

    return (response.data?.Page?.media ?? [])
      .filter((media) => media.id && (media.title?.english || media.title?.romaji))
      .map<Candidate>((media) => ({
        // English where it exists: it is what a viewer typed and what indexers
        // are most likely to carry.
        title: (media.title?.english || media.title?.romaji) as string,
        year: media.startDate?.year,
        type: media.format === 'MOVIE' ? TvType.AnimeMovie : TvType.Anime,
        posterUrl: media.coverImage?.large || media.coverImage?.medium,
        plot: stripHtml(media.description),
        genres: media.genres ?? [],
        url: buildMetadataUrl('anilist', media.id as number),
        source: 'AniList',
      }));
  }

  // --- merge ---------------------------------------------------------------

  /**
   * Collapses candidates naming the same work, then orders by relevance.
   *
   * Two passes are needed because a year is not always present. The first
   * merges on title+year, which is the exact rule; the second folds a
   * year-less row into a year-bearing row of the same title, which is almost
   * always the same work reported by a catalogue that omitted the date. Doing
   * that in one pass would let a year-less row claim its own slot and show the
   * user the same title twice.
   */
  private merge(candidates: Candidate[], query: string): SearchSuggestion[] {
    const byKey = new Map<string, SearchSuggestion>();
    const yearlessKeys: string[] = [];

    for (const candidate of candidates) {
      const normalised = normaliseTitleForMatch(candidate.title);
      if (!normalised) continue;

      const key = `${normalised}|${candidate.year ?? ''}`;
      const existing = byKey.get(key);

      if (existing) {
        this.absorb(existing, candidate);
        continue;
      }

      byKey.set(key, {
        title: candidate.title,
        year: candidate.year,
        type: candidate.type,
        posterUrl: candidate.posterUrl,
        plot: candidate.plot,
        genres: [...candidate.genres],
        url: candidate.url,
        imdbId: candidate.imdbId,
        sources: [candidate.source],
      });
      if (candidate.year === undefined) yearlessKeys.push(key);
    }

    for (const key of yearlessKeys) {
      const yearless = byKey.get(key);
      if (!yearless) continue;
      const normalised = key.slice(0, -1);

      const dated = [...byKey.entries()].find(
        ([otherKey, value]) =>
          otherKey !== key && otherKey.startsWith(`${normalised}|`) && value.year !== undefined
      );
      if (!dated) continue;

      this.absorb(dated[1], yearless);
      byKey.delete(key);
    }

    return [...byKey.values()]
      .map((suggestion) => ({ suggestion, score: this.score(suggestion, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((entry) => entry.suggestion);
  }

  /** Folds a duplicate into the kept row, filling gaps rather than overwriting. */
  private absorb(target: SearchSuggestion, extra: Candidate | SearchSuggestion): void {
    const sources = 'sources' in extra ? extra.sources : [extra.source];
    for (const source of sources) {
      if (!target.sources.includes(source)) target.sources.push(source);
    }

    target.posterUrl ??= extra.posterUrl;
    target.plot ??= extra.plot;
    target.year ??= extra.year;
    target.type ??= extra.type;
    // An IMDb id is the most valuable field a merge can contribute: it is what
    // the strongest indexer is addressed by, so it is taken from whichever
    // catalogue had one.
    target.imdbId ??= extra.imdbId;
    if (target.imdbId && extra.imdbId === target.imdbId && !target.url.startsWith('cs3meta://cinemeta')) {
      target.url = extra.url;
    }

    for (const genre of extra.genres) {
      if (!target.genres.includes(genre)) target.genres.push(genre);
    }
  }

  private score(suggestion: SearchSuggestion, query: string): number {
    const normalisedQuery = normaliseTitleForMatch(query);
    const normalisedTitle = normaliseTitleForMatch(suggestion.title);

    // Whichever measure is kinder: token overlap wins on multi-word queries,
    // bigram overlap carries the misspelled ones where tokens match nothing.
    const score2 = Math.max(
      titleSimilarity(query, suggestion.title),
      bigramSimilarity(normalisedQuery, normalisedTitle)
    );
    let score = score2 * 100;

    if (normalisedTitle === normalisedQuery) score += 60;
    else if (normalisedTitle.startsWith(normalisedQuery)) score += 25;
    // A partial word the user is still typing ("spider m") is a prefix of the
    // title even though it is not a prefix of any whole token.
    else if (normalisedTitle.includes(normalisedQuery)) score += 12;

    // Independent agreement between catalogues is the best evidence a row is
    // the real title rather than one catalogue's fuzzy near-miss.
    score += (suggestion.sources.length - 1) * 12;

    // A row the user can recognise is worth more than one they cannot.
    if (suggestion.posterUrl) score += 6;
    if (suggestion.year) score += 4;
    if (suggestion.imdbId) score += 3;

    const extraWords =
      normalisedTitle.split(' ').length - normalisedQuery.split(' ').length;
    if (extraWords > 0) score -= Math.min(20, extraWords * 4);

    return score;
  }
}

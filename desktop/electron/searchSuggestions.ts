import { fetchJson, postJson } from './torrent/http.ts';
import { TvType, type SearchSuggestion } from '../src/types/api.ts';
import { normaliseTitleForMatch, titleSimilarity } from './torrent/releaseParser.ts';
import { buildCinemetaUrl, parseCinemetaUrl } from './cinemeta.ts';
import { buildMetadataUrl } from './metadataProvider.ts';

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
 * not overlap. Measured against live endpoints:
 *
 * - **Cinemeta** is IMDb-backed, covers films, and forgives typos (`spidrman`
 *   returns the Spider-Man films). Its *search* response carries no genres and
 *   no description, so those are filled in by {@link SearchSuggestionService.enrich}.
 * - **TVmaze** is television-only but the most typo-tolerant of the three, and
 *   returns genres and a summary inline (`brakin bad` → Breaking Bad).
 * - **AniList** resolves romaji/English anime titles the others index poorly,
 *   but its `SEARCH_MATCH` is *not* typo-tolerant — `atack on titn` returns
 *   nothing. TVmaze covers that case, which is precisely why three sources are
 *   queried instead of trusting any one of them.
 *
 * A title returned by more than one catalogue is very unlikely to be a fuzzy
 * near-miss, so agreement is scored as confidence.
 *
 * Results are merged on normalised title + year, per the rule that two rows
 * naming the same title and year are the same work no matter which catalogue
 * produced them.
 *
 * ## Why this is push-shaped, and what it cost before it was
 *
 * The first version awaited all three catalogues, then awaited up to six
 * `/meta/` lookups for genre and plot, then answered. Measured against the live
 * endpoints, in milliseconds:
 *
 * | query      | fan-out | the awaited enrich after it |
 * |------------|---------|-----------------------------|
 * | `sp`       | 935     | 388                         |
 * | `spi`      | 437     | 187                         |
 * | `spider`   | 290     | 52                          |
 * | `spidrman` | 696     | 315                         |
 *
 * Add the renderer's 250 ms debounce and the first row appeared **0.6–1.6 s**
 * after the viewer stopped typing — which is the report this rewrite answers.
 * Three separate faults, and the fan-out was the smallest of them:
 *
 * 1. **The enrich was awaited.** It is a *decoration* — genre and plot on rows
 *    that are already correct, already ordered and already carry a poster — and
 *    it was holding back the entire list. It now runs behind the answer.
 * 2. **The fastest two sources waited for the slowest.** TVmaze answers in
 *    ~170 ms and Cinemeta's movie catalogue in up to 935; `Promise.allSettled`
 *    paid the 935 every time. Each source now publishes as it lands.
 * 3. **Nothing was reused between keystrokes.** `spider` and `spiderm` share
 *    every answer worth showing, and the second query started from nothing.
 *    {@link instant} answers the second from the first, with no I/O at all.
 *
 * The fan-out itself is left alone: it is somebody else's server and it is
 * already parallel. What changed is that nothing waits for the whole of it.
 */

/** Suggestions race the user's next keystroke; a slow catalogue is a dropped one. */
const SUGGEST_TIMEOUT_MS = 4_000;

/** Enough to fill the dropdown twice over, so merging still leaves a full list. */
const PER_SOURCE_LIMIT = 12;
const MAX_SUGGESTIONS = 10;

/** Backspacing through a word must not re-issue requests already answered. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 120;

/** How many visible rows get a second lookup for genre and plot. */
const ENRICH_LIMIT = 6;
const ENRICH_TIMEOUT_MS = 2_500;

/**
 * Below this, only Cinemeta is asked.
 *
 * A single character is a real query — the brief asks for rows after the first
 * one or two — but it identifies nothing, so three fan-outs per keystroke buy
 * an unrankable list at triple the cost to three third-party hosts. Cinemeta is
 * the one to keep: it is IMDb-backed, it covers both films and series, and it
 * is the only one of the three whose single-letter answer is ordered by
 * popularity rather than by string match.
 */
const FULL_FANOUT_MIN_LENGTH = 2;

/**
 * Which catalogue's answer shapes a merged row, regardless of who answered
 * first.
 *
 * The sources now publish as they land, so `found` accumulates in *arrival*
 * order — which is a property of three third-party hosts on the night. The
 * merge keeps the first candidate's title, poster and URL and folds the rest
 * onto it, so without a fixed precedence the identity of a merged row would
 * vary between runs: measured, *One Piece* comes back as `One Piece` from one
 * catalogue and `One Piece!` from another, and the row would read differently
 * depending on network timing. That URL is what a picked suggestion carries as
 * `ExactMedia.url`, so this is identity, not decoration.
 *
 * Cinemeta first because it is the IMDb-backed one and its address is the one
 * `absorb` already prefers; the order is otherwise the one the previous
 * `Promise.allSettled` produced, so nothing about the merged output changed
 * when the fan-out stopped being ordered.
 */
const SOURCE_PRECEDENCE = ['Cinemeta', 'TVmaze', 'AniList'];

interface Candidate {
  title: string;
  /**
   * Where this row sat in its own catalogue's answer.
   *
   * All three sources answer best-first by their own measure — Cinemeta's
   * `top` catalogue is its popularity ordering, TVmaze scores its search, and
   * AniList's `SEARCH_MATCH` sorts by match quality — so the position is
   * evidence, and the previous scorer discarded it entirely. Measured, that is
   * what put a 1991 television film called *Spider!* above *Spider-Man* for the
   * query `spider`: both are ordinary matches on the text, and the only thing
   * separating them is that one of them is the film people mean.
   */
  rank: number;
  originalTitle?: string;
  alternateTitles?: string[];
  year?: number;
  type?: TvType;
  posterUrl?: string;
  plot?: string;
  genres: string[];
  language?: string;
  url: string;
  imdbId?: string;
  source: string;
}

/**
 * The bonus a row earns for its catalogue's own ordering.
 *
 * Decaying, and capped well below the exact-title bonus: this is a tie-breaker
 * between rows that match the text equally well, not a popularity contest that
 * can bury the title somebody actually typed.
 */
function rankBonus(rank: number): number {
  return Math.max(0, 18 - rank * 1.5);
}

/**
 * The similarity floor for a title the query is a prefix of.
 *
 * Bigram overlap measures *how much of two strings is shared*, which is the
 * wrong question for a half-typed query: measured against `dune`, the title
 * `Dune: Part Two` scores 0.50 and `Dune Drifter` scores 0.67, purely because
 * one has a shorter tail. Combined with the word-count penalty below, that put
 * an obscure 2020 film above the one the viewer was obviously typing — and
 * Cinemeta had ranked the franchise entries 0, 1 and 2 in the reply.
 *
 * So a prefix match is scored as what it is — everything typed so far matched —
 * and the ordering within that tier is left to the catalogue's own, which is
 * the only thing here that knows which *Dune* people mean.
 */
const PREFIX_SIMILARITY_FLOOR = 0.85;

interface CacheEntry {
  at: number;
  suggestions: SearchSuggestion[];
  /** False while the fan-out is still running behind a provisional answer. */
  done: boolean;
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
  language?: string;
  image?: { medium?: string; original?: string };
  externals?: { imdb?: string | null };
}

/**
 * Anime, or merely animated?
 *
 * TVmaze types every cartoon as `Animation`, so keying off that alone labelled
 * *Spider-Man (1994)* as anime. The distinction matters downstream: anime is
 * routed to anime-only indexers and exempted from the ranker's year check, so
 * a mislabelled Western cartoon searches the wrong places. Language is the
 * reliable discriminator, with an explicit `Anime` genre as the override.
 */
function tvMazeType(show: TvMazeSuggestShow): TvType {
  const genres = show.genres ?? [];
  if (genres.some((g) => /^anime$/i.test(g))) return TvType.Anime;
  if (/animation/i.test(show.type ?? '') && /japanese/i.test(show.language ?? '')) {
    return TvType.Anime;
  }
  return TvType.TvSeries;
}

interface AniListSuggestMedia {
  id?: number;
  title?: { romaji?: string; english?: string; native?: string };
  synonyms?: string[];
  countryOfOrigin?: string;
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
 * The normalised title with its spaces taken out.
 *
 * `spiderman` and `Spider-Man` are the same word to everyone except a string
 * comparison: normalisation removes the hyphen and leaves `spider man`, which
 * is neither equal to nor a prefix of `spiderman`. The brief names this exact
 * case, and it is not a niche one — it is how most people type most franchise
 * titles. Collapsing both sides is a two-line fix that turns three of the
 * scoring bonuses below from misses into hits.
 */
export function collapseTitle(value: string): string {
  return normaliseTitleForMatch(value).replace(/\s+/g, '');
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
export function bigramSimilarity(a: string, b: string): number {
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

function isAnimeType(type: TvType | undefined): boolean {
  return type === TvType.Anime || type === TvType.AnimeMovie || type === TvType.OVA;
}

function cinemetaType(type: 'movie' | 'series', genres: string[] | undefined): TvType {
  const isAnime = (genres ?? []).some((g) => /animation|anime/i.test(g));
  if (type === 'series') return isAnime ? TvType.Anime : TvType.TvSeries;
  return isAnime ? TvType.AnimeMovie : TvType.Movie;
}

/** Every name a row answers to, for matching. Display uses `title` alone. */
export function matchableNames(suggestion: SearchSuggestion): string[] {
  return [suggestion.title, suggestion.originalTitle, ...(suggestion.alternateTitles ?? [])]
    .filter((name): name is string => Boolean(name?.trim()));
}

/**
 * Does this row still plausibly answer a longer query?
 *
 * Used only to reuse a cached answer while the network runs for the new one, so
 * it is deliberately generous: showing a row that the fresh answer then drops
 * costs a flicker, while dropping one it would have kept costs an empty
 * dropdown for the length of a round trip. Both prefix and substring count,
 * across every name the row answers to.
 */
export function stillMatches(suggestion: SearchSuggestion, query: string): boolean {
  const collapsed = collapseTitle(query);
  if (!collapsed) return true;
  const spaced = normaliseTitleForMatch(query);
  return matchableNames(suggestion).some((name) => {
    const candidate = collapseTitle(name);
    if (candidate.includes(collapsed)) return true;
    return normaliseTitleForMatch(name).includes(spaced);
  });
}

/** How each source's rows reach the merge, as it lands. */
export interface SuggestionProgress {
  (suggestions: SearchSuggestion[], done: boolean): void;
}

export class SearchSuggestionService {
  private cache = new Map<string, CacheEntry>();

  /**
   * What can be shown *right now*, with no I/O whatsoever.
   *
   * Three answers, in descending confidence: this exact query already ran; a
   * shorter query already ran and its rows still match (the common case while
   * someone types a word); or nothing, and the dropdown stays as it was rather
   * than blanking.
   *
   * Synchronous on purpose. The whole point is that it costs nothing, and an
   * `async` signature here would invite a caller to await it beside the network
   * call — which is how the latency this method exists to remove got there in
   * the first place.
   */
  public instant(query: string): { suggestions: SearchSuggestion[]; done: boolean } {
    const trimmed = query.trim();
    if (!trimmed) return { suggestions: [], done: true };

    const key = trimmed.toLowerCase();
    const exact = this.cache.get(key);
    if (exact && Date.now() - exact.at < CACHE_TTL_MS) {
      return { suggestions: exact.suggestions, done: exact.done };
    }

    // The longest cached prefix of this query is the closest thing already
    // known. Longest, not first: `spide` describes `spiderm` better than `sp`.
    let best: { key: string; entry: CacheEntry } | null = null;
    for (const [cachedKey, entry] of this.cache) {
      if (!key.startsWith(cachedKey)) continue;
      if (Date.now() - entry.at >= CACHE_TTL_MS) continue;
      if (!best || cachedKey.length > best.key.length) best = { key: cachedKey, entry };
    }
    if (!best) return { suggestions: [], done: false };

    const narrowed = best.entry.suggestions.filter((row) => stillMatches(row, trimmed));
    // Never `done`: these are last keystroke's rows re-filtered, and calling
    // them final would stop the caller replacing them with the real answer.
    return { suggestions: narrowed, done: false };
  }

  /**
   * Returns the titles a query most plausibly means.
   *
   * Never rejects: an empty dropdown is a fine outcome for a search box, and a
   * catalogue outage must not surface as an error on every keystroke.
   *
   * `onProgress` receives the merged list each time a catalogue lands, and once
   * more when everything has. The returned promise resolves with the final
   * list, so a caller that does not care about progress can ignore it entirely.
   */
  public async suggest(
    query: string,
    signal?: AbortSignal,
    onProgress?: SuggestionProgress
  ): Promise<SearchSuggestion[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = trimmed.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached?.done && Date.now() - cached.at < CACHE_TTL_MS) {
      onProgress?.(cached.suggestions, true);
      return cached.suggestions;
    }

    const found: Candidate[] = [];
    let published: SearchSuggestion[] = [];

    /**
     * Merges everything landed so far and hands it up.
     *
     * Re-merging from scratch rather than folding one source into a previous
     * result: the merge is order-dependent (a year-less row folds into a dated
     * one, and anime wins a type disagreement), so an incremental version would
     * produce a different list depending on which host was quickest — the same
     * class of bug as `diffProviders` observing a global by its length.
     */
    const publish = (done: boolean) => {
      published = this.merge(found, trimmed);
      this.remember(cacheKey, published, done);
      onProgress?.(published, done);
    };

    const sources: Array<Promise<void>> = [
      this.fromCinemeta(trimmed, signal)
        .then((rows) => {
          found.push(...rows);
          publish(false);
        })
        .catch(() => {}),
    ];

    if (trimmed.length >= FULL_FANOUT_MIN_LENGTH) {
      sources.push(
        this.fromTvMaze(trimmed, signal)
          .then((rows) => {
            found.push(...rows);
            publish(false);
          })
          .catch(() => {}),
        this.fromAniList(trimmed, signal)
          .then((rows) => {
            found.push(...rows);
            publish(false);
          })
          .catch(() => {})
      );
    }

    await Promise.all(sources);
    publish(true);

    // Behind the answer, never in front of it. See the header: this is the step
    // that used to hold the whole list back for a genre chip.
    void this.enrich(published, signal)
      .then((changed) => {
        if (!changed || signal?.aborted) return;
        this.remember(cacheKey, published, true);
        onProgress?.(published, true);
      })
      .catch(() => {});

    return published;
  }

  /**
   * Fills in genre and plot for rows that only Cinemeta produced.
   *
   * Measured, not assumed: Cinemeta's *catalogue search* response carries only
   * `id`, `imdb_id`, `name`, `poster`, `releaseInfo`, `type` and artwork — no
   * genres and no description. Its `/meta/` endpoint has both and answers in
   * about half a second. Films are the case that needs this, since TVmaze is
   * television-only and AniList is anime-only, so a film would otherwise show
   * as a bare title with no way to tell two same-named works apart.
   *
   * Bounded on purpose: only the rows the user can actually see, only the ones
   * still missing data, and failures are ignored rather than delaying the list.
   * Answers whether anything actually changed, so a pass that filled nothing in
   * does not push an identical list back to the renderer.
   */
  private async enrich(
    suggestions: SearchSuggestion[],
    signal?: AbortSignal
  ): Promise<boolean> {
    const targets = suggestions
      .slice(0, ENRICH_LIMIT)
      .filter((s) => s.imdbId && (s.genres.length === 0 || !s.plot));

    if (targets.length === 0) return false;

    let changed = false;

    await Promise.allSettled(
      targets.map(async (suggestion) => {
        const ref = parseCinemetaUrl(suggestion.url);
        const kind = ref?.type ?? (suggestion.type === TvType.Movie ? 'movie' : 'series');

        const response = await fetchJson<{ meta?: CinemetaSuggestMeta }>(
          `https://v3-cinemeta.strem.io/meta/${kind}/${suggestion.imdbId}.json`,
          { signal, timeoutMs: ENRICH_TIMEOUT_MS, retries: 0 }
        );

        const meta = response.meta;
        if (!meta) return;

        if (!suggestion.plot && stripHtml(meta.description)) {
          suggestion.plot = stripHtml(meta.description);
          changed = true;
        }
        for (const genre of meta.genres ?? []) {
          if (!suggestion.genres.includes(genre)) {
            suggestion.genres.push(genre);
            changed = true;
          }
        }
        // Anime is only detectable once genres exist, so the type is revisited
        // here rather than being fixed at search time on absent data.
        if (meta.genres?.length) {
          suggestion.type = cinemetaType(kind, meta.genres);
        }
      })
    );

    return changed;
  }

  private remember(key: string, suggestions: SearchSuggestion[], done: boolean): void {
    // Re-inserted rather than updated in place, so the eviction below sees the
    // refreshed entry as the newest — `Map.set` on an existing key keeps its
    // original position, which would make the most active query the first out.
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), suggestions, done });
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
        { signal, timeoutMs: SUGGEST_TIMEOUT_MS, retries: 0 }
      ),
      fetchJson<{ metas?: CinemetaSuggestMeta[] }>(
        `${base}/catalog/series/top/search=${encoded}.json`,
        { signal, timeoutMs: SUGGEST_TIMEOUT_MS, retries: 0 }
      ),
    ]);

    const out: Candidate[] = [];
    const collect = (
      settled: PromiseSettledResult<{ metas?: CinemetaSuggestMeta[] }>,
      type: 'movie' | 'series'
    ) => {
      if (settled.status !== 'fulfilled') return;
      const metas = (settled.value.metas ?? []).slice(0, PER_SOURCE_LIMIT);
      for (const [index, meta] of metas.entries()) {
        const imdbId = meta.imdb_id || meta.id;
        if (!imdbId?.startsWith('tt') || !meta.name) continue;
        out.push({
          rank: index,
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
      { signal, timeoutMs: SUGGEST_TIMEOUT_MS, retries: 0 }
    );
    if (!Array.isArray(raw)) return [];

    return raw
      .slice(0, PER_SOURCE_LIMIT)
      .map(({ show }) => show)
      .filter((show): show is TvMazeSuggestShow => Boolean(show?.id && show.name))
      .map<Candidate>((show, index) => ({
        rank: index,
        title: show.name as string,
        year: show.premiered ? parseInt(show.premiered.slice(0, 4), 10) : undefined,
        type: tvMazeType(show),
        posterUrl: show.image?.original || show.image?.medium,
        plot: stripHtml(show.summary),
        genres: show.genres ?? [],
        language: show.language || undefined,
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
              title { romaji english native }
              synonyms
              countryOfOrigin
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
      { signal, timeoutMs: SUGGEST_TIMEOUT_MS, retries: 0 }
    );

    return (response.data?.Page?.media ?? [])
      .filter((media) => media.id && (media.title?.english || media.title?.romaji))
      .map<Candidate>((media, index) => {
        // English where it exists: it is what a viewer typed and what indexers
        // are most likely to carry.
        const title = (media.title?.english || media.title?.romaji) as string;
        // Every other spelling becomes something the row answers to. This is
        // what makes `shingeki` find *Attack on Titan* — the romaji is a
        // synonym of a title it shares no characters with.
        const aliases = [media.title?.romaji, media.title?.english, ...(media.synonyms ?? [])]
          .filter((name): name is string => Boolean(name?.trim()))
          .filter((name) => collapseTitle(name) !== collapseTitle(title))
          .slice(0, 6);
        return {
          rank: index,
          title,
          originalTitle: media.title?.native || undefined,
          alternateTitles: aliases.length ? aliases : undefined,
          year: media.startDate?.year,
          type: media.format === 'MOVIE' ? TvType.AnimeMovie : TvType.Anime,
          posterUrl: media.coverImage?.large || media.coverImage?.medium,
          plot: stripHtml(media.description),
          genres: media.genres ?? [],
          language: media.countryOfOrigin === 'JP' ? 'Japanese' : undefined,
          url: buildMetadataUrl('anilist', media.id as number),
          source: 'AniList',
        };
      });
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
  private merge(input: Candidate[], query: string): SearchSuggestion[] {
    // Stable within a source, so each catalogue's own ordering — which is the
    // popularity signal `rankBonus` reads — survives the sort.
    const candidates = [...input].sort(
      (a, b) => SOURCE_PRECEDENCE.indexOf(a.source) - SOURCE_PRECEDENCE.indexOf(b.source)
    );

    const byKey = new Map<string, SearchSuggestion>();
    /**
     * The best position this work reached in any catalogue.
     *
     * Best rather than average: a title that is top of Cinemeta's popularity
     * list and fortieth in TVmaze's text search is the popular one, and
     * averaging would let a source that happens not to specialise in it drag
     * down a row every other source agrees about.
     */
    const bestRank = new Map<string, number>();
    const yearlessKeys: string[] = [];

    for (const candidate of candidates) {
      const normalised = normaliseTitleForMatch(candidate.title);
      if (!normalised) continue;

      const key = `${normalised}|${candidate.year ?? ''}`;
      const existing = byKey.get(key);

      if (existing) {
        bestRank.set(key, Math.min(bestRank.get(key) ?? candidate.rank, candidate.rank));
        this.absorb(existing, candidate);
        continue;
      }

      bestRank.set(key, candidate.rank);
      byKey.set(key, {
        title: candidate.title,
        originalTitle: candidate.originalTitle,
        alternateTitles: candidate.alternateTitles ? [...candidate.alternateTitles] : undefined,
        year: candidate.year,
        type: candidate.type,
        posterUrl: candidate.posterUrl,
        plot: candidate.plot,
        genres: [...candidate.genres],
        language: candidate.language,
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

      bestRank.set(
        dated[0],
        Math.min(bestRank.get(dated[0]) ?? Infinity, bestRank.get(key) ?? Infinity)
      );
      this.absorb(dated[1], yearless);
      byKey.delete(key);
      bestRank.delete(key);
    }

    return [...byKey.entries()]
      .map(([key, suggestion]) => ({
        suggestion,
        score: this.score(suggestion, query) + rankBonus(bestRank.get(key) ?? 0),
      }))
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
    target.language ??= extra.language;
    target.originalTitle ??= extra.originalTitle;

    if (extra.alternateTitles?.length) {
      const known = new Set(
        [target.title, target.originalTitle, ...(target.alternateTitles ?? [])]
          .filter(Boolean)
          .map((name) => collapseTitle(name as string))
      );
      const merged = [...(target.alternateTitles ?? [])];
      for (const alias of extra.alternateTitles) {
        const collapsed = collapseTitle(alias);
        if (known.has(collapsed)) continue;
        known.add(collapsed);
        merged.push(alias);
      }
      target.alternateTitles = merged.length ? merged.slice(0, 8) : undefined;
    }

    // Anime wins any disagreement. AniList indexes nothing else, so its
    // agreement is proof; the other two routinely call a series "TvSeries"
    // because they do not model anime at all. The distinction is not cosmetic —
    // it selects anime-only indexers and relaxes the ranker's year check, so
    // "Naruto" classified as TvSeries searches the wrong places.
    if (isAnimeType(extra.type) || isAnimeType(target.type)) {
      target.type = isAnimeType(target.type) ? target.type : extra.type;
    } else {
      target.type ??= extra.type;
    }
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

  /**
   * How well a row answers the query.
   *
   * Scored against **every name the row answers to**, not just the displayed
   * one. A viewer typing `shingeki` is describing *Attack on Titan* exactly,
   * and scoring only the English title would rank it below whatever happened to
   * share a bigram with the romaji.
   */
  private score(suggestion: SearchSuggestion, query: string): number {
    const normalisedQuery = normaliseTitleForMatch(query);
    const collapsedQuery = collapseTitle(query);
    const names = matchableNames(suggestion);

    let similarity = 0;
    let exact = false;
    let prefix = false;
    let contains = false;

    for (const name of names) {
      const normalised = normaliseTitleForMatch(name);
      const collapsed = collapseTitle(name);
      // Whichever measure is kinder: token overlap wins on multi-word queries,
      // bigram overlap carries the misspelled ones where tokens match nothing.
      similarity = Math.max(
        similarity,
        titleSimilarity(query, name),
        bigramSimilarity(normalisedQuery, normalised),
        // Collapsed, so `spiderman` scores against `Spider-Man` as the same
        // word rather than as two that happen to share letters.
        bigramSimilarity(collapsedQuery, collapsed)
      );
      if (collapsed === collapsedQuery) exact = true;
      else if (collapsed.startsWith(collapsedQuery)) prefix = true;
      else if (collapsed.includes(collapsedQuery)) contains = true;
    }

    // Everything typed so far matched, so the untyped remainder must not count
    // against the row. See `PREFIX_SIMILARITY_FLOOR`.
    if (exact || prefix) similarity = Math.max(similarity, PREFIX_SIMILARITY_FLOOR);

    let score = similarity * 100;

    if (exact) score += 60;
    else if (prefix) score += 25;
    // A partial word the user is still typing ("spider m") is a prefix of the
    // title even though it is not a prefix of any whole token.
    else if (contains) score += 12;

    // A match that needed an alias is still a match, but the displayed title is
    // what the viewer will read — so a row whose *shown* name matches outranks
    // one that only matched a synonym, all else equal.
    if (collapseTitle(suggestion.title).includes(collapsedQuery)) score += 6;

    // Independent agreement between catalogues is the best evidence a row is
    // the real title rather than one catalogue's fuzzy near-miss.
    score += (suggestion.sources.length - 1) * 12;

    // A row the user can recognise is worth more than one they cannot.
    if (suggestion.posterUrl) score += 6;
    if (suggestion.year) score += 4;
    if (suggestion.imdbId) score += 3;

    /**
     * Words the title has and the query does not.
     *
     * Skipped for a prefix match, for the same reason the similarity floor
     * exists: those words are the ones the viewer has not typed *yet*, and
     * charging for them ranks a franchise by how short its subtitles are.
     * It still applies to a loose match, where extra words really are evidence
     * that the row is about something else.
     */
    if (!exact && !prefix) {
      const extraWords =
        normaliseTitleForMatch(suggestion.title).split(' ').length -
        normalisedQuery.split(' ').length;
      if (extraWords > 0) score -= Math.min(20, extraWords * 4);
    }

    return score;
  }
}

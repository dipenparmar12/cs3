import { fetchJson } from './torrent/http';
import { TvType, type Episode, type SearchResponse } from '../src/types/api';
import { normaliseTitleForMatch, titleSimilarity } from './torrent/releaseParser';

/**
 * Cinemeta — IMDb-keyed catalogue metadata for movies and series.
 *
 * This replaces TVmaze as the primary metadata source for one decisive reason:
 * **TVmaze is television-only, so movie searches never produced an IMDb id**,
 * and Torrentio — the indexer that actually works behind ISP DNS blocks — is
 * addressed purely by IMDb id. Without this layer, every movie search resolved
 * to zero sources no matter how healthy the indexers were.
 *
 * Cinemeta returns `imdb_id` directly on every result, covers both types, and
 * ships episode lists and runtime, so it also feeds the ranker's size sanity check.
 */

const BASE = 'https://v3-cinemeta.strem.io';

interface CinemetaMeta {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  runtime?: string;
  genres?: string[];
  cast?: string[];
  videos?: CinemetaVideo[];
}

interface CinemetaVideo {
  id?: string;
  name?: string;
  title?: string;
  season?: number;
  number?: number;
  episode?: number;
  firstAired?: string;
  released?: string;
  overview?: string;
  description?: string;
  thumbnail?: string;
  rating?: string;
}

interface CatalogResponse {
  metas?: CinemetaMeta[];
}

interface MetaResponse {
  meta?: CinemetaMeta;
}

export interface CinemetaDetail {
  name: string;
  imdbId: string;
  type: TvType;
  posterUrl?: string;
  backgroundUrl?: string;
  year?: number;
  plot?: string;
  rating?: number;
  tags?: string[];
  actors?: string[];
  duration?: string;
  runtimeMinutes?: number;
  episodes: Episode[];
}

/** Identity for a Cinemeta item: `cs3meta://cinemeta/<movie|series>/<imdbId>`. */
export function buildCinemetaUrl(type: 'movie' | 'series', imdbId: string): string {
  return `cs3meta://cinemeta/${type}/${imdbId}`;
}

export function parseCinemetaUrl(
  url: string
): { type: 'movie' | 'series'; imdbId: string } | null {
  const match = url.match(/^cs3meta:\/\/cinemeta\/(movie|series)\/(tt\d+)/);
  if (!match) return null;
  return { type: match[1] as 'movie' | 'series', imdbId: match[2] };
}

/** `releaseInfo` is "2024", "2008–2013", or "2019–". Take the first year. */
function parseYear(releaseInfo: string | undefined): number | undefined {
  const match = releaseInfo?.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

function parseRuntimeMinutes(runtime: string | undefined): number | undefined {
  if (!runtime) return undefined;
  const hours = runtime.match(/(\d+)\s*h/i);
  const minutes = runtime.match(/(\d+)\s*min/i);
  if (!hours && !minutes) return undefined;
  return (hours ? parseInt(hours[1], 10) * 60 : 0) + (minutes ? parseInt(minutes[1], 10) : 0);
}

function toTvType(type: string | undefined, genres: string[] | undefined): TvType {
  const isAnime = (genres ?? []).some((g) => /animation|anime/i.test(g));
  if (type === 'series') return isAnime ? TvType.Anime : TvType.TvSeries;
  return isAnime ? TvType.AnimeMovie : TvType.Movie;
}

/**
 * Orders catalogue hits by how well they match what was typed.
 *
 * Cinemeta returns movies and series from two independent catalogues, each
 * internally ranked but not comparable to the other. Naively interleaving them
 * put "El Camino: A Breaking Bad Movie" above the series "Breaking Bad" for the
 * query "Breaking Bad" — the movie catalogue's top hit always won the first
 * slot regardless of relevance. Scoring both lists against the query fixes that.
 */
function rankByRelevance(results: SearchResponse[], query: string): SearchResponse[] {
  const normalisedQuery = normaliseTitleForMatch(query);

  const scored = results.map((result) => {
    const normalisedName = normaliseTitleForMatch(result.name);
    let score = titleSimilarity(query, result.name) * 100;

    // An exact normalised match is what the user almost certainly meant.
    if (normalisedName === normalisedQuery) score += 60;
    // A title that merely *starts* with the query ("Breaking Bad" vs
    // "Breaking Bad: Original Minisodes") is still a strong hit.
    else if (normalisedName.startsWith(normalisedQuery)) score += 25;

    // Penalise extra trailing words so the base title outranks its spin-offs.
    const extraWords =
      normalisedName.split(' ').length - normalisedQuery.split(' ').length;
    if (extraWords > 0) score -= Math.min(20, extraWords * 5);

    return { result, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.result);
}

export class CinemetaProvider {
  /**
   * Searches both catalogues concurrently.
   * A failure in one type must not blank the other — a movie search should
   * still work when the series catalogue is having a bad day.
   */
  public async search(query: string, signal?: AbortSignal): Promise<SearchResponse[]> {
    const encoded = encodeURIComponent(query);

    const [movies, series] = await Promise.allSettled([
      fetchJson<CatalogResponse>(`${BASE}/catalog/movie/top/search=${encoded}.json`, {
        signal,
        timeoutMs: 15_000,
      }),
      fetchJson<CatalogResponse>(`${BASE}/catalog/series/top/search=${encoded}.json`, {
        signal,
        timeoutMs: 15_000,
      }),
    ]);

    const results: SearchResponse[] = [];

    const collect = (settled: PromiseSettledResult<CatalogResponse>, type: 'movie' | 'series') => {
      if (settled.status !== 'fulfilled') return;
      for (const meta of settled.value.metas ?? []) {
        const imdbId = meta.imdb_id || meta.id;
        if (!imdbId?.startsWith('tt') || !meta.name) continue;
        results.push({
          name: meta.name,
          url: buildCinemetaUrl(type, imdbId),
          apiName: 'Catalogue',
          type: toTvType(type, meta.genres),
          posterUrl: meta.poster,
          year: parseYear(meta.releaseInfo),
        });
      }
    };

    collect(movies, 'movie');
    collect(series, 'series');

    return rankByRelevance(results, query);
  }

  public async load(
    type: 'movie' | 'series',
    imdbId: string,
    signal?: AbortSignal
  ): Promise<CinemetaDetail | null> {
    const response = await fetchJson<MetaResponse>(`${BASE}/meta/${type}/${imdbId}.json`, {
      signal,
      timeoutMs: 15_000,
    });
    const meta = response.meta;
    if (!meta?.name) return null;

    const episodes: Episode[] = (meta.videos ?? [])
      .filter((video) => (video.season ?? 0) > 0) // season 0 is specials/extras
      .map((video) => {
        const season = video.season ?? 1;
        const number = video.episode ?? video.number ?? 0;
        return {
          name: video.name || video.title
            ? `S${season}E${number} · ${video.name ?? video.title}`
            : `Episode ${number}`,
          // Season/episode ride on the URL so the source query can address them.
          url: `${buildCinemetaUrl(type, imdbId)}?s=${season}&e=${number}`,
          episode: number,
          season,
          posterUrl: video.thumbnail,
          description: video.overview ?? video.description,
          date: (video.firstAired ?? video.released)?.slice(0, 10),
          rating: video.rating ? parseFloat(video.rating) : undefined,
        };
      })
      .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));

    return {
      name: meta.name,
      imdbId,
      type: toTvType(type, meta.genres),
      posterUrl: meta.poster,
      backgroundUrl: meta.background,
      year: parseYear(meta.releaseInfo),
      plot: meta.description,
      rating: meta.imdbRating ? parseFloat(meta.imdbRating) : undefined,
      tags: meta.genres,
      actors: meta.cast,
      duration: meta.runtime,
      runtimeMinutes: parseRuntimeMinutes(meta.runtime),
      episodes,
    };
  }
}

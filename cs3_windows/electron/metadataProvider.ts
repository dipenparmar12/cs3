import { fetchJson, fetchText } from './torrent/http';
import { TvType, type Episode, type LoadResponse, type SearchResponse } from '../src/types/api';

/**
 * Catalogue metadata — titles, posters, plots, episode lists, IMDb ids.
 *
 * This layer is explicitly **not** a content source. TVmaze and AniList are
 * metadata databases; they carry no streams. Keeping that boundary sharp matters:
 * an earlier revision of this app conflated the two, presenting metadata search
 * results as if they were playable, with a hardcoded demo video behind them.
 *
 * The IMDb id this layer resolves is the important output — EZTV and most
 * Torznab indexers match far more accurately on `imdbid` than on free text.
 */

export const METADATA_SOURCE = 'Catalogue';

interface TvMazeShow {
  id?: number;
  name?: string;
  url?: string;
  type?: string;
  language?: string;
  genres?: string[];
  premiered?: string;
  ended?: string;
  runtime?: number;
  averageRuntime?: number;
  summary?: string;
  rating?: { average?: number | null };
  image?: { medium?: string; original?: string };
  externals?: { imdb?: string | null; thetvdb?: number | null };
  _embedded?: { episodes?: TvMazeEpisode[] };
}

interface TvMazeEpisode {
  id?: number;
  name?: string;
  season?: number;
  number?: number;
  airdate?: string;
  runtime?: number;
  summary?: string;
  image?: { medium?: string; original?: string };
}

interface AniListMedia {
  id?: number;
  idMal?: number;
  title?: { romaji?: string; english?: string; native?: string };
  coverImage?: { extraLarge?: string; large?: string };
  bannerImage?: string;
  startDate?: { year?: number };
  episodes?: number;
  duration?: number;
  format?: string;
  genres?: string[];
  averageScore?: number;
  description?: string;
  status?: string;
}

function stripHtml(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Stable synthetic identity for a catalogue item.
 * Encodes the source and native id so `load()` can route back to the right API
 * without a lookup table.
 */
export function buildMetadataUrl(source: 'tvmaze' | 'anilist', id: number | string): string {
  return `cs3meta://${source}/${id}`;
}

export function parseMetadataUrl(
  url: string
): { source: 'tvmaze' | 'anilist'; id: string } | null {
  const match = url.match(/^cs3meta:\/\/(tvmaze|anilist)\/(.+)$/);
  if (!match) return null;
  return { source: match[1] as 'tvmaze' | 'anilist', id: match[2] };
}

function tvMazeTypeOf(show: TvMazeShow): TvType {
  const genres = show.genres ?? [];
  if (genres.includes('Anime')) return TvType.Anime;
  if (show.type === 'Documentary') return TvType.Documentary;
  // TVmaze covers series; single-episode entries are effectively TV movies.
  return TvType.TvSeries;
}

export interface MetadataDetail extends LoadResponse {
  /** Drives accurate indexer queries; absent for many AniList entries. */
  imdbId?: string;
  /** Per-episode runtime, used by the source ranker's size sanity check. */
  runtimeMinutes?: number;
}

export class MetadataProvider {
  // --- search --------------------------------------------------------------

  public async search(query: string, signal?: AbortSignal): Promise<SearchResponse[]> {
    const [shows, anime] = await Promise.allSettled([
      this.searchTvMaze(query, signal),
      this.searchAniList(query, signal),
    ]);

    const results: SearchResponse[] = [];
    if (shows.status === 'fulfilled') results.push(...shows.value);
    if (anime.status === 'fulfilled') results.push(...anime.value);

    // Interleave so neither source dominates the first screen of results.
    return results;
  }

  private async searchTvMaze(query: string, signal?: AbortSignal): Promise<SearchResponse[]> {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
    const raw = await fetchJson<Array<{ show?: TvMazeShow }>>(url, { signal });
    if (!Array.isArray(raw)) return [];

    return raw
      .map(({ show }) => show)
      .filter((show): show is TvMazeShow => Boolean(show?.id && show.name))
      .map<SearchResponse>((show) => ({
        name: show.name as string,
        url: buildMetadataUrl('tvmaze', show.id as number),
        apiName: METADATA_SOURCE,
        type: tvMazeTypeOf(show),
        posterUrl: show.image?.original || show.image?.medium,
        year: show.premiered ? parseInt(show.premiered.slice(0, 4), 10) : undefined,
        id: show.id,
      }));
  }

  private async searchAniList(query: string, signal?: AbortSignal): Promise<SearchResponse[]> {
    const body = JSON.stringify({
      query: `
        query ($search: String) {
          Page(perPage: 15) {
            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
              id
              title { romaji english }
              coverImage { extraLarge large }
              startDate { year }
              format
            }
          }
        }`,
      variables: { search: query },
    });

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);

    const json = (await response.json()) as { data?: { Page?: { media?: AniListMedia[] } } };
    const media = json.data?.Page?.media ?? [];

    return media
      .filter((item): item is AniListMedia => Boolean(item?.id))
      .map<SearchResponse>((item) => ({
        name: item.title?.english || item.title?.romaji || query,
        url: buildMetadataUrl('anilist', item.id as number),
        apiName: METADATA_SOURCE,
        type: item.format === 'MOVIE' ? TvType.AnimeMovie : TvType.Anime,
        posterUrl: item.coverImage?.extraLarge || item.coverImage?.large,
        year: item.startDate?.year,
        id: item.id,
      }));
  }

  // --- detail --------------------------------------------------------------

  public async load(url: string, signal?: AbortSignal): Promise<MetadataDetail | null> {
    const parsed = parseMetadataUrl(url);
    if (!parsed) return null;

    return parsed.source === 'tvmaze'
      ? this.loadTvMaze(parsed.id, signal)
      : this.loadAniList(parsed.id, signal);
  }

  private async loadTvMaze(id: string, signal?: AbortSignal): Promise<MetadataDetail | null> {
    const show = await fetchJson<TvMazeShow>(
      `https://api.tvmaze.com/shows/${encodeURIComponent(id)}?embed=episodes`,
      { signal }
    );
    if (!show?.name) return null;

    const episodes: Episode[] = (show._embedded?.episodes ?? [])
      .filter((ep) => ep.number !== undefined && ep.number !== null)
      .map((ep) => ({
        name: ep.name ? `S${ep.season}E${ep.number} · ${ep.name}` : `Episode ${ep.number}`,
        // Episode identity carries the season/episode the source search needs.
        url: `${buildMetadataUrl('tvmaze', id)}?s=${ep.season ?? 1}&e=${ep.number}`,
        episode: ep.number ?? undefined,
        season: ep.season ?? undefined,
        posterUrl: ep.image?.original || ep.image?.medium,
        description: stripHtml(ep.summary),
        date: ep.airdate,
      }));

    return {
      name: show.name,
      url: buildMetadataUrl('tvmaze', id),
      apiName: METADATA_SOURCE,
      type: tvMazeTypeOf(show),
      posterUrl: show.image?.original || show.image?.medium,
      year: show.premiered ? parseInt(show.premiered.slice(0, 4), 10) : undefined,
      plot: stripHtml(show.summary),
      rating: show.rating?.average ?? undefined,
      tags: show.genres ?? [],
      duration: show.averageRuntime ? `${show.averageRuntime} min` : undefined,
      runtimeMinutes: show.averageRuntime ?? show.runtime ?? undefined,
      imdbId: show.externals?.imdb ?? undefined,
      episodes,
      id: show.id,
    };
  }

  private async loadAniList(id: string, signal?: AbortSignal): Promise<MetadataDetail | null> {
    const body = JSON.stringify({
      query: `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id idMal
            title { romaji english native }
            coverImage { extraLarge large }
            bannerImage
            startDate { year }
            episodes duration format genres averageScore description status
          }
        }`,
      variables: { id: parseInt(id, 10) },
    });

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);

    const json = (await response.json()) as { data?: { Media?: AniListMedia } };
    const media = json.data?.Media;
    if (!media?.id) return null;

    const title = media.title?.english || media.title?.romaji || 'Unknown';
    const isMovie = media.format === 'MOVIE';

    // AniList gives a count, not a list. Anime torrents are numbered absolutely,
    // so a synthesised 1..N list matches how releases are actually named.
    const count = media.episodes ?? 0;
    const episodes: Episode[] = isMovie
      ? []
      : Array.from({ length: count }, (_, i) => ({
          name: `Episode ${i + 1}`,
          url: `${buildMetadataUrl('anilist', media.id as number)}?e=${i + 1}`,
          episode: i + 1,
          season: 1,
        }));

    return {
      name: title,
      url: buildMetadataUrl('anilist', media.id),
      apiName: METADATA_SOURCE,
      type: isMovie ? TvType.AnimeMovie : TvType.Anime,
      posterUrl: media.coverImage?.extraLarge || media.coverImage?.large,
      year: media.startDate?.year,
      plot: stripHtml(media.description),
      rating: media.averageScore ? media.averageScore / 10 : undefined,
      tags: media.genres ?? [],
      duration: media.duration ? `${media.duration} min` : undefined,
      runtimeMinutes: media.duration ?? undefined,
      episodes,
      id: media.id,
    };
  }

  /**
   * Best-effort IMDb id lookup for titles that have none attached (AniList
   * entries, mostly). Failure is non-fatal — indexers fall back to free text.
   */
  public async resolveImdbId(title: string, year?: number): Promise<string | undefined> {
    try {
      const query = encodeURIComponent(title);
      const raw = await fetchText(
        `https://api.tvmaze.com/singlesearch/shows?q=${query}&embed=nextepisode`,
        { timeoutMs: 8000, retries: 0 }
      );
      const show = JSON.parse(raw) as TvMazeShow;
      const imdb = show.externals?.imdb;
      if (!imdb) return undefined;

      if (year && show.premiered) {
        const showYear = parseInt(show.premiered.slice(0, 4), 10);
        // Reject a confident-looking match from the wrong decade.
        if (Math.abs(showYear - year) > 2) return undefined;
      }
      return imdb;
    } catch {
      return undefined;
    }
  }
}

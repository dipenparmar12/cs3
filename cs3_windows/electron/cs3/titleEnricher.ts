import { fetchJson } from '../torrent/http';
import { TvType, type SearchResponse } from '../../src/types/api';
import { normaliseTitleForMatch, titleSimilarity } from '../torrent/releaseParser';

/**
 * Turns a provider's release name into the title it is actually about.
 *
 * Extension providers name their results after the file, not the film. A search
 * for *Avengers: Endgame* comes back as
 *
 *     Avengers End Game 720p Hindi Dubbed
 *     Avengers.Endgame.2019.1080p.BluRay.x264-GROUP
 *     Avengers Endgame (2019) [Dual Audio] [Org DD5.1]
 *
 * — three rows for one film, each with a different name, none with a plot, a
 * genre, a poster or a year. The grid is then unsortable, undedupable, and
 * indistinguishable from a directory listing.
 *
 * This resolves each of those to one catalogue record and attaches its
 * metadata, **without discarding the source**. The provider result stays
 * exactly where it was; only the display metadata is replaced. That distinction
 * is the whole design: the catalogue knows what the film is, the provider knows
 * how to play it, and neither can do the other's job.
 *
 * ## Matching, and why it is conservative
 *
 * `Avengers`, `Avengers: Endgame`, `Avengers: Age of Ultron` and the *Avengers*
 * TV series are four different things whose titles are prefixes of one another.
 * A fuzzy matcher tuned to catch "End Game" will happily map all four onto
 * whichever is most popular, and the resulting library is worse than no
 * enrichment at all — the user sees the right poster on the wrong film and
 * cannot tell.
 *
 * So the bar is deliberately high, and it rises when the evidence is thin:
 *
 *  - a year extracted from the release name must agree with the candidate's,
 *  - the content type must agree,
 *  - and the similarity threshold is high enough that "Avengers" alone does not
 *    match "Avengers: Endgame".
 *
 * When nothing clears the bar the original name is kept. An unenriched row is a
 * small loss; a mislabelled one is a bug the user will report as data
 * corruption.
 */

const BASE = 'https://v3-cinemeta.strem.io';

/** Above this, two titles are the same work. Measured against the corpus. */
const STRONG_MATCH = 0.86;

/** With a confirming year, a weaker title match is still safe. */
const MATCH_WITH_YEAR = 0.72;

/** How long a resolved title is remembered. Titles do not change. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_CACHE_ENTRIES = 5_000;

export interface EnrichedMetadata {
  title: string;
  originalTitle?: string;
  year?: number;
  imdbId: string;
  type: 'movie' | 'series';
  posterUrl?: string;
  backdropUrl?: string;
  plot?: string;
  genres?: string[];
  rating?: number;
  runtime?: string;
  cast?: string[];
}

interface CatalogMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  type?: string;
  poster?: string;
  background?: string;
  genres?: string[];
  genre?: string[];
  releaseInfo?: string;
  description?: string;
  imdbRating?: string;
  runtime?: string;
  cast?: string[];
}

interface CatalogResponse {
  metas?: CatalogMeta[];
}

/**
 * Strips everything a release name carries that a title does not.
 *
 * Order matters: the year has to be captured before the bracket contents are
 * removed, because it is usually inside them.
 */
export function parseReleaseTitle(raw: string): { title: string; year?: number } {
  let working = raw.replace(/[._]+/g, ' ');

  // A four-digit year between 1900 and next year, wherever it appears.
  const nextYear = new Date().getFullYear() + 1;
  let year: number | undefined;
  const yearMatch = working.match(/\b(19\d{2}|20\d{2})\b/g);
  if (yearMatch) {
    for (const candidate of yearMatch) {
      const value = parseInt(candidate, 10);
      if (value >= 1900 && value <= nextYear) year = value;
    }
  }

  working = working
    // Bracketed noise: [Dual Audio], (2019), {Org DD5.1}.
    .replace(/[[({][^\])}]*[\])}]/g, ' ')
    // Everything from the first release-quality token onwards is file metadata.
    .replace(
      /\b(720p|1080p|2160p|4k|480p|360p|hdrip|webrip|web-dl|webdl|bluray|brrip|dvdrip|hdtv|hevc|x264|x265|h264|h265|aac|ac3|dd5\.?1|dts|10bit|hdr|remux|proper|repack|extended|uncut|dual audio|multi|esub|msub|hindi dubbed|dubbed|subbed)\b.*$/i,
      ' '
    )
    // A trailing release group after a dash.
    .replace(/-\s*[A-Za-z0-9]+$/, ' ')
    .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Season/episode markers belong to the episode, not the show's title.
  working = working.replace(/\bS\d{1,2}\s*E\d{1,3}\b.*$/i, '').trim();
  working = working.replace(/\bSeason\s+\d+\b.*$/i, '').trim();

  return { title: working || raw.trim(), year };
}

interface CacheEntry {
  metadata: EnrichedMetadata | null;
  at: number;
}

export class TitleEnricher {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<EnrichedMetadata | null>>();

  /**
   * Resolves one provider result to a catalogue record.
   *
   * Returns `null` rather than a best guess when nothing clears the bar — see
   * the header. The caller keeps the original.
   */
  public async resolve(
    rawTitle: string,
    hint: { type?: TvType; year?: number } = {}
  ): Promise<EnrichedMetadata | null> {
    const parsed = parseReleaseTitle(rawTitle);
    const year = hint.year ?? parsed.year;
    const wantSeries = isSeriesType(hint.type);
    const key = `${normaliseTitleForMatch(parsed.title)}|${year ?? ''}|${wantSeries ? 's' : 'm'}`;

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.metadata;

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.lookup(parsed.title, year, wantSeries)
        .then((metadata) => {
          this.remember(key, metadata);
          return metadata;
        })
        .catch(() => null)
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  private remember(key: string, metadata: EnrichedMetadata | null): void {
    this.cache.set(key, { metadata, at: Date.now() });
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      // Oldest first. Map preserves insertion order, so the first key is the
      // least recently added.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private async lookup(
    title: string,
    year: number | undefined,
    wantSeries: boolean
  ): Promise<EnrichedMetadata | null> {
    const encoded = encodeURIComponent(title);
    // The declared type is a hint, not a fact — a provider that labels
    // everything "Movie" is common — so both catalogues are asked and the type
    // only weights the ranking.
    const [movies, series] = await Promise.allSettled([
      fetchJson<CatalogResponse>(`${BASE}/catalog/movie/top/search=${encoded}.json`, {
        timeoutMs: 12_000,
      }),
      fetchJson<CatalogResponse>(`${BASE}/catalog/series/top/search=${encoded}.json`, {
        timeoutMs: 12_000,
      }),
    ]);

    const candidates: Array<{ meta: CatalogMeta; type: 'movie' | 'series' }> = [];
    if (movies.status === 'fulfilled') {
      for (const meta of movies.value.metas ?? []) candidates.push({ meta, type: 'movie' });
    }
    if (series.status === 'fulfilled') {
      for (const meta of series.value.metas ?? []) candidates.push({ meta, type: 'series' });
    }
    if (candidates.length === 0) return null;

    let best: { meta: CatalogMeta; type: 'movie' | 'series'; score: number } | null = null;
    for (const candidate of candidates) {
      if (!candidate.meta.name) continue;
      const similarity = titleSimilarity(title, candidate.meta.name);
      const candidateYear = parseYear(candidate.meta.releaseInfo);

      // A year that disagrees is disqualifying, not merely unhelpful: it is the
      // single strongest signal that two same-named works are different ones.
      if (year && candidateYear && Math.abs(candidateYear - year) > 1) continue;

      const yearAgrees = Boolean(year && candidateYear && Math.abs(candidateYear - year) <= 1);
      const threshold = yearAgrees ? MATCH_WITH_YEAR : STRONG_MATCH;
      if (similarity < threshold) continue;

      let score = similarity;
      if (yearAgrees) score += 0.15;
      if ((candidate.type === 'series') === wantSeries) score += 0.08;
      if (normaliseTitleForMatch(candidate.meta.name) === normaliseTitleForMatch(title)) {
        score += 0.2;
      }

      if (!best || score > best.score) best = { ...candidate, score };
    }

    if (!best) return null;

    const imdbId = best.meta.imdb_id || best.meta.id;
    if (!imdbId?.startsWith('tt')) return null;

    return {
      title: best.meta.name!,
      year: parseYear(best.meta.releaseInfo),
      imdbId,
      type: best.type,
      posterUrl: best.meta.poster,
      backdropUrl: best.meta.background,
      plot: best.meta.description,
      genres: best.meta.genres ?? best.meta.genre,
      rating: best.meta.imdbRating ? parseFloat(best.meta.imdbRating) : undefined,
      runtime: best.meta.runtime,
      cast: best.meta.cast,
    };
  }

  /**
   * Enriches a page of search results, in place of nothing.
   *
   * Bounded concurrency because this fires one or two catalogue lookups per
   * row and a search can return two hundred rows; unbounded, it would open two
   * hundred sockets to a service this app depends on for search itself.
   *
   * A result that cannot be resolved is returned untouched, never dropped.
   */
  public async enrichAll(
    results: SearchResponse[],
    options: { concurrency?: number; limit?: number } = {}
  ): Promise<SearchResponse[]> {
    const limit = options.limit ?? 60;
    const concurrency = options.concurrency ?? 6;
    const out = [...results];

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < Math.min(out.length, limit)) {
        const index = next++;
        const result = out[index];
        // Catalogue rows are already canonical; re-resolving them would spend a
        // request to learn what they already say.
        if (result.apiName === 'Catalogue') continue;
        try {
          const metadata = await this.resolve(result.name, {
            type: result.type,
            year: result.year,
          });
          if (!metadata) continue;
          out[index] = {
            ...result,
            // The address is untouched. Only what the user reads changes.
            name: metadata.title,
            year: metadata.year ?? result.year,
            posterUrl: metadata.posterUrl ?? result.posterUrl,
          };
        } catch {
          // Enrichment is an improvement, never a requirement.
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
  }
}

function isSeriesType(type: TvType | undefined): boolean {
  return (
    type === TvType.TvSeries ||
    type === TvType.Anime ||
    type === TvType.OVA ||
    type === TvType.AsianDrama ||
    type === TvType.Documentary
  );
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d{4})/.exec(value);
  return match ? parseInt(match[1], 10) : undefined;
}

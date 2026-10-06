import { gunzipSync } from 'node:zlib';
import { fetchBuffer, fetchJson, fetchText } from './torrent/http.ts';
import { decodeSubtitle, toWebVtt } from './subtitles/convert.ts';
import { rankSubtitles, type MatchContext } from './subtitles/subtitleMatch.ts';
import { describeError } from '../src/utils/errors.ts';

/**
 * Online subtitle search, for the player.
 *
 * Uses the OpenSubtitles v3 Stremio addon, which needs no API key and is keyed
 * by IMDb id — the same identifier the metadata layer already resolves for
 * every title, and the reason indexer matching works at all. OpenSubtitles'
 * own REST API would be the obvious choice but requires per-user credentials,
 * which is a setup step this feature is meant to remove.
 *
 * Two details are load-bearing:
 *
 * 1. **The addon serves SubRip, and `<track>` only accepts WebVTT.** Handing an
 *    `.srt` to a `<track>` element fails silently — no error, no subtitles, no
 *    clue why. Conversion is not an optimisation here, it is the difference
 *    between working and appearing to work.
 * 2. **The renderer cannot fetch these itself.** The files come from a third
 *    party without permissive CORS for arbitrary origins, so the main process
 *    fetches and converts, and the renderer turns the text into a blob URL.
 */

const ADDON_BASE = 'https://opensubtitles-v3.strem.io';

/**
 * OpenSubtitles' keyless REST search — the one desktop players such as VLC's
 * VLSub reach for. The Stremio addon above is keyed by IMDb id only and says
 * little about each file; this one carries the release name, download count,
 * rating, frame rate and hearing-impaired flag, and searches by title,
 * season and episode too. Measured 2026-10-06: 300–700 ms per query, gzipped
 * SubRip downloads of about a second.
 *
 * Its two quirks are load-bearing: path segments must be in alphabetical
 * order, and it takes **one** language per request (`eng,hin` is a 400).
 */
const REST_BASE = 'https://rest.opensubtitles.org/search';
const REST_USER_AGENT = 'TemporaryUserAgent';
/** More than this many languages is a request per language nobody reads. */
const MAX_LANGUAGES_PER_SEARCH = 4;
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

/** Subtitle search is a foreground action in the player; it must not hang. */
const SEARCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Beyond this the list stops being browsable and starts being a wall. */
const MAX_RESULTS_PER_LANGUAGE = 8;

/** Kept per language once ranked; the panel shows them all, ordered. */
const MAX_RANKED_PER_LANGUAGE = 25;

/**
 * Cues OpenSubtitles injects into its files to advertise itself — "Do you want
 * subtitles for any video?", "Support us and become VIP member". Shown over a
 * film's opening seconds they read as the subtitle being for something else.
 */
const ADVERT_CUE = /opensubtitles\.(org|com)|osdb\.link|become vip member|advertise your product|subtitles for any video/i;

/** The OpenSubtitles file id inside either source's download link. */
function fileIdOf(url: string): string | undefined {
  return url.match(/\/file(?:ad)?\/(\d+)/)?.[1];
}

const numberOr = (value: string | number | undefined): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export interface SubtitleSearchResult {
  id: string;
  /** ISO 639-2 three-letter code as the addon reports it (`eng`, `ger`, `por`). */
  lang: string;
  /** Human-readable language, for the picker. */
  langName: string;
  url: string;
  /** Where the file came from: a catalogue, or the provider beside the stream. */
  origin?: 'opensubtitles' | 'provider';
  /** The subtitle's own file name — usually names the release it was timed to. */
  fileName?: string;
  /** The release the uploader says it matches. */
  releaseName?: string;
  downloads?: number;
  rating?: number;
  year?: number;
  fps?: number;
  hearingImpaired?: boolean;
  machineTranslated?: boolean;
  foreignPartsOnly?: boolean;
  trusted?: boolean;
  /** 0–100 from `subtitleMatch.ts`; present on results from {@link SubtitleService.find}. */
  matchScore?: number;
  /** The one result per language the app would choose itself. */
  best?: boolean;
  matchReasons?: string[];
}

/** One "find subtitles" request, as the player and the panel ask it. */
export interface SubtitleQuery {
  imdbId?: string;
  /** Free text: a title, or an IMDb id typed by the viewer. */
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  /** ISO 639-2 codes to ask for; empty means every language. */
  languages?: string[];
  /** The playing source's release name, which ranks the file timed to it first. */
  releaseName?: string;
}

/** How each catalogue answered, so "nothing found" and "could not ask" differ. */
export type SubtitleSourceStatus = 'ok' | 'empty' | 'failed' | 'skipped';

export interface SubtitleFindResult {
  results: SubtitleSearchResult[];
  imdbId?: string;
  matchedTitle?: string;
  sources: Record<'stremio' | 'opensubtitles', { status: SubtitleSourceStatus; error?: string }>;
}

interface AddonSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  SubEncoding?: string;
  subtitleFileName?: string;
  movieReleaseName?: string;
  fpsMilli?: number;
}

/** A row of OpenSubtitles' keyless REST search. Every value arrives as a string. */
interface RestSubtitle {
  IDSubtitleFile?: string;
  SubFileName?: string;
  MovieReleaseName?: string;
  SubLanguageID?: string;
  LanguageName?: string;
  SubDownloadsCnt?: string;
  SubRating?: string;
  MovieYear?: string;
  MovieFPS?: string;
  MovieName?: string;
  MovieKind?: string;
  IDMovieImdb?: string;
  SeriesIMDBParent?: string;
  SeriesSeason?: string;
  SeriesEpisode?: string;
  SubHearingImpaired?: string;
  SubAutoTranslation?: string;
  SubForeignPartsOnly?: string;
  SubFromTrusted?: string;
  SubBad?: string;
  SubFormat?: string;
  SubDownloadLink?: string;
}

/**
 * ISO 639-2/B to display name, covering what OpenSubtitles actually returns.
 * Unknown codes fall back to the raw code rather than being dropped — a
 * subtitle in an unlisted language is still usable.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian',
  por: 'Portuguese', pob: 'Portuguese (BR)', rus: 'Russian', ara: 'Arabic',
  hin: 'Hindi', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam',
  kan: 'Kannada', mar: 'Marathi', guj: 'Gujarati', urd: 'Urdu', pan: 'Punjabi',
  chi: 'Chinese', zht: 'Chinese (Traditional)', jpn: 'Japanese', kor: 'Korean',
  tur: 'Turkish', pol: 'Polish', dut: 'Dutch', swe: 'Swedish', nor: 'Norwegian',
  dan: 'Danish', fin: 'Finnish', gre: 'Greek', heb: 'Hebrew', cze: 'Czech',
  hun: 'Hungarian', rum: 'Romanian', bul: 'Bulgarian', ukr: 'Ukrainian',
  vie: 'Vietnamese', tha: 'Thai', ind: 'Indonesian', may: 'Malay', per: 'Persian',
  srp: 'Serbian', hrv: 'Croatian', slo: 'Slovak', slv: 'Slovenian', est: 'Estonian',
  lav: 'Latvian', lit: 'Lithuanian', alb: 'Albanian', mac: 'Macedonian',

  // ISO 639-2 has two variants for a number of languages — bibliographic (/B)
  // and terminological (/T) — and OpenSubtitles emits both. Without the /T
  // spellings the picker showed raw codes like "ELL", "NLD" and "RON" instead
  // of Greek, Dutch and Romanian.
  ell: 'Greek', nld: 'Dutch', ron: 'Romanian', fra: 'French', deu: 'German',
  ces: 'Czech', fas: 'Persian', zho: 'Chinese', slk: 'Slovak', sqi: 'Albanian',
  mkd: 'Macedonian', msa: 'Malay', hye: 'Armenian', isl: 'Icelandic',
  eus: 'Basque', cym: 'Welsh', mya: 'Burmese', bod: 'Tibetan',
};

/**
 * Every code OpenSubtitles uses for English. `eng` is ISO 639-2, `en` is 639-1,
 * and both appear depending on which upload the addon is proxying.
 */
const ENGLISH_CODES = new Set(['eng', 'en', 'en-us', 'en-gb']);

export function languageName(code: string): string {
  const key = code.trim().toLowerCase();
  const known = LANGUAGE_NAMES[key];
  if (known) return known;
  // Providers publish two-letter codes and plain names as often as ISO 639-2.
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(key)) {
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(key);
      if (name && name.toLowerCase() !== key) return name;
    } catch {
      // Not a code Intl knows; fall through.
    }
  }
  if (key.length > 3) return code.trim().charAt(0).toUpperCase() + code.trim().slice(1);
  return code.toUpperCase();
}

export class SubtitleService {
  /**
   * Finds subtitles for a title or a specific episode.
   *
   * The addon addresses an episode as `tt1234567:season:episode`, so season and
   * episode are part of the identity rather than a filter — asking for the
   * series id alone returns subtitles for the wrong episode.
   */
  public async search(
    imdbId: string,
    season?: number,
    episode?: number
  ): Promise<SubtitleSearchResult[]> {
    if (!imdbId?.startsWith('tt')) return [];

    const isEpisode = season !== undefined && episode !== undefined;
    const path = isEpisode
      ? `series/${imdbId}:${season}:${episode}`
      : `movie/${imdbId}`;

    const response = await fetchJson<{ subtitles?: AddonSubtitle[] }>(
      `${ADDON_BASE}/subtitles/${path}.json`,
      { timeoutMs: SEARCH_TIMEOUT_MS }
    );

    const perLanguage = new Map<string, SubtitleSearchResult[]>();
    for (const item of response.subtitles ?? []) {
      if (!item.url || !item.lang) continue;
      const list = perLanguage.get(item.lang) ?? [];
      // OpenSubtitles returns dozens per language; the extras are near-identical
      // and only make the picker unusable.
      if (list.length >= MAX_RESULTS_PER_LANGUAGE) continue;

      list.push({
        id: String(item.id ?? `${item.lang}-${list.length}`),
        lang: item.lang,
        langName: languageName(item.lang),
        url: item.url,
        origin: 'opensubtitles',
        // Published by the addon all along and dropped here, so every English
        // file in the picker read "English #1", "English #2" with nothing to
        // choose between them by.
        fileName: item.subtitleFileName || undefined,
        releaseName: item.movieReleaseName || undefined,
        fps: item.fpsMilli ? item.fpsMilli / 1000 : undefined,
      });
      perLanguage.set(item.lang, list);
    }

    /**
     * English first, then everything else alphabetically.
     *
     * Alphabetical alone buried English under Albanian, Arabic, Bulgarian,
     * Croatian and Danish — a scroll past a dozen languages to reach the one
     * most viewers want. Sorting purely by name treats the list as a reference
     * table; it is a picker, and a picker should open on the likely answer.
     */
    return [...perLanguage.values()].flat().sort((a, b) => {
      const aEnglish = ENGLISH_CODES.has(a.lang.toLowerCase());
      const bEnglish = ENGLISH_CODES.has(b.lang.toLowerCase());
      if (aEnglish !== bEnglish) return aEnglish ? -1 : 1;
      return a.langName.localeCompare(b.langName);
    });
  }

  /**
   * Resolves a free-text movie/series title or IMDb id into an IMDb ID and matched title
   * using Cinemeta with a TVmaze fallback.
   */
  public async resolveTitleToImdb(
    query: string,
    isSeries = false,
    year?: number
  ): Promise<{ imdbId: string; matchedTitle: string } | null> {
    const trimmed = query.trim();
    if (!trimmed) return null;

    // Direct IMDb id match (tt1234567)
    if (/^tt\d+$/i.test(trimmed)) {
      return { imdbId: trimmed.toLowerCase(), matchedTitle: trimmed };
    }

    const encoded = encodeURIComponent(trimmed);

    try {
      // Query Cinemeta movie & series catalogues concurrently
      const [moviesSettled, seriesSettled] = await Promise.allSettled([
        fetchJson<{ metas?: Array<{ id?: string; imdb_id?: string; name?: string; releaseInfo?: string }> }>(
          `${CINEMETA_BASE}/catalog/movie/top/search=${encoded}.json`,
          { timeoutMs: 8000 }
        ),
        fetchJson<{ metas?: Array<{ id?: string; imdb_id?: string; name?: string; releaseInfo?: string }> }>(
          `${CINEMETA_BASE}/catalog/series/top/search=${encoded}.json`,
          { timeoutMs: 8000 }
        ),
      ]);

      const candidates: Array<{ meta: { id?: string; imdb_id?: string; name?: string; releaseInfo?: string }; score: number }> = [];
      const lowerQuery = trimmed.toLowerCase();

      const processCatalog = (
        settled: PromiseSettledResult<{ metas?: Array<{ id?: string; imdb_id?: string; name?: string; releaseInfo?: string }> }>,
        type: 'movie' | 'series'
      ) => {
        if (settled.status !== 'fulfilled' || !Array.isArray(settled.value.metas)) return;
        for (const meta of settled.value.metas) {
          const imdb = meta.imdb_id || meta.id;
          if (!imdb?.startsWith('tt') || !meta.name) continue;

          const metaLower = meta.name.toLowerCase();
          let score = 0;
          if (metaLower === lowerQuery) score += 100;
          else if (metaLower.startsWith(lowerQuery)) score += 50;
          else if (metaLower.includes(lowerQuery)) score += 25;

          // Prefer series if isSeries was specified
          if (isSeries && type === 'series') score += 10;
          if (!isSeries && type === 'movie') score += 10;

          /**
           * The year decides between works that share a name. Without it,
           * "Extraction II" and "Extraction", or a film and its remake, went to
           * whichever the catalogue listed first — and the subtitles of the wrong
           * film then failed the duration check, so nothing loaded at all.
           */
          const released = Number(String(meta.releaseInfo ?? '').slice(0, 4));
          if (year && Number.isFinite(released) && released > 0) {
            score += Math.abs(released - year) <= 1 ? 40 : -40;
          }

          candidates.push({ meta, score });
        }
      };

      if (isSeries) {
        processCatalog(seriesSettled, 'series');
        processCatalog(moviesSettled, 'movie');
      } else {
        processCatalog(moviesSettled, 'movie');
        processCatalog(seriesSettled, 'series');
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length > 0) {
        const best = candidates[0].meta;
        const imdbId = best.imdb_id || best.id;
        if (imdbId) {
          const matchedTitle = best.name
            ? `${best.name}${best.releaseInfo ? ` (${best.releaseInfo})` : ''}`
            : imdbId;
          return { imdbId, matchedTitle };
        }
      }
    } catch {
      // Ignore Cinemeta failure and try TVmaze fallback
    }

    // Fallback: TVmaze for series/shows
    try {
      const raw = await fetchText(
        `https://api.tvmaze.com/singlesearch/shows?q=${encoded}`,
        { timeoutMs: 6000 }
      );
      const show = JSON.parse(raw) as { name?: string; externals?: { imdb?: string } };
      if (show?.externals?.imdb && show.externals.imdb.startsWith('tt')) {
        return {
          imdbId: show.externals.imdb,
          matchedTitle: show.name || show.externals.imdb,
        };
      }
    } catch {
      // Ignored
    }

    return null;
  }

  /**
   * Finds subtitles by custom title query or IMDb ID.
   */
  public async searchByTitle(
    query: string,
    season?: number,
    episode?: number
  ): Promise<{ imdbId?: string; matchedTitle?: string; results: SubtitleSearchResult[] }> {
    const trimmed = query.trim();
    if (!trimmed) return { results: [] };

    const isSeries = season !== undefined || episode !== undefined;
    const resolved = await this.resolveTitleToImdb(trimmed, isSeries);
    if (!resolved) {
      return { results: [] };
    }

    const results = await this.search(resolved.imdbId, season, episode);
    return {
      imdbId: resolved.imdbId,
      matchedTitle: resolved.matchedTitle,
      results,
    };
  }

  /**
   * Every subtitle worth offering for one title, ranked.
   *
   * Both catalogues are asked at once and merged on the OpenSubtitles file id
   * they share: the Stremio link is kept for the download (it is converted to
   * UTF-8 on their side), the REST row supplies what the file *is*. A catalogue
   * that fails is reported as failed rather than as empty — a swallowed error
   * here used to read, on screen, exactly like "no subtitles exist".
   */
  public async find(
    query: SubtitleQuery,
    extra: SubtitleSearchResult[] | Promise<SubtitleSearchResult[]> = []
  ): Promise<SubtitleFindResult> {
    const sources: SubtitleFindResult['sources'] = {
      stremio: { status: 'skipped' },
      opensubtitles: { status: 'skipped' },
    };
    const isEpisode = query.season !== undefined && query.episode !== undefined;
    const typed = query.title?.trim() ?? '';

    let imdbId = query.imdbId?.startsWith('tt') ? query.imdbId : undefined;
    let matchedTitle: string | undefined;
    if (/^tt\d+$/i.test(typed)) imdbId = typed.toLowerCase();
    if (!imdbId && typed) {
      const resolved = await this.resolveTitleToImdb(typed, isEpisode, query.year).catch(() => null);
      if (resolved) {
        imdbId = resolved.imdbId;
        matchedTitle = resolved.matchedTitle;
      }
    }

    const languages = (query.languages ?? []).map((l) => l.toLowerCase()).slice(0, MAX_LANGUAGES_PER_SEARCH);

    const [fromAddon, fromRest] = await Promise.all([
      imdbId
        ? this.search(imdbId, query.season, query.episode).then(
            (rows) => {
              sources.stremio = { status: rows.length ? 'ok' : 'empty' };
              return rows;
            },
            (error) => {
              sources.stremio = { status: 'failed', error: describeError(error) };
              return [] as SubtitleSearchResult[];
            }
          )
        : Promise.resolve([] as SubtitleSearchResult[]),
      imdbId || typed
        ? this.searchRest({ imdbId, title: typed, season: query.season, episode: query.episode, year: query.year }, languages).then(
            (rows) => {
              sources.opensubtitles = { status: rows.length ? 'ok' : 'empty' };
              return rows;
            },
            (error) => {
              sources.opensubtitles = { status: 'failed', error: describeError(error) };
              return [] as SubtitleSearchResult[];
            }
          )
        : Promise.resolve([] as SubtitleSearchResult[]),
    ]);

    const merged = new Map<string, SubtitleSearchResult>();
    for (const row of fromRest) merged.set(fileIdOf(row.url) ?? row.id, row);
    for (const row of fromAddon) {
      const key = fileIdOf(row.url) ?? row.id;
      const known = merged.get(key);
      merged.set(key, known ? { ...known, ...definedOnly(row), url: row.url, langName: known.langName } : row);
    }

    // `extra` is what the provider published beside the stream; it ranks with the rest.
    let results = [...(await extra), ...merged.values()];
    if (languages.length) {
      const wanted = new Set(languages);
      results = results.filter((r) => wanted.has(r.lang.toLowerCase()) || sameLanguage(r.lang, languages));
    }

    const context: MatchContext = { releaseName: query.releaseName, year: query.year };
    const perLanguage = new Map<string, number>();
    const ranked = rankSubtitles(results.map((r) => ({ ...r, origin: r.origin ?? 'opensubtitles' })), context).filter(
      (r) => {
        const count = (perLanguage.get(r.lang) ?? 0) + 1;
        perLanguage.set(r.lang, count);
        return count <= MAX_RANKED_PER_LANGUAGE;
      }
    );

    return { results: ranked, imdbId, matchedTitle, sources };
  }

  /**
   * OpenSubtitles' REST search, by IMDb id when there is one and by title when
   * there is not. A title search is fuzzy on their side — "breaking bad" also
   * returns "The Bad Guys: Breaking In" — so title results are kept only when
   * the work's own IMDb id or name and year agree.
   */
  private async searchRest(
    query: { imdbId?: string; title?: string; season?: number; episode?: number; year?: number },
    languages: string[]
  ): Promise<SubtitleSearchResult[]> {
    const segments: Array<[string, string]> = [];
    if (query.episode !== undefined) segments.push(['episode', String(query.episode)]);
    if (query.imdbId) segments.push(['imdbid', query.imdbId.replace(/^tt/i, '')]);
    else if (query.title) segments.push(['query', encodeURIComponent(query.title.toLowerCase())]);
    else return [];
    if (query.season !== undefined) segments.push(['season', String(query.season)]);

    const perLanguage = languages.length ? languages : [''];
    const replies = await Promise.all(
      perLanguage.map((language) => {
        const parts = language ? [...segments, ['sublanguageid', language] as [string, string]] : segments;
        // Alphabetical, or the endpoint answers 400.
        const path = [...parts].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}-${v}`).join('/');
        return fetchJson<RestSubtitle[]>(`${REST_BASE}/${path}`, {
          timeoutMs: SEARCH_TIMEOUT_MS,
          headers: { 'User-Agent': REST_USER_AGENT, 'X-User-Agent': REST_USER_AGENT },
        });
      })
    );

    const wantName = query.title?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const out: SubtitleSearchResult[] = [];
    for (const row of replies.flat()) {
      if (!row?.SubDownloadLink || !row.SubLanguageID || row.SubBad === '1') continue;
      if (row.SubFormat && !/^(srt|ass|ssa|vtt|sub)$/i.test(row.SubFormat)) continue;
      if (query.season !== undefined && Number(row.SeriesSeason) !== query.season) continue;
      if (query.episode !== undefined && Number(row.SeriesEpisode) !== query.episode) continue;
      if (!query.imdbId) {
        // An episode is listed as `"Show" Episode title`; the show is what to compare.
        const listed = row.MovieName ?? '';
        const name = (/^"([^"]+)"/.exec(listed)?.[1] ?? listed).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (wantName && !name.startsWith(wantName) && !name.includes(wantName)) continue;
        if (query.year && numberOr(row.MovieYear) && Math.abs(Number(row.MovieYear) - query.year) > 1 && query.episode === undefined) continue;
      }
      out.push({
        id: `os:${row.IDSubtitleFile ?? row.SubDownloadLink}`,
        lang: row.SubLanguageID,
        langName: row.LanguageName || languageName(row.SubLanguageID),
        url: row.SubDownloadLink,
        origin: 'opensubtitles',
        fileName: row.SubFileName || undefined,
        releaseName: row.MovieReleaseName?.trim() || undefined,
        downloads: numberOr(row.SubDownloadsCnt),
        rating: numberOr(row.SubRating),
        year: numberOr(row.MovieYear),
        fps: numberOr(row.MovieFPS),
        hearingImpaired: row.SubHearingImpaired === '1',
        machineTranslated: row.SubAutoTranslation === '1',
        foreignPartsOnly: row.SubForeignPartsOnly === '1',
        trusted: row.SubFromTrusted === '1',
      });
    }
    return out;
  }

  /**
   * Downloads one subtitle and returns it as WebVTT text.
   *
   * Fetched as **bytes** rather than text, which is the whole reason this reads
   * the way it does: `Response.text()` decodes as UTF-8 unconditionally, and a
   * Windows-1252 or GBK subtitle decoded that way loads perfectly with every
   * accented character replaced by a black diamond. Nothing errors, so it reads
   * as a bad upload rather than as our decoding. See `subtitles/convert.ts`.
   */
  public async fetchAsVtt(url: string): Promise<string> {
    let raw = await fetchBuffer(url, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      headers: url.includes('opensubtitles.org') ? { 'User-Agent': REST_USER_AGENT } : undefined,
    });
    // The REST catalogue serves gzip with no Content-Encoding header to say so.
    if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
    return withoutAdverts(toWebVtt(decodeSubtitle(raw)));
  }
}

/** `b` without the keys it leaves undefined, so a merge cannot blank a known value. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Whether a two-letter code names one of the wanted three-letter ones (`en` / `eng`). */
function sameLanguage(code: string, wanted: string[]): boolean {
  const c = code.toLowerCase();
  return wanted.some((w) => w.startsWith(c) || c.startsWith(w) || languageName(w) === languageName(c));
}

/** Drops the self-promotion cues OpenSubtitles adds to its files. */
export function withoutAdverts(vtt: string): string {
  const blocks = vtt.split(/\r?\n\r?\n/);
  return blocks.filter((block) => !(block.includes('-->') && ADVERT_CUE.test(block))).join('\n\n');
}

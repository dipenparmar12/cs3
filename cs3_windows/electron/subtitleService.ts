import { fetchJson, fetchText } from './torrent/http';

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

/** Subtitle search is a foreground action in the player; it must not hang. */
const SEARCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Beyond this the list stops being browsable and starts being a wall. */
const MAX_RESULTS_PER_LANGUAGE = 8;

export interface SubtitleSearchResult {
  id: string;
  /** ISO 639-2 three-letter code as the addon reports it (`eng`, `ger`, `por`). */
  lang: string;
  /** Human-readable language, for the picker. */
  langName: string;
  url: string;
}

interface AddonSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  SubEncoding?: string;
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
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * Converts SubRip to WebVTT.
 *
 * The differences that matter are small but total: WebVTT needs the `WEBVTT`
 * header, and its timestamps use a `.` for the fractional separator where
 * SubRip uses `,`. A file missing either is rejected outright by the browser.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    // A BOM before the WEBVTT header invalidates the file.
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 00:00:41,330 --> 00:00:43,400  ==>  00:00:41.330 --> 00:00:43.400
    .replace(
      /(\d{1,2}:\d{2}:\d{2}),(\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g,
      '$1.$2 --> $3.$4'
    );

  return body.startsWith('WEBVTT') ? body : `WEBVTT\n\n${body}`;
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

  /** Downloads one subtitle and returns it as WebVTT text. */
  public async fetchAsVtt(url: string): Promise<string> {
    const raw = await fetchText(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    return srtToVtt(raw);
  }
}

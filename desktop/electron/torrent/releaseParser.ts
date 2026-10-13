import {
  Resolution,
  ReleaseSource,
  VideoCodec,
  type ParsedRelease,
} from '../../src/types/torrent.ts';

/**
 * Parses scene / P2P release names into structured metadata.
 *
 * Indexers give us a title string and little else, so this parser is load-bearing:
 * episode matching, quality ranking, codec-playability checks and season-pack
 * detection all read its output. It is deliberately tolerant — an unrecognised
 * token degrades a field to `Unknown` rather than failing the whole parse, so a
 * novel naming convention loses ranking precision but never drops the result.
 */

const SEPARATOR_RE = /[._]+/g;
const BRACKET_RE = /[[\](){}]/g;

/** Ordered longest-first so `HDTS` wins over `TS`, `WEB-DL` over `WEB`. */
const SOURCE_PATTERNS: Array<[RegExp, ReleaseSource]> = [
  [/\bremux\b/i, ReleaseSource.Remux],
  [/\b(?:bluray|blu-ray|bdrip|brrip|bdremux|bd25|bd50|bdmv)\b/i, ReleaseSource.BluRay],
  [/\b(?:web-?dl|webdl|amzn|nf|dsnp|hmax|atvp|itunes)\b/i, ReleaseSource.WebDL],
  [/\b(?:web-?rip|webrip)\b/i, ReleaseSource.WebRip],
  [/\bweb\b/i, ReleaseSource.WebDL],
  [/\b(?:hdtv|pdtv|sdtv|dvbrip|tvrip)\b/i, ReleaseSource.HDTV],
  [/\b(?:dvdrip|dvd-?r|dvd5|dvd9|ntsc|pal)\b/i, ReleaseSource.DVDRip],
  [/\b(?:screener|scr|dvdscr|bdscr)\b/i, ReleaseSource.SCR],
  [/\b(?:hdts|telesync|ts)\b/i, ReleaseSource.TS],
  [/\b(?:hdcam|camrip|cam|telecine|tc)\b/i, ReleaseSource.CAM],
];

/**
 * Note the `[\s.]?` between letter and digits: `normalise()` has already turned
 * separator dots into spaces, so `H.265` arrives here as `H 265`. Matching only
 * `h\.?265` silently missed every dotted-codec release — which is most of them.
 */
const CODEC_PATTERNS: Array<[RegExp, VideoCodec]> = [
  [/\bav1\b/i, VideoCodec.AV1],
  [/\b(?:x[\s.]?265|h[\s.]?265|hevc)\b/i, VideoCodec.H265],
  [/\b(?:x[\s.]?264|h[\s.]?264|avc)\b/i, VideoCodec.H264],
  [/\b(?:xvid|divx)\b/i, VideoCodec.XviD],
  [/\bvp9\b/i, VideoCodec.VP9],
];

const RESOLUTION_PATTERNS: Array<[RegExp, Resolution]> = [
  [/\b(?:2160p?|4k|uhd|3840x2160)\b/i, Resolution.UHD_4K],
  [/\b(?:1440p?|2560x1440|qhd)\b/i, Resolution.QHD],
  [/\b(?:1080[pi]?|1920x1080|fhd)\b/i, Resolution.FHD],
  [/\b(?:720p?|1280x720)\b/i, Resolution.HD],
  [/\b(?:480[pi]?|640x480|sd)\b/i, Resolution.SD],
  [/\b(?:360p?|240p?)\b/i, Resolution.LD],
];

/**
 * Channel counts are glued to the codec in practice (`DDP5.1`, `AC3 2.0`), and
 * dots are already spaces by this point, so these allow an optional trailing
 * channel digit rather than requiring a word boundary straight after the name.
 */
const AUDIO_PATTERNS: Array<[RegExp, string]> = [
  [/\batmos\b/i, 'Atmos'],
  [/\btruehd\b/i, 'TrueHD'],
  [/\bdts-?hd(?:\s*ma)?\b/i, 'DTS-HD'],
  [/\bdts-?x\b/i, 'DTS-X'],
  [/\bdts\b/i, 'DTS'],
  [/\b(?:ddp|eac-?3|e-?ac-?3|dd\+)\d*\b/i, 'EAC3'],
  [/\b(?:dd(?!p)(?!\+)|ac-?3)\d*\b/i, 'AC3'],
  [/\bflac\d*\b/i, 'FLAC'],
  [/\bopus\b/i, 'Opus'],
  [/\baac\d*\b/i, 'AAC'],
  [/\bmp3\b/i, 'MP3'],
];

const HDR_PATTERNS: Array<[RegExp, string]> = [
  [/\bhdr10\+|\bhdr10plus\b/i, 'HDR10+'],
  [/\bhdr10\b/i, 'HDR10'],
  [/\b(?:dolby\s*vision|dovi|\bdv\b)\b/i, 'DV'],
  [/\bhlg\b/i, 'HLG'],
  [/\bhdr\b/i, 'HDR'],
];

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:english|eng)\b/i, 'en'],
  [/\b(?:spanish|espanol|castellano|latino|esp)\b/i, 'es'],
  [/\b(?:french|francais|vostfr|truefrench|vff|vfq)\b/i, 'fr'],
  [/\b(?:german|deutsch|ger)\b/i, 'de'],
  [/\b(?:italian|ita)\b/i, 'it'],
  [/\b(?:portuguese|dublado|legendado|por)\b/i, 'pt'],
  [/\b(?:russian|rus)\b/i, 'ru'],
  [/\b(?:japanese|jap|jpn)\b/i, 'ja'],
  [/\b(?:korean|kor)\b/i, 'ko'],
  [/\b(?:chinese|mandarin|cantonese|chs|cht)\b/i, 'zh'],
  [/\b(?:hindi|hin)\b/i, 'hi'],
  [/\b(?:tamil|tam)\b/i, 'ta'],
  [/\b(?:telugu|tel)\b/i, 'te'],
  [/\b(?:arabic|ara)\b/i, 'ar'],
  [/\b(?:turkish|tur)\b/i, 'tr'],
  [/\b(?:polish|pol|lektor)\b/i, 'pl'],
  [/\b(?:dutch|nld)\b/i, 'nl'],
  [/\b(?:thai|tha)\b/i, 'th'],
  [/\b(?:indonesian|ind)\b/i, 'id'],
  [/\b(?:vietnamese|vie)\b/i, 'vi'],
  [/\b(?:ukrainian|ukr)\b/i, 'uk'],
];

/** Tokens that reliably mark the end of the human title portion of a release name. */
const TITLE_TERMINATOR_RE = new RegExp(
  [
    String.raw`\b(19|20)\d{2}\b`,
    String.raw`\bs\d{1,3}(?:\s*[-–]\s*s?\d{1,3})?\b`,
    String.raw`\bs\d{1,3}\s*e\d{1,4}\b`,
    String.raw`\b\d{1,2}x\d{1,3}\b`,
    String.raw`\bseason\b`,
    String.raw`\b(?:2160|1440|1080|720|480|360)[pi]?\b`,
    String.raw`\b(?:4k|uhd|fhd)\b`,
    String.raw`\b(?:bluray|blu-ray|bdrip|brrip|web-?dl|webrip|web|hdtv|dvdrip|remux|hdcam|cam|hdts|telesync)\b`,
    String.raw`\b(?:x[\s.]?26[45]|h[\s.]?26[45]|hevc|avc|av1|xvid|divx)\b`,
    String.raw`\bcomplete\b`,
  ].join('|'),
  'i'
);

function normalise(raw: string): string {
  return raw
    .replace(SEPARATOR_RE, ' ')
    .replace(BRACKET_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchFirst<T>(text: string, patterns: Array<[RegExp, T]>, fallback: T): T {
  for (const [re, value] of patterns) {
    if (re.test(text)) return value;
  }
  return fallback;
}

function matchAll<T>(text: string, patterns: Array<[RegExp, T]>): T[] {
  const out: T[] = [];
  for (const [re, value] of patterns) {
    if (re.test(text) && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Extracts the release group, which conventionally trails the name after a
 * hyphen (`...1080p.WEB-DL.x264-GROUP`) or sits in the final bracket for anime
 * (`[SubsPlease] Title - 12 [1080p]`).
 */
function extractGroup(raw: string): string | undefined {
  const anime = raw.match(/^\[([^\]]{2,30})\]/);
  if (anime) return anime[1].trim();

  const trailing = raw.match(/-\s*([A-Za-z0-9_.]{2,25})(?:\.[a-z0-9]{2,4})?\s*$/);
  if (trailing) {
    const candidate = trailing[1].replace(/\.(mkv|mp4|avi|ts|m2ts)$/i, '').trim();
    // Guard against matching a trailing resolution/codec token rather than a group.
    if (!/^(?:2160p?|1080p?|720p?|480p?|x26[45]|h26[45]|hevc|av1)$/i.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

interface SeasonEpisode {
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  isSeasonPack: boolean;
  isCompleteSeries: boolean;
}

/**
 * Season/episode extraction across the conventions actually seen in the wild.
 * Ordered most-specific first: a multi-season range must not be read as a single
 * season, and `S01E05` must not be read as the season pack `S01`.
 */
function extractSeasonEpisode(text: string): SeasonEpisode {
  const isCompleteSeries = /\b(?:complete|full)\s*(?:series|collection)\b/i.test(text);

  // Multi-season range: "S01-S03", "Season 1-3"
  const range = text.match(/\bs(?:eason)?\s*(\d{1,3})\s*[-–]\s*s?(?:eason)?\s*(\d{1,3})\b/i);
  if (range) {
    return {
      season: parseInt(range[1], 10),
      isSeasonPack: true,
      isCompleteSeries: true,
    };
  }

  // Multi-episode range: "S01E01-E05" / "S01E01-05"
  const epRange = text.match(/\bs(\d{1,3})\s*e(\d{1,4})\s*[-–]\s*e?(\d{1,4})\b/i);
  if (epRange) {
    return {
      season: parseInt(epRange[1], 10),
      episode: parseInt(epRange[2], 10),
      isSeasonPack: true,
      isCompleteSeries: false,
    };
  }

  // Standard "S01E02" (also "S1.E2", "S01 E02")
  const std = text.match(/\bs(\d{1,3})\s*[.\-_ ]?\s*e(\d{1,4})\b/i);
  if (std) {
    return {
      season: parseInt(std[1], 10),
      episode: parseInt(std[2], 10),
      isSeasonPack: false,
      isCompleteSeries: false,
    };
  }

  // "1x02"
  const cross = text.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (cross) {
    return {
      season: parseInt(cross[1], 10),
      episode: parseInt(cross[2], 10),
      isSeasonPack: false,
      isCompleteSeries: false,
    };
  }

  // "Season 1 Episode 2"
  const verbose = text.match(/\bseason\s*(\d{1,3})\s*episode\s*(\d{1,4})\b/i);
  if (verbose) {
    return {
      season: parseInt(verbose[1], 10),
      episode: parseInt(verbose[2], 10),
      isSeasonPack: false,
      isCompleteSeries: false,
    };
  }

  // Season pack: "S01" / "Season 1" with no episode marker
  const pack = text.match(/\bs(?:eason)?\s*(\d{1,3})\b/i);
  if (pack) {
    return {
      season: parseInt(pack[1], 10),
      isSeasonPack: true,
      isCompleteSeries,
    };
  }

  // Anime absolute numbering: "Title - 137 [1080p]" / "Title - 137v2"
  const absolute = text.match(/\s-\s(\d{1,4})(?:v\d)?\b/);
  if (absolute) {
    const n = parseInt(absolute[1], 10);
    // A 4-digit match here is almost always a year, not an episode.
    if (n > 0 && n < 2000) {
      return {
        absoluteEpisode: n,
        episode: n,
        isSeasonPack: false,
        isCompleteSeries,
      };
    }
  }

  // Bare "E05" with no season
  const bareEp = text.match(/\be(?:p|pisode)?\s*(\d{1,4})\b/i);
  if (bareEp) {
    return {
      episode: parseInt(bareEp[1], 10),
      isSeasonPack: false,
      isCompleteSeries,
    };
  }

  return { isSeasonPack: isCompleteSeries, isCompleteSeries };
}

function extractYear(text: string): number | undefined {
  // Prefer a bracketed/parenthesised year, then any standalone plausible year.
  const all = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => parseInt(m[1], 10));
  if (all.length === 0) return undefined;
  const currentYear = new Date().getFullYear();
  const plausible = all.filter((y) => y >= 1900 && y <= currentYear + 2);
  return plausible.length > 0 ? plausible[0] : undefined;
}

function extractCleanTitle(normalised: string): string {
  const match = normalised.match(TITLE_TERMINATOR_RE);
  const head = match && match.index !== undefined ? normalised.slice(0, match.index) : normalised;
  return head
    .replace(/^\[[^\]]*\]\s*/, '') // leading anime group tag
    .replace(/[-–\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseReleaseName(raw: string): ParsedRelease {
  const text = normalise(raw);
  const se = extractSeasonEpisode(text);

  return {
    cleanTitle: extractCleanTitle(text),
    year: extractYear(text),
    season: se.season,
    episode: se.episode,
    absoluteEpisode: se.absoluteEpisode,
    isSeasonPack: se.isSeasonPack,
    isCompleteSeries: se.isCompleteSeries,
    resolution: matchFirst(text, RESOLUTION_PATTERNS, Resolution.Unknown),
    source: matchFirst(text, SOURCE_PATTERNS, ReleaseSource.Unknown),
    videoCodec: matchFirst(text, CODEC_PATTERNS, VideoCodec.Unknown),
    audioCodecs: matchAll(text, AUDIO_PATTERNS),
    hdr: matchAll(text, HDR_PATTERNS),
    languages: matchAll(text, LANGUAGE_PATTERNS),
    isMultiAudio: /\b(?:multi|multi-?audio|dual)\b/i.test(text),
    isDualAudio: /\bdual\s*-?\s*audio\b/i.test(text),
    hasHardcodedSubs: /\b(?:hardsub|hc|hardcoded)\b/i.test(text),
    isRepack: /\brepack\b/i.test(text),
    isProper: /\bproper\b/i.test(text),
    isRemastered: /\bremaster(?:ed)?\b/i.test(text),
    is3D: /\b3d\b|\bhsbs\b|\bhou\b/i.test(text),
    releaseGroup: extractGroup(raw),
  };
}

/**
 * Normalises a title for fuzzy comparison: lowercase, no punctuation, no
 * articles, collapsed whitespace. Used to check that an indexer hit actually
 * corresponds to the title the user picked — indexers routinely return loosely
 * related results for a query.
 */
export function normaliseTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-overlap similarity in [0, 1] (Sørensen–Dice over word sets).
 * Cheap, order-insensitive, and good enough to separate "Dune Part Two" from
 * "Dune" without pulling in a full edit-distance dependency.
 */
export function titleSimilarity(a: string, b: string): number {
  const at = new Set(normaliseTitleForMatch(a).split(' ').filter(Boolean));
  const bt = new Set(normaliseTitleForMatch(b).split(' ').filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;

  let shared = 0;
  for (const token of at) if (bt.has(token)) shared++;
  return (2 * shared) / (at.size + bt.size);
}

/**
 * Does this release satisfy a specific season/episode request?
 * Season packs count as a match — the engine can select the right file from
 * inside the torrent afterwards.
 */
export function matchesEpisode(
  parsed: ParsedRelease,
  season?: number,
  episode?: number
): boolean {
  if (season === undefined && episode === undefined) return true;

  if (parsed.isCompleteSeries) return true;

  if (season !== undefined && parsed.season !== undefined && parsed.season !== season) {
    return false;
  }

  // A season pack for the right season satisfies any episode within it.
  if (parsed.isSeasonPack) {
    return season === undefined || parsed.season === season;
  }

  if (episode !== undefined && parsed.episode !== undefined) {
    return parsed.episode === episode;
  }

  // Anime absolute numbering with no season info — accept and let file selection resolve it.
  if (parsed.absoluteEpisode !== undefined) return true;

  return season !== undefined && parsed.season === season;
}

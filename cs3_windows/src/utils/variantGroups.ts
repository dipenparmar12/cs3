import type { SearchResponse } from '../types/api';

/**
 * Release variants of one title from one provider, shown as one card.
 *
 * `searchMerge.ts` (main process) already folds *different providers* naming
 * the same work into one row with alternates. What it cannot fold is one
 * provider listing the same film four times — `Mean Girls 2024 1080p English`,
 * `… 720p English`, `… 720p Hindi`, `… 480p Hindi` — because those names do
 * not normalise to the same title, and they should not be merged as works:
 * each is a different file a viewer may specifically want.
 *
 * So this is presentation only. Every row survives untouched inside its group;
 * the grid draws the first as the card and offers the rest as variants. Nothing
 * downstream — playback, downloads, ranking, the Source filter — sees anything
 * but the original rows.
 *
 * ## Conservative by construction
 *
 * Two rows share a card only when **all** of these agree:
 *
 *  - the provider (`apiName`) — different providers stay different cards;
 *  - the content type;
 *  - the season/episode marker, when either has one — S01 and S02 are
 *    different content, not variants;
 *  - the year, when both state one;
 *  - the *core title* left after removing only tokens that describe the file
 *    (resolution, source, codec, audio, language, subtitles, size).
 *
 * Anything else that differs ("Extended", "Director's Cut", a subtitle) stays
 * in the core title and therefore keeps the rows apart. When in doubt, two
 * cards: a duplicate costs a glance, a wrong merge hides a choice.
 */

export interface VariantInfo {
  item: SearchResponse;
  resolution?: number;
  languages: string[];
  quality?: string;
  /** Codec, HDR, audio channel tags — shown, never used for grouping. */
  extras: string[];
  /** One short line naming what makes this variant different. */
  label: string;
}

export interface ResultCard {
  /** The row the card opens and plays — the first, i.e. the best-ranked. */
  primary: SearchResponse;
  /** Every row in the group, primary first. A single row has one. */
  variants: VariantInfo[];
  /** The title without file decorations, for the card caption. */
  title: string;
  /** True when every variant is the same release (a plain duplicate). */
  identical: boolean;
}

const LANGUAGES: Array<[RegExp, string]> = [
  [/\b(?:hindi|hin)\b/i, 'Hindi'],
  [/\b(?:english|eng)\b/i, 'English'],
  [/\b(?:tamil|tam)\b/i, 'Tamil'],
  [/\b(?:telugu|tel)\b/i, 'Telugu'],
  [/\bmalayalam\b/i, 'Malayalam'],
  [/\bkannada\b/i, 'Kannada'],
  [/\bbengali\b/i, 'Bengali'],
  [/\bmarathi\b/i, 'Marathi'],
  [/\bpunjabi\b/i, 'Punjabi'],
  [/\burdu\b/i, 'Urdu'],
  [/\bgujarati\b/i, 'Gujarati'],
  [/\bkorean\b/i, 'Korean'],
  [/\bjapanese\b/i, 'Japanese'],
  [/\b(?:chinese|mandarin|cantonese)\b/i, 'Chinese'],
  [/\bspanish\b/i, 'Spanish'],
  [/\bfrench\b/i, 'French'],
  [/\bgerman\b/i, 'German'],
  [/\bitalian\b/i, 'Italian'],
  [/\brussian\b/i, 'Russian'],
  [/\barabic\b/i, 'Arabic'],
  [/\bturkish\b/i, 'Turkish'],
  [/\bportuguese\b/i, 'Portuguese'],
  [/\bdual[ ._-]?audio\b/i, 'Dual audio'],
  [/\bmulti[ ._-]?audio\b/i, 'Multi audio'],
];

const QUALITIES: Array<[RegExp, string]> = [
  [/\bremux\b/i, 'Remux'],
  [/\bblu-?ray\b|\bbdrip\b|\bbrrip\b/i, 'BluRay'],
  [/\bweb-?dl\b/i, 'WEB-DL'],
  [/\bweb-?rip\b/i, 'WEBRip'],
  [/\bhdrip\b/i, 'HDRip'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\bdvdrip\b/i, 'DVDRip'],
  [/\bpre-?dvd\b/i, 'PreDVD'],
  [/\bhd-?ts\b|\bhd-?tc\b|\btelesync\b/i, 'TS'],
  [/\bcam(?:rip)?\b|\bhdcam\b/i, 'CAM'],
];

const EXTRAS: Array<[RegExp, string]> = [
  [/\b(?:x265|h\.?265|hevc)\b/i, 'HEVC'],
  [/\b(?:x264|h\.?264|avc)\b/i, 'H.264'],
  [/\b(?:hdr10\+?|hdr|dolby[ .]?vision|dv)\b/i, 'HDR'],
  [/\b10[ .-]?bit\b/i, '10-bit'],
  [/\b(?:atmos)\b/i, 'Atmos'],
  [/\b(?:dd\+?|ddp|eac3|ac3)[ .]?(?:5\.1|7\.1|2\.0)?\b/i, 'Dolby'],
  [/\b(?:e|m)?subs?\b/i, 'Subs'],
];

/** Tokens that describe the file and never the work — removed to find the core title. */
const FILE_TOKENS = [
  /\b(?:2160p|1440p|1080p|720p|576p|480p|360p|240p|4k|uhd|fhd|hd|sd)\b/gi,
  /\b(?:x26[45]|h\.?26[45]|hevc|avc|10[ .-]?bit|8[ .-]?bit|hdr10\+?|hdr|dolby[ .]?vision|dv|sdr)\b/gi,
  /\b(?:remux|blu-?ray|bdrip|brrip|web-?dl|web-?rip|webrip|hdrip|hdtv|dvdrip|pre-?dvd|hd-?ts|hd-?tc|telesync|hdcam|cam(?:rip)?|dvdscr|scr)\b/gi,
  /\b(?:aac|ac3|eac3|ddp?\+?|dts(?:-hd)?|truehd|atmos|flac|mp3|opus)(?:[ .]?(?:5\.1|7\.1|2\.0))?\b/gi,
  /\b(?:5\.1|7\.1|2\.0)\b/g,
  /\b(?:dual|multi)[ ._-]?audio\b/gi,
  /\b(?:dubbed|dub|org|original|audio|esubs?|msubs?|subs?|subbed|hardsub|softsub)\b/gi,
  /\b\d+(?:\.\d+)?\s?(?:gb|mb)\b/gi,
  /\b(?:hindi|hin|english|eng|tamil|tam|telugu|tel|malayalam|kannada|bengali|marathi|punjabi|urdu|gujarati|korean|japanese|chinese|mandarin|cantonese|spanish|french|german|italian|russian|arabic|turkish|portuguese)\b/gi,
];

const SEASON = /\b(?:s(\d{1,2})(?:\s?e(\d{1,4}))?|season[ ._-]?(\d{1,2})(?:[ ._-]?(?:episode|ep|e)[ ._-]?(\d{1,4}))?|(?:episode|ep)[ ._-]?(\d{1,4}))\b/i;
const YEAR = /\b(19\d{2}|20\d{2})\b/;

function resolutionOf(name: string): number | undefined {
  if (/\b(?:2160p|4k|uhd)\b/i.test(name)) return 2160;
  const match = name.match(/\b(1440|1080|720|576|480|360|240)p\b/i);
  return match ? Number(match[1]) : undefined;
}

function seasonMarker(name: string): string {
  const match = name.match(SEASON);
  if (!match) return '';
  const season = match[1] ?? match[3];
  const episode = match[2] ?? match[4] ?? match[5];
  return `s${season ? Number(season) : ''}e${episode ? Number(episode) : ''}`;
}

/**
 * The title with every file-describing token removed, normalised for comparison.
 *
 * Exported for the tests: this is the one function whose over-reach would merge
 * two different works.
 */
export function coreTitle(name: string): string {
  let working = (name ?? '').toLowerCase();
  // Scene names use dots and underscores as spaces.
  if (!/\s/.test(working)) working = working.replace(/[._]+/g, ' ');
  working = working.replace(SEASON, ' ').replace(YEAR, ' ');
  for (const pattern of FILE_TOKENS) working = working.replace(pattern, ' ');
  return working
    .replace(/[[\](){}]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The caption a card shows: the title before the first file token, tidied. */
function displayTitle(name: string): string {
  const raw = (name ?? '').trim();
  const spaced = /\s/.test(raw) ? raw : raw.replace(/[._]+/g, ' ');
  const cut = spaced.search(/[[(]|\b(?:2160p|1080p|720p|480p|4k|x26[45]|hevc|web-?dl|web-?rip|blu-?ray|hdrip|dual[ .-]audio|hindi|english|tamil|telugu|(?:19|20)\d{2})\b/i);
  const head = (cut > 0 ? spaced.slice(0, cut) : spaced).replace(/[\s\-–:|]+$/, '').trim();
  return head || raw;
}

/**
 * The release name a row was listed under.
 *
 * Search rewrites a provider's file name to the work it is about
 * (`useTitleEnrichment`) and keeps the file name in `originalTitle` — so after
 * enrichment `name` says "The Matrix" on all four encodes, and the differences
 * live only in the original.
 */
export function releaseNameOf(item: SearchResponse): string {
  return item.originalTitle && item.originalTitle !== item.name ? item.originalTitle : (item.name ?? '');
}

export function describeVariant(item: SearchResponse): VariantInfo {
  const name = releaseNameOf(item);
  const languages = LANGUAGES.filter(([pattern]) => pattern.test(name)).map(([, label]) => label);
  const quality = QUALITIES.find(([pattern]) => pattern.test(name))?.[1] ?? item.quality ?? undefined;
  const extras = EXTRAS.filter(([pattern]) => pattern.test(name)).map(([, label]) => label);
  const resolution = resolutionOf(name);
  const parts = [
    resolution ? (resolution === 2160 ? '4K' : `${resolution}p`) : undefined,
    ...languages,
    quality,
    ...extras.filter((extra) => extra === 'HEVC' || extra === 'HDR'),
  ].filter(Boolean) as string[];
  return {
    item,
    resolution,
    languages,
    quality,
    extras,
    label: parts.length > 0 ? parts.join(' · ') : name,
  };
}

function groupKey(item: SearchResponse): string | null {
  const name = releaseNameOf(item);
  const core = coreTitle(name);
  // Too little left to be sure what the work is: never grouped.
  if (core.length < 2) return null;
  const year = name.match(YEAR)?.[1] ?? (item.year ? String(item.year) : '');
  return [item.apiName ?? '', item.type ?? '', seasonMarker(name), year, core].join('|');
}

/**
 * The grid's cards, in the order the rows arrived.
 *
 * A group takes the position of its first row, so a search that streams in
 * does not reshuffle the cards already on screen.
 */
export function groupVariants(items: SearchResponse[]): ResultCard[] {
  const cards: ResultCard[] = [];
  const byKey = new Map<string, ResultCard>();
  for (const item of items) {
    // Torrents and magnets are releases already; grouping them is the source
    // picker's job, and a catalogue row has no variants.
    const key = item.url.startsWith('magnet:') ? null : groupKey(item);
    const existing = key ? byKey.get(key) : undefined;
    const variant = describeVariant(item);
    if (existing) {
      existing.variants.push(variant);
      continue;
    }
    const card: ResultCard = {
      primary: item,
      variants: [variant],
      title: displayTitle(item.name),
      identical: true,
    };
    cards.push(card);
    if (key) byKey.set(key, card);
  }
  for (const card of cards) {
    const first = card.variants[0].label;
    card.identical = card.variants.every((variant) => variant.label === first);
    // A primary without artwork borrows the first variant that has some.
    if (!card.primary.posterUrl) {
      const withPoster = card.variants.find((variant) => variant.item.posterUrl);
      if (withPoster) card.primary = { ...card.primary, posterUrl: withPoster.item.posterUrl };
    }
  }
  return cards;
}

/** "1080p · 720p · Hindi · English" — what a group offers, in one line. */
export function variantSummary(card: ResultCard, limit = 4): string {
  const resolutions = [...new Set(card.variants.map((v) => v.resolution).filter((r): r is number => !!r))]
    .sort((a, b) => b - a)
    .map((r) => (r === 2160 ? '4K' : `${r}p`));
  const languages = [...new Set(card.variants.flatMap((v) => v.languages))];
  const parts = [...resolutions, ...languages];
  if (parts.length === 0) return '';
  return parts.length > limit ? `${parts.slice(0, limit).join(' · ')} +${parts.length - limit}` : parts.join(' · ');
}

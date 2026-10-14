import type { TorrentResult } from '../types/torrent.ts';
import { coreTitle } from './variantGroups.ts';

/**
 * One rung of the player's Quality menu that is a *different source*.
 *
 * Providers such as Castle TV and VegaMovies answer with one link per
 * resolution rather than one adaptive stream, so the stream itself has a single
 * level and the menu would otherwise be a static badge. These are the session's
 * other links that are the same release at another resolution (PRD §99).
 */
export interface ResolutionVariant {
  resolution: number;
  label: string;
  source: TorrentResult;
  isCurrent: boolean;
  /** Every link at this resolution has already failed in this session. */
  failed: boolean;
}

/** `1080p`, `720i`, `2160p` — the number only counts with its scan letter. */
const SCAN_TOKEN = /(?<![\p{L}\p{N}])(2160|1440|1080|720|480|360|240)[pi](?![\p{L}\p{N}])/giu;
/** Names a resolution on its own. Bare `HD`/`SD` do not: "HD Rip", "Full HD Audio". */
const NAMED: Array<[RegExp, number]> = [
  [/(?<![\p{L}\p{N}])(?:4k|uhd)(?![\p{L}\p{N}])/iu, 2160],
  [/(?<![\p{L}\p{N}])(?:qhd)(?![\p{L}\p{N}])/iu, 1440],
  [/(?<![\p{L}\p{N}])(?:fhd|full[ ._-]?hd)(?![\p{L}\p{N}])/iu, 1080],
];
/** HLS ladders put the rung in a path segment: `/hls_mps/<id>/720/index.m3u8`. */
const PATH_SEGMENT = /\/(2160|1440|1080|720|480|360)\//;

/** Every resolution a piece of text states, explicitly. */
function statedIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(SCAN_TOKEN)) found.add(Number(match[1]));
  for (const [pattern, value] of NAMED) if (pattern.test(text)) found.add(value);
  return found;
}

/**
 * The vertical resolution a source can be *shown* to have, or 0.
 *
 * Evidence in order of trust (PRD §99.1): what the provider declared, then the
 * link's own name, then its address. A name stating two resolutions
 * ("720p & 1080p pack") is a conflict and confirms nothing; so is a bare number,
 * which in a title is as likely a year (`1920`) or an id. Nothing is invented.
 */
export function extractResolution(source: TorrentResult): number {
  const declared = source.parsed?.resolution ?? 0;
  if (declared > 0) return declared;

  const fromTitle = statedIn(source.title ?? '');
  if (fromTitle.size === 1) return [...fromTitle][0];
  if (fromTitle.size > 1) return 0;

  const url = (source.directUrl ?? '').split(/[?#]/)[0];
  const fromUrl = statedIn(url);
  if (fromUrl.size === 1) return [...fromUrl][0];
  if (fromUrl.size > 1) return 0;
  const segment = url.match(PATH_SEGMENT);
  return segment ? Number(segment[1]) : 0;
}

/** 2160 -> '4K', 1080 -> '1080p'. */
export function formatResolutionLabel(resolution: number): string {
  return resolution >= 2160 ? '4K' : `${resolution}p`;
}

const lower = (value: string | undefined) => (value ?? '').toLowerCase().trim();

/**
 * Whether two links are one release from one place, whatever their resolution
 * or language.
 *
 * Conservative on every axis PRD §99.2 lists, because a wrong "yes" swaps the
 * film for another one while the menu says only the quality changed: same
 * provider (never across providers, however similar the title), same extractor
 * when both name one, same episode, and the same title once resolution,
 * language and file decorations are stripped.
 */
export function areSameRelease(a: TorrentResult, b: TorrentResult): boolean {
  if (a === b) return true;

  const providerA = lower(a.providerName || a.indexerName);
  const providerB = lower(b.providerName || b.indexerName);
  if (!providerA || providerA !== providerB) return false;

  if (a.providerName && b.providerName && lower(a.indexerName) !== lower(b.indexerName)) return false;

  if ((a.parsed?.season ?? null) !== (b.parsed?.season ?? null)) return false;
  if ((a.parsed?.episode ?? null) !== (b.parsed?.episode ?? null)) return false;

  const coreA = lower(a.parsed?.cleanTitle) || coreTitle(a.title);
  const coreB = lower(b.parsed?.cleanTitle) || coreTitle(b.title);
  return Boolean(coreA) && coreA === coreB;
}

/**
 * The audio version a link carries, as a stable key: `en+hi`, or `''` when it
 * declares none. Never borrowed from a sibling (PRD §123.4 Case C).
 */
export function languageKey(source: TorrentResult): string {
  return [...new Set((source.parsed?.languages ?? []).map(lower).filter(Boolean))].sort().join('+');
}

/**
 * Same release at (possibly) another resolution, *in the same audio version*.
 *
 * The languages must be the same set, not merely overlap: "Hindi + English
 * 1080p" and "English 720p" overlap, and offering the second as "720p" would
 * drop Hindi without a word (PRD §123.7: never silently substitute a
 * language). A link that declares none matches only another that declares none.
 */
export function areResolutionSiblings(a: TorrentResult, b: TorrentResult): boolean {
  return areSameRelease(a, b) && languageKey(a) === languageKey(b);
}

/**
 * The Quality menu's source-switching rungs for the playing source.
 *
 * Empty unless there is a real choice: the active source's own resolution must
 * be known (otherwise no rung can be marked current, and "1080p" might be the
 * very link already playing) and at least one sibling must sit at another
 * resolution. One link per resolution: the active one for its own rung, then a
 * sibling that has not failed this session, then the best scored.
 */
export function findResolutionVariants(
  activeSource: TorrentResult | null | undefined,
  allSources: TorrentResult[] | undefined,
  failedHashes: ReadonlySet<string> = new Set(),
): ResolutionVariant[] {
  if (!activeSource || !allSources || allSources.length === 0) return [];
  const activeRes = extractResolution(activeSource);
  if (activeRes <= 0) return [];

  const isFailed = (s: TorrentResult) => Boolean(s.infoHash) && failedHashes.has(s.infoHash);
  const better = (candidate: TorrentResult, held: TorrentResult) => {
    if (isFailed(held) !== isFailed(candidate)) return isFailed(held);
    return (candidate.score ?? 0) > (held.score ?? 0);
  };

  const byRes = new Map<number, TorrentResult>([[activeRes, activeSource]]);
  for (const sibling of allSources) {
    if (sibling === activeSource || sibling.infoHash === activeSource.infoHash) continue;
    if (!areResolutionSiblings(activeSource, sibling)) continue;
    const res = extractResolution(sibling);
    if (res <= 0 || res === activeRes) continue;
    const held = byRes.get(res);
    if (!held || better(sibling, held)) byRes.set(res, sibling);
  }
  if (byRes.size < 2) return [];

  return [...byRes.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([resolution, source]) => ({
      resolution,
      label: formatResolutionLabel(resolution),
      source,
      isCurrent: resolution === activeRes,
      failed: resolution !== activeRes && isFailed(source),
    }));
}

/**
 * One rung of the audio-language menu that is a *different link* (PRD §123.4
 * Case B): the provider sent "Hindi 1080p" and "English 1080p" as two sources
 * rather than one stream with two audio tracks.
 */
export interface LanguageVariant {
  /** `languageKey` of the link: `hi`, `en+hi`. */
  key: string;
  languages: string[];
  resolution: number;
  source: TorrentResult;
  isCurrent: boolean;
  failed: boolean;
}

/**
 * The audio versions of the playing release, one link each.
 *
 * For every language set the release comes in, the link chosen keeps the
 * current resolution when that version has it, else the nearest one (higher on
 * a tie) — so a change of language never also becomes an unasked change of
 * quality when it need not (§123.7), and the caller can say when it must. A
 * link that failed this session yields to one that has not.
 *
 * Empty unless there is a real choice, and empty when the playing link
 * declares no language: there would be no way to mark which rung is current.
 */
export function findLanguageVariants(
  activeSource: TorrentResult | null | undefined,
  allSources: TorrentResult[] | undefined,
  failedHashes: ReadonlySet<string> = new Set(),
): LanguageVariant[] {
  if (!activeSource || !allSources || allSources.length === 0) return [];
  const activeKey = languageKey(activeSource);
  if (!activeKey) return [];
  const activeRes = extractResolution(activeSource);

  const isFailed = (s: TorrentResult) => Boolean(s.infoHash) && failedHashes.has(s.infoHash);
  const distance = (s: TorrentResult) => {
    const res = extractResolution(s);
    if (!activeRes || !res) return Number.MAX_SAFE_INTEGER;
    return Math.abs(res - activeRes) * 2 + (res < activeRes ? 1 : 0);
  };
  const better = (candidate: TorrentResult, held: TorrentResult) => {
    if (isFailed(held) !== isFailed(candidate)) return isFailed(held);
    if (distance(candidate) !== distance(held)) return distance(candidate) < distance(held);
    return (candidate.score ?? 0) > (held.score ?? 0);
  };

  const byKey = new Map<string, TorrentResult>([[activeKey, activeSource]]);
  for (const sibling of allSources) {
    if (sibling === activeSource || sibling.infoHash === activeSource.infoHash) continue;
    const key = languageKey(sibling);
    if (!key || key === activeKey || !areSameRelease(activeSource, sibling)) continue;
    const held = byKey.get(key);
    if (!held || better(sibling, held)) byKey.set(key, sibling);
  }
  if (byKey.size < 2) return [];

  return [...byKey.entries()]
    .map(([key, source]) => ({
      key,
      languages: key.split('+'),
      resolution: extractResolution(source),
      source,
      isCurrent: key === activeKey,
      failed: key !== activeKey && isFailed(source),
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.key.localeCompare(b.key));
}

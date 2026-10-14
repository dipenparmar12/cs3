import type { TorrentResult } from '../types/torrent.ts';
import { Resolution } from '../types/torrent.ts';
import { coreTitle } from './variantGroups.ts';

export interface ResolutionVariant {
  resolution: number;
  label: string;
  source: TorrentResult;
  isCurrent: boolean;
}

/**
 * Extracts a numeric vertical resolution from parsed metadata, title, or URL.
 * Returns 0 if unknown or unreliable (PRD §99.1).
 */
export function extractResolution(source: TorrentResult): number {
  if (source.parsed?.resolution && source.parsed.resolution > 0) {
    return source.parsed.resolution;
  }
  const text = `${source.title} ${source.directUrl ?? ''}`;
  if (/\b(?:2160p?|4k|uhd)\b/i.test(text)) return Resolution.UHD_4K;
  if (/\b(?:1440p?|qhd)\b/i.test(text)) return Resolution.QHD;
  if (/\b(?:1080[pi]?|fhd)\b/i.test(text)) return Resolution.FHD;
  if (/\b(?:720p?|hd)\b/i.test(text)) return Resolution.HD;
  if (/\b(?:480[pi]?|sd)\b/i.test(text)) return Resolution.SD;
  if (/\b(?:360p?)\b/i.test(text)) return Resolution.LD;
  if (/\b(?:240p?)\b/i.test(text)) return 240;
  return 0;
}

/** Formats numeric resolution into a familiar label: 2160 -> '4K', 1080 -> '1080p', etc. */
export function formatResolutionLabel(resolution: number): string {
  if (resolution >= 2160) return '4K';
  if (resolution === 1440) return '1440p';
  if (resolution === 1080) return '1080p';
  if (resolution === 720) return '720p';
  if (resolution === 480) return '480p';
  if (resolution === 360) return '360p';
  if (resolution === 240) return '240p';
  return `${resolution}p`;
}

/**
 * Checks whether two sources represent the same underlying release/media
 * differing only in resolution or quality variant (PRD §99.1 & §99.2).
 */
export function areResolutionSiblings(a: TorrentResult, b: TorrentResult): boolean {
  if (a === b) return true;

  // 1. Provider provenance must match
  const provA = (a.providerName || a.indexerName || '').toLowerCase().trim();
  const provB = (b.providerName || b.indexerName || '').toLowerCase().trim();
  if (!provA || !provB || provA !== provB) return false;

  // 2. Extractor / host match if present
  if (a.indexerName && b.indexerName && a.providerName && b.providerName) {
    if (a.indexerName.toLowerCase().trim() !== b.indexerName.toLowerCase().trim()) {
      return false;
    }
  }

  // 3. Episodic consistency
  if ((a.parsed?.season ?? null) !== (b.parsed?.season ?? null)) return false;
  if ((a.parsed?.episode ?? null) !== (b.parsed?.episode ?? null)) return false;

  // 4. Core title comparison (file decorations and resolution tokens stripped)
  const coreA = a.parsed?.cleanTitle?.toLowerCase().trim() || coreTitle(a.title);
  const coreB = b.parsed?.cleanTitle?.toLowerCase().trim() || coreTitle(b.title);
  if (!coreA || !coreB || coreA !== coreB) return false;

  // 5. Language compatibility (if both declare languages and they don't overlap)
  const langsA = a.parsed?.languages ?? [];
  const langsB = b.parsed?.languages ?? [];
  if (langsA.length > 0 && langsB.length > 0) {
    const hasOverlap = langsA.some((l) => langsB.some((ol) => ol.toLowerCase() === l.toLowerCase()));
    if (!hasOverlap) return false;
  }

  return true;
}

/**
 * Finds all confirmed resolution variants for activeSource from allSources.
 * Returns an array sorted descending by resolution (e.g. 1080p -> 720p -> 480p).
 * Deduplicates by resolution.
 */
export function findResolutionVariants(
  activeSource: TorrentResult | null | undefined,
  allSources: TorrentResult[] | undefined
): ResolutionVariant[] {
  if (!activeSource || !allSources || allSources.length === 0) return [];

  const activeRes = extractResolution(activeSource);
  const siblings = allSources.filter((s) => areResolutionSiblings(activeSource, s));

  // Map resolution -> TorrentResult
  const byRes = new Map<number, TorrentResult>();
  // Ensure activeSource is the representative for its resolution
  if (activeRes > 0) {
    byRes.set(activeRes, activeSource);
  }

  for (const sibling of siblings) {
    const res = extractResolution(sibling);
    if (res <= 0) continue;
    if (!byRes.has(res)) {
      byRes.set(res, sibling);
    } else if (sibling.infoHash === activeSource.infoHash) {
      byRes.set(res, sibling);
    } else if (byRes.get(res) !== activeSource && sibling.score > (byRes.get(res)?.score ?? 0)) {
      byRes.set(res, sibling);
    }
  }

  const entries = Array.from(byRes.entries());
  // Sort descending by resolution
  entries.sort((a, b) => b[0] - a[0]);

  return entries.map(([res, source]) => ({
    resolution: res,
    label: formatResolutionLabel(res),
    source,
    isCurrent: source.infoHash === activeSource.infoHash || (activeRes > 0 && res === activeRes),
  }));
}

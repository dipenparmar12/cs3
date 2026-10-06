/**
 * Query builder and title normalization for related media searches.
 *
 * Implements PRD 2026-10-06 §8 (Search Query Generation) & §9 (Title Normalization).
 */

import type { RelatedMediaSearchRequest } from '../../../src/types/relatedMedia.ts';

/** Common rip / resolution / release artifacts in scraped titles. */
const NOISE_PATTERN =
  /\b(1080p|720p|2160p|4k|uhd|bluray|blu-ray|webrip|web-dl|hdrip|dvdrip|x264|x265|hevc|aac|dual\s+audio|hindi|english|tamil|telugu|sub(?:titles?)?|esub|complete|season\s*\d+|s\d{1,2}e\d{1,2}|s\d{1,2}|e\d{1,2})\b/gi;

/**
 * Cleans a title of torrent/release noise if necessary.
 */
export function normalizeMediaTitle(title: string): string {
  if (!title) return '';
  let cleaned = title.replace(/[._]/g, ' ');
  cleaned = cleaned.replace(NOISE_PATTERN, ' ');
  // Collapse brackets and extra whitespace
  cleaned = cleaned.replace(/[\[\](){}]/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/**
 * Builds search queries tailored for discovering reviews, explanations,
 * recaps, and discussions.
 */
export function buildRelatedMediaQueries(request: RelatedMediaSearchRequest): string[] {
  const title = normalizeMediaTitle(request.title || request.originalTitle || '');
  if (!title) return [];

  const yearStr = request.year ? String(request.year) : '';
  const isTvEpisode = Boolean(request.season && request.episode);
  const tvSuffix = isTvEpisode ? `S${String(request.season).padStart(2, '0')}E${String(request.episode).padStart(2, '0')}` : '';

  const prefix = isTvEpisode
    ? `${title} ${tvSuffix}`.trim()
    : `${title} ${yearStr}`.trim();

  switch (request.type) {
    case 'explanation':
      return [`${prefix} ending explained`, `${prefix} movie explained`];
    case 'review':
      return [`${prefix} movie review`, `${prefix} review`];
    case 'recap':
      return [`${prefix} recap`, `${prefix} story summary`];
    case 'analysis':
      return [`${prefix} analysis breakdown`, `${prefix} easter eggs hidden details`];
    case 'interview':
      return [`${prefix} cast interview`, `${prefix} director interview`];
    case 'discussion':
      return [`${prefix} discussion podcast`];
    case 'all':
    default:
      // Return queries that cover the main spectrum: reviews, explanations, analysis
      return [
        `${prefix} review`,
        `${prefix} ending explained`,
        `${prefix} analysis breakdown`,
        `${prefix} recap`,
      ];
  }
}

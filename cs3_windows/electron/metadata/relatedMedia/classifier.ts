/**
 * Category classification for on-demand movie reviews, explanations,
 * recaps, and discussions.
 *
 * Implements PRD 2026-10-06 §6 (Discovery Categories).
 */

import type { RelatedMediaCategory } from '../../../src/types/relatedMedia.ts';

const EXPLANATION_REGEX =
  /\b(ending\s+explained|movie\s+explained|film\s+explained|plot\s+explained|story\s+explained|scene\s+explained|twist\s+explained|post[- ]credits?\s+explained|concept\s+explained|lore\s+explained|what\s+really\s+happened|meaning\s+of\s+the\s+ending|ending\s+breakdown)\b/i;

const RECAP_REGEX =
  /\b(recap|recapped|story\s+recap|plot\s+recap|movie\s+recap|series\s+recap|season\s+\d+\s+recap|full\s+story\s+summary|summarized|summary\s+in\s+\d+\s+minutes|in\s+\d+\s+minutes\s+or\s+less)\b/i;

const ANALYSIS_REGEX =
  /\b(analysis|breakdown|hidden\s+details?|easter\s+eggs?|things?\s+you\s+missed|details?\s+you\s+missed|fan\s+theor(?:y|ies)|deep\s+dive|symbolism|visual\s+style|cinematography|philosophy\s+of|lore\s+breakdown|character\s+study|character\s+arc)\b/i;

const INTERVIEW_REGEX =
  /\b(interview|interviews|press\s+conference|q&a|q\s+and\s+a|cast\s+interview|director\s+interview|sits\s+down\s+with|in\s+conversation\s+with|roundtable|behind\s+the\s+scenes\s+interview)\b/i;

const DISCUSSION_REGEX =
  /\b(discussion|podcast|commentary|reaction|reacts\s+to|spoiler\s+discussion|talk\s+show|debate)\b/i;

const REVIEW_REGEX =
  /\b(review|reviews|movie\s+review|film\s+review|spoiler[- ]free\s+review|spoiler\s+review|honest\s+review|critique|verdict|rating|is\s+it\s+worth\s+watching|should\s+you\s+watch)\b/i;

/**
 * Classifies a title and optional description into a RelatedMediaCategory.
 *
 * Checks higher-specificity categories (explanation, recap, analysis, interview)
 * before broader categories (review, discussion).
 */
export function classifyRelatedMediaCategory(
  title: string,
  description?: string
): RelatedMediaCategory {
  const text = `${title || ''} ${description || ''}`.trim();
  if (!text) return 'other';

  if (EXPLANATION_REGEX.test(text)) {
    return 'explanation';
  }
  if (RECAP_REGEX.test(text)) {
    return 'recap';
  }
  if (ANALYSIS_REGEX.test(text)) {
    return 'analysis';
  }
  if (INTERVIEW_REGEX.test(text)) {
    return 'interview';
  }
  if (REVIEW_REGEX.test(text)) {
    return 'review';
  }
  if (DISCUSSION_REGEX.test(text)) {
    return 'discussion';
  }

  return 'other';
}

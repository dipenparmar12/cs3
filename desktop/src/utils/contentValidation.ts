/**
 * Does this source hold the requested content? (Content Validation PRD §5, §7.)
 *
 * Two separate answers, because they fail separately: **identity** (is it the
 * film or episode asked for) and **playability** (can it be played at all). A
 * playable stream can be the wrong film; the right film can fail to play.
 *
 * Duration is the strongest single identity signal and the easiest to misuse,
 * so the rules are per content type with configurable tolerances, and:
 * - nothing known on either side is **unverified**, never a rejection;
 * - a runtime that is only a show's average (TVmaze `averageRuntime`) can raise
 *   a possible mismatch, never confirm one;
 * - trailers, clips and short films are not judged on length at all;
 * - a hit the identity gate already judged a mismatch is confirmed whatever
 *   the length (`providerHitMatch.ts`).
 *
 * Pure. `mediaSanity.looksLikeWrongMedia` is the confirmed-mismatch half.
 */

export type ContentKind = 'movie' | 'episode' | 'short' | 'trailer' | 'live' | 'unknown';

/** How much a runtime can be trusted (PRD §4.2). */
export type RuntimeConfidence = 'measured' | 'catalogue' | 'average' | 'provider';

export type IdentityState = 'validated' | 'likely-match' | 'unverified' | 'possible-mismatch' | 'confirmed-mismatch';
export type PlayabilityState = 'playable' | 'unknown' | 'restricted' | 'temporarily-unavailable' | 'invalid';

/** PRD §6.3, the subset this model decides; the rest belong to the inspector and the request layer. */
export type ValidationReason =
  | 'SUSPICIOUS_DURATION'
  | 'CONTENT_MISMATCH'
  | 'METADATA_UNAVAILABLE'
  | 'VALIDATION_INCONCLUSIVE'
  | 'UPDATE_REQUIRED'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_MEDIA_RESPONSE'
  | 'MEDIA_PROBE_FAILED'
  | 'TEMPORARILY_UNAVAILABLE';

export interface DurationTolerance {
  /** Below this expected length the kind is not judged on duration. */
  minExpectedSeconds: number;
  /** Shorter than this share of expected, and under `confirmCeilingSeconds`: confirmed mismatch. */
  confirmRatio: number;
  confirmCeilingSeconds: number;
  /** Shorter than this share: possible mismatch. */
  possibleRatio: number;
  /** Within this share either way: consistent with the title. */
  consistentRatio: number;
}

/**
 * Defaults, per kind. The movie row reproduces the long-standing skip rule
 * exactly (≥ 20 min expected, < 6 min and < 15%), so adopting the model
 * changes no automatic decision; the possible band is new and only warns.
 */
export const DEFAULT_TOLERANCES: Record<'movie' | 'episode', DurationTolerance> = {
  movie: { minExpectedSeconds: 20 * 60, confirmRatio: 0.15, confirmCeilingSeconds: 6 * 60, possibleRatio: 0.5, consistentRatio: 0.25 },
  episode: { minExpectedSeconds: 15 * 60, confirmRatio: 0.15, confirmCeilingSeconds: 4 * 60, possibleRatio: 0.4, consistentRatio: 0.35 },
};

export interface ValidationInput {
  kind: ContentKind;
  expectedSeconds?: number;
  expectedConfidence?: RuntimeConfidence;
  /** A length that was measured (`judgeableDuration`), never the element's live guess. */
  detectedSeconds?: number;
  /** What the hit-identity gate said about the provider's search row. */
  hitVerdict?: 'match' | 'unknown' | 'mismatch';
  /** From the inspector / request layer (Phase 2). */
  response?: 'media' | 'html' | 'login' | 'update-required' | 'rate-limited' | 'probe-failed';
  tolerances?: Partial<Record<'movie' | 'episode', Partial<DurationTolerance>>>;
}

export interface ValidationResult {
  identity: IdentityState;
  playability: PlayabilityState;
  reasons: ValidationReason[];
  /** For the warning: what was expected and found, when both are known. */
  expectedSeconds?: number;
  detectedSeconds?: number;
  /** detected / expected, when both are known. */
  ratio?: number;
  /** One sentence a viewer can act on. */
  summary: string;
}

const minutes = (seconds: number) => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`);

function tolerance(kind: 'movie' | 'episode', overrides: ValidationInput['tolerances']): DurationTolerance {
  return { ...DEFAULT_TOLERANCES[kind], ...(overrides?.[kind] ?? {}) };
}

function playability(response: ValidationInput['response']): { state: PlayabilityState; reason?: ValidationReason; summary?: string } {
  switch (response) {
    case 'media':
      return { state: 'playable' };
    case 'login':
      return { state: 'restricted', reason: 'AUTHENTICATION_REQUIRED', summary: 'This source asks you to sign in on its website.' };
    case 'update-required':
      return { state: 'restricted', reason: 'UPDATE_REQUIRED', summary: 'This source asks for an app update instead of playing.' };
    case 'html':
      return { state: 'invalid', reason: 'INVALID_MEDIA_RESPONSE', summary: 'This source answered with a web page, not a video.' };
    case 'rate-limited':
      return { state: 'temporarily-unavailable', reason: 'TEMPORARILY_UNAVAILABLE', summary: 'This source is busy; try again shortly.' };
    case 'probe-failed':
      return { state: 'unknown', reason: 'MEDIA_PROBE_FAILED' };
    default:
      return { state: 'unknown' };
  }
}

export function validateContent(input: ValidationInput): ValidationResult {
  const play = playability(input.response);
  const reasons: ValidationReason[] = play.reason ? [play.reason] : [];
  const base = { playability: play.state, expectedSeconds: input.expectedSeconds, detectedSeconds: input.detectedSeconds };

  if (input.hitVerdict === 'mismatch') {
    return {
      ...base,
      identity: 'confirmed-mismatch',
      reasons: [...reasons, 'CONTENT_MISMATCH'],
      summary: 'This source answered with a different title.',
    };
  }

  const judged = input.kind === 'movie' || input.kind === 'episode' ? input.kind : null;
  const expected = input.expectedSeconds;
  const detected = input.detectedSeconds;
  const known = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;

  if (!judged || !known(expected) || !known(detected)) {
    const identity: IdentityState = input.hitVerdict === 'match' ? 'likely-match' : 'unverified';
    return {
      ...base,
      identity,
      reasons: [...reasons, judged && !known(expected) ? 'METADATA_UNAVAILABLE' : 'VALIDATION_INCONCLUSIVE'],
      summary: play.summary ?? (identity === 'likely-match' ? 'Looks like the requested title.' : 'Could not confirm this source holds the requested title. It may still play.'),
    };
  }

  const tol = tolerance(judged, input.tolerances);
  const ratio = detected / expected;
  const result = { ...base, ratio };
  if (expected < tol.minExpectedSeconds) {
    return { ...result, identity: input.hitVerdict === 'match' ? 'likely-match' : 'unverified', reasons: [...reasons, 'VALIDATION_INCONCLUSIVE'], summary: play.summary ?? 'Too short a title to judge by length.' };
  }

  const average = input.expectedConfidence === 'average';
  if (ratio < tol.confirmRatio && detected < tol.confirmCeilingSeconds && !average) {
    return {
      ...result,
      identity: 'confirmed-mismatch',
      reasons: [...reasons, 'SUSPICIOUS_DURATION'],
      summary: `This source plays a ${minutes(detected)} clip, not the ${minutes(expected)} title — likely an advert or a notice.`,
    };
  }
  if (ratio < tol.possibleRatio) {
    return {
      ...result,
      identity: 'possible-mismatch',
      reasons: [...reasons, 'SUSPICIOUS_DURATION'],
      summary: `This source may not be the requested title: it runs ${minutes(detected)}, about ${minutes(expected)} was expected.`,
    };
  }
  if (Math.abs(1 - ratio) <= tol.consistentRatio) {
    return {
      ...result,
      identity: input.hitVerdict === 'unknown' || average ? 'likely-match' : 'validated',
      reasons,
      summary: play.summary ?? 'Runs as long as the requested title.',
    };
  }
  return { ...result, identity: 'likely-match', reasons, summary: play.summary ?? 'Runs about as long as expected.' };
}

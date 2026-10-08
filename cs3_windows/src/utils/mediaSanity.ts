/**
 * Whether a stream is plainly not the title it was offered as.
 *
 * Some providers answer a link request with something that *plays*: a
 * thirty-second "update your app" clip, an advert, a looping placeholder. It
 * passes every check upstream — the URL responds, the bytes decode — and the
 * viewer is left watching a warning card instead of their film.
 *
 * Length is the one fact that gives it away, and it is only trusted when both
 * sides are known: the stream's own duration, and how long the title is
 * expected to be (the catalogue runtime, or what this exact release measured
 * last time it played). A short *film* is fine; a two-minute stream for a
 * two-hour film is not. The thresholds are deliberately loose — a wrong
 * verdict skips a working source, which is worse than letting a bad one play.
 *
 * Applied after the stream has started and reported a duration, never before:
 * it never delays a working source.
 */
export interface MediaSanityInput {
  /** The stream's duration in seconds, as the player reports it. */
  actualSeconds: number;
  /** How long the title should be, in seconds. */
  expectedSeconds?: number;
  isLive?: boolean;
}

/** Titles shorter than this are not judged at all: shorts and clips vary too much. */
const MIN_EXPECTED_SECONDS = 20 * 60;
/** Nothing above this many seconds is called a placeholder, whatever the ratio. */
const PLACEHOLDER_CEILING_SECONDS = 6 * 60;
/** The stream must be shorter than this share of the expected length. */
const MAX_RATIO = 0.15;

export function looksLikeWrongMedia(input: MediaSanityInput): boolean {
  const { actualSeconds, expectedSeconds, isLive } = input;
  if (isLive) return false;
  if (!Number.isFinite(actualSeconds) || actualSeconds <= 0) return false;
  if (!expectedSeconds || !Number.isFinite(expectedSeconds) || expectedSeconds < MIN_EXPECTED_SECONDS) return false;
  return actualSeconds < PLACEHOLDER_CEILING_SECONDS && actualSeconds < expectedSeconds * MAX_RATIO;
}

/** The sentence shown on the source that was skipped. */
export function wrongMediaReason(actualSeconds: number, expectedSeconds: number): string {
  const minutes = (seconds: number) =>
    seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
  return `This source plays a ${minutes(actualSeconds)} clip, not the ${minutes(expectedSeconds)} title — likely an advert or a notice.`;
}

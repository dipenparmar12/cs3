import { validateContent } from './contentValidation.ts';

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

/**
 * The confirmed-mismatch half of `contentValidation.ts`, whose movie row holds
 * this rule's thresholds (judged from 20 min expected; under 6 min and under
 * 15%). Kind is always "movie" here so an episode is judged as it always was.
 */
export function looksLikeWrongMedia(input: MediaSanityInput): boolean {
  if (input.isLive) return false;
  return (
    validateContent({ kind: 'movie', expectedSeconds: input.expectedSeconds, detectedSeconds: input.actualSeconds })
      .identity === 'confirmed-mismatch'
  );
}

/**
 * The length a stream may be judged by — `undefined` when nothing measured it.
 *
 * The element's `duration` is the source's length only when the element plays
 * the source itself. On a conversion it is what ffmpeg has muxed so far (8 s,
 * one second in), and on a live playlist it is the current window. Judging
 * either called every converted Castle TV episode "an 8 s clip" and skipped it
 * — taking the audio track the viewer had just chosen with it, and dropping
 * them onto whichever source came next, in its default language.
 */
export function judgeableDuration(input: {
  /** What the player reports: the element's duration, or mpv's. */
  reportedSeconds: number;
  /** The element is playing ffmpeg's live output, not the source. */
  converted: boolean;
  /** The source's own length, from the inspection. */
  sourceSeconds?: number;
  isLive?: boolean;
}): number | undefined {
  if (input.isLive) return undefined;
  const seconds = input.converted ? input.sourceSeconds : input.reportedSeconds;
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** The sentence shown on the source that was skipped. */
export function wrongMediaReason(actualSeconds: number, expectedSeconds: number): string {
  const minutes = (seconds: number) =>
    seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
  return `This source plays a ${minutes(actualSeconds)} clip, not the ${minutes(expectedSeconds)} title — likely an advert or a notice.`;
}

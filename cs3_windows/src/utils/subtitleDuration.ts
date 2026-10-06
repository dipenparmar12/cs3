/**
 * Whether a subtitle's timeline fits the media it is about to be laid over
 * (subtitle PRD §13–16). Duration is one signal, not a verdict, so the answer
 * has three values and only `mismatch` refuses.
 *
 * The asymmetry is deliberate: a subtitle routinely ends minutes before the
 * film does (credits, a silent ending), so ending early is tolerated far more
 * than running long — a cue past the end of the file cannot belong to it.
 */

export type DurationFit = 'compatible' | 'unknown' | 'mismatch';

const TIMESTAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/g;

/** End of the last cue, in seconds, from WebVTT or SubRip text; null if none parse. */
export function lastCueEndSeconds(text: string): number | null {
  let last: number | null = null;
  for (const m of text.matchAll(TIMESTAMP)) {
    const end = Number(m[5] ?? 0) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8].padEnd(3, '0')) / 1000;
    if (last === null || end > last) last = end;
  }
  return last;
}

/**
 * Running long by more than this (or this fraction) means another release or
 * another work.
 *
 * Twenty minutes and twenty percent, raised from five minutes and ten. The old
 * bound refused the subtitles of an extended cut laid over the theatrical one,
 * a PAL release (4% faster) over an NTSC one, and anything timed with a long
 * post-credits scene — all of them usable, most of them the only English file
 * there was. Those are now *ranked* by how well they fit
 * ({@link durationCloseness}) rather than thrown away, and only a timeline that
 * cannot be this film is refused.
 */
const OVERRUN_SECONDS = 20 * 60;
const OVERRUN_FRACTION = 0.2;
/** Covering less than this fraction of the media means it is not this work's dialogue. */
const MIN_COVERAGE = 0.4;

export function assessSubtitleDuration(subtitleEnd: number | null, mediaDuration: number): DurationFit {
  if (subtitleEnd === null || !Number.isFinite(mediaDuration) || mediaDuration <= 60) return 'unknown';
  const overrun = subtitleEnd - mediaDuration;
  if (overrun > Math.max(OVERRUN_SECONDS, mediaDuration * OVERRUN_FRACTION)) return 'mismatch';
  if (subtitleEnd < mediaDuration * MIN_COVERAGE) return 'mismatch';
  return 'compatible';
}

export function subtitleFitsMedia(text: string, mediaDuration: number): boolean {
  return assessSubtitleDuration(lastCueEndSeconds(text), mediaDuration) !== 'mismatch';
}

/**
 * 0-1: how well a subtitle's length suits the media, for choosing between
 * files that all fit. Dialogue normally ends a few minutes before the file
 * (credits), so ending up to 12% early counts as a perfect fit; running past
 * the end costs twice as much as ending early, because a cue after the last
 * frame cannot belong to it. Unknown on either side is neutral.
 */
export function durationCloseness(text: string, mediaDuration: number): number {
  const end = lastCueEndSeconds(text);
  if (end === null || !Number.isFinite(mediaDuration) || mediaDuration <= 60) return 0.5;
  const ratio = end / mediaDuration;
  if (ratio >= 0.88 && ratio <= 1.01) return 1;
  const off = ratio > 1 ? (ratio - 1.01) * 2 : 0.88 - ratio;
  return Math.max(0, 1 - off * 2.5);
}

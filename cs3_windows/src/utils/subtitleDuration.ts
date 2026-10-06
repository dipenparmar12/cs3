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

/** Running long by more than this (or this fraction) means another release or another work. */
const OVERRUN_SECONDS = 5 * 60;
const OVERRUN_FRACTION = 0.1;
/** Covering less than this fraction of the media means it is not this work's dialogue. */
const MIN_COVERAGE = 0.5;

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

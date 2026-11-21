/**
 * Decisions the trailer player makes, kept pure so they can be tested.
 *
 * ## Seeking
 *
 * A YouTube trailer plays as a live fragmented MP4 that ffmpeg muxes from two
 * inputs (`ContentService.resolvePromoVideo`). It has no index, so each seek
 * restarts ffmpeg at the target (`?t=`). The popup used to do that on every
 * mouse move while the scrubber was dragged: one ffmpeg process started and
 * killed per pixel, and the element reloaded each time. A drag now only moves
 * the handle; the stream is restarted once, on release. Keyboard and button
 * seeks are coalesced the way `VideoPlayer` does it (120 ms), and each one
 * starts from the last target rather than from a playhead that has not moved
 * yet, so three presses of → go 15 s, not 5.
 *
 * ## Recovering
 *
 * A trailer that had been playing and then errors is restarted where it was,
 * a few times, before the error panel is shown. A trailer that never started is
 * a real failure and is reported at once (the panel has Try again).
 */

/** Same pause `VideoPlayer.seekTo` waits before restarting a conversion. */
export const SEEK_COMMIT_MS = 120;

/** Restarts allowed for one entry before its error is shown. */
export const MAX_RECOVERIES = 3;

/** Within this many seconds of the end, an error is treated as the end. */
const END_SLACK_SECONDS = 1.5;

/** A seek target inside the trailer. An unknown duration only clamps at zero. */
export function clampSeek(target: number, duration: number): number {
  if (!Number.isFinite(target)) return 0;
  const upper = duration > 0 ? duration : Infinity;
  return Math.max(0, Math.min(target, upper));
}

/** Where a relative seek starts: the target still pending, else the playhead. */
export function seekBase(pending: number | null, current: number): number {
  return pending ?? current;
}

/** The time under the pointer on a scrubber of the given geometry. */
export function timeAtPointer(clientX: number, left: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  const fraction = Math.max(0, Math.min(1, (clientX - left) / width));
  return fraction * duration;
}

/**
 * The position a live conversion is at. Its element clock restarts at zero on
 * every seek, so the seek target is added back; any other stream reports its
 * own position.
 */
export function playheadSeconds(elementTime: number, offset: number, isLiveConversion: boolean): number {
  return isLiveConversion ? offset + elementTime : elementTime;
}

/** Whether a playback URL is one of the transcoder's live sessions. */
export function isLiveConversionUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/media\/[^/?#]+/i.test(url);
}

export type RecoveryPlan =
  | { action: 'restart'; at: number }
  | { action: 'ended' }
  | { action: 'fail' };

/** What to do when the element reports an error. */
export function recoveryPlan(input: {
  /** The element had presented frames for this entry. */
  hasPlayed: boolean;
  /** Restarts already spent on this entry. */
  recoveries: number;
  position: number;
  duration: number;
}): RecoveryPlan {
  const { hasPlayed, recoveries, position, duration } = input;
  if (duration > 0 && position >= duration - END_SLACK_SECONDS) return { action: 'ended' };
  if (!hasPlayed) return { action: 'fail' };
  if (recoveries >= MAX_RECOVERIES) return { action: 'fail' };
  return { action: 'restart', at: clampSeek(position, duration) };
}

/** Which controls work in a phase. Everything but the transport works at once. */
export function controlsFor(phase: 'resolving' | 'ready' | 'error'): {
  transport: boolean;
  volume: boolean;
  fullscreen: boolean;
  queue: boolean;
} {
  return { transport: phase === 'ready', volume: true, fullscreen: true, queue: true };
}

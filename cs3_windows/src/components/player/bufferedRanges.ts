/**
 * What the buffer bar draws: every buffered span of the timeline, as the
 * active engine reports it.
 *
 * It used to be one number — the end of the *last* range — drawn as a bar from
 * zero. After a seek back the last range is still the one far ahead, so the
 * bar claimed everything up to it was loaded, and after a seek forward into a
 * new range the gap behind the playhead was painted as buffered. Both engines
 * report ranges (`<video>.buffered`, mpv's `seekable-ranges`); the bar now
 * draws exactly those, and nothing is carried over between sources.
 *
 * Pure, so the element path and the mpv path read one rule.
 */

export interface TimeRange {
  start: number;
  end: number;
}

/** The part of `TimeRanges` read here, so a test can pass a plain object. */
export interface TimeRangesLike {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

/** Ranges closer than this are one range on screen (a keyframe gap is not a hole). */
const MERGE_GAP_SECONDS = 0.5;

/**
 * Reads `<video>.buffered`, shifted by `offset` — a remuxed stream's clock
 * starts at the seek point, so its ranges are relative to that.
 */
export function readTimeRanges(ranges: TimeRangesLike | null | undefined, offset = 0): TimeRange[] {
  if (!ranges) return [];
  const out: TimeRange[] = [];
  for (let i = 0; i < ranges.length; i += 1) {
    try {
      out.push({ start: offset + ranges.start(i), end: offset + ranges.end(i) });
    } catch {
      // The list changed while being read (`IndexSizeError`); the next event re-reads it.
      break;
    }
  }
  return out;
}

/**
 * Valid, sorted, merged and clamped to the timeline. A duration of 0 (not yet
 * known, or a live stream) clamps nothing but the start.
 */
export function normaliseRanges(ranges: readonly TimeRange[], duration: number): TimeRange[] {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const valid = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(limit, range.end) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start);

  const merged: TimeRange[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + MERGE_GAP_SECONDS) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * The end of the range the playhead is in, or null when the playhead sits in
 * a hole — which is what "+45s banked" means; a range somewhere else does not
 * play next.
 */
export function bufferedEndAt(ranges: readonly TimeRange[], position: number): number | null {
  for (const range of ranges) {
    if (position >= range.start - MERGE_GAP_SECONDS && position <= range.end) return range.end;
  }
  return null;
}

/** Percent offsets for drawing, one per range. */
export function rangeSegments(
  ranges: readonly TimeRange[],
  duration: number,
): Array<{ left: number; width: number }> {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return ranges
    .map((range) => ({
      left: (Math.max(0, range.start) / duration) * 100,
      width: ((Math.min(duration, range.end) - Math.max(0, range.start)) / duration) * 100,
    }))
    .filter((segment) => segment.width > 0);
}

/**
 * mpv's ranges, or — on a build or stream that reports no seekable cache — the
 * one span it does report: playhead to `demuxer-cache-time`. That figure is the
 * end of the *current* cache range, so it is only trusted when it lies ahead of
 * the playhead; a stale value left over from before a seek back is ignored
 * rather than drawn.
 */
export function mpvBufferedRanges(snapshot: {
  positionSeconds: number;
  bufferedSeconds: number;
  bufferedRanges?: readonly TimeRange[];
}): TimeRange[] {
  if (snapshot.bufferedRanges && snapshot.bufferedRanges.length > 0) return [...snapshot.bufferedRanges];
  const { positionSeconds: position, bufferedSeconds: end } = snapshot;
  if (Number.isFinite(position) && Number.isFinite(end) && end > position) return [{ start: position, end }];
  return [];
}

/** Equal to a tenth of a second — no re-render for a range that did not visibly move. */
export function sameRanges(a: readonly TimeRange[], b: readonly TimeRange[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (range, i) => Math.abs(range.start - b[i].start) < 0.1 && Math.abs(range.end - b[i].end) < 0.1,
  );
}

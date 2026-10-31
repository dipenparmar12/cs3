/**
 * Speed and ETA a viewer can read (Download Progress Stability PRD §2.5).
 *
 * Engines report instantaneous speed (aria2 every poll, the HTTP downloader per
 * second, WebTorrent per tick), and an ETA from one sample swings by minutes
 * between ticks. The speed shown and used for ETA is an exponential moving
 * average; ETA is only given when the size is known and something is moving.
 * Percent is never computed here: it is always bytes over the known total, by
 * the caller. Pure.
 */

/** Weight of the newest sample: about the last five samples matter. */
const ALPHA = 0.3;

export function smoothSpeed(previous: number | undefined, sample: number): number {
  if (!Number.isFinite(sample) || sample < 0) return previous ?? 0;
  if (!previous || previous <= 0) return sample;
  if (sample === 0) return previous * (1 - ALPHA); // decays toward a stall, not a cliff
  return previous + ALPHA * (sample - previous);
}

/** Seconds left, or 0 (shown as no ETA) when the size or a speed is unknown. */
export function etaSeconds(downloaded: number, total: number, speed: number): number {
  if (!(total > 0) || !(speed > 1) || downloaded >= total) return 0;
  return Math.ceil((total - downloaded) / speed);
}

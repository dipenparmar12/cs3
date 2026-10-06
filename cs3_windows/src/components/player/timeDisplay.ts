/**
 * The player's clock: elapsed/total versus elapsed/remaining (PRD-051 §32), and
 * how much is banked ahead of the playhead (§31). Pure, so both player sizes
 * and both engines read one rule.
 */

export type TimeDisplayMode = 'total' | 'remaining';

const STORAGE_KEY = 'cs3.player.timeDisplay';

/** A per-viewer reading preference, so localStorage rather than the datastore. */
export function loadTimeDisplayMode(): TimeDisplayMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'remaining' ? 'remaining' : 'total';
  } catch {
    return 'total';
  }
}

export function saveTimeDisplayMode(mode: TimeDisplayMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private window: not remembered */ }
}

/**
 * The right-hand figure. Remaining is only meaningful once the duration is
 * known — a live stream or a probe still in flight shows the total form.
 */
export function rightHandSeconds(mode: TimeDisplayMode, current: number, duration: number): {
  seconds: number;
  negative: boolean;
} {
  if (mode === 'remaining' && Number.isFinite(duration) && duration > 0) {
    return { seconds: Math.max(0, duration - current), negative: true };
  }
  return { seconds: duration, negative: false };
}

/**
 * `+45s`, `+2m 30s`, `+1h 15m`, or null when nothing useful is banked. The
 * buffered figure is an absolute position on every engine (mpv's
 * `demuxer-cache-time`, the element's range end), so ahead = end − playhead.
 */
export function formatBufferAhead(bufferedEnd: number, current: number): string | null {
  const ahead = Math.floor(bufferedEnd - current);
  if (!Number.isFinite(ahead) || ahead < 1) return null;
  const h = Math.floor(ahead / 3600);
  const m = Math.floor((ahead % 3600) / 60);
  const s = ahead % 60;
  if (h > 0) return `+${h}h ${m}m`;
  if (m > 0) return s > 0 ? `+${m}m ${s}s` : `+${m}m`;
  return `+${s}s`;
}

/** Formats a relative seek delta from current playhead (e.g. +1m 30s or -45s). */
export function formatDeltaSeconds(delta: number): string {
  const abs = Math.abs(Math.round(delta));
  const sign = delta >= 0 ? '+' : '-';
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) return `${sign}${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${sign}${m}m ${s}s` : `${sign}${m}m`;
  return `${sign}${s}s`;
}

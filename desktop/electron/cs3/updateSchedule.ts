/**
 * When the automatic extension update check runs: at most once per calendar
 * day, as soon after launch as the app has settled, and again after midnight
 * for an app left open across it.
 *
 * Calendar day rather than "24 hours since the last check": an app opened at
 * 23:00 and again at 09:00 should check both times, and one opened at 09:00 and
 * again at 11:00 should not. The old `startup` policy re-checked every launch —
 * every repository fetched again for an app restarted five times in an
 * evening. A check the viewer asks for is never limited by this; only the
 * automatic one is, and it keeps its own timestamp so a manual check in the
 * morning does not cancel the day's automatic install.
 *
 * Pure, with the clock injected, so the day boundary is tested
 * (`updateSchedule.test.mts`) rather than waited for.
 */

export type AutomaticPolicy = 'manual' | 'daily' | 'startup';

export function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function nextLocalMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

/**
 * Milliseconds until the next automatic check, or null when checks are off.
 *
 * `startup` and `daily` mean the same now — once a day — and both stay
 * accepted so a stored choice keeps working.
 */
export function automaticCheckDelay(input: {
  policy: AutomaticPolicy;
  lastAutoCheckAt: number;
  now: number;
  /** How long after launch (or midnight) to wait, so the check never competes with first paint. */
  settleMs: number;
}): number | null {
  if (input.policy === 'manual') return null;
  const { lastAutoCheckAt, now, settleMs } = input;
  // Never checked, checked on an earlier day, or a clock that has moved backwards.
  if (!lastAutoCheckAt || lastAutoCheckAt > now || !sameLocalDay(lastAutoCheckAt, now)) return settleMs;
  return nextLocalMidnight(now) - now + settleMs;
}

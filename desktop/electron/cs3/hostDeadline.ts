/**
 * How long the host may spend on a call the sidecar is sitting and waiting on.
 *
 * The reverse channel carries one deadline and both ends used it: the JVM waits
 * `timeoutMs` in `HostChannel.call`, and `WebViewHost.resolve` spent the same
 * `timeoutMs` driving the browser. An answer produced at the very end of that
 * budget therefore arrives after the only thread that wanted it has stopped
 * waiting, and `HostChannel.complete` drops it — "a reply with nobody waiting"
 * is its documented normal case.
 *
 * Measured over three sessions of ordinary use: 214 resolves, of which 49
 * matched — every one of those inside 6.5s — and 165 ran to the full 15s
 * budget and reported back between 15021ms and 15273ms against a 15000ms wait.
 * All 165 were discarded, tens of milliseconds late, having already cost the
 * viewer the entire wait. That is 41 minutes of browser work in three sessions
 * thrown away at the finish line, and it is most of what "it just sits there"
 * means on a source that needs a browser.
 *
 * ## The rule
 *
 * The side doing the work finishes first, so that the side waiting for it is
 * still listening. This repository already states that rule in the forward
 * direction — `Main.timeoutFor` gives a plugin call ten seconds less than the
 * RPC that carries it, so "the inner one wins" and the message names the
 * provider that hung rather than shrugging. The reverse channel was built later
 * and never got it.
 *
 * The reserve is flat rather than proportional because what it pays for is
 * flat: serialising an answer, one pipe write, and a parse on the sidecar's
 * stdin reader. That is milliseconds. It is sized far above the measured
 * overshoot (21–273ms) because the overshoot is not the round trip — it is our
 * own timer firing late while three Chromium pages and a transcode compete for
 * the machine, and a margin that only just covers a quiet host is not a margin.
 *
 * It is also capped as a fraction of the deadline, so that a caller asking for
 * very little still gets most of it to work in rather than having its budget
 * eaten by a reserve sized for a long one.
 */

/** Room left for producing the answer and getting it across the pipe. */
export const DELIVERY_RESERVE_MS = 1_500;

/**
 * Never hand back less working time than this.
 *
 * Below it there is no point starting: a browser cannot open a page, and the
 * honest outcome is the empty answer the caller would have got anyway — but it
 * should come from the work, not from arithmetic that left nothing to do it in.
 */
export const MIN_WORKING_MS = 1_000;

/** The reserve never takes more of the deadline than this. */
export const MAX_RESERVE_FRACTION = 0.25;

export interface BudgetOptions {
  /** Upper bound on the caller's deadline. `HostChannel` enforces its own too. */
  ceilingMs?: number;
  reserveMs?: number;
}

/**
 * The working budget for a host call whose caller will wait `callerDeadlineMs`.
 *
 * Always strictly less than the deadline unless the deadline is already at the
 * floor, where there is nothing left to reserve and the honest answer is to
 * return the floor rather than zero.
 */
export function hostBudget(callerDeadlineMs: number, options: BudgetOptions = {}): number {
  const ceiling = options.ceilingMs ?? Number.POSITIVE_INFINITY;
  // `NaN` is meaningless and collapses to the floor. An infinite deadline is
  // not meaningless — it says "wait as long as you like" — so it is allowed
  // through to be clamped by the ceiling the caller supplies.
  const asked = Number.isNaN(callerDeadlineMs) ? MIN_WORKING_MS : callerDeadlineMs;
  const deadline = Math.min(Math.max(asked, MIN_WORKING_MS), ceiling);

  const reserve = Math.min(
    options.reserveMs ?? DELIVERY_RESERVE_MS,
    Math.floor(deadline * MAX_RESERVE_FRACTION)
  );

  const budget = deadline - reserve;
  // Reachable only when an unbounded deadline meets an unbounded ceiling, where
  // there is no number to plan against and the floor is the honest answer.
  if (!Number.isFinite(budget)) return MIN_WORKING_MS;
  return Math.max(MIN_WORKING_MS, budget);
}

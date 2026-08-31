/**
 * Whether the bytes already on disk may be kept when a download's link changes.
 *
 * ## The situation this exists for
 *
 * Provider links are signed and short-lived. A 4 GB film routinely outlives the
 * URL that was serving it, `DownloadService` re-resolves the release, and the
 * replacement is a *different address for the same content* — usually a
 * different CDN edge, sometimes a different mirror entirely. The question is
 * then whether the partial file beside it is still the beginning of what the
 * new address is about to send.
 *
 * ## Why the previous answer was dangerous
 *
 * The recovery path compared the provider's *declared* size against the task's
 * and restarted when they differed by more than 20%. Two things are wrong with
 * that, and they compound:
 *
 *  - Provider-declared sizes are frequently absent and frequently wrong. With
 *    no declared size the check did not run at all, and the partial was
 *    appended to unconditionally.
 *  - 20% is enormous. Two encodes of one film at one resolution differ by far
 *    less than that, and appending the tail of encode B to the head of encode A
 *    produces a file that finalises, reports success, and does not play.
 *
 * A corrupt download that completes is worse than one that restarts, because
 * nothing anywhere says it happened. The viewer discovers it when they sit down
 * to watch.
 *
 * ## What replaces it
 *
 * Evidence, ordered cheapest-first, with an exact byte comparison as the last
 * word. The strong check is `overlapVerified`: read the last window of the
 * partial file, ask the new URL for that exact byte range, and compare. If they
 * match, the remote file is byte-identical up to that offset and resuming is
 * not a guess — it is proved, for 64 KB of traffic against a multi-gigabyte
 * transfer.
 *
 * ## What this cannot do, stated plainly
 *
 * When the replacement server ignores `Range` — it answers a ranged request
 * with `200` and the whole file from byte zero — there is no way to continue.
 * The bytes are not recoverable and the transfer restarts. This is reported as
 * its own reason rather than folded into the mismatches, because it is the one
 * restart that is nobody's fault and the only one that would be fixed by the
 * source improving rather than by the user doing anything.
 *
 * Pure, and tested, because both directions fail silently and in opposite
 * ways: too eager corrupts a file that reports success, and too cautious throws
 * away hours of a download and reads as the app being unable to resume at all.
 */

export interface ResumeEvidence {
  /** Bytes already written to the `.part` file. */
  partialBytes: number;
  /**
   * What the task believed the finished file would weigh, from before the link
   * changed. Often absent — providers are not obliged to declare a size.
   */
  expectedTotalBytes?: number;
  /**
   * The whole file's length according to the *new* URL, read from
   * `Content-Range` on a ranged probe or from `Content-Length` on an unranged
   * one. Absent when the server declares nothing.
   */
  remoteTotalBytes?: number;
  /** The new URL answered a ranged probe with `206` and a `Content-Range`. */
  remoteSupportsRange: boolean;
  /**
   * Byte-for-byte agreement across the window ending at `partialBytes`.
   *
   * `undefined` means the comparison has not been made yet, which is what the
   * `verify` action asks the caller to go and do.
   */
  overlapVerified?: boolean;
  /** The refreshed source is the same provider the task was created against. */
  sameProvider: boolean;
  /** Same resolution, so this is not a 1080p rip landing in a 2160p file. */
  sameResolution: boolean;
  /**
   * Same container, inferred from the file extension the new link implies.
   * A `.mkv` continued into a `.mp4` is a different file whatever else agrees.
   */
  sameContainer: boolean;
}

export type ResumeAction =
  /** Append to the partial from `keepBytes`. */
  | 'resume'
  /** The partial is already the whole file; finalise it without transferring. */
  | 'complete'
  /** Everything cheap agrees; take the overlap window and ask again. */
  | 'verify'
  /** Discard the partial and transfer from zero. */
  | 'restart';

export interface ResumeDecision {
  action: ResumeAction;
  /** Bytes to keep on disk. Always 0 for `restart`. */
  keepBytes: number;
  /**
   * Why, in a sentence fit to put in front of the user.
   *
   * Carried rather than derived at the call site because a restart that says
   * nothing is indistinguishable from the download having failed and started
   * over on its own — which is what the old path looked like.
   */
  reason: string;
  /**
   * Machine-readable cause, for the ledger and for tests. `no-range` is
   * separate from the mismatches on purpose: it is the only restart that says
   * nothing is wrong with either file.
   */
  cause:
    | 'nothing-to-keep'
    | 'identity-mismatch'
    | 'size-mismatch'
    | 'partial-too-long'
    | 'no-range'
    | 'unknown-length'
    | 'overlap-mismatch'
    | 'verified'
    | 'already-complete'
    | 'needs-verification';
}

/** How much of the boundary to compare. Enough to be conclusive, small enough to be free. */
export const OVERLAP_WINDOW_BYTES = 64 * 1024;

/**
 * The window to request, given how much is on disk.
 *
 * Never larger than the partial itself, and never zero — a range of no bytes
 * proves nothing and some servers answer it with the whole file.
 */
export function overlapWindow(partialBytes: number): { start: number; end: number } | null {
  if (partialBytes <= 0) return null;
  const length = Math.min(OVERLAP_WINDOW_BYTES, partialBytes);
  return { start: partialBytes - length, end: partialBytes - 1 };
}

export function planResume(evidence: ResumeEvidence): ResumeDecision {
  const restart = (cause: ResumeDecision['cause'], reason: string): ResumeDecision => ({
    action: 'restart',
    keepBytes: 0,
    reason,
    cause,
  });

  if (evidence.partialBytes <= 0) {
    return restart('nothing-to-keep', 'Nothing had been downloaded yet, so the transfer starts fresh.');
  }

  /**
   * Identity first, because it is free and it is the check that stops the
   * worst outcome. A source that is a different release is not a resume
   * candidate no matter how well its bytes happen to line up — and at one
   * resolution, from one provider, they can line up for a surprisingly long
   * way, since two encodes of the same film share container headers.
   */
  if (!evidence.sameProvider || !evidence.sameResolution || !evidence.sameContainer) {
    return restart(
      'identity-mismatch',
      'The replacement link is a different release, so the part already downloaded cannot be reused.'
    );
  }

  if (evidence.remoteTotalBytes === undefined) {
    /**
     * No declared length. The overlap check alone would still prove the *head*
     * matches, but not that the files are the same length — a re-encode
     * sharing a prefix is exactly the case that produces a truncated or
     * over-long result that still finalises.
     */
    return restart(
      'unknown-length',
      'The new source does not say how large the file is, so continuing could not be verified as safe.'
    );
  }

  if (
    evidence.expectedTotalBytes !== undefined &&
    evidence.expectedTotalBytes > 0 &&
    evidence.expectedTotalBytes !== evidence.remoteTotalBytes
  ) {
    /**
     * Exact, not approximate. The 20% tolerance this replaced is wider than the
     * difference between two encodes of the same title at the same resolution,
     * which is precisely the pair it needed to tell apart.
     */
    return restart(
      'size-mismatch',
      'The replacement file is a different size from the one being downloaded, so it is a different copy.'
    );
  }

  if (evidence.partialBytes > evidence.remoteTotalBytes) {
    return restart(
      'partial-too-long',
      'More has been downloaded than the replacement file contains, so they are not the same file.'
    );
  }

  if (evidence.partialBytes === evidence.remoteTotalBytes) {
    return {
      action: 'complete',
      keepBytes: evidence.partialBytes,
      reason: 'The file was already fully downloaded; finishing it off.',
      cause: 'already-complete',
    };
  }

  /**
   * Checked after the size arithmetic, not before.
   *
   * A server that ignores `Range` can still answer the probe with a
   * `Content-Length`, and knowing the file is a different size is a better
   * thing to tell the user than knowing the server cannot resume. Ordering it
   * this way means the message names the real problem when there is one.
   */
  if (!evidence.remoteSupportsRange) {
    return restart(
      'no-range',
      'The replacement server sends the whole file each time and cannot continue part-way, ' +
        'so the download has to start again.'
    );
  }

  if (evidence.overlapVerified === undefined) {
    return {
      action: 'verify',
      keepBytes: evidence.partialBytes,
      reason: 'Checking that the replacement file matches what has been downloaded so far.',
      cause: 'needs-verification',
    };
  }

  if (!evidence.overlapVerified) {
    return restart(
      'overlap-mismatch',
      'The replacement file differs from what has been downloaded, so continuing would corrupt it.'
    );
  }

  return {
    action: 'resume',
    keepBytes: evidence.partialBytes,
    reason: 'The replacement file matches byte for byte; continuing from where it stopped.',
    cause: 'verified',
  };
}

/**
 * The container a URL implies, or null when it implies nothing.
 *
 * Query strings are stripped first: a signed URL carries `?Expires=…&…` and the
 * extension sits before it. A URL with no recognisable extension answers null
 * rather than guessing, and `sameContainer` should then be treated as agreeing
 * — refusing to resume because an address is opaque would refuse most provider
 * links, which is the failure mode that makes a safety check get switched off.
 */
export function containerFromUrl(url: string): string | null {
  const withoutQuery = url.split(/[?#]/)[0];
  const match = /\.([a-z0-9]{2,5})$/i.exec(withoutQuery);
  if (!match) return null;
  const extension = match[1].toLowerCase();
  const known = ['mkv', 'mp4', 'avi', 'mov', 'webm', 'ts', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];
  return known.includes(extension) ? extension : null;
}

/**
 * Whether two addresses imply the same container.
 *
 * True when either says nothing, for the reason above. This is a check that
 * only ever *rejects* on positive disagreement.
 */
export function containersAgree(oldUrl: string, newUrl: string): boolean {
  const before = containerFromUrl(oldUrl);
  const after = containerFromUrl(newUrl);
  if (before === null || after === null) return true;
  return before === after;
}

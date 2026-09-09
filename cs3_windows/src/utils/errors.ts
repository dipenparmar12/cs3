/**
 * Turning a thrown thing into a sentence, once.
 *
 * `error instanceof Error ? error.message : String(error)` appeared **79
 * times** across 37 files, under four different variable names. That is the
 * most-repeated expression in this codebase, and repeating it would be the
 * smaller problem — the real one is what it produces.
 *
 * ## `fetch failed`
 *
 * Node's fetch throws `TypeError: fetch failed` and puts the actual reason in
 * `error.cause`. So the naive idiom reports every DNS failure, every refused
 * connection, every TLS error and every unreachable host in this app as the
 * same two words. That message reaches three places and is useless in all of
 * them: the screen, where it tells the viewer nothing they can act on; the
 * pasteable report, where it tells a maintainer nothing either; and
 * `ExtensionIssueLog`, where `groupingForm` collapses every one of them into a
 * **single row** — so a tally built precisely to answer "how many distinct
 * things are wrong" answers "one" for the entire network-failure family.
 *
 * Counting is the whole argument for the issue ledger, and this was quietly
 * defeating it. `indexerRegistry` had already worked this out and grown a local
 * `describeError` that unwraps `cause.code`; it was one module's fix for a
 * codebase-wide problem.
 *
 * ## Timeouts
 *
 * `AbortSignal.timeout` surfaces as `TimeoutError: The operation was aborted
 * due to timeout`, and a caller's own `AbortController` as `AbortError: This
 * operation was aborted`. Both are ordinary, both are frequent — fifteen
 * scrapes are in flight whenever the viewer types a new query — and neither
 * sentence is worth showing anyone.
 *
 * The distinction this keeps is the one the taxonomy needs: a timeout is a
 * failure and a **cancellation is not**. `classifyFailure` files anything
 * matching `cancelled` under `cancelled`, which `ExtensionIssueLog` drops
 * rather than counting — so the words below are chosen to land there, and an
 * abort must not be described with the word "timeout" or it is scored against
 * a provider for the app's own decision to stop waiting.
 */

/** Node's fetch failures carry the real reason here. */
interface ErrorCause {
  code?: string;
  message?: string;
}

/**
 * What a `cause.code` means, in words worth showing someone.
 *
 * Only the codes that reach a user through a provider, an indexer or a
 * catalogue. Anything else falls through to `message (CODE)`, which is still
 * far better than dropping the code — it is the part that groups.
 */
const CAUSE_TEXT: Record<string, string> = {
  ENOTFOUND: 'Host not found (DNS blocked or the domain moved)',
  EAI_AGAIN: 'DNS lookup failed (the resolver did not answer)',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection reset',
  ETIMEDOUT: 'Connection timed out',
  EHOSTUNREACH: 'Host unreachable',
  ENETUNREACH: 'Network unreachable',
  EPROTO: 'TLS handshake failed',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The site presented a self-signed certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The site’s certificate could not be verified',
  CERT_HAS_EXPIRED: 'The site’s certificate has expired',
};

/**
 * A one-line description of anything that was thrown.
 *
 * Never throws and never returns an empty string: this runs on failure paths,
 * and a blank message is the one outcome worse than a vague one — it renders as
 * a UI element with nothing in it and gives the reader no reason to look
 * further.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Ordering matters: a caller's abort is not a timeout, and the words here
    // decide which taxonomy row it lands in. See the note above.
    if (error.name === 'TimeoutError') return 'Timed out';
    if (error.name === 'AbortError') return 'Cancelled';

    const cause = (error as { cause?: ErrorCause }).cause;
    const code = cause?.code;
    if (code) {
      const known = CAUSE_TEXT[code];
      if (known) return known;
      // Unknown code, but `fetch failed` alone is worth nothing — keep the code,
      // which is the half that distinguishes one failure from another.
      return error.message && error.message !== 'fetch failed'
        ? `${error.message} (${code})`
        : code;
    }

    // A cause that is itself an Error, which is how several libraries wrap.
    if (cause instanceof Error && cause.message) {
      return error.message && error.message !== 'fetch failed'
        ? `${error.message}: ${cause.message}`
        : cause.message;
    }

    if (error.message) return error.message;
    return error.name || 'Unknown error';
  }

  if (typeof error === 'string' && error) return error;

  // `String({})` is "[object Object]", which says less than nothing. A rejected
  // promise carrying a plain object is common enough in IPC to be worth the
  // branch — the object's own fields are the only information there is.
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const field of ['message', 'error', 'reason', 'detail'] as const) {
      const value = record[field];
      if (typeof value === 'string' && value) return value;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}') return json.slice(0, 300);
    } catch {
      /* circular, or a BigInt — fall through to the constructor name */
    }
    return error.constructor?.name ?? 'Unknown error';
  }

  // `String('')` and `String([])` are both empty, and an empty description
  // renders as a UI element with nothing in it. Whatever else this returns, it
  // is never that.
  const rendered = error === undefined || error === null ? '' : String(error);
  return rendered || 'Unknown error';
}

/**
 * Whether this failure is the app's own decision to stop waiting.
 *
 * Callers that count failures need to skip these — a cancelled scrape is not a
 * provider that failed, and counting it ranks the *slowest* providers down
 * hardest, since those are the ones still running when the cancel lands.
 */
export function isAbort(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
  );
}

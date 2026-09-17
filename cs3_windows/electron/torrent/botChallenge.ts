/**
 * Telling a bot wall apart from a refusal, and from an outage.
 *
 * ## Why an indexer "times out" when it has not
 *
 * The reported failures on 1337x, BitSearch and Nyaa arrive here as
 * `HTTP 403 Forbidden` — the same string a hotlink block, a country ban and a
 * WAF rule produce. `withRetry` does not retry a 4xx, the registry counts a
 * failure, and after three of them the indexer is skipped. Nothing in the
 * torrent lane has ever looked at *why*, so three genuinely different
 * situations got one response: give up.
 *
 * Two of them are worth separating, because the right move is opposite:
 *
 *  - **A challenge** is a page saying "prove you are a browser". We have a
 *    browser — `WebViewHost` solves exactly this for `.cs3` extensions, and has
 *    since 2026-08-24. Solving it once buys a `cf_clearance` cookie good for
 *    every later request to that host.
 *  - **A block** is a page saying "no". Opening a browser costs several seconds
 *    and changes nothing, and doing it on every search is worse than the
 *    failure it is trying to fix.
 *
 * ## The case that looks like success
 *
 * Cloudflare's managed challenge is frequently served as **HTTP 200** with an
 * interstitial body. `fetchText` returns it without complaint, cheerio parses
 * zero rows, and the adapter reports "no results" — which reads to a viewer as
 * "this indexer has nothing for that film". A search that silently found fewer
 * sources than it should is the worst failure this app has; detecting it is
 * most of the value here.
 *
 * Pure, so the shapes can be pinned without a network. The corresponding rule
 * in `webViewHost.ts` — `Server: cloudflare` **and** a 403/503, both — is the
 * same judgement made at the other end, and this deliberately agrees with it.
 */

export type ChallengeKind =
  | 'none'
  /** "Just a moment…" — a browser can pass this. */
  | 'cloudflare-challenge'
  /** A WAF or country block behind Cloudflare. A browser cannot pass it. */
  | 'cloudflare-block'
  /** DDoS-Guard's interstitial. Detected and named; no bypass is built. */
  | 'ddos-guard'
  /** Rate limiting. Not a bot wall, and waiting is the only cure. */
  | 'rate-limited';

export interface ChallengeVerdict {
  kind: ChallengeKind;
  /** True only when opening a browser is likely to produce a usable session. */
  solvable: boolean;
  /** Said to the user, and recorded against the indexer. */
  reason: string;
}

const NOT_A_CHALLENGE: ChallengeVerdict = {
  kind: 'none',
  solvable: false,
  reason: '',
};

/**
 * Markers that only appear on a challenge page.
 *
 * Deliberately narrow. `cheerio` will happily parse an ordinary listing that
 * mentions Cloudflare in a footer, and treating that as a challenge would send
 * every search through a browser for nothing.
 */
const CHALLENGE_MARKERS = [
  'cf-browser-verification',
  'challenge-platform',
  'cf_chl_opt',
  'cf-challenge-running',
  '/cdn-cgi/challenge-platform/',
  'just a moment',
  'checking your browser before accessing',
  'enable javascript and cookies to continue',
];

/** Markers that mean a decision has been made and it was "no". */
const BLOCK_MARKERS = [
  'attention required',
  'sorry, you have been blocked',
  'error code: 1020',
  'access denied',
];

const DDOS_GUARD_MARKERS = ['ddos-guard', 'ddg-challenge', 'check.ddos-guard.net'];

/** Headers are matched case-insensitively; different stacks disagree on casing. */
function header(headers: Readonly<Record<string, string>>, name: string): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value.toLowerCase();
  }
  return '';
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function detectChallenge(input: {
  status: number;
  headers?: Readonly<Record<string, string>>;
  /** The first few KB of the body. Reading the whole page to classify it is waste. */
  bodyPrefix?: string;
}): ChallengeVerdict {
  const headers = input.headers ?? {};
  const body = (input.bodyPrefix ?? '').toLowerCase();
  const server = header(headers, 'server');
  const behindCloudflare = server.includes('cloudflare') || Boolean(header(headers, 'cf-ray'));

  /**
   * Cloudflare's own answer, when it gives one.
   *
   * `cf-mitigated: challenge` is definitive and needs no body at all, which
   * matters because it is present on the 403 whose body we would otherwise have
   * to download to classify.
   */
  if (header(headers, 'cf-mitigated') === 'challenge') {
    return {
      kind: 'cloudflare-challenge',
      solvable: true,
      reason: 'This site asked for a browser check.',
    };
  }

  if (containsAny(body, DDOS_GUARD_MARKERS) || server.includes('ddos-guard')) {
    return {
      kind: 'ddos-guard',
      solvable: false,
      reason: 'This site is behind DDoS-Guard, which this app cannot pass.',
    };
  }

  /**
   * 429, and 503 with a `Retry-After`, are rate limits rather than bot walls.
   *
   * Checked before the challenge markers because a rate-limited Cloudflare host
   * answers 503 too, and sending a browser at one makes the rate limit worse —
   * the browser issues a dozen subrequests where the scrape issued one.
   */
  if (input.status === 429 || (input.status === 503 && header(headers, 'retry-after'))) {
    return {
      kind: 'rate-limited',
      solvable: false,
      reason: 'This site is rate-limiting us; it will answer again shortly.',
    };
  }

  const looksLikeChallenge = containsAny(body, CHALLENGE_MARKERS);

  /**
   * The one that looked like success.
   *
   * A managed challenge served as HTTP 200 parsed to zero rows and was reported
   * as "no results" — a silently smaller search, which is exactly the failure
   * mode this repository treats as the most serious one it has. It is a
   * challenge whatever the status line says.
   */
  if (looksLikeChallenge) {
    return {
      kind: 'cloudflare-challenge',
      solvable: true,
      reason: 'This site asked for a browser check.',
    };
  }

  if (behindCloudflare && (input.status === 403 || input.status === 503)) {
    /**
     * Behind Cloudflare, refused, and not a challenge.
     *
     * This is a WAF rule, a country block or a reputation ban, and a browser
     * passes none of them. The same rule is applied at the other end in
     * `webViewHost` — a bare 403 with no challenge in it is usually hotlink
     * protection — and the two agreeing is the point: a browser is opened when
     * a browser would help, and not otherwise.
     */
    if (containsAny(body, BLOCK_MARKERS) || body.length > 0) {
      return {
        kind: 'cloudflare-block',
        solvable: false,
        reason: 'This site refused the request outright; a browser will not change that.',
      };
    }

    /**
     * Refused with nothing to read.
     *
     * Treated as solvable: the body was not fetched (a HEAD, or a caller that
     * classifies before reading), so the evidence that would tell the two apart
     * is simply absent. Guessing "block" here costs a working indexer; guessing
     * "challenge" costs one browser window that finds out.
     */
    return {
      kind: 'cloudflare-challenge',
      solvable: true,
      reason: 'This site refused the request; it may be asking for a browser check.',
    };
  }

  return NOT_A_CHALLENGE;
}

/**
 * Raised instead of a bare `HttpError` when a wall is recognised.
 *
 * A distinct type because the callers do genuinely different things with it:
 * `withRetry` must not retry a challenge on the same connection (it will be
 * challenged again), the registry must not count a solvable challenge as
 * evidence the indexer is dead, and the health panel should say "asked for a
 * browser check" rather than "HTTP 403".
 */
export class ChallengeError extends Error {
  readonly kind: ChallengeKind;
  readonly solvable: boolean;
  readonly url: string;
  readonly status: number;

  constructor(verdict: ChallengeVerdict, url: string, status: number) {
    super(verdict.reason);
    this.name = 'ChallengeError';
    this.kind = verdict.kind;
    this.solvable = verdict.solvable;
    this.url = url;
    this.status = status;
  }
}

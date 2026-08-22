/**
 * Telling "the site said no" apart from "the site asked a question".
 *
 * This is the detection half of human-assisted access. When a scraper's request
 * comes back refused, exactly one thing decides what happens next: whether a
 * person sitting at this machine could change the answer by looking at the
 * page. A Cloudflare interstitial and a 451 legal block are both `403 Forbidden`
 * with an HTML body, and treating them the same produces the two worst
 * outcomes available — a browser window nobody can act on, or a site quietly
 * dropped that one click would have opened.
 *
 * ## Why this is a closed set rather than "is it Cloudflare?"
 *
 * ext.to is behind Cloudflare today. Cloudflare Radar shows it on AS13335, and
 * a scan of it records `403` with `server: cloudflare` and `cf-mitigated:
 * challenge`. But the next site will be behind DataDome, or Imperva, or a login
 * wall, or an age gate, and a detector written around one vendor's markup has
 * to be rewritten for each. `AccessIntervention` names what the *user* would
 * have to do, which is the only thing the rest of the app needs to know.
 *
 * ## The rule that keeps this honest
 *
 * `requiresUserInteraction` is false for everything a human cannot help with.
 * A rate limit is answered by waiting; a legal block is answered by nothing.
 * Opening a browser window for either teaches people that the window is noise,
 * and the one time it matters they will close it. That is a worse failure than
 * never having built this.
 *
 * Pure, and tested. Every input is a fact already in hand from a response that
 * has been read — no network, no clock, no Electron.
 */

/**
 * What a person would have to do, not which vendor is asking.
 *
 * - `NONE` — the response is usable; nothing was intercepted.
 * - `LOGIN_REQUIRED` — the site wants an account. A human can sign in.
 * - `HUMAN_VERIFICATION` — an explicit widget: a checkbox, a puzzle, an image
 *   grid. A human is what it is asking for, by design.
 * - `BOT_CHALLENGE` — an automated interstitial, usually a JavaScript proof of
 *   work. A real browser session is what clears it, and a person watching one
 *   load is the honest way to produce that.
 * - `RATE_LIMITED` — too many requests. Waiting is the answer; a human is not.
 * - `CONSENT_REQUIRED` — a cookie banner or age gate standing in front of the
 *   content. A human can accept it; nothing else can.
 * - `ACCESS_DENIED` — refused on the merits: geoblocked, legally blocked, or a
 *   machine-readable refusal. No interaction changes it.
 * - `UNKNOWN` — refused, HTML, and nothing recognised it. Opening the page is
 *   the only way to find out what it wants, which is what the hand-off is for.
 */
export type AccessIntervention =
  | 'NONE'
  | 'LOGIN_REQUIRED'
  | 'HUMAN_VERIFICATION'
  | 'BOT_CHALLENGE'
  | 'RATE_LIMITED'
  | 'CONSENT_REQUIRED'
  | 'ACCESS_DENIED'
  | 'UNKNOWN';

export interface AccessChallenge {
  type: AccessIntervention;
  url: string;
  statusCode?: number;
  /** One sentence, written for the user rather than for a log. */
  reason?: string;
  /** Whether retrying the original request could succeed afterwards. */
  canResume: boolean;
  /** Whether showing a person the page could change the answer. */
  requiresUserInteraction: boolean;
  /** The system recognised, when one was. Diagnostic only — never branched on. */
  system?: string;
  /** From `Retry-After`, when the site said how long to wait. */
  retryAfterSeconds?: number;
}

/** Everything read from a response that has already been received. */
export interface ResponseFacts {
  url: string;
  status: number;
  /** Header names are matched case-insensitively; `set-cookie` may repeat. */
  headers: Record<string, string | string[]>;
  /**
   * The start of the body, decoded as text. Bounded by the caller — identifying
   * a challenge must never mean buffering a film.
   */
  body?: string;
  /** Convenience; falls back to the `content-type` header. */
  contentType?: string;
}

function header(facts: ResponseFacts, name: string): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(facts.headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? value.join('; ') : String(value);
  }
  return '';
}

function isHtml(facts: ResponseFacts): boolean {
  const type = (facts.contentType ?? header(facts, 'content-type')).toLowerCase();
  if (type.includes('html')) return true;
  // A challenge page served with no content-type at all is routine. Sniff the
  // body rather than assuming, but only for a body that is actually present.
  return /^\s*(<!doctype html|<html)/i.test(facts.body ?? '');
}

/**
 * Vendor fingerprints.
 *
 * Recognising the vendor changes nothing about what happens next — the
 * intervention type does that — but it changes what the user is told, and
 * "Cloudflare is asking you to verify" is a far more actionable sentence than
 * "the site refused". Order matters only in that the first match wins, so the
 * narrowest patterns come first.
 */
interface Fingerprint {
  system: string;
  type: AccessIntervention;
  headers?: Array<[string, RegExp]>;
  body?: RegExp;
}

const FINGERPRINTS: Fingerprint[] = [
  // Cloudflare says so outright on a mitigated request. This is the strongest
  // single signal available and the one recorded against ext.to.
  {
    system: 'Cloudflare',
    type: 'BOT_CHALLENGE',
    headers: [['cf-mitigated', /challenge/i]],
  },
  // Turnstile is the visible widget rather than the invisible interstitial: a
  // checkbox someone has to tick, which is `HUMAN_VERIFICATION` by definition.
  {
    system: 'Cloudflare Turnstile',
    type: 'HUMAN_VERIFICATION',
    body: /challenges\.cloudflare\.com\/turnstile|cf-turnstile/i,
  },
  {
    system: 'Cloudflare',
    type: 'BOT_CHALLENGE',
    body: /\/cdn-cgi\/challenge-platform|cf_chl_opt|cf-browser-verification|Checking your browser before accessing/i,
  },
  {
    system: 'hCaptcha',
    type: 'HUMAN_VERIFICATION',
    body: /hcaptcha\.com\/(?:1\/api\.js|captcha)|h-captcha/i,
  },
  {
    system: 'reCAPTCHA',
    type: 'HUMAN_VERIFICATION',
    body: /google\.com\/recaptcha|g-recaptcha/i,
  },
  {
    system: 'DataDome',
    type: 'BOT_CHALLENGE',
    headers: [
      ['x-datadome', /./],
      ['set-cookie', /datadome=/i],
    ],
    body: /geo\.captcha-delivery\.com|datadome/i,
  },
  {
    system: 'Imperva',
    type: 'BOT_CHALLENGE',
    headers: [
      ['x-iinfo', /./],
      ['x-cdn', /incapsula/i],
    ],
    body: /_Incapsula_Resource|Incapsula incident ID/i,
  },
  {
    system: 'Akamai',
    type: 'BOT_CHALLENGE',
    headers: [['set-cookie', /_abck=|ak_bmsc=/i]],
    body: /\/_sec\/cp_challenge|Reference #\d+\.[0-9a-f]+/i,
  },
  {
    system: 'PerimeterX',
    type: 'BOT_CHALLENGE',
    headers: [['set-cookie', /_px[a-z0-9]*=/i]],
    body: /client\.perimeterx\.net|PX-Captcha|px-captcha/i,
  },
  {
    system: 'Sucuri',
    type: 'BOT_CHALLENGE',
    body: /sucuri_cloudproxy|Sucuri WebSite Firewall/i,
  },
];

function fingerprint(facts: ResponseFacts): Fingerprint | null {
  const body = facts.body ?? '';
  for (const candidate of FINGERPRINTS) {
    for (const [name, pattern] of candidate.headers ?? []) {
      if (pattern.test(header(facts, name))) return candidate;
    }
    // Body patterns are only trusted on HTML. A film whose bytes happen to
    // contain "datadome" is not a challenge, and a 200-byte JSON error is not
    // an interstitial.
    if (candidate.body && isHtml(facts) && candidate.body.test(body)) return candidate;
  }
  return null;
}

/** Login walls are only believed on a status that already says "refused". */
const LOGIN_MARKERS =
  /<input[^>]+type=["']password["']|name=["'](?:password|passwd|pwd)["']|please (?:log|sign) ?in/i;

/**
 * Consent and age gates.
 *
 * Deliberately narrow. Nearly every site on the internet carries a cookie
 * banner *beside* its content, and matching those would classify every
 * successful page as a challenge. Only an interstitial — a refusal status, or a
 * body that is a gate and nothing else — counts.
 */
const CONSENT_MARKERS =
  /age[- ]verification|you must be (?:18|21)|confirm your age|enter only if you are|consent\.(?:cookiebot|onetrust)/i;

function parseRetryAfter(value: string): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  // The header also permits an HTTP-date.
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

const RESUMABLE: Record<AccessIntervention, boolean> = {
  NONE: true,
  LOGIN_REQUIRED: true,
  HUMAN_VERIFICATION: true,
  BOT_CHALLENGE: true,
  RATE_LIMITED: true,
  CONSENT_REQUIRED: true,
  ACCESS_DENIED: false,
  UNKNOWN: true,
};

/**
 * Whether a person could change the answer.
 *
 * `RATE_LIMITED` is the one that looks like it belongs here and does not. The
 * site is not asking anything; it is counting. Showing someone a page that will
 * load correctly if they wait teaches them the window means nothing.
 */
const INTERACTIVE: Record<AccessIntervention, boolean> = {
  NONE: false,
  LOGIN_REQUIRED: true,
  HUMAN_VERIFICATION: true,
  BOT_CHALLENGE: true,
  RATE_LIMITED: false,
  CONSENT_REQUIRED: true,
  ACCESS_DENIED: false,
  UNKNOWN: true,
};

const REASONS: Record<AccessIntervention, string> = {
  NONE: '',
  LOGIN_REQUIRED: 'This site wants you signed in.',
  HUMAN_VERIFICATION: 'This site is asking you to verify that you are a person.',
  BOT_CHALLENGE: 'This site is running a browser check before it will answer.',
  RATE_LIMITED: 'This site is asking for fewer requests.',
  CONSENT_REQUIRED: 'This site is showing a consent or age notice first.',
  ACCESS_DENIED: 'This site refused the request outright.',
  UNKNOWN: 'This site refused the request and did not say why.',
};

function build(
  type: AccessIntervention,
  facts: ResponseFacts,
  extra: Partial<AccessChallenge> = {}
): AccessChallenge {
  return {
    type,
    url: facts.url,
    statusCode: facts.status,
    reason: REASONS[type] || undefined,
    canResume: RESUMABLE[type],
    requiresUserInteraction: INTERACTIVE[type],
    ...extra,
  };
}

/**
 * Reads a refused response and says what it would take to get past it.
 *
 * The ordering below is the whole design and is worth reading as a sequence.
 * A recognised anti-bot system is checked *first*, ahead of the status code,
 * because Cloudflare answers a challenge with 403 and with 503 depending on
 * configuration and the status is the least informative part of it. Everything
 * after that is a fallback, ending at "refused, HTML, unrecognised" — which
 * stays interactive, because opening the page is the only remaining way to
 * learn what it wants.
 */
export function classifyAccess(facts: ResponseFacts): AccessChallenge {
  const retryAfterSeconds = parseRetryAfter(header(facts, 'retry-after'));

  // 429 outranks a fingerprint: a challenge vendor that is also rate-limiting
  // is still rate-limiting, and no person can click past a counter.
  if (facts.status === 429) {
    return build('RATE_LIMITED', facts, { retryAfterSeconds });
  }

  const match = fingerprint(facts);
  if (match && facts.status !== 200) {
    return build(match.type, facts, { system: match.system, retryAfterSeconds });
  }
  /**
   * A challenge served with `200 OK` is real and common — Cloudflare's managed
   * challenge does exactly that, and so does every consent interstitial. But a
   * *successful* page that merely embeds a Turnstile widget somewhere (a login
   * form further in, a comment box) is not a challenge, and treating it as one
   * would interrupt a working scrape. So a 200 is only a challenge when the
   * body is a challenge page rather than a page containing one: the marker has
   * to appear in a body too small to be the content itself.
   */
  if (match && facts.status === 200 && (facts.body?.length ?? 0) < 60_000) {
    return build(match.type, facts, { system: match.system });
  }

  if (facts.status === 401) return build('LOGIN_REQUIRED', facts);

  // 451 is a legal block and 403 on a machine-readable body is a decision. Both
  // are answers, not questions.
  if (facts.status === 451) return build('ACCESS_DENIED', facts);

  if (facts.status === 403 || facts.status === 503) {
    if (!isHtml(facts)) return build('ACCESS_DENIED', facts);
    if (LOGIN_MARKERS.test(facts.body ?? '')) return build('LOGIN_REQUIRED', facts);
    if (CONSENT_MARKERS.test(facts.body ?? '')) return build('CONSENT_REQUIRED', facts);
    return build('UNKNOWN', facts);
  }

  if (facts.status >= 200 && facts.status < 400) {
    // A consent or age gate answered with 200 is the normal shape for one.
    if (isHtml(facts) && CONSENT_MARKERS.test(facts.body ?? '')) {
      return build('CONSENT_REQUIRED', facts);
    }
    return build('NONE', facts);
  }

  // 5xx that is not 503, and anything else: a server problem, not an access
  // problem. Retrying is the caller's business and no person is involved.
  return build('NONE', facts);
}

/** True when this challenge is worth putting a person in front of. */
export function needsHuman(challenge: AccessChallenge): boolean {
  return challenge.type !== 'NONE' && challenge.requiresUserInteraction && challenge.canResume;
}

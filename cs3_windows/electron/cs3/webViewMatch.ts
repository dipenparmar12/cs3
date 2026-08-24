/**
 * What a page's subrequests mean to a `WebViewResolver`.
 *
 * Pure, and its own module for the same reason `providerLinks.ts` is: every
 * wrong answer here is attributed to something else. A pattern that fails to
 * compile makes a working provider look like a dead site; a blacklist that is
 * too eager makes a challenge page fail to solve and reads as bot protection we
 * cannot beat. Neither produces an error anyone would trace back to here.
 *
 * The reference is Android's `WebViewResolver.shouldInterceptRequest`. Where
 * this diverges from upstream's *source* it is because it matches upstream's
 * *behaviour*; those two places are called out below.
 */

/** What the browser should do with one observed request. */
export type RequestVerdict =
  /** Matches `interceptUrl`. This is the answer; stop the browser. */
  | { kind: 'intercept' }
  /** Matches one of `additionalUrls`. Collect it and keep going. */
  | { kind: 'additional' }
  /** An asset the resolve has no use for. Cancel it to save the bytes. */
  | { kind: 'block' }
  /** Anything else: let the page have it. */
  | { kind: 'allow' };

/**
 * Assets a resolve never needs, verbatim from upstream's `blacklistedFiles`.
 *
 * Upstream also lists `"wss://"`, and it is unreachable there: the test is
 * against `Url(url).encodedPath`, which never contains a scheme. So Android's
 * *behaviour* is that websockets are not blocked, and that is what this
 * reproduces — implementing the apparent intent instead would block a transport
 * that some challenge pages genuinely use, and it would be a change no measured
 * Android run supports.
 */
export const BLOCKED_PATH_FRAGMENTS: readonly string[] = [
  '.jpg', '.png', '.webp', '.mpg', '.mpeg', '.jpeg', '.webm', '.mp4', '.mp3',
  '.gifv', '.flv', '.asf', '.mov', '.mng', '.mkv', '.ogg', '.avi', '.wav',
  '.woff2', '.woff', '.ttf', '.css', '.vtt', '.srt', '.ts', '.gif',
];

/**
 * Paths that must never be blocked whatever else says so.
 *
 * Upstream routes `recaptcha` and `/cdn-cgi/` straight to the network before the
 * blacklist can see them. `/cdn-cgi/` is Cloudflare's own challenge machinery —
 * blocking any part of it is blocking the thing we are here to solve — and it
 * serves `.js` and `.css` under paths that would otherwise trip the list.
 */
const NEVER_BLOCKED = ['recaptcha', '/cdn-cgi/'];

export interface CompiledPattern {
  /** The Java/Kotlin pattern exactly as the extension wrote it. */
  source: string;
  /** Null when it could not be translated; `reason` then says why. */
  regex: RegExp | null;
  reason?: string;
}

/**
 * Java-only constructs that JavaScript accepts and then means something else by.
 *
 * These are the dangerous ones. `(?>…)` and a stray `[` at least *throw*, so
 * they are caught by compiling. `\p{Alpha}`, `\Q…\E` and friends do not: JS
 * reads `\p` outside a Unicode-mode pattern as the literal letter `p`, so the
 * pattern compiles happily and matches the wrong strings forever. A silently
 * wrong regex is worse here than no regex at all, so these are refused.
 */
const UNTRANSLATABLE: ReadonlyArray<[RegExp, string]> = [
  [/(^|[^\\])\\[pP]\{/, 'Java POSIX/Unicode classes (\\p{…}) have no unflagged JavaScript equivalent'],
  [/(^|[^\\])\\Q/, 'Java literal quoting (\\Q…\\E) has no JavaScript equivalent'],
];

/**
 * Rewrites the Java-only syntax that JavaScript would misread.
 *
 * Escape-aware, and it has to be. A naive `replace(/\\A/g, '^')` also rewrites
 * the `\A` inside `\\A` — an escaped backslash followed by a literal `A` — and
 * turns a valid pattern into a different valid pattern, which is the failure
 * this whole module is built to avoid.
 *
 * Two rewrites, both exactly equivalent for matching:
 *
 * - `\A` → `^`, `\z`/`\Z` → `$`. Exact, because the search never runs
 *   multiline. Untranslated they are identity escapes in JavaScript: `\A`
 *   matches a literal `A`, so `\Ahttps://…` compiles cleanly and matches
 *   nothing a browser will ever request.
 * - possessive quantifiers (`a++`, `a*+`, `a?+`, `a{2,}+`) become greedy. JS has
 *   no possessive form and rejects them outright; the difference is
 *   backtracking, not the set of strings matched. Only a `+` following a real
 *   quantifier is dropped — `\++` is one-or-more literal plus signs and must
 *   survive untouched.
 */
function translateJavaRegex(source: string): string {
  let out = '';
  let inClass = false;
  /** True when the previous character was an unescaped quantifier. */
  let afterQuantifier = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (ch === '\\') {
      const next = source[i + 1];
      if (!inClass && next === 'A') {
        out += '^';
        i++;
      } else if (!inClass && (next === 'z' || next === 'Z')) {
        out += '$';
        i++;
      } else {
        // Copied as a pair so the escaped character can never be read as syntax
        // on the next iteration.
        out += ch + (next ?? '');
        i++;
      }
      afterQuantifier = false;
      continue;
    }

    if (inClass) {
      out += ch;
      if (ch === ']') inClass = false;
      continue;
    }

    if (ch === '[') {
      inClass = true;
      out += ch;
      afterQuantifier = false;
      continue;
    }

    if (ch === '+' && afterQuantifier) {
      // Possessive. Dropped rather than emitted.
      afterQuantifier = false;
      continue;
    }

    out += ch;
    afterQuantifier = ch === '*' || ch === '+' || ch === '?' || ch === '}';
  }

  return out;
}

/**
 * Turns a Kotlin `Regex.pattern` into a JavaScript one.
 *
 * These strings are written against `java.util.regex`, and the two flavours are
 * close but not identical. Anything that cannot be translated is reported
 * rather than guessed at: a pattern silently treated as "never matches" spends
 * the full browser timeout on every link and then reports that the site had
 * nothing — indistinguishable from a host that is simply down, and attributed
 * to the provider rather than to here.
 */
export function compilePattern(source: string): CompiledPattern {
  for (const [probe, why] of UNTRANSLATABLE) {
    if (probe.test(source)) return { source, regex: null, reason: why };
  }

  const translated = translateJavaRegex(source);
  try {
    return { source, regex: new RegExp(translated) };
  } catch (error) {
    return {
      source,
      regex: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function compilePatterns(sources: readonly string[]): CompiledPattern[] {
  return sources.map(compilePattern);
}

/** `Regex.containsMatchIn` — an unanchored search, not a full match. */
function matches(pattern: CompiledPattern, url: string): boolean {
  if (!pattern.regex) return false;
  // `lastIndex` is only consulted for /g and /y, neither of which is set here,
  // so one RegExp can safely be reused across every request of a resolve.
  return pattern.regex.test(url);
}

export interface MatchInputs {
  intercept: CompiledPattern;
  additional: readonly CompiledPattern[];
}

/**
 * Classifies one request, in upstream's order.
 *
 * Order is the whole of it: `interceptUrl` is tested before `additionalUrls`,
 * and both before the blacklist. A provider whose intercept pattern is `\.mp4`
 * — which several are — would otherwise have its own answer cancelled as an
 * unwanted media file.
 */
export function classifyRequest(url: string, inputs: MatchInputs): RequestVerdict {
  if (matches(inputs.intercept, url)) return { kind: 'intercept' };
  if (inputs.additional.some((pattern) => matches(pattern, url))) return { kind: 'additional' };
  if (shouldBlock(url)) return { kind: 'block' };
  return { kind: 'allow' };
}

/**
 * Whether an unmatched request is worth the bytes.
 *
 * Tested against the **path**, as upstream is, not the whole URL: a query string
 * routinely carries `.jpg` in a `?poster=` parameter or `.ts` in a cache buster,
 * and matching those would cancel the page's own scripts.
 */
export function shouldBlock(url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    // Decoded, as upstream's `decodeURLPart` does — a percent-encoded extension
    // is still that extension. A malformed escape is not a reason to fail.
    try {
      path = decodeURIComponent(parsed.pathname);
    } catch {
      path = parsed.pathname;
    }
  } catch {
    // `data:`, `blob:` and `about:` reach here. They cost no network and
    // cancelling them breaks pages that build their own scripts.
    return false;
  }

  const whole = url.toLowerCase();
  if (NEVER_BLOCKED.some((fragment) => whole.includes(fragment))) return false;

  const lower = path.toLowerCase();
  if (lower.endsWith('/favicon.ico')) return true;
  return BLOCKED_PATH_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

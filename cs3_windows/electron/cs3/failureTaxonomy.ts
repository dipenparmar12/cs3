import type { FailureKind } from '../../src/types/analytics';

/**
 * Turns a failure into one of a small closed set of categories.
 *
 * Two things depend on this and neither can use a message. The ranking engine
 * counts categories, and counting free text produces a tally with one entry per
 * failure. The diagnostics screen groups by category, and a taxonomy that
 * splits `SocketTimeoutException: connect timed out` from
 * `java.net.SocketTimeoutException: Read timed out` hides that a provider has
 * timed out ninety times.
 *
 * The order below is the classification order and it matters: a message can
 * satisfy several patterns at once, and the more specific reading is the useful
 * one. `HTTP 403 after redirect to /cdn-cgi/challenge` is `blocked`, not
 * `network`, because the response to each is different — one needs a browser,
 * the other needs a retry.
 */

interface Rule {
  kind: FailureKind;
  test: RegExp;
}

const RULES: Rule[] = [
  /**
   * A call the app itself abandoned, and therefore not a failure of anything.
   *
   * First in the order because the vocabulary it uses — `IOException: Canceled`,
   * `Parent job is Cancelling`, `JobCancellationException` — reads as an
   * exception to every rule below, and `provider-error` was claiming it: 79
   * occurrences in a real 21-session log, filed as extensions throwing. They
   * are the ordinary consequence of the viewer typing a new query or closing a
   * page while fifteen scrapes are in flight, and the coroutine scope closing
   * throws in every one of them at once.
   *
   * Recording those as extension errors is the same mistake as folding `empty`
   * into `failure` in the ranking: it counts a provider as broken for the app's
   * own decision to stop waiting. `ExtensionIssueLog` drops these rather than
   * listing them — there is nothing to fix.
   */
  { kind: 'cancelled', test: /\b(?:cancell?ed|Cancelling|CancellationException|JobCancellation)\b/i },

  /**
   * First, because it is unambiguous and because the rules below would misread
   * it. The message carries a URL, and a host like `a.5xx.xyz` trips
   * `server-error`'s three-digit test — filing an extension's own resource leak
   * as the site having returned a 5xx.
   *
   * It reached `unknown` before this rule existed: 159 occurrences, which was
   * *every* unclassified problem record in a real 21-session log. See the kind's
   * own note for why it is not `provider-error`.
   */
  { kind: 'resource-leak', test: /\bwas leaked\b.*\bresponse body\b|forget to close a response body/i },

  // Bot protection first: these usually also carry an HTTP status, and the
  // status is the less informative half.
  { kind: 'blocked', test: /cloudflare|cf-ray|challenge|captcha|bot protection|access denied|just a moment/i },
  { kind: 'blocked', test: /\b(403|401)\b|forbidden|unauthori[sz]ed/i },

  /**
   * Ahead of `runtime-unavailable`, which would otherwise claim it: the two
   * share vocabulary and only this one is about a single provider.
   */
  { kind: 'provider-missing', test: /PROVIDER_NOT_LOADED|no loaded provider is named|no longer installed|no installed extension provides/i },

  { kind: 'runtime-unavailable', test: /sidecar|extension runtime|SIDECAR_[A-Z]+|NoClassDefFoundError|UnsupportedClassVersionError|ClassNotFoundException/i },
  /**
   * The other half of the linkage family, and it is just as much ours.
   *
   * The rule above catches a *missing class*. These catch a class that is
   * present and wrong — which is what a shim gets wrong far more often, and
   * this repository has the history to prove it:
   *
   *  - `SharedPreferences` was a class where Android's is an interface, so
   *    112 plugins' `invokeinterface` threw `IncompatibleClassChangeError` — at
   *    first *use*, not at load.
   *  - `Context.getPackageManager` and `getResources` returned `Object`, a
   *    different descriptor from Android's, so the call site threw
   *    `NoSuchMethodError` before the stub's own message could ever be seen.
   *  - `AccountManager.aniListApi` was declared as the wrapper type and failed
   *    with `NoSuchMethodError: AniListApi AccountManager$Companion.getAniListApi()`
   *    — a getter returning a supertype is a different method to the JVM.
   *
   * Every one of those is a defect in the compatibility layer, and every one
   * was landing in `provider-error` — "the extension itself threw. Worth
   * reporting to its maintainer" — which sends the reader to blame a scraper
   * author for a method we failed to provide.
   */
  { kind: 'runtime-unavailable', test: /\b(?:NoSuchMethodError|NoSuchFieldError|IncompatibleClassChangeError|AbstractMethodError|VerifyError|IllegalAccessError)\b/ },
  { kind: 'timeout', test: /timeout|timed out|deadline|ETIMEDOUT/i },

  { kind: 'expired', test: /expired|link has expired|token.*(expired|invalid)|signature.*(expired|mismatch)/i },
  { kind: 'not-found', test: /\b404\b|not found|no longer (has|exists)|gone\b|\b410\b/i },
  { kind: 'server-error', test: /\b5\d{2}\b|internal server error|bad gateway|service unavailable/i },

  /**
   * Both dialects, because both reach here.
   *
   * The original list is Node's — `ECONNRESET`, `ENOTFOUND` — and the sidecar
   * is a JVM: it says `SocketException: Connection reset` and
   * `NoRouteToHostException`. 108 network failures in a real log were reaching
   * `provider-error` purely for being phrased in Java, which reports the
   * extension as throwing when the connection never arrived.
   */
  { kind: 'network', test: /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UnknownHost|fetch failed|network|SSL|TLS|handshake|certificate/i },
  { kind: 'network', test: /\b(?:Connection (?:reset|refused|closed)|Socket(?:Exception|closed)|NoRouteToHost|PortUnreachable|Network is unreachable|Broken pipe)\b/i },

  { kind: 'unsupported-operation', test: /does not implement|unsupported operation|NotImplemented|UnsupportedAndroidApiException/i },
  { kind: 'unreadable-reply', test: /could not be read|unreadable|JSON|parse|unexpected token|malformed|encoded string not found/i },

  { kind: 'provider-error', test: /Exception|Error\b|failed/i },
];

/**
 * A source location in a stack frame — `(RealCall.java:519)`, `(Http.kt:88)`.
 *
 * Stripped before classification, because a line number is a three-digit
 * integer and `server-error` tests for one: `java.io.IOException: Canceled`
 * with an OkHttp stack under it was classified as the *host* returning a 5xx,
 * 23 times, on the strength of `RealCall.java:519`. Nothing about that is
 * visible in the result — it is a plausible-looking category on a real failure,
 * which is the worst kind of wrong answer a taxonomy can give.
 *
 * Line numbers cannot simply be dropped from the grouping form instead: bare
 * integers are load-bearing there, and `HTTP 403` and `HTTP 404` have to stay
 * apart. So the frame is removed, not the digits.
 */
const STACK_LOCATION = /\((?:[\w$]+\.(?:java|kt|kts))?:?\d+\)/g;

export function classifyFailure(message: string | undefined | null): FailureKind {
  if (!message) return 'unknown';
  const subject = message.replace(STACK_LOCATION, '()');
  for (const rule of RULES) {
    if (rule.test.test(subject)) return rule.kind;
  }
  return 'unknown';
}

/**
 * What a category means, and what can be done about it.
 *
 * Written for the person reading the diagnostics screen, who is usually not the
 * person who wrote the scraper. "Blocked" on its own invites a bug report
 * against this app for something only the extension or a browser engine can
 * fix.
 */
export const FAILURE_KIND_LABELS: Record<FailureKind, { label: string; hint: string }> = {
  timeout: {
    label: 'Timed out',
    hint: 'The site did not answer in time. Usually the site is slow or unreachable from here rather than broken.',
  },
  'runtime-unavailable': {
    label: 'Extension runtime',
    hint: 'The JVM sidecar could not run the extension. This one is ours — check the runtime status in Settings.',
  },
  'provider-missing': {
    label: 'Provider not loaded',
    hint: 'The extension that provided this is disabled, uninstalled, or failed to load. Open Extensions to turn it back on, or search again to find the title elsewhere.',
  },
  blocked: {
    label: 'Blocked by the host',
    hint: 'The site refused the request, usually bot protection. Needs the provider’s own headers or a browser engine, not a retry.',
  },
  'not-found': {
    label: 'Not found',
    hint: 'The page or file is gone. The link was real when the provider produced it.',
  },
  'server-error': {
    label: 'Host error',
    hint: 'The site returned a server error. Nothing on this side will change the outcome.',
  },
  network: {
    label: 'Network',
    hint: 'The connection failed before a reply arrived — DNS, TLS or the connection itself.',
  },
  expired: {
    label: 'Link expired',
    hint: 'The address carried a deadline that has passed. Refresh the sources to get a new one.',
  },
  'unreadable-reply': {
    label: 'Unreadable reply',
    hint: 'The site answered with something the extension could not parse, which usually means the page changed shape.',
  },
  'unsupported-operation': {
    label: 'Not supported',
    hint: 'This provider does not implement that step. A review catalogue with no streams is the ordinary case.',
  },
  'provider-error': {
    label: 'Extension error',
    hint: 'The extension itself threw. Worth reporting to its maintainer with the copied report.',
  },
  'resource-leak': {
    label: 'Connection leaked',
    hint: 'The extension left a connection open instead of closing it. The scrape itself usually worked, so this costs memory and sockets rather than a stream — worth reporting to the maintainer, not a reason to switch the provider off.',
  },
  cancelled: {
    label: 'Cancelled',
    hint: 'The app stopped waiting — a new search, a closed page, or a source that answered first. Nothing failed and there is nothing to fix.',
  },
  unknown: {
    label: 'Unclassified',
    hint: 'No pattern matched. The raw message is in the report.',
  },
};

/**
 * The form of a message that two occurrences of one failure share.
 *
 * Grouping is the whole point of this module — counting free text produces a
 * tally with one entry per failure — and grouping needs the parts that differ
 * on every occurrence removed. Durations, byte counts, timestamps and heap
 * addresses are those parts: they are never what distinguishes one failure
 * from another.
 *
 * **Bare integers are deliberately left alone.** `HTTP 403` and `HTTP 404`
 * differ by one digit and mean opposite things — one needs a browser, the other
 * needs a different source — and folding them together produces a shorter
 * report that says something false. Same for `Failed sr=1` and `Failed sr=2`.
 *
 * Lives here rather than in `diagnostics.ts`, where it was written, because
 * that module imports `electron` and is therefore unloadable under Node's type
 * stripping — which is where the tests that pin this behaviour run.
 */
export function groupingForm(message: string): string {
  return message
    .replace(/\b\d+(\.\d+)?\s?ms\b/gi, '<ms>')
    .replace(/\b\d+(\.\d+)?\s?s\b/gi, '<s>')
    .replace(/\b\d+(\.\d+)?\s?(B|KB|MB|GB|KiB|MiB|GiB)\b/g, '<size>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<time>')
    .replace(/0x[0-9a-f]{6,}/gi, '<addr>');
}

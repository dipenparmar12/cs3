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
  // Bot protection first: these usually also carry an HTTP status, and the
  // status is the less informative half.
  { kind: 'blocked', test: /cloudflare|cf-ray|challenge|captcha|bot protection|access denied|just a moment/i },
  { kind: 'blocked', test: /\b(403|401)\b|forbidden|unauthori[sz]ed/i },

  { kind: 'runtime-unavailable', test: /sidecar|extension runtime|SIDECAR_[A-Z]+|NoClassDefFoundError|UnsupportedClassVersionError|ClassNotFoundException/i },
  { kind: 'timeout', test: /timeout|timed out|deadline|ETIMEDOUT/i },

  { kind: 'expired', test: /expired|link has expired|token.*(expired|invalid)|signature.*(expired|mismatch)/i },
  { kind: 'not-found', test: /\b404\b|not found|no longer (has|exists)|gone\b|\b410\b/i },
  { kind: 'server-error', test: /\b5\d{2}\b|internal server error|bad gateway|service unavailable/i },

  { kind: 'network', test: /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UnknownHost|fetch failed|network|SSL|TLS|handshake|certificate/i },

  { kind: 'unsupported-operation', test: /does not implement|unsupported operation|NotImplemented|UnsupportedAndroidApiException/i },
  { kind: 'unreadable-reply', test: /could not be read|unreadable|JSON|parse|unexpected token|malformed|encoded string not found/i },

  { kind: 'provider-error', test: /Exception|Error\b|failed/i },
];

export function classifyFailure(message: string | undefined | null): FailureKind {
  if (!message) return 'unknown';
  for (const rule of RULES) {
    if (rule.test.test(message)) return rule.kind;
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
  unknown: {
    label: 'Unclassified',
    hint: 'No pattern matched. The raw message is in the report.',
  },
};

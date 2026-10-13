/**
 * Taking the secrets out of a log line.
 *
 * This is not hypothetical tidiness. The URLs this app handles are, routinely,
 * signed CDN addresses whose query string *is* the credential — a CloudFront
 * `Signature`, a Google `X-Goog-Signature`, a bare JWT — and a log is a file
 * that gets pasted into issues, attached to bug reports and read by whoever the
 * user asks for help. A log that records those verbatim hands out working
 * access to someone else's infrastructure, and does it in the artefact whose
 * whole purpose is to be shared.
 *
 * Two rules shape what follows:
 *
 * **The structure survives; the secret does not.** `?token=<redacted>` rather
 * than dropping the parameter, because "this URL carried a token" is itself a
 * fact worth having — it is the difference between a link that expired and a
 * link that never had credentials in the first place. The host and the path
 * stay, because those are what identify the provider and the release.
 *
 * **Fail open, never throw.** Providers hand back URLs containing spaces, stray
 * percent signs and unbalanced brackets; `new URL()` rejects all of them. A
 * redactor that throws on a malformed URL would take down the logging of the
 * exact failure worth recording, so parsing is best-effort and the regex path
 * catches whatever the parser will not take.
 */

const REDACTED = '<redacted>';

/**
 * Query parameters whose value is a credential.
 *
 * Matched as substrings, case-insensitively, because the same concept arrives
 * under a dozen spellings across providers: `token`, `access_token`,
 * `X-Amz-Security-Token`, `hdntl`. Over-matching here costs a log line some
 * detail; under-matching leaks a key.
 */
const SECRET_PARAM_PATTERNS = [
  'token', 'signature', 'sig', 'key', 'secret', 'password', 'passwd', 'pwd',
  'auth', 'credential', 'session', 'sid', 'apikey', 'api_key', 'access',
  'hdnt', 'hmac', 'md5', 'policy', 'nonce', 'jwt', 'bearer',
];

/** Header names never written out, whatever their value looks like. */
const SECRET_HEADERS = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key'];

function isSecretParam(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_PARAM_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * A JWT anywhere in free text.
 *
 * Three base64url segments separated by dots, with a realistic minimum length
 * so ordinary dotted identifiers are left alone. Providers put these in paths
 * and in fragments as well as in query strings, so a parameter-name rule alone
 * does not find them.
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** `Bearer <something>` and `Basic <something>` in free text. */
const AUTH_SCHEME_PATTERN = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * One URL, with its credentials removed and its shape intact.
 *
 * Magnet links are passed through untouched: an infohash is a content address,
 * not a secret, and it is the single most useful identifier a torrent log can
 * carry.
 */
export function redactUrl(value: string): string {
  if (!value) return value;
  if (value.startsWith('magnet:')) return value;

  try {
    const url = new URL(value);

    let changed = false;
    for (const name of [...url.searchParams.keys()]) {
      if (isSecretParam(name)) {
        url.searchParams.set(name, REDACTED);
        changed = true;
      }
    }

    // Credentials in the authority are rare and unambiguous when present.
    if (url.username || url.password) {
      url.username = REDACTED;
      url.password = '';
      changed = true;
    }

    const rendered = url.toString();
    const cleaned = redactSecretsInText(rendered);
    return changed || cleaned !== rendered ? cleaned : rendered;
  } catch {
    /**
     * Not parseable, which is ordinary rather than exceptional here — scraped
     * URLs carry spaces, `|`, and stray percent signs. Fall back to the text
     * rules, which need no structure.
     */
    return redactSecretsInText(value.replace(/([?&][^=&\s]*(?:token|sig|signature|key|auth|secret)[^=&\s]*=)[^&\s]+/gi, `$1${REDACTED}`));
  }
}

/** JWTs and `Authorization`-style values wherever they appear in a string. */
function redactSecretsInText(value: string): string {
  return value.replace(JWT_PATTERN, REDACTED).replace(AUTH_SCHEME_PATTERN, (match) => {
    const scheme = match.split(/\s+/)[0];
    return `${scheme} ${REDACTED}`;
  });
}

/**
 * Free text — an error message, a stack, a provider's reply.
 *
 * These carry URLs too, embedded in sentences, so any `http(s)` run is pulled
 * out and passed through {@link redactUrl} rather than left alone. That is the
 * common case in practice: almost nothing logs a bare URL, and almost
 * everything logs `Request to https://…?token=… failed with 403`.
 */
export function redact(value: string): string {
  if (!value) return value;
  const withUrls = value.replace(/https?:\/\/[^\s"'<>)\]}]+/g, (match) => redactUrl(match));
  return redactSecretsInText(withUrls);
}

/** A header map with the credential-bearing entries masked. */
export function redactHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADERS.includes(name.toLowerCase()) ? REDACTED : redact(value);
  }
  return out;
}

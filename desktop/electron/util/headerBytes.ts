/**
 * Response headers made safe for Electron's `net.fetch`.
 *
 * HTTP header values are bytes. Electron hands them to JavaScript decoded as
 * UTF-8 and then builds a WHATWG `Headers` object from them inside an event
 * callback — and `Headers.set` refuses any character above U+00FF. So a server
 * answering with `Content-Disposition: attachment; filename="【Movie】.mkv"`
 * throws `Cannot convert argument to a ByteString … value of 12304` where no
 * caller can catch it: the request never settles and the main process dies
 * (measured 2026-10-14, the last line of a session log, during a search).
 *
 * The fix is to give `Headers` what a browser's `fetch` would: the value's
 * UTF-8 bytes, one character per byte. Nothing is lost — a reader that wants
 * the text decodes those bytes as UTF-8 again.
 */

/** A header value as the byte string `Headers` accepts, or the value itself if it already is one. */
export function toByteString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0xff) return Buffer.from(value, 'utf8').toString('latin1');
  }
  return value;
}

/**
 * The headers with every value made a byte string, or `null` when none needed
 * it — so the common case costs one scan and no allocation, and the webRequest
 * hook can answer "unchanged".
 */
export function byteStringHeaders(
  headers: Record<string, string | string[]> | undefined
): Record<string, string[]> | null {
  if (!headers) return null;
  let changed = false;
  const out: Record<string, string[]> = {};
  for (const [name, raw] of Object.entries(headers)) {
    const values = Array.isArray(raw) ? raw : [raw];
    out[name] = values.map((value) => {
      const safe = toByteString(value);
      if (safe !== value) changed = true;
      return safe;
    });
  }
  return changed ? out : null;
}

/**
 * Electron's own failure on such a header, recognised by its message and by
 * coming from Electron's internals rather than our code — the only shape the
 * process guard may contain without hiding a bug of ours.
 */
export function isElectronHeaderByteStringError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /Cannot convert argument to a ByteString/.test(error.message) &&
    /Headers\.(?:set|append)/.test(error.stack ?? '') &&
    /node:electron\//.test(error.stack ?? '')
  );
}

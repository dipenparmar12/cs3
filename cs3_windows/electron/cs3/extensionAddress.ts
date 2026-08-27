/**
 * The `cs3ext://` address scheme, and the one distinction it does not encode.
 *
 * Split out of `pluginManager.ts` so it can be tested: that module imports
 * `electron` and cannot be loaded under Node's type stripping. Same reason
 * `groupingForm` lives in `failureTaxonomy.ts` rather than in `diagnostics.ts`.
 *
 * A provider's own URLs carry nothing identifying which provider produced them,
 * so every result is re-addressed as `cs3ext://<provider>/<handle>`. What the
 * scheme cannot say is **which kind of handle** it is carrying, and upstream's
 * `MainAPI` has two that are not interchangeable:
 *
 * | Call | Handle | What the provider does with it |
 * |---|---|---|
 * | `load(url)` | a **page address** | fetches it |
 * | `loadLinks(data)` | an **opaque blob** | parses it; it built it itself |
 *
 * Confusing them is not a type error anywhere — both are strings — and the
 * failure it produces names the wrong party. See `looksLikeLinksHandle`.
 */

/** `cs3ext://<provider>/<opaque handle>` — see `PluginManager.searchAll` for why. */
export function buildExtensionUrl(provider: string, target: string): string {
  return `cs3ext://${encodeURIComponent(provider)}/${encodeURIComponent(target)}`;
}

export function parseExtensionUrl(
  url: string
): { provider: string; target: string } | null {
  if (!url.startsWith('cs3ext://')) return null;
  const rest = url.slice('cs3ext://'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return {
    provider: decodeURIComponent(rest.slice(0, slash)),
    target: decodeURIComponent(rest.slice(slash + 1)),
  };
}

/**
 * Whether a handle is definitely *not* something `load()` could open.
 *
 * A large part of the corpus puts structured JSON in the `loadLinks` blob:
 *
 * ```
 * VegaMovies  [{"source":"https://vcloud.fit/ubvtmxgdjbx1xxu"}, …]
 * HDHub4U     ["https://greenmountmotors.com/?id=THdEbjN…","https://hubstream.art/#mlvoou"]
 * ```
 *
 * `load()` fetches what it is handed, so one of those reaches OkHttp's
 * `HttpUrl.get` and throws `IllegalArgumentException: Expected URL scheme 'http'
 * or 'https' but no scheme was found for [{"sou…`. In a captured session that was
 * the most frequent failure on screen — recorded at stage `detail`, counted
 * against the *provider* by the ranking, and shown to the viewer as the reason
 * their title would not play. All three attributions are wrong: the provider is
 * fine and the call should never have been made.
 *
 * **The test is deliberately narrow.** JSON is definitely not a page; anything
 * else might be. Providers legitimately use non-URL page handles — Internet
 * Archive's `load()` takes `https://archive.org/details/<id>` while its
 * `loadLinks` takes the bare id — so a rule like "must start with http" would
 * refuse pages that work. Being sure about a few cases beats guessing about all
 * of them.
 */
export function looksLikeLinksHandle(target: string): boolean {
  const head = target.trimStart()[0];
  return head === '[' || head === '{';
}

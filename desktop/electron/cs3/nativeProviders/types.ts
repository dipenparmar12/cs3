/**
 * Providers that ship with the app rather than arriving as somebody's archive.
 *
 * ## Why this lane has to exist at all
 *
 * Everything this app can currently *search and play* is an Android `.cs3`
 * addressed `cs3ext://` and executed in the JVM sidecar. The only other provider
 * shape in the codebase is `HomeProvider` (`cs3/homeProviders.ts`), which
 * answers `fetch(HomeCatalogRequest)` and nothing else — it has no `search`, no
 * `load`, no `loadLinks`. So a catalogue can put rows on the home screen and
 * cannot supply a single playable byte.
 *
 * The consequence is one gap with a long shadow: **every source that is not an
 * Android extension is unreachable, and they are all unreachable for the same
 * reason.** Internet Archive's 52,000 public-domain films, iptv-org's 17,000
 * free-to-air channels, a PeerTube instance, the user's own Jellyfin server —
 * none of them can be an Android archive, and none of them has anywhere to go.
 *
 * ## Why this is not PRD-41's L2
 *
 * PRD-41 specifies `.csx`: a user-installable, sandboxed, capability-declared,
 * signed bundle format. That is the right answer for third-party code and it is
 * a large piece of work. **This is deliberately the other half.** Code here
 * ships inside the app and is reviewed like any other module, so it needs no
 * sandbox, no signing, no manifest and no capability model. It is the part that
 * delivers sources, without the part that delivers an ecosystem — and when
 * `.csx` lands, it produces the same `Provider`/`Source` values this does.
 *
 * ## The rules, each answering a failure already on record
 *
 * **They are addressed `cs3native://<id>/<handle>`, never `cs3ext://`.**
 * `PluginManager.explainMissingProvider` resolves an unknown `cs3ext://` name by
 * consulting the extension tables and reporting which extension owned it. A
 * native provider is in none of those tables, so sharing the scheme would
 * produce "that extension was uninstalled" about a module compiled into the
 * binary — the exact wrong-attribution failure that method exists to prevent.
 *
 * **A handle is opaque and belongs to its provider.** AGENTS.md records what
 * happens when a links blob is handed to `load()`: OkHttp throws
 * `Expected URL scheme 'http' or 'https'`, the provider is blamed, and the
 * ranking scores it down for a call it should never have received. Providers
 * here encode whatever they need and are the only thing that reads it back.
 *
 * **`loadLinks` returns `ExtractorLink`.** Not a new shape. `providerLinks.ts`
 * already reads type, DRM, playlist parts and audio headers off that interface,
 * and the compatibility engine, `MediaProxy`, mpv routing, the download identity
 * and the source cache all consume it. A second link shape would mean teaching
 * every one of them a second dialect.
 *
 * **Failure is a reason, never an empty list.** `loadLinks` returning `[]` with
 * no explanation is the single most expensive habit this codebase has had to
 * unlearn — one sentence covering a timeout, a dead host, a title that genuinely
 * has nothing, and a provider that does not implement the call. A native
 * provider throws with something a person can act on, or returns rows.
 *
 * **Nothing synthetic, ever.** No placeholder source, no trailer standing in for
 * a feature, no "sample" item padding a catalogue. When there is nothing, the
 * answer is nothing plus a reason.
 */
import type {
  ExtractorLink,
  LoadResponse,
  SearchResponse,
  TvType,
} from '../../../src/types/api';

/** The address scheme every native provider answers to. */
export const NATIVE_SCHEME = 'cs3native://';

/**
 * What a provider can actually do, declared rather than assumed.
 *
 * The same argument `HomeProviderCapabilities` makes: providers do not offer the
 * same things, and a UI that renders six affordances and hopes is how a control
 * that cannot work gets shown to somebody. Internet Archive searches and
 * resolves; iptv-org browses and resolves but free-text search over 17,000
 * channel names is a different thing from searching for a film.
 */
export interface NativeCapabilities {
  /** Answers `search(query)` against a free-text title. */
  search: boolean;
  /** Publishes browseable rows through `catalog()`. */
  catalog: boolean;
  /** Can turn one of its own handles into playable links. */
  resolve: boolean;
}

/** One browseable row a provider publishes. */
export interface NativeCatalogSection {
  /** Stable within the provider; the handle `catalog()` is called back with. */
  id: string;
  title: string;
  /** Shown under the title when the row needs a caveat rather than a boast. */
  subtitle?: string;
}

export interface NativeCatalogRequest {
  sectionId: string;
  /** 1-based, matching upstream's `getMainPage`. Providers treat 0 as no page. */
  page?: number;
}

export interface NativeProvider {
  /**
   * Stable, lowercase, and part of the address — changing it orphans every
   * bookmark, library row and cached source that names it.
   */
  readonly id: string;
  /**
   * The display name, and the scope/enable key.
   *
   * Unique across native *and* extension providers, because
   * `PluginManager.providers` is a Map keyed by name and the search scope keys
   * on the same string. A native provider colliding with an extension's name
   * would make which one answers depend on load order.
   */
  readonly name: string;
  readonly description: string;
  readonly types: TvType[];
  /** Routed through the same gate as an NSFW extension when true. */
  readonly adult?: boolean;
  /**
   * True until the user supplies a URL or key.
   *
   * Listed but not selectable, the way `HomeProviderRegistry` treats TMDB: a row
   * that silently answers nothing is worse than one that says what it needs.
   */
  readonly requiresConfig?: boolean;

  capabilities(): NativeCapabilities;

  /** Free-text title search. Only called when `capabilities().search`. */
  search(query: string, signal: AbortSignal): Promise<SearchResponse[]>;

  /** One of this provider's own handles to a detail page. */
  load(handle: string, signal: AbortSignal): Promise<LoadResponse>;

  /** One of this provider's own handles to playable links. Throws with a reason. */
  loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]>;

  /** Browseable rows. Only meaningful when `capabilities().catalog`. */
  sections?(): NativeCatalogSection[];
  catalog?(request: NativeCatalogRequest, signal: AbortSignal): Promise<SearchResponse[]>;
}

/**
 * Builds the address for one of a provider's handles.
 *
 * The handle is encoded because providers put JSON, paths and query strings in
 * theirs, and an unencoded `/` would silently split the address at the wrong
 * place — producing a provider id that does not exist and a "no such provider"
 * error naming the wrong thing.
 */
export function nativeAddress(providerId: string, handle: string): string {
  return `${NATIVE_SCHEME}${encodeURIComponent(providerId)}/${encodeURIComponent(handle)}`;
}

/** The inverse of {@link nativeAddress}. Null when the address is not one of ours. */
export function parseNativeAddress(
  address: string
): { providerId: string; handle: string } | null {
  if (!address.startsWith(NATIVE_SCHEME)) return null;
  const rest = address.slice(NATIVE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  try {
    const providerId = decodeURIComponent(rest.slice(0, slash));
    const handle = decodeURIComponent(rest.slice(slash + 1));
    if (!providerId || !handle) return null;
    return { providerId, handle };
  } catch {
    // A malformed percent-escape is not our address; say so rather than throwing
    // out of a routing decision.
    return null;
  }
}

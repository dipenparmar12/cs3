/**
 * The OTT platforms the app offers as first-class destinations, and the rule
 * for deciding which installed provider is one of them.
 *
 * ## Why this is a table and not a list of `if`s
 *
 * The desktop app has no privileged knowledge of what an extension registers.
 * A `.cs3` is somebody else's Kotlin, and the only identity it exposes is the
 * `name` its `MainAPI` chose — `PluginManager.providers` is keyed on exactly
 * that string. So "is this provider Netflix?" can only ever be answered by
 * matching that name, and the useful question is how to match it without being
 * wrong in either direction.
 *
 * Measured rather than assumed. The NetMirror extension
 * (`Sushan64/NetMirror-Extension`, verified 2026-08-31: the published archive's
 * SHA-256 matches its `fileHash`) contains four `MainAPI` subclasses —
 * `NetflixMirrorProvider`, `PrimeVideoMirrorProvider`, `HotStarMirrorProvider`
 * and `DisneyPlusProvider` — registering the display names **Netflix**,
 * **Prime Video**, **Hotstar** and **Disney Plus**. Those strings are the whole
 * reason this feature can exist at all, and they are what the exact-match lists
 * below are seeded with. **Hotstar is the exception**: it has a provider but no
 * catalogue behind it, so it is not a platform here — see the note above `disney`.
 *
 * ## The two ways a matcher here goes wrong
 *
 * | Too loose | Too tight |
 * |---|---|
 * | `PrimeWire` files under Prime Video. A user opens Prime Video and browses a torrent aggregator. | A provider that renames itself `Netflix Mirror v2` disappears from the Netflix page and looks uninstalled. |
 *
 * Loose is the worse failure, because it is *silent* — the page fills with
 * plausible content from the wrong place. So exact names win first, and the
 * patterns that follow are anchored and specific enough that the false
 * positives which actually exist in this corpus (`PrimeWire`, `Ahashare`,
 * `Netfilm`) cannot reach them. `ottPlatforms.test.mts` pins those three by
 * name; add a case there before loosening anything here.
 *
 * ## Only three are listed; everything else is discovered
 *
 * Netflix, Prime Video and Disney+ are the only hand-listed platforms. Every
 * other service appears because an installed extension registers a provider
 * with a main page (`discoverPlatforms`), the way Android's home screen works.
 * Sony LIV, ZEE5 and JioCinema were once listed as "carried by" aggregate
 * extensions with no provider of their own; that put a brand heading over a
 * search box and a hardcoded claim about somebody else's scraper, so they were
 * removed. A provider named after one of them is picked up by discovery.
 */

/** A repository id from `official_repositories.json`. */
export type RepositoryId = string;

export interface OttPlatformDefinition {
  id: string;
  /** Shown in the sidebar and as the page heading. */
  name: string;
  /** One line under the heading. Says what the page is, not what OTT is. */
  tagline: string;
  /** Brand colour, used for the sidebar dot and the page header wash. */
  accent: string;
  /**
   * Provider display names that *are* this platform, compared after
   * normalisation. Seeded from what installed archives actually register.
   */
  providerNames: string[];
  /**
   * Anchored fallbacks for a provider that renames itself. Tested against the
   * normalised name, never the raw one.
   */
  providerPatterns: RegExp[];
  /** Repositories to offer when nothing for this platform is installed. */
  suggestedRepositories: RepositoryId[];
  /** Whether this platform appears in the sidebar without being asked for. */
  defaultEnabled: boolean;
}

/**
 * Lowercase, letters and digits only.
 *
 * `Disney+ Hotstar`, `Disney Plus` and `DisneyPlus` differ only in punctuation
 * a provider author chose, and none of those differences means anything.
 */
export function normaliseProviderName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const OTT_PLATFORMS: OttPlatformDefinition[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    tagline: 'Films and series from Netflix catalogues, through installed extensions.',
    accent: '#e50914',
    providerNames: ['Netflix', 'NetflixMirror'],
    providerPatterns: [/^netflix/],
    suggestedRepositories: ['netmirror', 'cncverse'],
    defaultEnabled: true,
  },
  {
    id: 'primevideo',
    name: 'Prime Video',
    tagline: 'Amazon Prime Video catalogues, through installed extensions.',
    accent: '#00a8e1',
    providerNames: ['Prime Video', 'Amazon Prime Video', 'PrimeVideoMirror'],
    // Anchored, so `PrimeWire` — a real provider in this corpus — cannot reach it.
    providerPatterns: [/^(amazon)?primevideo/],
    suggestedRepositories: ['netmirror', 'cncverse'],
    defaultEnabled: true,
  },
  /**
   * Disney+ Hotstar was a platform here and is deliberately not one now.
   *
   * Nothing serves it a catalogue. `ottCatalog.ts`'s addon has no Hotstar
   * service code, and the platform page's own browse comes from an installed
   * provider's `getMainPage` — so the page opened onto a search box under a
   * brand name, which is the failure this table exists to avoid in the other
   * direction: the user reads a heading as a promise about what is behind it.
   *
   * Removing the row does not hide the providers. `Hotstar` and `JioHotstar`
   * stay installed, enabled and searchable, and one that publishes
   * `getMainPage` is offered by `discoverPlatforms` under its own name.
   * **Do not re-add this row** — discovery is how services beyond these three
   * appear.
   *
   * This is why `disney`'s pattern below stays anchored and terminated. With no
   * Hotstar row to claim it, `Disney+ Hotstar` normalises to `disneyhotstar`
   * and now matches nothing — which is correct. An unanchored Disney pattern
   * would file it under Disney+ and fill that page with the wrong library.
   */
  {
    id: 'disney',
    name: 'Disney+',
    tagline: 'The Disney+ catalogue, through installed extensions.',
    accent: '#113ccf',
    providerNames: ['Disney Plus', 'Disney+'],
    /**
     * Anchored and terminated. `Disney+ Hotstar` normalises to `disneyhotstar`,
     * which starts with `disney`; an unanchored pattern here would claim it and
     * put the Hotstar library under the Disney+ heading. That mattered when
     * Hotstar had its own row and matters more now that it has none — there is
     * no second page for it to land on, only the wrong one.
     *
     * The trailing `m?` is not decoration. CNC Verse ships two extensions side
     * by side, and the second suffixes every provider name with `M` for its
     * mobile endpoints — `DisneyM` beside `Disney` `[measured]`. Netflix and
     * Prime Video survive that suffix on their existing patterns; Disney is the
     * only one anchored tightly enough to be broken by it.
     */
    providerPatterns: [/^disney(plus)?m?$/],
    suggestedRepositories: ['netmirror', 'cncverse'],
    defaultEnabled: true,
  },
];

/** Pre-normalised exact-match index, built once. */
const EXACT_INDEX: Map<string, OttPlatformDefinition> = (() => {
  const index = new Map<string, OttPlatformDefinition>();
  for (const platform of OTT_PLATFORMS) {
    for (const name of platform.providerNames) {
      const key = normaliseProviderName(name);
      // First wins, so even a mistake here is a stable answer rather than one
      // that depends on array order. `ottPlatforms.test.mts` forbids the mistake.
      if (!index.has(key)) index.set(key, platform);
    }
  }
  return index;
})();

/**
 * Which platform a provider belongs to, or null for the overwhelming majority
 * of the corpus, which belongs to none.
 */
export function ottPlatformForProvider(providerName: string): OttPlatformDefinition | null {
  const key = normaliseProviderName(providerName);
  if (!key) return null;

  const exact = EXACT_INDEX.get(key);
  if (exact) return exact;

  for (const platform of OTT_PLATFORMS) {
    for (const pattern of platform.providerPatterns) {
      if (pattern.test(key)) return platform;
    }
  }
  return null;
}

export function ottPlatformById(id: string): OttPlatformDefinition | null {
  return OTT_PLATFORMS.find((p) => p.id === id) ?? null;
}

/** How a platform page can be reached, in decreasing order of directness. */
export type OttAvailability =
  /** A provider named after the platform is installed and enabled. */
  | 'ready'
  /** Installed, but switched off somewhere in the repository/extension/provider cascade. */
  | 'disabled'
  /** Nothing installed can serve it; the repositories that might are offered. */
  | 'missing';

export interface OttPlatformView {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  availability: OttAvailability;
  /** Providers that are this platform and are currently askable. */
  providers: string[];
  /** Providers that are this platform but are switched off. */
  disabledProviders: string[];
  /** Repositories to offer when `availability` is `missing`. */
  suggestedRepositories: RepositoryId[];
  /**
   * True for a platform discovered from an installed provider rather than
   * listed in `OTT_PLATFORMS`. Off in the sidebar until the viewer picks it.
   */
  discovered?: boolean;
  /** For a discovered platform: the extension that registered the provider. */
  extension?: string;
  /** For a discovered platform: the provider's declared `TvType`s and language. */
  types?: string[];
  lang?: string;
  /**
   * Adult content, read from the provider's own declaration (upstream's `NSFW`
   * `TvType`) — the same signal the adult gate uses, never a name list. Drives
   * the 18+ badge and the once-per-launch warning before the page loads.
   */
  adult?: boolean;
  /** Pinned to the top of the sidebar by the viewer. Set by `OttService`. */
  pinned?: boolean;
}

/** What the inventory knows about one provider, from the registry — no JVM. */
export interface OttProviderDetail {
  name: string;
  pluginName: string;
  hasMainPage: boolean;
  supportedTypes: string[];
  lang?: string;
}

export interface OttInventory {
  /** Every provider the app knows about, whether or not it is enabled. */
  allProviders: string[];
  /** The subset a search would actually ask — the full enable cascade applied. */
  enabledProviders: string[];
  /**
   * Per-provider facts, for discovery. Absent means no discovered platforms,
   * so the hand-listed table still answers on its own.
   */
  providerDetails?: OttProviderDetail[];
}

/** Id prefix for a platform discovered from a provider. The rest is its name. */
export const DISCOVERED_PREFIX = 'provider:';

export function discoveredPlatformId(providerName: string): string {
  return `${DISCOVERED_PREFIX}${providerName}`;
}

/** A stable colour from the name, so a discovered row keeps its dot. */
function accentFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 55%)`;
}

/**
 * Every enabled provider that publishes a main page and is not already one of
 * the hand-listed platforms, as a platform of its own.
 *
 * This is Android's home-screen picker: upstream has no platform table — the
 * home screen offers every `MainAPI` with `hasMainPage`, and its rows are that
 * provider's `getMainPage`. So the list follows whatever the installed
 * extensions register (NetMirror's Hotstar, CNC Verse's services, a regional
 * site) without a row being written here for each.
 *
 * Enabled providers only: a provider held back by the adult gate or switched
 * off must not appear in a picker by name.
 */
export function discoverPlatforms(inventory: OttInventory): OttPlatformView[] {
  const enabled = new Set(inventory.enabledProviders);
  const seen = new Set<string>();
  const out: OttPlatformView[] = [];
  for (const detail of inventory.providerDetails ?? []) {
    if (!detail.hasMainPage || !enabled.has(detail.name)) continue;
    if (ottPlatformForProvider(detail.name)) continue;
    if (seen.has(detail.name)) continue;
    seen.add(detail.name);
    out.push({
      id: discoveredPlatformId(detail.name),
      name: detail.name,
      tagline: `${detail.name}'s own catalogue, from the ${detail.pluginName} extension.`,
      accent: accentFor(detail.name),
      availability: 'ready',
      providers: [detail.name],
      disabledProviders: [],
      suggestedRepositories: [],
      discovered: true,
      extension: detail.pluginName,
      types: detail.supportedTypes,
      lang: detail.lang,
      adult: detail.supportedTypes.some((type) => type.toUpperCase() === 'NSFW'),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Turns what is installed into what the sidebar should show.
 *
 * Pure, and takes the inventory rather than reaching for `PluginManager`, so
 * the interesting cases — a provider installed but disabled, a provider
 * discovered from its main page — are testable without a JVM anywhere near them.
 */
export function buildOttPlatformViews(inventory: OttInventory): OttPlatformView[] {
  const enabled = new Set(inventory.enabledProviders);

  const byPlatform = new Map<string, { on: string[]; off: string[] }>();
  for (const provider of inventory.allProviders) {
    const platform = ottPlatformForProvider(provider);
    if (!platform) continue;
    let bucket = byPlatform.get(platform.id);
    if (!bucket) {
      bucket = { on: [], off: [] };
      byPlatform.set(platform.id, bucket);
    }
    (enabled.has(provider) ? bucket.on : bucket.off).push(provider);
  }

  const listed = OTT_PLATFORMS.map((platform): OttPlatformView => {
    const bucket = byPlatform.get(platform.id) ?? { on: [], off: [] };

    let availability: OttAvailability;
    if (bucket.on.length > 0) availability = 'ready';
    else if (bucket.off.length > 0) availability = 'disabled';
    else availability = 'missing';

    return {
      id: platform.id,
      name: platform.name,
      tagline: platform.tagline,
      accent: platform.accent,
      availability,
      providers: bucket.on,
      disabledProviders: bucket.off,
      suggestedRepositories: platform.suggestedRepositories,
    };
  });
  return [...listed, ...discoverPlatforms(inventory)];
}

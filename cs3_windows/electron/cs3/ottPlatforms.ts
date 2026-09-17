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
 * ## Platforms with no provider are still listed
 *
 * Sony LIV, ZEE5 and JioCinema have no per-platform CloudStream provider in the
 * reachable ecosystem — the community reaches them through aggregate scrapers
 * (MovieBox and CNC Verse both advertise it) rather than through a provider
 * named after the service. Dropping them from the catalogue would be tidier and
 * would answer the wrong question: the user knows the platform, not the scraper
 * that carries it. They are listed with `aggregateExtensions` naming the
 * extensions that do carry them, and the page says so instead of showing an
 * empty grid that reads as a bug.
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
  /**
   * Extension internal names that carry a meaningful amount of this platform's
   * catalogue without registering a provider named after it. Matched on the
   * extension, because that is the identity a repository index publishes and
   * therefore the only one verifiable without installing anything.
   */
  aggregateExtensions: string[];
  /** Repositories to offer when nothing for this platform is installed. */
  suggestedRepositories: RepositoryId[];
  /**
   * Whether this platform appears in the sidebar without being asked for.
   *
   * The three that are on by default are the ones with both a provider *named
   * after them* and something to browse — NetMirror registers Netflix, Prime
   * Video and Disney Plus, and CNC Verse adds its own. Sony LIV, ZEE5 and
   * JioCinema have no such provider anywhere: they are reachable only through
   * aggregate scrapers, so their pages open onto a search box rather than a
   * catalogue.
   *
   * Listing them off by default rather than dropping them is deliberate, and
   * it is the same argument that put them in the table at all: the user knows
   * the platform, not the scraper. Hiding them entirely answers "can I watch
   * ZEE5?" with silence, which reads as the app not knowing what ZEE5 is.
   */
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
    aggregateExtensions: [],
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
    aggregateExtensions: [],
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
   * stay installed, enabled and searchable exactly as before; they simply no
   * longer have a platform page of their own. **Do not re-add this row without
   * a catalogue** — either a service code in `PLATFORM_CATALOGS` or a provider
   * that actually publishes `getMainPage` for it.
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
    aggregateExtensions: [],
    suggestedRepositories: ['netmirror', 'cncverse'],
    defaultEnabled: true,
  },
  {
    id: 'sonyliv',
    name: 'Sony LIV',
    tagline: 'Sony LIV titles, carried by multi-platform extensions.',
    accent: '#f26522',
    providerNames: ['Sony LIV'],
    providerPatterns: [/^sonyliv/],
    // Both advertise Sony LIV coverage in their published descriptions.
    aggregateExtensions: ['MovieBoxProvider', 'MovieBoxProviderIN', 'CNC Verse'],
    suggestedRepositories: ['cncverse', 'phisher'],
    defaultEnabled: false,
  },
  {
    id: 'zee5',
    name: 'ZEE5',
    tagline: 'ZEE5 titles, carried by multi-platform extensions.',
    accent: '#8230c6',
    providerNames: ['ZEE5'],
    providerPatterns: [/^zee5/],
    aggregateExtensions: ['MovieBoxProvider', 'MovieBoxProviderIN', 'CNC Verse'],
    suggestedRepositories: ['cncverse', 'phisher'],
    defaultEnabled: false,
  },
  {
    id: 'jiocinema',
    name: 'JioCinema',
    tagline: 'JioCinema titles, carried by multi-platform extensions.',
    accent: '#d61f6b',
    providerNames: ['JioCinema'],
    /**
     * `jiocinema` only. JioCinema merged into JioHotstar, and a `^jio` pattern
     * here would take that provider — filing a Hotstar library under the
     * JioCinema heading. Hotstar has no page of its own any more, so there is
     * nowhere better for it to go; unmatched is the honest answer.
     */
    providerPatterns: [/^jiocinema/],
    aggregateExtensions: ['MovieBoxProvider', 'MovieBoxProviderIN', 'CNC Verse'],
    suggestedRepositories: ['cncverse', 'phisher'],
    defaultEnabled: false,
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
  /** No provider of its own, but an installed extension carries its catalogue. */
  | 'aggregate'
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
  /** Installed extensions that carry the platform without being named after it. */
  carriedBy: string[];
  /** Repositories to offer when `availability` is `missing`. */
  suggestedRepositories: RepositoryId[];
}

export interface OttInventory {
  /** Every provider the app knows about, whether or not it is enabled. */
  allProviders: string[];
  /** The subset a search would actually ask — the full enable cascade applied. */
  enabledProviders: string[];
  /** `internalName` of every installed extension. */
  installedExtensions: string[];
}

/**
 * Turns what is installed into what the sidebar should show.
 *
 * Pure, and takes the inventory rather than reaching for `PluginManager`, so
 * the interesting cases — a provider installed but disabled, a platform reachable
 * only through an aggregate — are testable without a JVM anywhere near them.
 */
export function buildOttPlatformViews(inventory: OttInventory): OttPlatformView[] {
  const enabled = new Set(inventory.enabledProviders);
  const installedExtensions = new Set(
    inventory.installedExtensions.map((name) => normaliseProviderName(name))
  );

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

  return OTT_PLATFORMS.map((platform) => {
    const bucket = byPlatform.get(platform.id) ?? { on: [], off: [] };
    const carriedBy = platform.aggregateExtensions.filter((name) =>
      installedExtensions.has(normaliseProviderName(name))
    );

    let availability: OttAvailability;
    if (bucket.on.length > 0) availability = 'ready';
    else if (bucket.off.length > 0) availability = 'disabled';
    else if (carriedBy.length > 0) availability = 'aggregate';
    else availability = 'missing';

    return {
      id: platform.id,
      name: platform.name,
      tagline: platform.tagline,
      accent: platform.accent,
      availability,
      providers: bucket.on,
      disabledProviders: bucket.off,
      carriedBy,
      suggestedRepositories: platform.suggestedRepositories,
    };
  });
}

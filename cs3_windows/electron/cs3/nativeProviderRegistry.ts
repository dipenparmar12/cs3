/**
 * The roster of built-in providers, and the one place they are gated.
 *
 * ## The rule this file exists to keep
 *
 * `PluginManager.enabledProviderNames` is the single enforcement point for the
 * provider / extension / repository / adult cascade across search, the scope
 * picker, source discovery, playback and downloads. AGENTS.md is explicit that
 * enforcing it at each call site would be five places to forget.
 *
 * A new provider lane is exactly how that guarantee gets quietly broken — code
 * that registers providers somewhere else re-opens the adult gate *and* the
 * disable switch at once, and neither failure is visible until someone reports
 * it. So this registry answers the same question in the same shape
 * (`enabledProviderNames()`), reads the same adult setting, and stores its
 * disabled set through the same `DisabledSet` primitive the extension cascade
 * uses — which owns the rule that the stored list holds *exceptions*, so a
 * provider added in a later release works without anyone opting into it.
 *
 * ## Why the roster is a table
 *
 * Same argument `providerRanking`'s criteria are rows rather than a formula, and
 * `backupService`'s sections are a table rather than two switch statements: a
 * provider added to one list and forgotten in another is invisible to `tsc` and
 * looks exactly like a working feature to everyone reading the code. Everything
 * about a native provider — that it exists, that it can be disabled, that it is
 * searched, that it appears in the scope picker — follows from being in
 * `this.providers`.
 */
import type { DatastoreManager } from '../datastore.ts';
import { DisabledSet } from '../util/disabledSet.ts';
import { getLogger } from '../logging/logger.ts';
import type { SearchResponse, SubtitleFile, TvType } from '../../src/types/api.ts';
import { InternetArchiveProvider } from './nativeProviders/internetArchive.ts';
import { IptvOrgProvider } from './nativeProviders/iptvOrg.ts';
import { PeerTubeProvider } from './nativeProviders/peerTube.ts';
import {
  StremioAddonProvider,
  fetchManifest,
  normaliseBase,
  type StremioManifest,
} from './nativeProviders/stremioAddon.ts';
import {
  JellyfinProvider,
  normaliseServerUrl,
  probeServer,
  type JellyfinServerConfig,
} from './nativeProviders/jellyfin.ts';
import type {
  NativeCatalogSection,
  NativeProvider,
} from './nativeProviders/types.ts';
import { parseNativeAddress } from './nativeProviders/types.ts';

const log = getLogger().child('provider', { component: 'native' });

const DISABLED_KEY = 'cs3_disabled_native_providers';
const ADULT_KEY = 'cs3_adult_content_enabled';
const ADDONS_KEY = 'cs3_stremio_addons';
const SERVERS_KEY = 'cs3_media_servers';

/**
 * One Stremio addon the user has added, with the manifest as it read at the
 * time.
 *
 * The manifest is stored rather than re-fetched at startup for two reasons:
 * `capabilities()` is synchronous and the roster has to render immediately, and
 * an addon host being slow or down must not delay the extensions screen or make
 * a provider the user added disappear from it.
 */
export interface StoredAddon {
  localId: string;
  url: string;
  manifest: StremioManifest;
  addedAt: number;
}

/** What the UI renders one native provider as. */
export interface NativeProviderSummary {
  id: string;
  name: string;
  description: string;
  types: TvType[];
  adult: boolean;
  requiresConfig: boolean;
  enabled: boolean;
  /** False when something above it — currently only the adult gate — blocks it. */
  effectivelyEnabled: boolean;
  /**
   * Why it is unavailable despite being switched on.
   *
   * The same distinction the extensions tree draws between `enabled` and
   * `effectivelyEnabled`: a provider greyed out by the adult gate must not look
   * like one the user turned off, or its toggle appears to do nothing.
   */
  unavailableReason?: string;
  capabilities: { search: boolean; catalog: boolean; resolve: boolean };
  sections: NativeCatalogSection[];
}

export class NativeProviderRegistry {
  private readonly datastore: DatastoreManager;
  private readonly disabled: DisabledSet;
  private readonly providers = new Map<string, NativeProvider>();

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
    this.disabled = new DisabledSet(datastore, DISABLED_KEY);
    this.rebuild();
  }

  /**
   * The roster, rebuilt whenever the set of user-added addons changes.
   *
   * Built-ins first and always; addons are appended from storage. Same shape as
   * `HomeProviderRegistry.rebuild` and for the same reason — a roster assembled
   * once at construction would not notice an addon being added until a restart.
   */
  private rebuild(): void {
    this.providers.clear();
    const adultAllowed = () => this.adultAllowed();

    for (const provider of [
      new InternetArchiveProvider({ adultAllowed }),
      new PeerTubeProvider({ adultAllowed }),
      new IptvOrgProvider({ adultAllowed }),
    ]) {
      this.providers.set(provider.id, provider);
    }

    for (const server of this.storedServers()) {
      try {
        const provider = new JellyfinProvider(server);
        if (!this.providers.has(provider.id)) this.providers.set(provider.id, provider);
      } catch (error) {
        log.warn('stored_server_unusable', {
          server: server.localId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const addon of this.storedAddons()) {
      try {
        const provider = new StremioAddonProvider({
          localId: addon.localId,
          baseUrl: addon.url,
          manifest: addon.manifest,
        });
        // A built-in never loses its slot to a stored addon: the addon list is
        // user data and a malformed or hostile entry must not be able to
        // shadow Internet Archive by claiming its id.
        if (!this.providers.has(provider.id)) this.providers.set(provider.id, provider);
      } catch (error) {
        log.warn('stored_addon_unusable', {
          addon: addon.localId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private storedAddons(): StoredAddon[] {
    const raw = this.datastore.getObject<StoredAddon[]>(ADDONS_KEY, []) ?? [];
    return Array.isArray(raw) ? raw.filter((a) => a?.localId && a?.url && a?.manifest) : [];
  }

  public listAddons(): StoredAddon[] {
    return this.storedAddons();
  }

  private storedServers(): JellyfinServerConfig[] {
    const raw = this.datastore.getObject<JellyfinServerConfig[]>(SERVERS_KEY, []) ?? [];
    return Array.isArray(raw)
      ? raw.filter((s) => s?.localId && s?.url && s?.apiKey && s?.userId)
      : [];
  }

  /**
   * The configured media servers, **without their API keys**.
   *
   * This is what the renderer is given, and the key is removed on the way out
   * rather than being filtered by each caller. A long-lived credential for
   * somebody's own server has no business crossing the context bridge: nothing
   * in the UI needs it, and once it is in the renderer it is one careless log,
   * error report or source export away from being written down.
   */
  public listServers(): Array<Omit<JellyfinServerConfig, 'apiKey'>> {
    return this.storedServers().map(({ apiKey: _apiKey, ...rest }) => rest);
  }

  /**
   * Validates a media server and stores it.
   *
   * Probed at add time — a wrong URL or a key not attached to a user account
   * fails in front of the person who typed it, rather than becoming a provider
   * that answers nothing on every search.
   */
  public async addServer(
    url: string,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<Omit<JellyfinServerConfig, 'apiKey'>> {
    const probe = await probeServer(url, apiKey, signal);
    const base = normaliseServerUrl(url);
    const localId = serverLocalId(base);

    const existing = this.storedServers();
    if (existing.some((s) => s.localId === localId)) {
      throw new Error(`${probe.name} at ${base} has already been added.`);
    }
    if (this.providers.has(localId)) {
      throw new Error('That server collides with a built-in provider\'s id.');
    }

    const record: JellyfinServerConfig = {
      localId,
      // Disambiguated by host, because "Jellyfin" is what almost every server
      // is called and two identically named providers would collide on the
      // scope key.
      name: `${probe.name} (${hostOf(base)})`,
      url: base,
      apiKey,
      userId: probe.userId,
    };
    this.datastore.setObject(SERVERS_KEY, [...existing, record]);
    this.rebuild();
    const { apiKey: _apiKey, ...safe } = record;
    return safe;
  }

  public removeServer(localId: string): void {
    this.datastore.setObject(
      SERVERS_KEY,
      this.storedServers().filter((s) => s.localId !== localId)
    );
    this.disabled.set([localId], true);
    this.rebuild();
  }

  /**
   * Validates and stores one addon.
   *
   * The manifest is fetched here rather than lazily so a wrong URL fails in
   * front of the person who typed it. A URL that is not an addon would
   * otherwise become a provider that is listed, enabled, asked on every search
   * and silently answers nothing — indistinguishable from a source that has
   * nothing for this title.
   */
  public async addAddon(url: string, signal?: AbortSignal): Promise<StoredAddon> {
    const manifest = await fetchManifest(url, signal);
    const base = normaliseBase(url);
    const localId = addonLocalId(manifest.id, base);

    const existing = this.storedAddons();
    if (existing.some((a) => a.localId === localId)) {
      throw new Error(`"${manifest.name}" has already been added.`);
    }
    if (this.providers.has(localId)) {
      throw new Error(`"${manifest.name}" collides with a built-in provider's id.`);
    }

    const record: StoredAddon = { localId, url: base, manifest, addedAt: Date.now() };
    this.datastore.setObject(ADDONS_KEY, [...existing, record]);
    this.rebuild();
    return record;
  }

  public removeAddon(localId: string): void {
    const remaining = this.storedAddons().filter((a) => a.localId !== localId);
    this.datastore.setObject(ADDONS_KEY, remaining);
    // The disabled entry goes with it, or re-adding the same addon later comes
    // back switched off with nothing on screen explaining why.
    this.disabled.set([localId], true);
    this.rebuild();
  }

  /**
   * Subtitles from every addon that publishes them, merged.
   *
   * 42 of the 95 catalogued addons serve `subtitles` — the most-served resource
   * in the ecosystem, against the one host `subtitleService` hardcodes. A
   * failing addon contributes nothing rather than failing the merge.
   */
  public async subtitles(handle: string, signal: AbortSignal): Promise<SubtitleFile[]> {
    const addons = this.enabledProviders().filter(
      (p): p is StremioAddonProvider => p instanceof StremioAddonProvider
    );
    const settled = await Promise.allSettled(addons.map((a) => a.subtitles(handle, signal)));
    const out: SubtitleFile[] = [];
    for (const result of settled) if (result.status === 'fulfilled') out.push(...result.value);
    return out;
  }

  /** Read per call, never cached — the setting can change while the app runs. */
  private adultAllowed(): boolean {
    return this.datastore.getBool(ADULT_KEY, false);
  }

  public all(): NativeProvider[] {
    return [...this.providers.values()];
  }

  public byId(id: string): NativeProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Resolves a provider by its *display name*, which is what the search scope
   * and the enable list key on.
   *
   * Names are unique across native and extension providers by construction —
   * see `NativeProvider.name`.
   */
  public byName(name: string): NativeProvider | undefined {
    return this.all().find((p) => p.name === name);
  }

  /**
   * Every gate, applied in one place — the native mirror of
   * `PluginManager.enabledProviderNames`.
   */
  public enabledProviderNames(): string[] {
    const off = new Set(this.disabled.list());
    const allowAdult = this.adultAllowed();
    return this.all()
      .filter((p) => !off.has(p.id))
      .filter((p) => allowAdult || !p.adult)
      .filter((p) => !p.requiresConfig)
      .map((p) => p.name);
  }

  /** The enabled providers themselves, for callers that need to invoke them. */
  public enabledProviders(): NativeProvider[] {
    const names = new Set(this.enabledProviderNames());
    return this.all().filter((p) => names.has(p.name));
  }

  public setEnabled(id: string, enabled: boolean): string[] {
    if (!this.providers.has(id)) return this.disabled.list();
    return this.disabled.set([id], enabled);
  }

  public summaries(): NativeProviderSummary[] {
    const off = new Set(this.disabled.list());
    const allowAdult = this.adultAllowed();
    return this.all().map((p) => {
      const enabled = !off.has(p.id);
      const blockedByAdult = Boolean(p.adult) && !allowAdult;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        types: [...p.types],
        adult: Boolean(p.adult),
        requiresConfig: Boolean(p.requiresConfig),
        enabled,
        effectivelyEnabled: enabled && !blockedByAdult && !p.requiresConfig,
        unavailableReason: blockedByAdult
          ? 'Adult content is turned off in Settings.'
          : p.requiresConfig
            ? 'Needs to be set up in Settings before it can answer.'
            : undefined,
        capabilities: p.capabilities(),
        sections: p.sections?.() ?? [],
      };
    });
  }

  /**
   * Searches the enabled native providers, one failure never taking the rest.
   *
   * Isolation is the same discipline `IndexerRegistry` applies and for the same
   * reason: one slow or broken source must not delay or fail an aggregate
   * search. A rejection is logged and reported as zero rows from *that*
   * provider, never as a failed search.
   */
  public async search(
    query: string,
    signal: AbortSignal,
    only?: string[]
  ): Promise<SearchResponse[]> {
    const allow = only && only.length > 0 ? new Set(only) : null;
    const targets = this.enabledProviders().filter(
      (p) => p.capabilities().search && (!allow || allow.has(p.name))
    );

    const settled = await Promise.allSettled(
      targets.map((p) => p.search(query, signal))
    );

    const rows: SearchResponse[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        rows.push(...result.value);
      } else if (!signal.aborted) {
        log.warn('native_search_failed', {
          provider: targets[index]?.id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    return rows;
  }

  /**
   * True when this address belongs to an enabled native provider.
   *
   * Enabled-ness is part of the answer on purpose: a bookmark or library row
   * addressing a provider the user has since switched off must fall through to
   * the ordinary "why is this provider missing" explanation rather than being
   * silently served by a source they disabled.
   */
  public handles(address: string): boolean {
    const parsed = parseNativeAddress(address);
    if (!parsed) return false;
    const provider = this.providers.get(parsed.providerId);
    if (!provider) return false;
    return this.enabledProviderNames().includes(provider.name);
  }

  /**
   * Why an address cannot be served, in words a person can act on.
   *
   * The native counterpart of `PluginManager.explainMissingProvider`, and it
   * exists for the same reason: the layer that knows a name is absent knows
   * nothing useful, while the layer that owns the roster knows exactly which of
   * three different things went wrong — and each is a different action.
   */
  public explain(address: string): string {
    const parsed = parseNativeAddress(address);
    if (!parsed) return 'That address is not a built-in provider address.';
    const provider = this.providers.get(parsed.providerId);
    if (!provider) {
      return `"${parsed.providerId}" is not a built-in provider in this version of the app.`;
    }
    if (this.disabled.has(provider.id)) {
      return `${provider.name} is switched off. Turn it back on under Extensions → Built-in sources.`;
    }
    if (provider.adult && !this.adultAllowed()) {
      return `${provider.name} carries adult content, which is turned off in Settings.`;
    }
    if (provider.requiresConfig) {
      return `${provider.name} has not been set up yet. Add its details in Settings.`;
    }
    return `${provider.name} could not answer for this item.`;
  }
}

/**
 * A stable local id for one addon.
 *
 * The manifest id alone is not unique: the same addon software is deployed
 * behind many hosts (Torrentio, Comet and MediaFusion all have public and
 * self-hosted deployments, and a debrid-configured instance is the *point* of
 * adding one), and two deployments of one manifest id must be two providers or
 * the second silently replaces the first.
 *
 * The host is therefore part of the id, and the whole thing is prefixed so an
 * addon can never collide with a built-in provider's id namespace.
 */
export function addonLocalId(manifestId: string, baseUrl: string): string {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // Not a parseable URL — it was validated before this is reached, so fall
    // back to the raw string rather than throwing out of an id function.
  }
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `addon:${slug(manifestId)}@${slug(host)}`;
}

/** A stable id for one media server. The host is the identity; the key is not. */
export function serverLocalId(baseUrl: string): string {
  return `server:${hostOf(baseUrl).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:[/][/]/i, '').replace(/[/].*$/, '');
  }
}

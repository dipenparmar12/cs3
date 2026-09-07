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
import type { SearchResponse, TvType } from '../../src/types/api.ts';
import { InternetArchiveProvider } from './nativeProviders/internetArchive.ts';
import { IptvOrgProvider } from './nativeProviders/iptvOrg.ts';
import { PeerTubeProvider } from './nativeProviders/peerTube.ts';
import type {
  NativeCatalogSection,
  NativeProvider,
} from './nativeProviders/types.ts';
import { parseNativeAddress } from './nativeProviders/types.ts';

const log = getLogger().child('provider', { component: 'native' });

const DISABLED_KEY = 'cs3_disabled_native_providers';
const ADULT_KEY = 'cs3_adult_content_enabled';

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

    const adultAllowed = () => this.adultAllowed();
    for (const provider of [
      new InternetArchiveProvider({ adultAllowed }),
      new PeerTubeProvider({ adultAllowed }),
      new IptvOrgProvider({ adultAllowed }),
    ]) {
      this.providers.set(provider.id, provider);
    }
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

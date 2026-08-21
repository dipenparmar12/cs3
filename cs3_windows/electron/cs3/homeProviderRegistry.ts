import type { DatastoreManager } from '../datastore.ts';
import { scopedLogger } from '../logging/logger.ts';
import {
  AniListProvider,
  HEALTH_TTL_MS,
  StremioCatalogProvider,
  TmdbProvider,
  checkProvider,
  isSelectable,
  type HomeProvider,
  type HomeProviderHealth,
} from './homeProviders.ts';

/**
 * Which catalogue the home screen is currently built from, and whether it works.
 *
 * Two responsibilities that belong together because neither is safe alone.
 * Selection without health checking lets someone pick a provider that is down
 * and get an empty home screen with no explanation. Health checking without
 * selection is a diagnostic nobody can act on.
 *
 * **The active provider is resolved, not stored.** The datastore holds an *id*;
 * what `active()` returns is that provider if it is answering and the default
 * if it is not. A catalogue host going down for an afternoon must not leave the
 * app with a blank front page — and it must not silently rewrite the user's
 * choice either, so the stored id is left alone and the fallback is reported.
 */

const log = scopedLogger('discovery', { component: 'home-providers' });

const SELECTED_KEY = 'home_provider_key';
const TMDB_KEY = 'home_tmdb_api_key';
const CUSTOM_URL_KEY = 'home_custom_catalog_url';

/** The one that ships, and the one everything falls back to. */
export const DEFAULT_PROVIDER_ID = 'cinemeta';

export interface HomeProviderSummary {
  id: string;
  name: string;
  description: string;
  requiresKey: boolean;
  catalogs: string[];
  genres: number;
  health: HomeProviderHealth | null;
  selectable: boolean;
  active: boolean;
}

export class HomeProviderRegistry {
  private datastore: DatastoreManager;
  private providers = new Map<string, HomeProvider>();
  private health = new Map<string, HomeProviderHealth>();
  private probing = new Map<string, Promise<HomeProviderHealth>>();

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
    this.rebuild();
  }

  /**
   * The roster, rebuilt whenever a setting that defines one changes.
   *
   * The custom entry appears only when a URL has been supplied: an empty
   * "Custom addon" row that can never be selected is a control that looks
   * broken rather than one that looks available.
   */
  private rebuild(): void {
    this.providers.clear();

    this.providers.set(
      DEFAULT_PROVIDER_ID,
      new StremioCatalogProvider({
        id: DEFAULT_PROVIDER_ID,
        name: 'CloudStream catalogue',
        description:
          'Stremio Cinemeta. Keyless, IMDb-keyed, and its popularity ordering comes from the same Trakt and TMDB signal the paid services sell.',
        baseUrl: 'https://cinemeta-catalogs.strem.io',
      })
    );

    this.providers.set('anilist', new AniListProvider());
    this.providers.set('tmdb', new TmdbProvider(() => this.datastore.getString(TMDB_KEY, '', true)));

    const custom = this.datastore.getString(CUSTOM_URL_KEY, '', true).trim();
    if (custom) {
      this.providers.set(
        'custom',
        new StremioCatalogProvider({
          id: 'custom',
          name: 'Custom catalogue addon',
          description: `Stremio catalog addon at ${custom}`,
          baseUrl: custom,
        })
      );
    }
  }

  public list(): HomeProvider[] {
    return [...this.providers.values()];
  }

  public get(id: string): HomeProvider | null {
    return this.providers.get(id) ?? null;
  }

  public get selectedId(): string {
    return this.datastore.getString(SELECTED_KEY, DEFAULT_PROVIDER_ID, true) || DEFAULT_PROVIDER_ID;
  }

  /**
   * The provider the home screen should actually use right now.
   *
   * Falls back to the default when the selection is missing or has been
   * measured as not answering. The stored id is deliberately *not* rewritten:
   * a host that is down for an afternoon should not permanently lose someone
   * their choice, and silently changing a setting the user made is its own bug.
   */
  public active(): { provider: HomeProvider; fellBack: boolean } {
    const selected = this.providers.get(this.selectedId);
    const fallback = this.providers.get(DEFAULT_PROVIDER_ID)!;
    if (!selected) return { provider: fallback, fellBack: true };

    const known = this.health.get(selected.id);
    if (known && !isSelectable(known)) {
      log.warn('provider_unavailable_falling_back', {
        provider: selected.id,
        status: known.status,
        error: known.reason,
      });
      return { provider: fallback, fellBack: true };
    }
    return { provider: selected, fellBack: false };
  }

  /**
   * Health for one provider, measured at most every {@link HEALTH_TTL_MS}.
   *
   * Concurrent callers join the in-flight probe rather than starting their own:
   * the settings panel asks for all of them at once, and four simultaneous
   * probes of the same host is both wasteful and a good way to be rate-limited
   * by a service we are trying to establish is healthy.
   */
  public async checkOne(id: string, force = false): Promise<HomeProviderHealth | null> {
    const provider = this.providers.get(id);
    if (!provider) return null;

    const cached = this.health.get(id);
    if (!force && cached && Date.now() - cached.checkedAt < HEALTH_TTL_MS) return cached;

    const existing = this.probing.get(id);
    if (existing) return existing;

    const probe = checkProvider(provider)
      .then((result) => {
        this.health.set(id, result);
        log.info('provider_checked', {
          provider: id,
          status: result.status,
          durationMs: result.latencyMs,
          items: result.items,
          error: result.reason,
        });
        return result;
      })
      .finally(() => this.probing.delete(id));

    this.probing.set(id, probe);
    return probe;
  }

  public async checkAll(force = false): Promise<HomeProviderHealth[]> {
    return Promise.all(
      this.list().map(
        async (provider) =>
          (await this.checkOne(provider.id, force)) ?? {
            id: provider.id,
            name: provider.name,
            status: 'unchecked' as const,
            checkedAt: Date.now(),
          }
      )
    );
  }

  /** Everything the settings panel needs, in one shape. */
  public async summaries(force = false): Promise<HomeProviderSummary[]> {
    await this.checkAll(force);
    const activeId = this.active().provider.id;

    return this.list().map((provider) => {
      const capabilities = provider.capabilities();
      const health = this.health.get(provider.id) ?? null;
      return {
        id: provider.id,
        name: provider.name,
        description: provider.description,
        requiresKey: Boolean(provider.requiresKey),
        catalogs: capabilities.catalogs,
        genres: capabilities.genres.length,
        health,
        selectable: isSelectable(health ?? undefined),
        active: provider.id === activeId,
      };
    });
  }

  /**
   * Selects a provider, refusing one that is not answering.
   *
   * Refusing rather than accepting-and-failing is the point of the health
   * check. Letting someone choose a dead provider and then discovering it on
   * the home screen would make the check a decoration — and the message here
   * can say *why*, which the empty screen could not.
   */
  public async select(id: string): Promise<{ ok: boolean; error?: string; id: string }> {
    const provider = this.providers.get(id);
    if (!provider) return { ok: false, error: `No such home provider: ${id}`, id: this.selectedId };

    const health = await this.checkOne(id, true);
    if (!isSelectable(health ?? undefined)) {
      return {
        ok: false,
        error: health?.reason ?? `${provider.name} is not responding.`,
        id: this.selectedId,
      };
    }

    this.datastore.setString(SELECTED_KEY, id, true);
    log.info('provider_selected', { provider: id });
    return { ok: true, id };
  }

  public setTmdbKey(key: string): void {
    this.datastore.setString(TMDB_KEY, key.trim(), true);
    // The key is read through a closure, so the provider itself needs no
    // rebuilding — but its health does, since the last probe failed for want
    // of exactly this.
    this.health.delete('tmdb');
  }

  public hasTmdbKey(): boolean {
    return this.datastore.getString(TMDB_KEY, '', true).trim().length > 0;
  }

  public setCustomCatalogUrl(url: string): void {
    this.datastore.setString(CUSTOM_URL_KEY, url.trim(), true);
    this.health.delete('custom');
    this.rebuild();
  }

  public customCatalogUrl(): string {
    return this.datastore.getString(CUSTOM_URL_KEY, '', true);
  }
}

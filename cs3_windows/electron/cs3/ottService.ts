import type { PluginManager } from '../pluginManager';
import type { ProviderCatalog, ProviderCatalogPage } from '../../src/types/api';
import { OFFICIAL_REPOSITORIES } from '../officialRepositories';
import type { DatastoreManager } from '../datastore';
import {
  buildOttPlatformViews,
  DISCOVERED_PREFIX,
  ottPlatformById,
  OTT_PLATFORMS,
  type OttPlatformView,
} from './ottPlatforms';

/**
 * The OTT platform destinations, assembled from what is actually installed.
 *
 * `ottPlatforms.ts` is the table and the matching rule and is pure. This is the
 * part that has to look at the running app, and it is deliberately thin: it
 * asks `PluginManager` what exists, hands the answer to the pure function, and
 * turns a platform id back into the providers a request should be scoped to.
 *
 * ## Why a platform is a set of providers, not one
 *
 * Two extensions can register the same platform. NetMirror registers `Netflix`,
 * and CNC Verse registers a `Netflix` of its own plus a `NetflixM` beside it
 * `[measured]` — so the Netflix page is a view over however many of those the
 * user has installed and enabled, and a search from that page asks all of them.
 * That is the difference between this and the Android app, where a provider row
 * binds to exactly one provider: here the platform is the destination and the
 * providers behind it are an implementation detail the user did not choose.
 *
 * Note the name collision that follows from it. `PluginManager.providers` is a
 * `Map` keyed on the provider's own name, so when two installed extensions both
 * register `Netflix` the first keeps it and the second is reported through
 * `unavailableReason` — existing behaviour, and correct. The consequence here is
 * that installing a second OTT repository does not double the Netflix page; it
 * adds whichever providers did not collide.
 */
/**
 * Which platforms the user has chosen to see.
 *
 * Stored rather than derived so the choice survives a platform being added to
 * the table: a new one arrives at its own `defaultEnabled` instead of being
 * silently absent because an older stored list did not mention it.
 */
const SETTINGS_KEY_OTT_ENABLED = 'ott_enabled_platforms';

export class OttService {
  private plugins: PluginManager;
  private datastore: DatastoreManager;

  constructor(plugins: PluginManager, datastore: DatastoreManager) {
    this.plugins = plugins;
    this.datastore = datastore;
  }

  /**
   * The platforms shown in the sidebar.
   *
   * Absent from the stored map means "as shipped", not "off" — see the key's
   * comment. The three listed platforms are on as shipped; discovered ones are
   * off until picked.
   */
  public getEnabledPlatformIds(): string[] {
    const stored = this.datastore.getObject<Record<string, boolean>>(
      SETTINGS_KEY_OTT_ENABLED,
      {}
    );
    const listed = OTT_PLATFORMS.filter((platform) =>
      typeof stored?.[platform.id] === 'boolean' ? stored[platform.id] : platform.defaultEnabled
    ).map((platform) => platform.id);
    // Discovered platforms are off until picked, as on Android's home screen
    // where the viewer chooses which provider's catalogue to see.
    const picked = Object.entries(stored ?? {})
      .filter(([id, on]) => id.startsWith(DISCOVERED_PREFIX) && on === true)
      .map(([id]) => id);
    return [...listed, ...picked];
  }

  public setPlatformEnabled(platformId: string, enabled: boolean): string[] {
    const stored = this.datastore.getObject<Record<string, boolean>>(
      SETTINGS_KEY_OTT_ENABLED,
      {}
    );
    this.datastore.setObject(SETTINGS_KEY_OTT_ENABLED, { ...(stored ?? {}), [platformId]: enabled });
    return this.getEnabledPlatformIds();
  }

  /**
   * Many at once — the picker's Select all / Select none. One write and one
   * answer, so a bulk change cannot land half-applied.
   */
  public setPlatformsEnabled(changes: Record<string, boolean>): string[] {
    const stored = this.datastore.getObject<Record<string, boolean>>(
      SETTINGS_KEY_OTT_ENABLED,
      {}
    );
    const next = { ...(stored ?? {}) };
    for (const [id, on] of Object.entries(changes)) {
      if (id && typeof on === 'boolean') next[id] = on;
    }
    this.datastore.setObject(SETTINGS_KEY_OTT_ENABLED, next);
    return this.getEnabledPlatformIds();
  }

  /**
   * Every platform, with what is installed behind it.
   *
   * The three listed platforms always appear, installed or not, so their pages
   * can offer the extension; everything else is discovered from what is
   * installed.
   */
  public async listPlatforms(includeHidden = false): Promise<OttPlatformView[]> {
    const enabledProviders = await this.plugins.listEnabledProviders();
    const shown = new Set(this.getEnabledPlatformIds());
    const views = buildOttPlatformViews({
      allProviders: this.plugins.getProvidersList(),
      enabledProviders,
      providerDetails: this.plugins.getProviders().map((provider) => ({
        name: provider.name,
        pluginName: provider.pluginName || provider.pluginInternalName,
        hasMainPage: provider.hasMainPage,
        supportedTypes: provider.supportedTypes ?? [],
        lang: provider.lang,
      })),
    });
    /*
     * `includeHidden` is for the settings screen, which has to list what is
     * switched off in order to switch it back on. Every other caller gets the
     * user's chosen set — a sidebar that showed the hidden ones would make the
     * setting look broken.
     */
    return includeHidden ? views : views.filter((view) => shown.has(view.id));
  }

  public async getPlatform(platformId: string): Promise<OttPlatformView | null> {
    // Hidden included: a platform reached by its own URL should open, not 404
    // because it is merely absent from the sidebar.
    const platforms = await this.listPlatforms(true);
    return platforms.find((platform) => platform.id === platformId) ?? null;
  }

  /**
   * The providers a request from this platform's page may ask.
   *
   * Enabled only, and never widened. An empty answer is a real answer — the
   * page renders its "nothing installed serves this yet" state from it — and
   * must not be turned into a global search somewhere downstream, which is
   * exactly what `SearchScopeStore.override` refuses to do.
   *
   * Only providers that *are* the platform. There is no fallback to some other
   * extension said to "carry" it: that was a hardcoded claim about third-party
   * scrapers, and it put a general scraper's results under a brand heading.
   */
  public async providersFor(platformId: string): Promise<string[]> {
    const view = await this.getPlatform(platformId);
    return view?.providers ?? [];
  }

  /**
   * What the platform offers to browse.
   *
   * One provider's catalogue, not a merge of several. Upstream rows are the
   * provider's own editorial — "Trending Now", "Recently Added" — and two
   * providers' notions of trending are different lists that would interleave
   * into something neither of them meant. So the first provider that publishes
   * a catalogue wins the browse view, and the rest are still searched.
   */
  public async getCatalog(platformId: string): Promise<ProviderCatalog | null> {
    const providers = await this.providersFor(platformId);
    if (providers.length === 0) return null;

    let firstReason: string | undefined;
    for (const provider of providers) {
      const catalog = await this.plugins.loadCatalog(provider);
      if (catalog.hasMainPage && catalog.sections.length > 0) return catalog;
      firstReason ??= catalog.unavailableReason;
    }

    // Nothing browsable, but the platform is installed and searchable. Reported
    // as the first provider's reason rather than as a failure.
    return {
      provider: providers[0],
      hasMainPage: false,
      sections: [],
      unavailableReason:
        firstReason ?? 'These providers do not publish a catalogue — search them instead.',
    };
  }

  public async getCatalogPage(
    provider: string,
    section: { name: string; data: string; horizontalImages?: boolean },
    page: number
  ): Promise<ProviderCatalogPage> {
    return this.plugins.loadCatalogPage(provider, section, page);
  }

  /**
   * The repositories to offer for a platform nothing can serve yet.
   *
   * Resolved against the shipped catalogue rather than carried as URLs in the
   * platform table, so a repository whose address moves is corrected in one
   * place. A suggested id that no longer exists is dropped silently — it means
   * the catalogue removed a repository, which is not something to report to a
   * user who was only trying to browse.
   */
  public suggestionsFor(platformId: string): Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    rawRepoUrl: string;
    installed: boolean;
  }> {
    const platform = ottPlatformById(platformId);
    if (!platform) return [];

    const installed = new Set(this.plugins.getInstalledRepositories());
    return platform.suggestedRepositories
      .map((id) => OFFICIAL_REPOSITORIES.find((repo) => repo.id === id))
      .filter((repo): repo is NonNullable<typeof repo> => Boolean(repo))
      .map((repo) => ({
        id: repo.id,
        name: repo.name,
        description: repo.description,
        url: repo.url,
        rawRepoUrl: repo.rawRepoUrl,
        installed: installed.has(repo.rawRepoUrl) || installed.has(repo.url),
      }));
  }

  /**
   * Install a suggested repository by id.
   *
   * By id, not by URL, and that is a boundary rather than a convenience: this
   * channel is reachable from the renderer, and taking an arbitrary address
   * here would turn "set up Netflix" into a way to make the app install code
   * from anywhere. Adding a repository by hand is still possible — it is a
   * different, deliberate action on the extensions screen.
   */
  public async installSuggestion(
    platformId: string,
    repositoryId: string
  ): Promise<{ ok: boolean; message: string; installed: number; failed: number }> {
    const platform = ottPlatformById(platformId);
    if (!platform || !platform.suggestedRepositories.includes(repositoryId)) {
      return {
        ok: false,
        message: 'That repository is not one of this platform’s suggestions.',
        installed: 0,
        failed: 0,
      };
    }

    const repo = OFFICIAL_REPOSITORIES.find((entry) => entry.id === repositoryId);
    if (!repo) {
      return { ok: false, message: 'That repository is no longer listed.', installed: 0, failed: 0 };
    }

    await this.plugins.addRepository(repo.rawRepoUrl);
    const result = await this.plugins.installRepository(repo.rawRepoUrl);
    return {
      ok: result.ok,
      message: result.message,
      installed: result.installed,
      failed: result.failed,
    };
  }
}

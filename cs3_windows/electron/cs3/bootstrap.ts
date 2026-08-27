import type { DatastoreManager } from '../datastore';
import type { PluginManager } from '../pluginManager';
import type { SitePlugin } from '../../src/types/plugin';
import { OFFICIAL_REPOSITORIES, type OfficialRepository } from '../officialRepositories';

/**
 * Makes a fresh install work without the user configuring anything.
 *
 * The people this app is for have used Netflix. They have not used a plugin
 * manager, and they should not have to: an app that installs and then shows an
 * empty home screen until you find the extensions tab, add a repository, pick
 * plugins out of a list of eighty and install them one at a time has not
 * shipped a product, it has shipped a construction kit.
 *
 * So the repositories that were verified end-to-end (`tools/e2e/provider-e2e.mjs`)
 * are installed on first launch, in the background, with progress. Every
 * provider they register is enabled by default — the enable list is a
 * *disable* list, so registering is enough.
 *
 * Three rules this obeys, and none of them are negotiable:
 *
 *  - **Adult repositories are never bootstrapped.** They are not installed, not
 *    fetched, and not shown until the user turns adult content on themselves.
 *    See {@link isAdultAllowed}.
 *  - **It runs once.** A user who removes a bundled repository has made a
 *    decision, and re-adding it on next launch would be the app arguing.
 *  - **It never blocks.** Failure means fewer providers, not a broken app;
 *    every outcome is recorded and surfaced rather than thrown.
 */

const KEY_BOOTSTRAP_DONE = 'cs3_bootstrap_completed_version';
const KEY_ADULT_ENABLED = 'cs3_adult_content_enabled';

/**
 * Bumped when the bundled set changes, so an existing install picks up newly
 * verified repositories without re-adding ones the user has since removed —
 * only repositories not seen by a previous run are considered.
 */
/**
 * Bumped when the bundled set changes, so an existing install gets the addition.
 *
 * Safe to bump because `run()` filters targets on
 * `!already.has(repo.rawRepoUrl)`: a repository the user already has is skipped
 * entirely, so a re-run installs only what is new and re-downloads nothing.
 *
 * Version 2 adds **CloudStream X (CSX)**. It was catalogued and unbundled; the
 * flag was set after `tools/e2e/provider-e2e.mjs --repo CSX` drove it end to end
 * — 11 providers loaded, 9 answering, 8 links resolved, 7 streams delivering
 * bytes — which is what `bundled` is a claim about. Two shim gaps it exposed
 * (`CloudStreamApp.setKey` and `AccountManager.simklApi`) were fixed first; see
 * §5 and `RUNTIME_GENERATION`.
 */
const BOOTSTRAP_VERSION = 2;

/**
 * How many plugins are installed per repository on first run.
 *
 * Not all of them. phisher98 alone publishes 80, and installing ~170 archives
 * means ~170 DEX translations before the first search — minutes of CPU on a
 * cold start, for providers the user may never ask about. The rest of every
 * repository stays one click away in the extensions screen.
 */
const PLUGINS_PER_REPOSITORY = 12;

/** Installs run in series per repository; this is how many repositories overlap. */
const REPOSITORY_CONCURRENCY = 2;

/** `NSFW` is upstream's own `TvType`, declared by the plugin in its manifest. */
function isAdultPlugin(plugin: SitePlugin): boolean {
  return (plugin.tvTypes ?? []).some((type) => String(type).toUpperCase() === 'NSFW');
}

export interface BootstrapProgress {
  phase: 'idle' | 'running' | 'done';
  /** Repository currently being worked on. */
  repository?: string;
  installed: number;
  failed: number;
  /** Total plugins this run intends to install, known once lists are fetched. */
  total: number;
  message?: string;
}

export class BootstrapService {
  private datastore: DatastoreManager;
  private plugins: PluginManager;
  private notifier: ((progress: BootstrapProgress) => void) | null = null;
  private progress: BootstrapProgress = { phase: 'idle', installed: 0, failed: 0, total: 0 };
  private running: Promise<void> | null = null;

  constructor(datastore: DatastoreManager, plugins: PluginManager) {
    this.datastore = datastore;
    this.plugins = plugins;
  }

  public setNotifier(notifier: (progress: BootstrapProgress) => void): void {
    this.notifier = notifier;
  }

  public getProgress(): BootstrapProgress {
    return this.progress;
  }

  // --- adult content -------------------------------------------------------

  /**
   * Adult repositories are opt-in, and the opt-in is the only thing that
   * reveals them. Default false, and read fresh every time rather than cached:
   * turning it off must take effect immediately, everywhere.
   */
  public isAdultAllowed(): boolean {
    return this.datastore.getBool(KEY_ADULT_ENABLED, false);
  }

  public setAdultAllowed(enabled: boolean): boolean {
    this.datastore.setBool(KEY_ADULT_ENABLED, enabled);
    return enabled;
  }

  /** The catalogue as this user should see it. */
  public visibleRepositories(): OfficialRepository[] {
    if (this.isAdultAllowed()) return OFFICIAL_REPOSITORIES;
    return OFFICIAL_REPOSITORIES.filter((repo) => !repo.adult);
  }

  // --- first run -----------------------------------------------------------

  /**
   * Installs the bundled set, once. Returns immediately; watch the notifier.
   */
  public start(): void {
    if (this.running) return;

    const completed = this.datastore.getInt(KEY_BOOTSTRAP_DONE, 0);
    if (completed >= BOOTSTRAP_VERSION) {
      this.progress = { phase: 'done', installed: 0, failed: 0, total: 0 };
      return;
    }

    this.running = this.run()
      .catch((error) => {
        // Bootstrap failing is a degraded first run, never a failed launch.
        this.progress.message = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        /**
         * Only a run that achieved something is remembered.
         *
         * A first launch with no network fails every fetch, and marking the
         * bootstrap complete there would mean the user never gets the bundled
         * repositories at all — the single launch they happened to be offline
         * for would permanently decide it. So: installing nothing *because there
         * was nothing to install* completes; installing nothing because
         * everything failed does not, and the next launch tries again.
         *
         * A partial run does complete. Re-running would re-install what already
         * worked in order to retry what did not, and the extensions screen is
         * the right place to pick up stragglers.
         */
        if (this.progress.installed > 0 || this.progress.total === 0) {
          this.datastore.setInt(KEY_BOOTSTRAP_DONE, BOOTSTRAP_VERSION);
        }
        this.progress.phase = 'done';
        this.emit();
        this.running = null;
      });
  }

  private emit(): void {
    this.notifier?.({ ...this.progress });
  }

  private async run(): Promise<void> {
    const already = new Set(this.plugins.getInstalledRepositories());
    const targets = OFFICIAL_REPOSITORIES.filter(
      // `bundled` is the verified set. `adult` is excluded unconditionally —
      // not because of the flag below, but because bootstrapping content the
      // user has not asked for is the one thing that must never happen here.
      (repo) => repo.bundled && !repo.adult && !already.has(repo.rawRepoUrl)
    );

    this.progress = { phase: 'running', installed: 0, failed: 0, total: 0 };
    this.emit();
    if (targets.length === 0) return;

    // Lists first, so `total` is a real denominator from the first update
    // rather than a number that climbs while the bar is already moving.
    const plans: Array<{
      repo: OfficialRepository;
      /**
       * The URL `fetchRepository` actually resolved to, which is what it
       * registered as installed. Stamping plugins with the *requested* URL
       * instead would file them under a repository the app does not consider
       * installed, and the extensions screen would show an orphaned group.
       */
      repositoryUrl: string;
      plugins: Awaited<ReturnType<PluginManager['fetchRepository']>>['plugins'];
    }> = [];

    const allowAdult = this.isAdultAllowed();

    for (const repo of targets) {
      try {
        const fetched = await this.plugins.fetchRepository(repo.rawRepoUrl);
        const usable = fetched.plugins
          .filter((plugin) => plugin?.url && plugin?.internalName)
          // A repository marking its own plugin as down is the best signal
          // available that installing it would waste the user's first minute.
          .filter((plugin) => plugin.status === undefined || plugin.status !== 0)
          /**
           * Adult plugins are not downloaded at all while adult content is off.
           *
           * `PluginManager` already refuses to *offer* an NSFW provider, so this
           * is not the safety mechanism — that one is central and cannot be
           * bypassed. This is about not fetching, translating and storing
           * archives the user has given no indication of wanting. Measured
           * against the catalogue, four repositories publish NSFW-tagged
           * plugins, and one of them is in the bundled set.
           */
          .filter((plugin) => allowAdult || !isAdultPlugin(plugin))
          .slice(0, PLUGINS_PER_REPOSITORY);
        plans.push({ repo, repositoryUrl: fetched.repositoryUrl, plugins: usable });
        this.progress.total += usable.length;
      } catch (error) {
        this.progress.failed += 1;
        this.progress.message = `${repo.name}: ${error instanceof Error ? error.message : String(error)}`;
      }
      this.emit();
    }

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < plans.length) {
        const plan = plans[next++];
        this.progress.repository = plan.repo.name;
        this.emit();

        for (const plugin of plan.plugins) {
          try {
            const result = await this.plugins.installPlugin(plugin, plan.repositoryUrl);
            if (result.ok) this.progress.installed += 1;
            else this.progress.failed += 1;
          } catch {
            this.progress.failed += 1;
          }
          this.emit();
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(REPOSITORY_CONCURRENCY, plans.length) }, worker)
    );

    this.progress.repository = undefined;
  }
}

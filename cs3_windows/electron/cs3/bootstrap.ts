import type { DatastoreManager } from '../datastore';
import { findOfficialRepository, type PluginManager } from '../pluginManager';
import { pickStarterPlugins } from './starterPlugins';
import {
  REGIONS,
  affectedByRemoval,
  normaliseSelection,
  planRegionalSetup,
  suggestRegions,
  type Region,
  type RegionId,
} from './regions';
import { OFFICIAL_REPOSITORIES, type OfficialRepository } from '../officialRepositories';
import { describeError } from '../../src/utils/errors.ts';

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
 * are installed on first launch, in the background, with progress — once the
 * viewer has said which regions their content is from (PRD-54, `regions.ts`),
 * which decides the repositories added and the extensions installed. Every
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
const KEY_ADULT_MODE = 'cs3_adult_content_mode';
/** The viewer's content regions (PRD-54), a JSON array. A datastore key, so backups carry it. */
const KEY_REGIONS = 'cs3_content_regions';
/** Also look in other regions' repositories for extensions in the viewer's languages. Default on. */
const KEY_CROSS_REGION = 'cs3_content_regions_cross';

/**
 * Bumped when the bundled set changes, so an existing install gets the addition.
 *
 * Safe to bump because `run()` filters targets on
 * `!already.has(repo.rawRepoUrl)`: a repository the user already has is skipped
 * entirely, so a re-run installs only what is new and re-downloads nothing — and
 * one the user has since removed is not re-added unless it is new to the set.
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
 * repository stays one click away in the extensions screen. Sixteen rather
 * than the twelve it was, because the slots now go only to providers in the
 * viewer's languages instead of to whatever each index listed first.
 */
const PLUGINS_PER_REPOSITORY = 16;

/** Installs run in series per repository; this is how many repositories overlap. */
const REPOSITORY_CONCURRENCY = 2;

export interface BootstrapProgress {
  /** `needs-regions`: nothing is installed until the viewer has said where their content is from. */
  phase: 'idle' | 'needs-regions' | 'running' | 'done';
  /** Repository currently being worked on. */
  repository?: string;
  installed: number;
  failed: number;
  /** Total plugins this run intends to install, known once lists are fetched. */
  total: number;
  message?: string;
}

export interface RegionState {
  selected: RegionId[];
  /** No selection stored yet: the renderer asks before anything is installed. */
  needsSelection: boolean;
  /** Offered pre-ticked, from the system locale. */
  suggested: RegionId[];
  regions: Region[];
  /** Other regions' repositories are searched for extensions in the selection's languages. */
  crossRegion: boolean;
}

/** An installed catalogue repository that matched only through a region just removed. */
export interface RegionAffectedRepository {
  /** The installed (resolved) URL — the id `setRepositoriesEnabled` takes. */
  url: string;
  name: string;
}

export class BootstrapService {
  private datastore: DatastoreManager;
  /**
   * In memory, never on disk. See `adultMode` — an unlock that survived a
   * restart would make `ask` into `on` with extra steps.
   */
  private adultUnlockedThisSession = false;

  /**
   * Everything that shows or hides adult content must hear about a change the
   * moment it happens, from whichever surface made it — otherwise each screen
   * holds its own copy of one decision and they drift apart.
   */
  private adultListeners = new Set<() => void>();
  private plugins: PluginManager;
  private notifier: ((progress: BootstrapProgress) => void) | null = null;
  private progress: BootstrapProgress = { phase: 'idle', installed: 0, failed: 0, total: 0 };
  private running: Promise<void> | null = null;
  private locale: string | undefined;

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
  public onAdultChange(listener: () => void): () => void {
    this.adultListeners.add(listener);
    return () => this.adultListeners.delete(listener);
  }

  private notifyAdultChange(): void {
    for (const listener of this.adultListeners) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others hearing about it.
      }
    }
  }

  public isAdultAllowed(): boolean {
    const mode = this.adultMode();
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return this.adultUnlockedThisSession;
  }

  /**
   * Three answers, because two could not express the useful middle one.
   *
   * `off` and `on` are what they always were. `ask` keeps adult providers
   * installed and configured but hidden until the viewer asks for them, and the
   * asking lasts **only for this run of the app** — `adultUnlockedThisSession`
   * is deliberately a field and never touches the datastore. A middle setting
   * that quietly persisted its unlock would be `on` with extra steps, which is
   * the opposite of what someone sharing a machine is choosing it for.
   *
   * Migrated from the boolean rather than replacing it: the old key is still
   * read when no mode has been stored, so an existing install that had adult
   * content on keeps it on.
   */
  public adultMode(): 'off' | 'ask' | 'on' {
    const stored = this.datastore.getString(KEY_ADULT_MODE, '');
    if (stored === 'off' || stored === 'ask' || stored === 'on') return stored;
    return this.datastore.getBool(KEY_ADULT_ENABLED, false) ? 'on' : 'off';
  }

  public setAdultMode(mode: 'off' | 'ask' | 'on'): 'off' | 'ask' | 'on' {
    this.datastore.setString(KEY_ADULT_MODE, mode);
    /**
     * The old boolean is kept in step, not abandoned.
     *
     * `cs3_adult_content_enabled` is a datastore key, which means it travels in
     * Android-format backups. Leaving it stale would restore an install whose
     * two records of the same decision disagree — and `ask` maps to `false`
     * there because a backup carries no session.
     */
    this.datastore.setBool(KEY_ADULT_ENABLED, mode === 'on');
    // Switching away from `ask` ends any unlock; switching *to* it starts locked.
    this.adultUnlockedThisSession = false;
    this.notifyAdultChange();
    return mode;
  }

  /**
   * Reveals adult providers for the rest of this run.
   *
   * A no-op unless the mode is `ask`. That guard matters: this is reachable
   * over IPC, and a renderer calling it while the setting is `off` must not be
   * able to turn the gate on — the setting owns that decision and the consent
   * step lives with it.
   */
  public unlockAdultForSession(): boolean {
    if (this.adultMode() !== 'ask') return this.isAdultAllowed();
    this.adultUnlockedThisSession = true;
    this.notifyAdultChange();
    return true;
  }

  public lockAdultForSession(): void {
    this.adultUnlockedThisSession = false;
    this.notifyAdultChange();
  }

  public setAdultAllowed(enabled: boolean): boolean {
    this.setAdultMode(enabled ? 'on' : 'off');
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
   *
   * `locale` is the system's (`app.getLocale()`, which only answers once the
   * app is ready), and decides which languages the starting extensions are in.
   */
  public start(locale?: string): void {
    if (this.running) return;
    this.locale = locale;

    // Nothing is installed before the viewer has said where their content is
    // from — existing installs included, for whom the answer is purely
    // additive because `run()` skips every repository already installed.
    if (this.storedRegions() === null) {
      this.progress = { phase: 'needs-regions', installed: 0, failed: 0, total: 0 };
      this.emit();
      return;
    }

    const completed = this.datastore.getInt(KEY_BOOTSTRAP_DONE, 0);
    if (completed >= BOOTSTRAP_VERSION) {
      this.progress = { phase: 'done', installed: 0, failed: 0, total: 0 };
      return;
    }
    this.launch();
  }

  // --- regions (PRD-54) ----------------------------------------------------

  private storedRegions(): RegionId[] | null {
    const raw = this.datastore.getString(KEY_REGIONS, '');
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? normaliseSelection(parsed.map(String)) : null;
    } catch {
      return null;
    }
  }

  public getRegionState(): RegionState {
    const stored = this.storedRegions();
    const suggested = suggestRegions(this.locale);
    return {
      selected: stored ?? suggested,
      needsSelection: stored === null,
      suggested,
      regions: REGIONS,
      crossRegion: this.datastore.getBool(KEY_CROSS_REGION, true),
    };
  }

  /**
   * Stores a selection and adds what it newly calls for, in the background.
   *
   * Only ever adds: a repository already installed is skipped, so nothing the
   * viewer switched off is switched back on. What a removed region leaves
   * behind is *returned* for review, never disabled here.
   */
  public setRegions(
    selection: readonly string[],
    options: { crossRegion?: boolean } = {}
  ): {
    state: RegionState;
    affected: RegionAffectedRepository[];
  } {
    const next = normaliseSelection(selection);
    if (next.length === 0) throw new Error('Choose at least one region.');
    const before = this.storedRegions() ?? [];
    this.datastore.setString(KEY_REGIONS, JSON.stringify(next));
    if (typeof options.crossRegion === 'boolean') this.datastore.setBool(KEY_CROSS_REGION, options.crossRegion);

    const installed = this.plugins.getInstalledRepositories().flatMap((url) => {
      const entry = findOfficialRepository(url);
      return entry ? [{ ...entry, installedUrl: url }] : [];
    });
    const affected = affectedByRemoval(installed, before, next).map((repo) => ({
      url: repo.installedUrl,
      name: repo.name,
    }));

    this.launch();
    return { state: this.getRegionState(), affected };
  }

  /** One run at a time; a change made while one is in flight runs after it. */
  private launch(): void {
    const previous = this.running ?? Promise.resolve();
    const current: Promise<void> = previous
      .then(() => this.run())
      .catch((error) => {
        // Bootstrap failing is a degraded first run, never a failed launch.
        this.progress.message = describeError(error);
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
        if (this.running === current) this.running = null;
      });
    this.running = current;
  }

  private emit(): void {
    this.notifier?.({ ...this.progress });
  }

  private async run(): Promise<void> {
    const regions = this.storedRegions();
    if (!regions) return;
    // Installed under a resolved URL, catalogued under the raw one: skip both.
    const already = new Set<string>();
    for (const url of this.plugins.getInstalledRepositories()) {
      already.add(url);
      const entry = findOfficialRepository(url);
      if (entry) already.add(entry.rawRepoUrl);
    }
    const allowAdult = this.isAdultAllowed();
    /**
     * PRD-54 §5: which repositories the viewer's regions call for, and which
     * of those to install starter extensions from rather than only add. Adult
     * repositories are added only once adult content is allowed and are never
     * installed from — bootstrapping content nobody asked for is the one thing
     * that must never happen here.
     */
    const plan = planRegionalSetup(OFFICIAL_REPOSITORIES, regions, {
      adultAllowed: allowAdult,
      crossRegion: this.datastore.getBool(KEY_CROSS_REGION, true),
      skip: already,
    });
    const targets = plan.filter((entry) => entry.install);

    this.progress = { phase: 'running', installed: 0, failed: 0, total: 0 };
    this.emit();

    // Added, not installed: the whole catalogue one click away in Extensions.
    for (const entry of plan) {
      if (entry.install) continue;
      this.progress.repository = entry.repo.name;
      this.emit();
      const added = await this.plugins
        .addRepository(entry.repo.rawRepoUrl)
        .catch((error: unknown) => ({ ok: false, message: describeError(error) }));
      if (!added.ok) this.progress.message = `${entry.repo.name}: ${added.message}`;
    }
    this.progress.repository = undefined;
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

    for (const { repo, languages, reason } of targets) {
      try {
        const fetched = await this.plugins.fetchRepository(repo.rawRepoUrl);
        /**
         * The viewer's languages, working ones first, nothing marked down —
         * see `starterPlugins.ts`.
         *
         * Adult plugins are not downloaded at all while adult content is off.
         * `PluginManager` already refuses to *offer* an NSFW provider, so that
         * is not the safety mechanism — that one is central and cannot be
         * bypassed. This is about not fetching, translating and storing
         * archives the user has given no indication of wanting.
         */
        const usable = pickStarterPlugins(fetched.plugins, {
          languages: languages ?? [],
          anyLanguage: languages === null,
          strictLanguage: reason === 'language',
          allowAdult,
          limit: PLUGINS_PER_REPOSITORY,
        });
        // Another region's repository is kept only for what it had in the
        // viewer's languages. `fetchRepository` has already recorded it, and
        // nothing was installed from it before this run (installed ones are
        // skipped), so removing it touches nothing of the viewer's.
        if (reason === 'language' && usable.length === 0) {
          this.plugins.removeRepository(fetched.repositoryUrl);
          continue;
        }
        plans.push({ repo, repositoryUrl: fetched.repositoryUrl, plugins: usable });
        this.progress.total += usable.length;
      } catch (error) {
        // A repository only being searched in passing is not a failure of the run.
        if (reason === 'language') continue;
        this.progress.failed += 1;
        this.progress.message = `${repo.name}: ${describeError(error)}`;
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

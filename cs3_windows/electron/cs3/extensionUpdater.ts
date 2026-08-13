import type { SitePlugin } from '../../src/types/plugin';
import type { DatastoreManager } from '../datastore';
import type { PluginManager } from '../pluginManager';

/**
 * Over-the-air updates for installed extensions.
 *
 * Extensions are maintained by their original Android authors and change on
 * their schedule, not the app's. Shipping a new desktop build every time a
 * provider fixes a scraper would be absurd, so extension updates are decoupled
 * from app updates entirely: the catalogue is re-fetched from each repository,
 * versions are compared, and only changed archives are downloaded — into the
 * user's own data directory, never into the installed program files.
 *
 * The result is that a provider fix published upstream reaches the user without
 * anyone reinstalling anything.
 */

export interface AvailableUpdate {
  internalName: string;
  name: string;
  installedVersion: number;
  availableVersion: number;
  repositoryUrl: string;
  downloadUrl: string;
  fileSize?: number;
  /** Author-supplied notes, when the repository carries them. */
  description?: string;
}

export interface UpdateCheckResult {
  checkedAt: number;
  updates: AvailableUpdate[];
  /** Repositories that could not be reached; their plugins are simply unchanged. */
  warnings: string[];
  repositoriesChecked: number;
}

export interface UpdateOutcome {
  internalName: string;
  ok: boolean;
  fromVersion?: number;
  toVersion?: number;
  message: string;
}

export type UpdatePolicy = 'manual' | 'daily' | 'startup';

export interface UpdateSettings {
  policy: UpdatePolicy;
  /** Download and install automatically, versus only notifying. */
  autoInstall: boolean;
  lastCheckedAt: number;
  lastResult?: { updateCount: number; installed: number; failed: number };
}

const SETTINGS_KEY = 'extension_update_settings';
const CACHED_UPDATES_KEY = 'extension_available_updates';
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long after launch the startup/daily check runs, so it never competes with first paint. */
const STARTUP_DELAY_MS = 30_000;

export class ExtensionUpdater {
  private datastore: DatastoreManager;
  private plugins: PluginManager;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<UpdateCheckResult> | null = null;
  private notify: ((event: string, payload: unknown) => void) | null = null;

  constructor(datastore: DatastoreManager, plugins: PluginManager) {
    this.datastore = datastore;
    this.plugins = plugins;
  }

  /** Renderer notification sink, so the UI can show progress without polling. */
  public setNotifier(notify: (event: string, payload: unknown) => void): void {
    this.notify = notify;
  }

  private emit(event: string, payload: unknown): void {
    try {
      this.notify?.(event, payload);
    } catch {
      // A dead renderer must not break an update that is otherwise fine.
    }
  }

  // --- settings ------------------------------------------------------------

  public getSettings(): UpdateSettings {
    const stored = this.datastore.getObject<Partial<UpdateSettings>>(SETTINGS_KEY, {});
    const validPolicies: UpdatePolicy[] = ['manual', 'daily', 'startup'];
    const policy: UpdatePolicy =
      stored?.policy && validPolicies.includes(stored.policy as UpdatePolicy)
        ? (stored.policy as UpdatePolicy)
        : 'daily';
    return {
      policy,
      // Defaults to notify-only. Installed extensions execute code the user
      // chose to trust at a specific version; silently swapping that for a new
      // version without asking is a decision the user should make, not a
      // default. Turning it on is one click.
      autoInstall: stored?.autoInstall ?? false,
      lastCheckedAt: stored?.lastCheckedAt ?? 0,
      lastResult: stored?.lastResult,
    };
  }

  public saveSettings(patch: Partial<UpdateSettings>): UpdateSettings {
    const next = { ...this.getSettings(), ...patch };
    this.datastore.setObject(SETTINGS_KEY, next);
    this.schedule();
    return next;
  }

  public getCachedUpdates(): AvailableUpdate[] {
    const cached = this.datastore.getObject<AvailableUpdate[]>(CACHED_UPDATES_KEY, []);
    return Array.isArray(cached) ? cached : [];
  }

  // --- scheduling ----------------------------------------------------------

  /**
   * Arms the automatic check according to the current policy.
   *
   * Safe to call repeatedly; each call replaces any existing timer, so changing
   * the policy in Settings takes effect immediately rather than at next launch.
   */
  public schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const settings = this.getSettings();
    if (settings.policy === 'manual') return;

    if (settings.policy === 'startup') {
      this.timer = setTimeout(() => this.runScheduledCheck(), STARTUP_DELAY_MS);
      this.timer.unref?.();
      return;
    }

    // Daily: catch up immediately if a day has already elapsed while the app was
    // closed, otherwise wait out the remainder. A desktop app is not running at
    // a fixed hour, so "daily" has to mean "at most 24h since the last check".
    const elapsed = Date.now() - settings.lastCheckedAt;
    const delay = elapsed >= DAY_MS ? STARTUP_DELAY_MS : Math.max(STARTUP_DELAY_MS, DAY_MS - elapsed);
    this.timer = setTimeout(() => this.runScheduledCheck(), delay);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async runScheduledCheck(): Promise<void> {
    try {
      const result = await this.checkForUpdates();
      const settings = this.getSettings();

      if (settings.autoInstall && result.updates.length > 0) {
        const outcomes = await this.updateAll(result.updates.map((u) => u.internalName));
        this.emit('extension:autoUpdateCompleted', { result, outcomes });
      } else if (result.updates.length > 0) {
        this.emit('extension:updatesAvailable', result);
      }
    } catch (error) {
      // A failed background check is not worth interrupting the user over; the
      // next tick retries, and a manual check surfaces the error directly.
      console.warn('Scheduled extension update check failed:', error);
    } finally {
      // Re-arm regardless of outcome, or one transient network failure would
      // silently end automatic updates for the rest of the session.
      this.schedule();
    }
  }

  // --- checking ------------------------------------------------------------

  /**
   * Re-fetches every installed repository and reports which installed plugins
   * have a newer version upstream.
   *
   * Concurrent callers share one in-flight check: the scheduled tick and a user
   * pressing "Check for updates" at the same moment should not fetch every
   * repository twice.
   */
  public async checkForUpdates(): Promise<UpdateCheckResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doCheck(): Promise<UpdateCheckResult> {
    const repoUrls = this.plugins.getInstalledRepositories();
    const installed = new Map(
      this.plugins.getInstalledPluginRecords().map((p) => [p.internalName, p])
    );

    const warnings: string[] = [];
    // internalName -> best candidate seen, so a plugin present in two
    // repositories resolves to the highest version rather than to whichever
    // repository happened to be fetched last.
    const candidates = new Map<string, AvailableUpdate>();

    this.emit('extension:updateCheckStarted', { repositories: repoUrls.length });

    const fetched = await Promise.allSettled(
      repoUrls.map((url) => this.plugins.fetchRepository(url))
    );

    fetched.forEach((outcome, index) => {
      const repoUrl = repoUrls[index];
      if (outcome.status === 'rejected') {
        warnings.push(
          `${repoUrl} could not be checked: ${
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
          }`
        );
        return;
      }
      warnings.push(...outcome.value.warnings);

      for (const remote of outcome.value.plugins) {
        const local = installed.get(remote.internalName);
        if (!local) continue;

        const remoteVersion = Number(remote.version ?? 0);
        const localVersion = Number(local.version ?? 0);
        if (!Number.isFinite(remoteVersion) || remoteVersion <= localVersion) continue;

        const existing = candidates.get(remote.internalName);
        if (existing && existing.availableVersion >= remoteVersion) continue;

        candidates.set(remote.internalName, {
          internalName: remote.internalName,
          name: remote.name ?? remote.internalName,
          installedVersion: localVersion,
          availableVersion: remoteVersion,
          repositoryUrl: repoUrl,
          downloadUrl: remote.url,
          fileSize: remote.fileSize,
          description: remote.description,
        });
      }
    });

    const updates = [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name));
    const result: UpdateCheckResult = {
      checkedAt: Date.now(),
      updates,
      warnings,
      repositoriesChecked: repoUrls.length,
    };

    this.datastore.setObject(CACHED_UPDATES_KEY, updates);
    this.saveSettings({ lastCheckedAt: result.checkedAt });
    this.emit('extension:updateCheckFinished', result);
    return result;
  }

  // --- applying ------------------------------------------------------------

  /**
   * Updates one extension in place.
   *
   * Delegates to the normal install path, which downloads, verifies the
   * publisher's SHA-256, writes to a temp file and atomically renames. That
   * matters more for an update than for a first install: a half-written archive
   * would replace a working extension with a broken one.
   */
  public async updatePlugin(internalName: string): Promise<UpdateOutcome> {
    const update = this.getCachedUpdates().find((u) => u.internalName === internalName);
    if (!update) {
      return {
        internalName,
        ok: false,
        message: 'No update is known for this extension. Check for updates first.',
      };
    }

    this.emit('extension:updateStarted', { internalName, name: update.name });

    const plugin: SitePlugin = {
      url: update.downloadUrl,
      status: 1,
      version: update.availableVersion,
      name: update.name,
      internalName: update.internalName,
      repositoryUrl: update.repositoryUrl,
      fileSize: update.fileSize,
      description: update.description,
    };

    // Re-resolve against the live repository so the hash is the one the
    // publisher currently advertises. A cached hash from an earlier check could
    // be stale if the author republished, and a stale hash fails the very
    // verification it exists to perform.
    try {
      const repo = await this.plugins.fetchRepository(update.repositoryUrl);
      const fresh = repo.plugins.find((p) => p.internalName === internalName);
      if (fresh) {
        plugin.fileHash = fresh.fileHash;
        plugin.url = fresh.url;
        plugin.version = Number(fresh.version ?? update.availableVersion);
      }
    } catch {
      // Proceed without a hash rather than blocking the update; the install path
      // treats an absent hash as "publisher did not supply one", as on install.
    }

    const outcome = await this.plugins.installPlugin(plugin, update.repositoryUrl);

    if (outcome.ok) {
      this.dropCachedUpdate(internalName);
    }

    const result: UpdateOutcome = {
      internalName,
      ok: outcome.ok,
      fromVersion: update.installedVersion,
      toVersion: outcome.ok ? plugin.version : undefined,
      message: outcome.ok
        ? `${update.name} updated from v${update.installedVersion} to v${plugin.version}.`
        : outcome.message,
    };
    this.emit('extension:updateFinished', result);
    return result;
  }

  /**
   * Updates several extensions, one at a time.
   *
   * Sequential on purpose. Parallel downloads would hammer a single repository
   * host, and an update that fails partway through is much easier to reason
   * about when only one archive was in flight.
   */
  public async updateAll(internalNames?: string[]): Promise<UpdateOutcome[]> {
    const targets = internalNames ?? this.getCachedUpdates().map((u) => u.internalName);
    const outcomes: UpdateOutcome[] = [];

    for (let i = 0; i < targets.length; i++) {
      this.emit('extension:updateProgress', {
        current: i + 1,
        total: targets.length,
        internalName: targets[i],
      });
      outcomes.push(await this.updatePlugin(targets[i]));
    }

    const installed = outcomes.filter((o) => o.ok).length;
    this.saveSettings({
      lastResult: {
        updateCount: targets.length,
        installed,
        failed: targets.length - installed,
      },
    });
    return outcomes;
  }

  private dropCachedUpdate(internalName: string): void {
    this.datastore.setObject(
      CACHED_UPDATES_KEY,
      this.getCachedUpdates().filter((u) => u.internalName !== internalName)
    );
  }
}

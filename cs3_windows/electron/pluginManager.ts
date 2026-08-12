import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import type { SitePlugin, PluginData, PluginCompatibilityReport } from '../src/types/plugin';
import type { SearchResponse, LoadResponse, ExtractorLink } from '../src/types/api';
import { PluginCompatibilityAnalyzer } from './pluginAnalyzer';
import { fetchBuffer, fetchJson } from './torrent/http';
import type { DatastoreManager } from './datastore';
import { SidecarSupervisor } from './cs3/sidecarSupervisor';

/**
 * CloudStream extension (`.cs3`) repository and install management.
 *
 * Discovers repositories, parses CloudStream's real repository contract,
 * downloads and SHA-256-verifies `.cs3` archives, records them using Android's
 * install-path grammar, and hands each one to the JVM sidecar to be translated
 * from DEX to JVM bytecode and classified (`docs/PRD/31`).
 *
 * **What still gates execution.** Translation and analysis work today; running a
 * provider additionally needs `library-jvm.jar`, the upstream provider API,
 * which is published only through JitPack and so is fetched at build time. When
 * it is absent the sidecar says exactly that and every plugin is reported as
 * blocked, naming the missing types.
 *
 * That directness is deliberate. An earlier implementation registered each
 * installed plugin as a fake provider backed by a metadata API and a hardcoded
 * demo video, which made a non-functional extension system look operational.
 */

/** Repository JSON as defined by `RepositoryManager.kt:34-40`. */
interface RepositoryJson {
  iconUrl?: string;
  name: string;
  description?: string;
  manifestVersion?: number;
  /** URLs of plugin-list JSON files — **not** inline plugin objects. */
  pluginLists: string[];
}

export interface RepositoryFetchResult {
  repositoryUrl: string;
  name: string;
  description?: string;
  iconUrl?: string;
  plugins: SitePlugin[];
  /** Non-fatal problems worth showing the user (a dead plugin-list URL, say). */
  warnings: string[];
}

/** What the sidecar reports back about a translated archive. */
export interface PluginRuntimeReport {
  tier: string;
  reason: string;
  translated: boolean;
  classCount?: number;
  dexCount?: number;
  entryClass?: string;
  unresolvedCritical?: string[];
  unresolvedAndroid?: string[];
  failureKind?: string;
}

export class PluginManager {
  private pluginsDir: string;
  private analyzer = new PluginCompatibilityAnalyzer();
  private datastore: DatastoreManager;
  private sidecar: SidecarSupervisor;

  private installedRepoUrls = new Set<string>();
  private installedPlugins = new Map<string, PluginData & { meta: SitePlugin }>();
  private runtimeReports = new Map<string, PluginRuntimeReport>();

  constructor(datastore: DatastoreManager, sidecar?: SidecarSupervisor) {
    this.datastore = datastore;
    this.sidecar = sidecar ?? new SidecarSupervisor();
    this.pluginsDir = app
      ? path.join(app.getPath('userData'), 'extensions')
      : path.join(process.cwd(), 'extensions');
    fs.mkdirSync(this.pluginsDir, { recursive: true });
    this.restore();
  }

  private restore(): void {
    const repos = this.datastore.getObject<string[]>('installed_repositories_urls', []);
    if (Array.isArray(repos)) for (const url of repos) this.installedRepoUrls.add(url);

    const plugins = this.datastore.getObject<Array<PluginData & { meta: SitePlugin }>>(
      'installed_plugins_list',
      []
    );
    if (Array.isArray(plugins)) {
      for (const plugin of plugins) {
        if (plugin?.internalName) this.installedPlugins.set(plugin.internalName, plugin);
      }
    }
  }

  private persist(): void {
    this.datastore.setObject('installed_repositories_urls', [...this.installedRepoUrls]);
    this.datastore.setObject('installed_plugins_list', [...this.installedPlugins.values()]);
  }

  // --- install path grammar ------------------------------------------------

  /**
   * Reproduces Android's `sanitizeFilename` + `hashCode` install path so an
   * install tree is recognisable across platforms:
   *   `<extensions>/<sanitize(repoUrl)>.<hash(repoUrl)>/<sanitize(name)>.<hash(name)>.cs3`
   * (`PluginManager.kt` / doc 27 §1.3.)
   */
  private static sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '').trim();
  }

  /** Java `String.hashCode()` — 32-bit signed with wraparound. */
  private static javaHashCode(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = Math.imul(31, hash) + input.charCodeAt(i);
      hash |= 0; // force 32-bit signed overflow, exactly as the JVM does
    }
    return hash;
  }

  private installPathFor(repoUrl: string, internalName: string): string {
    const repoDir = `${PluginManager.sanitize(repoUrl)}.${PluginManager.javaHashCode(repoUrl)}`;
    const file = `${PluginManager.sanitize(internalName)}.${PluginManager.javaHashCode(internalName)}.cs3`;
    return path.join(this.pluginsDir, repoDir, file);
  }

  // --- repositories --------------------------------------------------------

  /**
   * Fetches a repository and every plugin list it references.
   *
   * The previous implementation treated `pluginLists` as an array of plugin
   * objects; it is an array of **URLs** to plugin-list documents
   * (`RepositoryManager.kt:39,185-190`), so no real plugin metadata was ever
   * retrieved.
   */
  public async fetchRepository(repoUrl: string): Promise<RepositoryFetchResult> {
    const warnings: string[] = [];
    const repo = await fetchJson<RepositoryJson | SitePlugin[]>(repoUrl, { timeoutMs: 15_000 });

    // Some repositories publish the plugin array directly instead of wrapping it
    // in a repo.json with `pluginLists` — CSX is one. Both are in the wild and
    // both are worth accepting; rejecting the bare array would drop a working
    // repository for a purely cosmetic difference.
    if (Array.isArray(repo)) {
      const plugins = repo.filter((p) => p?.internalName && p.url);
      if (plugins.length !== repo.length) {
        warnings.push(`${repo.length - plugins.length} entries lacked an internalName or url.`);
      }
      this.installedRepoUrls.add(repoUrl);
      this.persist();
      return {
        repositoryUrl: repoUrl,
        name: 'Plugin list',
        description: 'This URL is a plugin list rather than a repository document.',
        plugins,
        warnings,
      };
    }

    if (!repo || typeof repo !== 'object' || !Array.isArray(repo.pluginLists)) {
      throw new Error(
        'Not a CloudStream repository: the document is neither a plugin array nor an object with a "pluginLists" array.'
      );
    }

    const lists = await Promise.allSettled(
      repo.pluginLists.map((listUrl) =>
        fetchJson<SitePlugin[]>(listUrl, { timeoutMs: 15_000 })
      )
    );

    const plugins: SitePlugin[] = [];
    lists.forEach((result, index) => {
      if (result.status === 'rejected') {
        warnings.push(
          `Plugin list ${repo.pluginLists[index]} could not be read: ${
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          }`
        );
        return;
      }
      if (!Array.isArray(result.value)) {
        warnings.push(`Plugin list ${repo.pluginLists[index]} was not a JSON array.`);
        return;
      }
      for (const plugin of result.value) {
        if (plugin?.internalName && plugin.url) plugins.push(plugin);
      }
    });

    this.installedRepoUrls.add(repoUrl);
    this.persist();

    return {
      repositoryUrl: repoUrl,
      name: repo.name || 'Unnamed repository',
      description: repo.description,
      iconUrl: repo.iconUrl,
      plugins,
      warnings,
    };
  }

  public getInstalledRepositories(): string[] {
    return [...this.installedRepoUrls];
  }

  public removeRepository(repoUrl: string): void {
    this.installedRepoUrls.delete(repoUrl);
    this.persist();
  }

  // --- plugin install ------------------------------------------------------

  /**
   * Downloads and verifies a `.cs3`, then records it.
   *
   * Verification follows Android: when the repository supplies `fileHash`, a
   * SHA-256 mismatch aborts the install and deletes the temporary file. The
   * archive is written to a temp path and atomically renamed so an interrupted
   * download can never leave a loadable partial plugin.
   */
  public async installPlugin(
    plugin: SitePlugin,
    repositoryUrl?: string
  ): Promise<{ ok: boolean; message: string; report?: PluginCompatibilityReport }> {
    if (!plugin.url) return { ok: false, message: 'Plugin has no download URL.' };

    const repoUrl = repositoryUrl ?? plugin.repositoryUrl ?? 'unknown-repository';
    const target = this.installPathFor(repoUrl, plugin.internalName);
    const tempPath = `${target}.tmp`;

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });

      const buffer = await fetchBuffer(plugin.url, { timeoutMs: 60_000 });
      const digest = crypto.createHash('sha256').update(buffer).digest('hex');

      if (plugin.fileHash) {
        const expected = plugin.fileHash.replace(/^sha256-/i, '').toLowerCase();
        if (expected !== digest) {
          return {
            ok: false,
            message: `SHA-256 mismatch — the download does not match the hash the repository published. Install aborted.`,
          };
        }
      }

      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, target);

      const report = this.analyzer.analyzePlugin(plugin.name, plugin.internalName, target);

      this.installedPlugins.set(plugin.internalName, {
        internalName: plugin.internalName,
        url: plugin.url,
        isOnline: true,
        filePath: target,
        version: plugin.version ?? 1,
        tier: report.recommendedTier,
        isEnabled: true,
        meta: plugin,
      });
      this.persist();

      // Translate and classify now rather than on first use: DROP-2 requires
      // translation to happen once at install time, and a plugin's tier has to
      // be known before the user is told whether it works.
      const runtime = await this.inspect(plugin.internalName, target);

      return {
        ok: true,
        report,
        message: runtime
          ? `${plugin.name} installed and verified. ${runtime.reason}`
          : `${plugin.name} installed and verified. The extension runtime is unavailable, so it could not be analysed.`,
      };
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // Best effort; a stale .tmp is harmless because it is never loaded.
      }
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public uninstallPlugin(internalName: string): boolean {
    const record = this.installedPlugins.get(internalName);
    if (!record) return false;

    try {
      if (record.filePath && fs.existsSync(record.filePath)) fs.unlinkSync(record.filePath);
    } catch {
      // Removing the record matters more than removing the file.
    }
    this.installedPlugins.delete(internalName);
    this.persist();
    return true;
  }

  public getInstalledPlugins(): SitePlugin[] {
    return [...this.installedPlugins.values()].map((p) => p.meta);
  }

  public analyzePlugin(plugin: SitePlugin): PluginCompatibilityReport {
    const record = this.installedPlugins.get(plugin.internalName);
    return this.analyzer.analyzePlugin(
      plugin.name,
      plugin.internalName,
      record?.filePath ?? plugin.url
    );
  }

  // --- runtime -------------------------------------------------------------

  /**
   * Asks the sidecar to translate and classify an installed archive.
   *
   * Returns `null` only when the sidecar itself is unreachable, which is a
   * different condition from "the plugin does not work" and is reported
   * differently to the user (DROP-34).
   */
  public async inspect(internalName: string, filePath: string): Promise<PluginRuntimeReport | null> {
    const started = await this.sidecar.ensureStarted();
    if (!started) return null;

    const response = await this.sidecar.call('inspect', { pluginId: internalName, path: filePath });
    if (!response.ok) {
      const report: PluginRuntimeReport = {
        tier: 'T4_BLOCKED',
        reason: response.error ?? 'The extension runtime could not analyse this plugin.',
        translated: false,
        failureKind: response.errorKind,
      };
      this.runtimeReports.set(internalName, report);
      return report;
    }

    const r = response.result ?? {};
    const report: PluginRuntimeReport = {
      tier: String(r.tier ?? 'T4_BLOCKED'),
      reason: String(r.reason ?? ''),
      translated: Boolean(r.translated),
      classCount: typeof r.classCount === 'number' ? r.classCount : undefined,
      dexCount: typeof r.dexCount === 'number' ? r.dexCount : undefined,
      entryClass: r.entryClass ? String(r.entryClass) : undefined,
      unresolvedCritical: Array.isArray(r.unresolvedCritical)
        ? (r.unresolvedCritical as string[])
        : undefined,
      unresolvedAndroid: Array.isArray(r.unresolvedAndroid)
        ? (r.unresolvedAndroid as string[])
        : undefined,
      failureKind: r.failureKind ? String(r.failureKind) : undefined,
    };
    this.runtimeReports.set(internalName, report);
    return report;
  }

  public getRuntimeReport(internalName: string): PluginRuntimeReport | null {
    return this.runtimeReports.get(internalName) ?? null;
  }

  /**
   * Whether any installed plugin can actually execute.
   *
   * Requires both a live sidecar and the provider API on its classpath; either
   * one alone is not enough, and the UI is told which is missing.
   */
  public async getRuntimeStatus(): Promise<{
    available: boolean;
    installedCount: number;
    reason: string;
    javaVersion?: string;
    sandboxGaps: string[];
  }> {
    const status = await this.sidecar.status();
    return {
      available: status.running && status.canExecute,
      installedCount: this.installedPlugins.size,
      reason: status.running
        ? status.canExecute
          ? 'The extension runtime is running and can execute installed extensions.'
          : (status.reason ??
            'The extension runtime is running but the CloudStream provider API is not on its classpath, so extensions cannot be executed.')
        : (status.reason ?? 'The extension runtime is not available.'),
      javaVersion: status.javaVersion,
      sandboxGaps: status.sandboxGaps,
    };
  }

  public shutdown(): void {
    this.sidecar.stop();
  }

  public getProvidersList(): string[] {
    return [];
  }

  /**
   * Provider-backed search.
   *
   * Still returns nothing: dispatching `search` into a loaded provider needs the
   * provider API on the sidecar classpath, and the coroutine bridge that calls a
   * Kotlin `suspend` function reflectively. Returning an empty list here is
   * accurate — no provider is loaded — and `getRuntimeStatus` carries the reason
   * so the UI never presents this as "no results found".
   */
  public async searchAll(_query: string): Promise<SearchResponse[]> {
    return [];
  }

  public async loadMedia(_url: string): Promise<LoadResponse | null> {
    return null;
  }

  public async loadLinks(_url: string): Promise<ExtractorLink[]> {
    return [];
  }
}

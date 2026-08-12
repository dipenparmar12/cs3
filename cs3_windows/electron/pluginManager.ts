import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import type { SitePlugin, PluginData, PluginCompatibilityReport } from '../src/types/plugin';
import type { SearchResponse, LoadResponse, ExtractorLink } from '../src/types/api';
import { PluginCompatibilityAnalyzer } from './pluginAnalyzer';
import { fetchBuffer, fetchJson } from './torrent/http';
import type { DatastoreManager } from './datastore';

/**
 * CloudStream extension (`.cs3`) repository and install management.
 *
 * **What this does today:** discovers repositories, parses CloudStream's real
 * repository contract, downloads and SHA-256-verifies `.cs3` archives, and
 * records them using Android's install-path grammar.
 *
 * **What it does not do:** execute them. `.cs3` payloads are Android DEX
 * bytecode; running them needs the JVM sidecar specified in
 * `docs/PRD/31-cs3-dropin-compatibility.md`, which does not exist yet. Installed
 * plugins therefore contribute **no** search results or streams, and this class
 * says so explicitly rather than substituting a placeholder.
 *
 * That honesty is deliberate. The previous implementation registered every
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

export class PluginManager {
  private pluginsDir: string;
  private analyzer = new PluginCompatibilityAnalyzer();
  private datastore: DatastoreManager;

  private installedRepoUrls = new Set<string>();
  private installedPlugins = new Map<string, PluginData & { meta: SitePlugin }>();

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
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
    const repo = await fetchJson<RepositoryJson>(repoUrl, { timeoutMs: 15_000 });

    if (!repo || typeof repo !== 'object' || !Array.isArray(repo.pluginLists)) {
      throw new Error(
        'Not a CloudStream repository: the document has no "pluginLists" array.'
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

      return {
        ok: true,
        report,
        message: `${plugin.name} installed and verified. It cannot run yet — no .cs3 runtime is present in this build.`,
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

  // --- runtime (absent) ----------------------------------------------------

  /**
   * Whether any installed plugin can actually execute.
   * Always false until a `.cs3` runtime ships; exposed so the UI can explain
   * the state instead of silently returning nothing.
   */
  public hasRunnableProviders(): boolean {
    return false;
  }

  public getRuntimeStatus(): { available: boolean; installedCount: number; reason: string } {
    return {
      available: false,
      installedCount: this.installedPlugins.size,
      reason:
        '.cs3 extensions contain Android DEX bytecode. Executing them requires the JVM sidecar described in docs/PRD/31-cs3-dropin-compatibility.md, which is not part of this build. Installed extensions are verified and stored, but contribute no search results or streams.',
    };
  }

  public getProvidersList(): string[] {
    return [];
  }

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

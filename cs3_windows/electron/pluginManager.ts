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

/** One provider an installed extension registered when it loaded. */
export interface ExtensionProvider {
  /** The provider's own name, and how it is addressed in every RPC. */
  name: string;
  /** Which `.cs3` registered it — one archive commonly registers several. */
  pluginInternalName: string;
  pluginName: string;
  mainUrl?: string;
  lang?: string;
  hasMainPage: boolean;
  hasQuickSearch: boolean;
  supportedTypes: string[];
}

/** One node of the repository → extension → provider tree. */
export interface ProviderTreeRepository {
  url: string;
  name: string;
  extensions: Array<{
    internalName: string;
    name: string;
    language?: string;
    providers: Array<{ name: string; lang?: string; supportedTypes: string[] }>;
  }>;
}

/**
 * A readable name for a repository we only know by URL.
 *
 * Repository documents carry a `name`, but it is not retained past the install
 * — the plugin records keep the URL and nothing else. The owner/repo segment of
 * a GitHub raw URL is what the user recognises anyway, and is far better than
 * showing them a 90-character raw.githubusercontent.com link.
 */
function repositoryLabel(url: string): string {
  if (!url) return 'Sideloaded';
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname.includes('github') && segments.length >= 2) {
      return `${segments[0]}/${segments[1]}`;
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

const SETTINGS_KEY_DISABLED_PROVIDERS = 'cs3_disabled_providers';

/**
 * Provider calls are network-bound scrapes of third-party sites, routinely
 * slower than an API call and occasionally very slow. The sidecar applies its
 * own shorter deadline inside this one so a hung provider is named rather than
 * merely timing out.
 */
const PROVIDER_CALL_TIMEOUT_MS = 60_000;

/** `cs3ext://<provider>/<opaque handle>` — see `searchAll` for why. */
function buildExtensionUrl(provider: string, target: string): string {
  return `cs3ext://${encodeURIComponent(provider)}/${encodeURIComponent(target)}`;
}

export function parseExtensionUrl(
  url: string
): { provider: string; target: string } | null {
  if (!url.startsWith('cs3ext://')) return null;
  const rest = url.slice('cs3ext://'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return {
    provider: decodeURIComponent(rest.slice(0, slash)),
    target: decodeURIComponent(rest.slice(slash + 1)),
  };
}

/**
 * Branch and filename combinations community repositories actually publish to.
 *
 * There is no convention here, only practice. Measured against the repositories
 * this app ships in its own list: recloudstream/extensions and
 * Bnyro/GermanProviders serve `master/repo.json`,
 * phisher98/cloudstream-extensions-phisher serves `builds/repo.json`, and
 * SaurabhKaperwan/CSX serves `builds/plugins.json` as a bare plugin array.
 * Guessing one shape would have covered a third of them.
 */
const REPO_BRANCHES = ['master', 'main', 'builds', 'refs/heads/main', 'refs/heads/master'];
const REPO_FILENAMES = ['repo.json', 'plugins.json', 'repos.json', 'repo', 'CS.json', 'builds/repo.json', 'builds/plugins.json'];

/**
 * Known mapping of legacy or incorrect owner/repo pairs to their canonical repository location.
 * Legacy Android configurations and community links commonly assumed every repository lived
 * under `recloudstream` on a `builds` branch; this mapping resolves them to their true owner.
 */
const KNOWN_OWNER_MAP = new Map<string, { owner: string; repo: string }>([
  ['recloudstream/megarepo', { owner: 'self-similarity', repo: 'MegaRepo' }],
  ['recloudstream/aniyomicompatextension', { owner: 'CranberrySoup', repo: 'AniyomiCompatExtension' }],
  ['recloudstream/germanproviders', { owner: 'Bnyro', repo: 'GermanProviders' }],
  ['recloudstream/italialnstreaming', { owner: 'DieGon7771', repo: 'ItaliaInStreaming' }],
  ['recloudstream/italiainstreaming', { owner: 'DieGon7771', repo: 'ItaliaInStreaming' }],
  ['recloudstream/re-3arabi', { owner: 'Abodabodd', repo: 're-3arabi' }],
  ['recloudstream/storm-ext', { owner: 'redblacker8', repo: 'storm-ext' }],
  ['recloudstream/csx', { owner: 'SaurabhKaperwan', repo: 'CSX' }],
  ['recloudstream/cuxplug', { owner: 'ycngmn', repo: 'CuxPlug' }],
  ['recloudstream/indostream', { owner: 'TeKuma25', repo: 'IndoStream' }],
  ['recloudstream/luna712-cloudstream-extensions', { owner: 'Luna712', repo: 'Luna712-CloudStream-Extensions' }],
  ['recloudstream/cartoonyrepo', { owner: 'med1245', repo: 'cartoonyrepo' }],
  ['recloudstream/cinephile', { owner: 'rockhero1234', repo: 'cinephile' }],
  ['recloudstream/redowan-cloudstream', { owner: 'redowan99', repo: 'Redowan-CloudStream' }],
  ['recloudstream/cloudstream-extensions-uk', { owner: 'CakesTwix', repo: 'cloudstream-extensions-uk' }],
  ['recloudstream/reflexrepo', { owner: 'Reflex755', repo: 'ReflexRepo' }],
  ['recloudstream/pitipitii', { owner: 'sarapcanagii', repo: 'Pitipitii' }],
  ['recloudstream/cs-karma', { owner: 'Kraptor123', repo: 'cs-Karma' }],
  ['recloudstream/cs-kraptor', { owner: 'Kraptor123', repo: 'cs-kraptor' }],
  ['recloudstream/dogiorshadenough', { owner: 'doGior', repo: 'doGiorsHadEnough' }],
  ['recloudstream/cloudstream-extensions-phisher', { owner: 'phisher98', repo: 'cloudstream-extensions-phisher' }],
  ['recloudstream/skillshare-repo', { owner: 'techtanic', repo: 'SkillShare-Repo' }],
  ['recloudstream/italianprovider', { owner: 'Gian-Fr', repo: 'ItalianProvider' }],
]);

/**
 * Turns a project page or raw document URL into candidate raw URLs it might publish.
 *
 * Handles raw.githubusercontent.com as well as github.com, gitlab.com, and Gitea/Forgejo.
 * Maps legacy recloudstream repository links to their true owner and probes alternate branches and files.
 */
function rawDocumentCandidates(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return [];
  let owner = segments[0];
  let repo = segments[1].replace(/\.git$/, '');

  const mapKey = `${owner}/${repo}`.toLowerCase();
  const mapped = KNOWN_OWNER_MAP.get(mapKey);
  if (mapped) {
    owner = mapped.owner;
    repo = mapped.repo;
  }

  const build = (branch: string, file: string): string | null => {
    if (parsed.hostname === 'github.com' || parsed.hostname === 'raw.githubusercontent.com') {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`;
    }
    if (parsed.hostname === 'gitlab.com') {
      return `https://gitlab.com/${owner}/${repo}/-/raw/${branch}/${file}`;
    }
    // Gitea and Forgejo instances (git.disroot.org among them) use this form.
    return `${parsed.origin}/${owner}/${repo}/raw/branch/${branch}/${file}`;
  };

  const candidates: string[] = [];
  for (const branch of REPO_BRANCHES) {
    for (const file of REPO_FILENAMES) {
      const candidate = build(branch, file);
      if (candidate && candidate !== url && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

/** A document is only a repository if it is a plugin array or has `pluginLists`. */
function looksLikeRepository(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => entry && typeof entry === 'object' && 'internalName' in entry);
  }
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as RepositoryJson).pluginLists)
  );
}

/**
 * Fetches a repository document, resolving a project page to its raw JSON.
 *
 * The direct URL is tried first and unconditionally: a user who pasted an exact
 * raw address must not have it second-guessed, and it is one request rather
 * than nine. Candidates are only probed when that fails or returns something
 * that is not a repository — which is precisely the HTML case.
 */
async function resolveRepositoryDocument(
  repoUrl: string
): Promise<{ url: string; document: RepositoryJson | SitePlugin[] }> {
  let directError: unknown;
  try {
    const document = await fetchJson<RepositoryJson | SitePlugin[]>(repoUrl, {
      timeoutMs: 15_000,
    });
    if (looksLikeRepository(document)) return { url: repoUrl, document };
    directError = new Error(
      'Not a CloudStream repository: the document is neither a plugin array nor an object with a "pluginLists" array.'
    );
  } catch (error) {
    directError = error;
  }

  for (const candidate of rawDocumentCandidates(repoUrl)) {
    try {
      const document = await fetchJson<RepositoryJson | SitePlugin[]>(candidate, {
        // Short, and no retry: most candidates are expected 404s and the point
        // of the walk is to get past them quickly, not to insist on each one.
        timeoutMs: 8_000,
        retries: 0,
      });
      if (looksLikeRepository(document)) return { url: candidate, document };
    } catch {
      // A candidate that is not there is the normal case, not an error.
    }
  }

  throw directError instanceof Error ? directError : new Error(String(directError));
}

/** The bridge's replies arrive as JSON strings; a malformed one is not fatal. */
function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class PluginManager {
  private pluginsDir: string;
  private analyzer = new PluginCompatibilityAnalyzer();
  private datastore: DatastoreManager;
  private sidecar: SidecarSupervisor;

  private installedRepoUrls = new Set<string>();
  private installedPlugins = new Map<string, PluginData & { meta: SitePlugin }>();
  private runtimeReports = new Map<string, PluginRuntimeReport>();

  /** Providers registered by loaded plugins, keyed by provider name. */
  private providers = new Map<string, ExtensionProvider>();
  private providersLoaded = false;
  private providersLoading: Promise<void> | null = null;

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
    const resolved = await resolveRepositoryDocument(repoUrl);
    const repo = resolved.document;
    const finalUrl = resolved.url;
    if (finalUrl !== repoUrl) {
      warnings.push(`Resolved to ${finalUrl}.`);
      if (this.installedRepoUrls.has(repoUrl)) {
        this.installedRepoUrls.delete(repoUrl);
      }
    }

    // Some repositories publish the plugin array directly instead of wrapping it
    // in a repo.json with `pluginLists` — CSX is one. Both are in the wild and
    // both are worth accepting; rejecting the bare array would drop a working
    // repository for a purely cosmetic difference.
    if (Array.isArray(repo)) {
      const plugins = repo.filter((p) => p?.internalName && p.url);
      if (plugins.length !== repo.length) {
        warnings.push(`${repo.length - plugins.length} entries lacked an internalName or url.`);
      }
      this.installedRepoUrls.add(finalUrl);
      this.persist();
      return {
        repositoryUrl: finalUrl,
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

    this.installedRepoUrls.add(finalUrl);
    this.persist();

    return {
      repositoryUrl: finalUrl,
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

      // The loader marks installed archives read-only, matching Android
      // (PluginManager.kt:602). On Windows a rename over a read-only file
      // fails, so an update would leave the old version in place while
      // reporting success. Clear the flag on the outgoing file first.
      if (fs.existsSync(target)) {
        try {
          fs.chmodSync(target, 0o666);
        } catch {
          // If the mode cannot be changed the rename below reports the real
          // problem; nothing is lost by trying.
        }
      }
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
        // Stamp the originating repository so the updater can re-check this
        // plugin later; a repository's plugin list does not always carry it.
        meta: { ...plugin, repositoryUrl: repoUrl },
      });
      this.persist();

      // Translate and classify now rather than on first use: DROP-2 requires
      // translation to happen once at install time, and a plugin's tier has to
      // be known before the user is told whether it works.
      const runtime = await this.inspect(plugin.internalName, target);

      // Invalidate cached provider state and load the new extension into JVM sidecar immediately
      this.providersLoaded = false;
      try {
        await this.loadProviders();
      } catch (err) {
        console.warn(`[pluginManager] Could not auto-load providers for ${plugin.internalName}:`, err);
      }

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

    // Clean up provider registrations for uninstalled extension
    this.providersLoaded = false;
    for (const [pName, provider] of [...this.providers.entries()]) {
      if (provider.pluginInternalName === internalName) {
        this.providers.delete(pName);
      }
    }
    void this.sidecar.call('unload', { pluginId: internalName });
    return true;
  }

  public getInstalledPlugins(): SitePlugin[] {
    return [...this.installedPlugins.values()].map((p) => p.meta);
  }

  /**
   * Install records rather than repository metadata.
   *
   * The updater needs the version that is actually on disk, which is the
   * install record's. `meta` is the repository's description of the plugin at
   * the moment it was fetched, so after an update it can disagree.
   */
  public getInstalledPluginRecords(): Array<PluginData & { meta: SitePlugin }> {
    return [...this.installedPlugins.values()];
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
    return [...this.providers.keys()];
  }

  /** Everything known about the providers installed extensions registered. */
  public getProviders(): ExtensionProvider[] {
    return [...this.providers.values()];
  }

  /**
   * The repository → extension → provider tree, as the UI needs to draw it.
   *
   * Built here rather than in the renderer because only this class knows which
   * archive a provider came from and which repository that archive came from —
   * a provider reports its own name and nothing about its ancestry.
   *
   * An extension that registered no providers is still listed. It is either
   * still loading or blocked, and hiding it would make a failed extension
   * indistinguishable from one that was never installed.
   */
  public getProviderTree(): ProviderTreeRepository[] {
    const byRepo = new Map<string, ProviderTreeRepository>();

    for (const record of this.installedPlugins.values()) {
      const repoUrl = record.meta?.repositoryUrl ?? '';
      let repo = byRepo.get(repoUrl);
      if (!repo) {
        repo = { url: repoUrl, name: repositoryLabel(repoUrl), extensions: [] };
        byRepo.set(repoUrl, repo);
      }

      repo.extensions.push({
        internalName: record.internalName,
        name: record.meta?.name ?? record.internalName,
        language: record.meta?.language,
        providers: [...this.providers.values()]
          .filter((provider) => provider.pluginInternalName === record.internalName)
          .map((provider) => ({
            name: provider.name,
            lang: provider.lang,
            supportedTypes: provider.supportedTypes,
          })),
      });
    }

    return [...byRepo.values()];
  }

  // --- provider execution --------------------------------------------------

  /**
   * Loads every installed plugin into the sidecar, once per session.
   *
   * Deferred rather than done at startup: loading runs DEX translation and a
   * plugin's own `load()`, which is far too much to put in the cold-start path
   * (DSK-57). The first search pays for it, and everything after is warm.
   */
  private async ensureProvidersLoaded(): Promise<void> {
    if (this.providersLoaded) return this.providersLoading ?? undefined;
    if (this.providersLoading) return this.providersLoading;

    this.providersLoading = (async () => {
      const started = await this.sidecar.ensureStarted();
      if (!started) return;

      for (const record of this.installedPlugins.values()) {
        if (!record.filePath || !fs.existsSync(record.filePath)) continue;

        const response = await this.sidecar.call('load', {
          pluginId: record.internalName,
          path: record.filePath,
        });

        if (!response.ok) {
          // A plugin that will not load is a per-plugin outcome, not a search
          // failure: the other providers still work and the reason is kept for
          // the extension manager to show.
          this.runtimeReports.set(record.internalName, {
            tier: 'T4_BLOCKED',
            reason: response.error ?? 'The extension runtime could not load this plugin.',
            translated: false,
            failureKind: response.errorKind,
          });
          continue;
        }

        const result = response.result ?? {};
        const registered = Array.isArray(result.providers) ? result.providers : [];
        for (const raw of registered as Array<Record<string, unknown>>) {
          const name = raw.name ? String(raw.name) : null;
          if (!name) continue;
          this.providers.set(name, {
            name,
            pluginInternalName: record.internalName,
            pluginName: record.meta?.name ?? record.internalName,
            mainUrl: raw.mainUrl ? String(raw.mainUrl) : undefined,
            lang: raw.lang ? String(raw.lang) : undefined,
            hasMainPage: Boolean(raw.hasMainPage),
            hasQuickSearch: Boolean(raw.hasQuickSearch),
            supportedTypes: Array.isArray(raw.supportedTypes)
              ? (raw.supportedTypes as string[])
              : [],
          });
        }
      }
      this.providersLoaded = true;
    })().finally(() => {
      this.providersLoading = null;
    });

    return this.providersLoading;
  }

  /**
   * Providers the user has left switched on; all of them by default.
   *
   * Loading must have happened first, or this reports an empty registry rather
   * than an empty selection — a distinction the scope layer cannot make.
   */
  public async listEnabledProviders(): Promise<string[]> {
    await this.ensureProvidersLoaded();
    return this.enabledProviderNames();
  }

  private enabledProviderNames(): string[] {
    const disabled = new Set(
      this.datastore.getObject<string[]>(SETTINGS_KEY_DISABLED_PROVIDERS, []) ?? []
    );
    return [...this.providers.keys()].filter((name) => !disabled.has(name));
  }

  public getDisabledProviders(): string[] {
    return this.datastore.getObject<string[]>(SETTINGS_KEY_DISABLED_PROVIDERS, []) ?? [];
  }

  public setProviderEnabled(name: string, enabled: boolean): string[] {
    return this.setProvidersEnabled([name], enabled);
  }

  /** Bulk toggle, so enabling a whole repository is one write not twenty. */
  public setProvidersEnabled(names: string[], enabled: boolean): string[] {
    const disabled = new Set(this.getDisabledProviders());
    for (const name of names) {
      if (enabled) disabled.delete(name);
      else disabled.add(name);
    }
    const next = [...disabled];
    this.datastore.setObject(SETTINGS_KEY_DISABLED_PROVIDERS, next);
    return next;
  }

  /** Public entry point for loading providers, used by the extension manager. */
  public async loadProviders(): Promise<void> {
    await this.ensureProvidersLoaded();
  }

  /**
   * Searches every enabled extension provider.
   *
   * Results are re-addressed as `cs3ext://` URLs. A provider's own URLs are
   * plain site links with nothing in them identifying which provider produced
   * them, so a later `load` would have no way to route back to the right one.
   */
  public async searchAll(query: string, only?: string[]): Promise<SearchResponse[]> {
    await this.ensureProvidersLoaded();

    const enabled = this.enabledProviderNames();
    // `only` narrows within what is enabled — it can never switch a disabled
    // provider back on, which is what keeps the extensions screen authoritative.
    const names = only ? enabled.filter((name) => only.includes(name)) : enabled;
    if (names.length === 0) return [];

    const response = await this.sidecar.call(
      'providerSearch',
      { query, providers: names },
      PROVIDER_CALL_TIMEOUT_MS
    );
    if (!response.ok) return [];

    const byProvider = (response.result?.byProvider ?? {}) as Record<string, string>;
    const out: SearchResponse[] = [];

    for (const [providerName, raw] of Object.entries(byProvider)) {
      const parsed = safeParse(raw);
      if (!parsed?.ok || !Array.isArray(parsed.results)) continue;

      for (const item of parsed.results as Array<Record<string, unknown>>) {
        if (!item.name || !item.url) continue;
        out.push({
          name: String(item.name),
          url: buildExtensionUrl(providerName, String(item.url)),
          apiName: item.apiName ? String(item.apiName) : providerName,
          type: item.type as SearchResponse['type'],
          posterUrl: item.posterUrl ? String(item.posterUrl) : undefined,
          posterHeaders: item.posterHeaders as Record<string, string> | undefined,
          quality: item.quality ? String(item.quality) : undefined,
          year: typeof item.year === 'number' ? item.year : undefined,
        });
      }
    }
    return out;
  }

  public async loadMedia(url: string): Promise<LoadResponse | null> {
    const ref = parseExtensionUrl(url);
    if (!ref) return null;
    await this.ensureProvidersLoaded();

    const response = await this.sidecar.call(
      'providerLoad',
      { provider: ref.provider, url: ref.target },
      PROVIDER_CALL_TIMEOUT_MS
    );
    if (!response.ok) return null;

    const parsed = safeParse(String(response.result?.json ?? ''));
    if (!parsed?.ok || !parsed.found || !parsed.detail) return null;

    const detail = parsed.detail as Record<string, unknown>;
    const episodes = Array.isArray(detail.episodes)
      ? (detail.episodes as Array<Record<string, unknown>>).map((episode) => ({
          name: episode.name ? String(episode.name) : `Episode ${episode.episode ?? ''}`,
          // The episode's `data` is the opaque handle loadLinks must be given
          // back, so it is what the URL has to carry — not the page address.
          url: buildExtensionUrl(ref.provider, String(episode.data ?? '')),
          episode: typeof episode.episode === 'number' ? episode.episode : undefined,
          season: typeof episode.season === 'number' ? episode.season : undefined,
          posterUrl: episode.posterUrl ? String(episode.posterUrl) : undefined,
          rating: typeof episode.rating === 'number' ? episode.rating : undefined,
          description: episode.description ? String(episode.description) : undefined,
          date: episode.date ? String(episode.date) : undefined,
        }))
      : undefined;

    return {
      name: String(detail.name ?? ''),
      url,
      apiName: detail.apiName ? String(detail.apiName) : ref.provider,
      type: detail.type as LoadResponse['type'],
      posterUrl: detail.posterUrl ? String(detail.posterUrl) : undefined,
      year: typeof detail.year === 'number' ? detail.year : undefined,
      plot: detail.plot ? String(detail.plot) : undefined,
      rating: typeof detail.rating === 'number' ? detail.rating : undefined,
      tags: Array.isArray(detail.tags) ? (detail.tags as string[]) : undefined,
      duration:
        typeof detail.duration === 'number' ? `${detail.duration} min` : undefined,
      episodes,
      actors: Array.isArray(detail.actors) ? (detail.actors as string[]) : undefined,
      // A film has no episode list; its `dataUrl` is the playable handle and is
      // re-addressed the same way an episode's is.
      id: undefined,
      ...(detail.dataUrl
        ? { dataUrl: buildExtensionUrl(ref.provider, String(detail.dataUrl)) }
        : {}),
    } as LoadResponse & { dataUrl?: string };
  }

  /** Resolves playable links for one movie or episode handle. */
  public async loadLinks(url: string): Promise<ExtractorLink[]> {
    const ref = parseExtensionUrl(url);
    if (!ref) return [];
    await this.ensureProvidersLoaded();

    const response = await this.sidecar.call(
      'providerLoadLinks',
      { provider: ref.provider, data: ref.target },
      PROVIDER_CALL_TIMEOUT_MS
    );
    if (!response.ok) return [];

    const parsed = safeParse(String(response.result?.json ?? ''));
    if (!parsed?.ok || !Array.isArray(parsed.links)) return [];

    return (parsed.links as Array<Record<string, unknown>>).map((link) => ({
      source: link.source ? String(link.source) : ref.provider,
      name: link.name ? String(link.name) : ref.provider,
      url: String(link.url ?? ''),
      referer: link.referer ? String(link.referer) : '',
      quality: typeof link.quality === 'number' ? link.quality : 0,
      isM3u8: Boolean(link.isM3u8) || link.type === 'M3U8',
      isDash: link.type === 'DASH',
      headers: (link.headers as Record<string, string> | undefined) ?? {},
    }));
  }

  /** Subtitles a provider offered alongside its links, for the same handle. */
  public async loadSubtitles(url: string): Promise<Array<{ lang: string; url: string }>> {
    const ref = parseExtensionUrl(url);
    if (!ref) return [];
    await this.ensureProvidersLoaded();

    const response = await this.sidecar.call(
      'providerLoadLinks',
      { provider: ref.provider, data: ref.target },
      PROVIDER_CALL_TIMEOUT_MS
    );
    if (!response.ok) return [];

    const parsed = safeParse(String(response.result?.json ?? ''));
    if (!parsed?.ok || !Array.isArray(parsed.subtitles)) return [];

    return (parsed.subtitles as Array<Record<string, unknown>>)
      .filter((s) => s.url)
      .map((s) => ({ lang: String(s.lang ?? 'Unknown'), url: String(s.url) }));
  }
}

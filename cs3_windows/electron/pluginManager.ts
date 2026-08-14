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
import { OFFICIAL_REPOSITORIES, type OfficialRepository } from './officialRepositories';
import { classifyFailure, FAILURE_KIND_LABELS } from './cs3/failureTaxonomy';
import type { FailureKind } from '../src/types/analytics';
import type {
  DiagnosisFact,
  DiagnosisKind,
  SourceDiagnosis,
} from '../src/types/diagnostics';

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

/**
 * One selectable source, and the leaf of the tree.
 *
 * `id` is the provider's name because that *is* its app-wide address: the
 * `cs3ext://` URL scheme, the sidecar RPC, the enable/disable list and the
 * search scope all key on it. Giving the UI a second, synthetic identity would
 * mean two things to keep in step and one more place for a selection to stop
 * matching the provider it names.
 */
export interface ProviderTreeProvider {
  id: string;
  name: string;
  lang?: string;
  supportedTypes: string[];
  /** False when this provider itself is switched off. */
  enabled: boolean;
  /**
   * False when something *above* it is switched off — its extension or its
   * repository — while its own switch is still on.
   *
   * Kept separate from `enabled` because collapsing the two loses the
   * information the user needs to fix it. A provider greyed out because its
   * repository is off must not look like one the user turned off individually:
   * clicking its own toggle would appear to do nothing, since the ancestor gate
   * still wins. The UI shows the reason instead.
   */
  effectivelyEnabled: boolean;
  /** Where this provider came from, so a result can be traced to its source. */
  extensionInternalName: string;
  extensionName: string;
  repositoryId: string;
  repositoryName: string;
  /** Whether the provider declares upstream's NSFW `TvType`. */
  adult: boolean;
}

export interface ProviderTreeExtension {
  id: string;
  internalName: string;
  name: string;
  language?: string;
  providers: ProviderTreeProvider[];
  /** False when the user switched this extension off. Archives are kept. */
  enabled: boolean;
  /** False when its repository is switched off, whatever its own state. */
  effectivelyEnabled: boolean;
  /** Provenance — who wrote it, what version is on disk, where it came from. */
  version?: number;
  authors?: string[];
  description?: string;
  iconUrl?: string;
  fileSize?: number;
  repositoryId: string;
  repositoryName: string;
  /** Union of the content types its providers declare, for tag filtering. */
  tvTypes: string[];
  /** How many of its providers are answering right now. */
  enabledProviderCount: number;
  /**
   * Why this extension offers nothing to select, when it offers nothing.
   *
   * An extension with no providers is not the same as an extension that is not
   * installed — it is loading, blocked, or lost a name to another extension —
   * and callers that cannot tell the difference end up inventing a placeholder
   * provider to fill the gap. One did exactly that, and selecting the invented
   * name scoped the search to a provider that has never existed.
   */
  unavailableReason?: string;
}

/** One node of the repository → extension → provider tree. Exactly three levels. */
export interface ProviderTreeRepository {
  id: string;
  url: string;
  name: string;
  extensions: ProviderTreeExtension[];
  /** False when the user switched the whole repository off. Archives are kept. */
  enabled: boolean;
  /**
   * True when this is one of the repositories installed on first launch.
   *
   * Surfaced so the UI can label it rather than hide it. A default the user
   * cannot see the provenance of is a default they cannot make an informed
   * decision about, and every one of these is removable.
   */
  bundled: boolean;
  /** Present when the catalogue knows this repository; absent for sideloads. */
  description?: string;
  category?: string;
  iconUrl?: string;
  /** Whether the catalogue verified this URL returns a document. */
  verified?: boolean;
  /** The project page, when the stored URL is a raw document link. */
  homepageUrl?: string;
  extensionCount: number;
  providerCount: number;
  enabledProviderCount: number;
  /** Union of the content types everything under it declares. */
  tvTypes: string[];
}

/** Repositories are keyed by URL; a sideloaded archive has none. */
const SIDELOADED_REPOSITORY_ID = 'sideloaded';

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

/**
 * The catalogue entry a stored repository URL came from, if any.
 *
 * Matching is not a plain equality check because the two ends hold different
 * URLs by design: the catalogue stores a project page
 * (`https://github.com/owner/repo`) while an install records whichever raw
 * document actually resolved (`.../builds/repo.json`). Comparing them directly
 * finds nothing, which is what left every repository in the tree labelled with a
 * bare hostname and no provenance at all.
 *
 * Both sides are therefore normalised through the same `owner/repo` reduction
 * `repositoryLabel` uses, with an exact match on either URL tried first.
 */
function findOfficialRepository(repoUrl: string): OfficialRepository | undefined {
  if (!repoUrl) return undefined;
  const exact = OFFICIAL_REPOSITORIES.find(
    (repo) => repo.rawRepoUrl === repoUrl || repo.url === repoUrl
  );
  if (exact) return exact;

  const wanted = repositoryLabel(repoUrl).toLowerCase();
  return OFFICIAL_REPOSITORIES.find(
    (repo) =>
      repositoryLabel(repo.rawRepoUrl).toLowerCase() === wanted ||
      repositoryLabel(repo.url).toLowerCase() === wanted
  );
}

const SETTINGS_KEY_DISABLED_PROVIDERS = 'cs3_disabled_providers';
/**
 * Repositories and extensions the user has switched off.
 *
 * Switching off is deliberately **not** uninstalling, and the two are separate
 * because they answer different questions. Uninstalling a bundled repository
 * used to be the only way to silence it, and it did not even do that: it dropped
 * the URL from `installedRepoUrls` and left every extension it had installed in
 * place, still loaded, still registering providers, still answering searches. A
 * user who turned off a default repository watched it keep producing results.
 *
 * Disabling silences the whole subtree immediately and keeps the archives, so
 * turning it back on costs nothing. Removing still uninstalls — and now cascades
 * to the extensions the repository brought with it, which is what makes the
 * button mean what it says.
 *
 * Keyed by repository id (its URL) and by extension `internalName`, matching the
 * identities the tree already exposes, so a stored decision survives a
 * reinstall of the same extension.
 */
const SETTINGS_KEY_DISABLED_REPOSITORIES = 'cs3_disabled_repositories';
const SETTINGS_KEY_DISABLED_EXTENSIONS = 'cs3_disabled_extensions';
/** Shared with `BootstrapService`; both read the one user decision. */
const SETTINGS_KEY_ADULT_ENABLED = 'cs3_adult_content_enabled';

/**
 * Whether a provider serves adult content.
 *
 * `NSFW` is upstream's own `TvType`, which providers declare themselves, so
 * this catches an adult provider bundled inside an otherwise ordinary
 * repository — which a repository-level flag never would.
 */
function isAdultProvider(provider: ExtensionProvider): boolean {
  return provider.supportedTypes.some((type) => type.toUpperCase() === 'NSFW');
}

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

/** What one provider had to say about one query. */
export interface ProviderSearchOutcome {
  /** The registered provider name, which is its identity everywhere else. */
  provider: string;
  results: SearchResponse[];
  latencyMs: number;
  /** Set when this provider failed; the others are unaffected. */
  error?: string;
}

/**
 * How many provider searches are in flight at once. See `searchEach`.
 *
 * The default is a compromise, which is why it is adjustable. The sidecar
 * dispatches each RPC onto a bounded pool sized to the core count, so raising
 * this past that only moves the queue from here to there — but on a many-core
 * machine with thirty providers installed, the extra parallelism is real.
 * Lowering it helps a slow connection, where thirty simultaneous scrapes
 * contend for bandwidth and every one of them gets slower.
 */
const DEFAULT_PROVIDER_SEARCH_CONCURRENCY = 8;
const MIN_PROVIDER_SEARCH_CONCURRENCY = 1;
const MAX_PROVIDER_SEARCH_CONCURRENCY = 32;
const SETTINGS_KEY_SEARCH_CONCURRENCY = 'cs3_provider_search_concurrency';

/**
 * Turns one provider's raw reply into search rows.
 *
 * `apiName` is forced to the registered provider name rather than whatever the
 * provider called itself. That name is the app's identity for this source —
 * the scope picker selects it, `cs3ext://` addresses it, the results filter
 * groups by it — and a provider that answers under a different label would
 * appear in the results as a source the user cannot find in the picker.
 */
function mapProviderResults(providerName: string, raw: unknown): SearchResponse[] {
  if (!Array.isArray(raw)) return [];

  const out: SearchResponse[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item.name || !item.url) continue;
    out.push({
      name: String(item.name),
      url: buildExtensionUrl(providerName, String(item.url)),
      apiName: providerName,
      type: item.type as SearchResponse['type'],
      posterUrl: item.posterUrl ? String(item.posterUrl) : undefined,
      posterHeaders: item.posterHeaders as Record<string, string> | undefined,
      quality: item.quality ? String(item.quality) : undefined,
      year: typeof item.year === 'number' ? item.year : undefined,
    });
  }
  return out;
}

/**
 * Somewhere to send failures, without depending on the whole diagnostics store.
 *
 * Structural rather than a concrete type so this module stays usable in a test
 * or a tool that has no Electron app around it.
 */
export interface DiagnosticsSink {
  record(entry: {
    /** `info` records what worked, which is what makes a failure reproducible. */
    level: 'error' | 'warn' | 'info';
    stage: 'search' | 'detail' | 'links' | 'sources' | 'playback' | 'runtime' | 'install';
    source?: string;
    query?: string;
    title?: string;
    url?: string;
    message: string;
    detail?: string;
  }): void;
}

/**
 * Somewhere to send measurements, on the same terms as {@link DiagnosticsSink}.
 *
 * Separate from diagnostics on purpose even though both are fed from the same
 * call sites. Diagnostics answers "what went wrong just now, in enough detail
 * to reproduce it" and keeps queries, titles and URLs to do so. This answers
 * "which providers are worth asking" and keeps none of that — only counts. One
 * file is meant to be pasted into a bug report; the other never leaves the
 * machine unless the user exports it.
 */
/** Progress of the one-time load of every installed extension. */
export interface ProviderLoadProgress {
  /** Archives whose `load()` has been attempted. */
  loaded: number;
  /** Archives that will be attempted in this pass. */
  total: number;
  /** True while a pass is in flight. */
  running: boolean;
  /** Providers registered so far, which is what the scope picker can offer. */
  providers: number;
  /** The archive currently being loaded, for a progress line worth reading. */
  current?: string;
}

export interface AnalyticsSink {
  observe(input: {
    provider: string;
    stage: 'search' | 'detail' | 'links' | 'playback' | 'download';
    outcome: 'success' | 'empty' | 'failure';
    produced?: number;
    latencyMs?: number;
    error?: string;
  }): void;
  describe(
    provider: string,
    provenance: {
      repositoryId?: string;
      repositoryName?: string;
      extensionInternalName?: string;
      extensionName?: string;
    }
  ): void;
}

/**
 * One sentence naming the provider and the cause, for the failure kinds that
 * have a plain-language reading.
 *
 * Kept short deliberately. The detail belongs in `facts`, which the debug copy
 * collects; a message that tries to be a report ends up being neither.
 */
function summarizeLinkFailure(provider: string, kind: DiagnosisKind, raw: string): string {
  switch (kind) {
    case 'blocked':
      return `The file host refused ${provider}'s request for this item.`;
    case 'not-found':
      return `${provider}'s source for this item is gone.`;
    case 'expired':
      return `${provider}'s link for this item had already expired.`;
    case 'server-error':
      return `The file host returned an error to ${provider}.`;
    case 'network':
      return `${provider} could not reach the file host.`;
    case 'timeout':
      return `${provider} did not answer in time.`;
    case 'unsupported-operation':
      return `${provider} does not resolve playable links — it is a catalogue, not a source.`;
    case 'unreadable-reply':
      return `${provider} could not read the page it was given; the site has probably changed.`;
    default:
      return raw.length <= 160 ? raw : `${provider} failed while resolving this item.`;
  }
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

  /**
   * Where provider failures are recorded, when the host supplies a log.
   *
   * Optional so this class stays constructible in tests and tools without one.
   * Recording happens here rather than at the call sites because this is the
   * only layer that knows which provider was being asked.
   */
  private diagnostics: DiagnosticsSink | null = null;

  /** Where provider outcomes are counted, when the host supplies a store. */
  private analytics: AnalyticsSink | null = null;

  /** Providers registered by loaded plugins, keyed by provider name. */
  private providers = new Map<string, ExtensionProvider>();
  /** Names an extension tried to register that another extension already held. */
  private providerNameClashes = new Map<string, string[]>();
  private providersLoaded = false;
  private providersLoading: Promise<void> | null = null;

  /**
   * How far the one-time provider load has got.
   *
   * Loading runs DEX translation and each plugin's own `load()`, serially,
   * across every installed archive — on a bootstrapped install that is a
   * hundred and seventy of them and it takes minutes. Nothing reported that,
   * so every consumer that waits on `loadProviders()` looked frozen, and the
   * search scope picker in particular appeared to be permanently empty until
   * the user happened to run a search and wait long enough for the same load to
   * finish underneath it. The work was always fine; its silence was the bug.
   */
  private loadProgress: ProviderLoadProgress = {
    loaded: 0,
    total: 0,
    running: false,
    providers: 0,
  };
  private loadProgressListeners = new Set<(progress: ProviderLoadProgress) => void>();

  public getSidecar(): SidecarSupervisor {
    return this.sidecar;
  }

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

  /**
   * Removes a repository *and* the extensions it installed.
   *
   * The cascade is the whole point. This used to delete the URL and stop, which
   * left every archive the repository had installed on disk, loaded in the
   * sidecar, and answering searches — so "remove" removed a row from a list and
   * changed nothing a user could observe. That was the concrete shape of "I
   * cannot turn off the default repositories": the button reported success and
   * the providers kept working.
   *
   * Returns the extensions it uninstalled so the caller can say what actually
   * happened rather than claiming a bare success.
   *
   * To silence a repository without losing its archives, use
   * {@link setRepositoryEnabled} — that is the reversible operation, and it is
   * the one the UI offers first.
   */
  public removeRepository(repoUrl: string): string[] {
    const urls = new Set<string>([repoUrl, ...rawDocumentCandidates(repoUrl)]);
    for (const url of urls) this.installedRepoUrls.delete(url);

    const removed: string[] = [];
    for (const record of [...this.installedPlugins.values()]) {
      const origin = record.meta?.repositoryUrl;
      if (origin && urls.has(origin) && this.uninstallPlugin(record.internalName)) {
        removed.push(record.internalName);
      }
    }

    // A repository that is gone cannot stay in the disabled set: re-adding it
    // later would otherwise arrive silently switched off, with nothing on
    // screen explaining why none of its providers answer.
    if (this.getDisabledRepositories().some((id) => urls.has(id))) {
      this.setRepositoriesEnabled([...urls], true);
    }

    // `uninstallPlugin` persists per plugin; this covers the URL removal when
    // the repository had no installed extensions at all.
    this.persist();
    return removed;
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
  private installProgressListeners = new Set<(progress: {
    internalName: string;
    name: string;
    step: 'downloading' | 'verifying' | 'analyzing' | 'complete' | 'error';
    downloadedBytes?: number;
    totalBytes?: number;
    percent: number;
    message?: string;
  }) => void>();

  public onInstallProgress(
    listener: (progress: {
      internalName: string;
      name: string;
      step: 'downloading' | 'verifying' | 'analyzing' | 'complete' | 'error';
      downloadedBytes?: number;
      totalBytes?: number;
      percent: number;
      message?: string;
    }) => void
  ): () => void {
    this.installProgressListeners.add(listener);
    return () => this.installProgressListeners.delete(listener);
  }

  private notifyInstallProgress(data: {
    internalName: string;
    name: string;
    step: 'downloading' | 'verifying' | 'analyzing' | 'complete' | 'error';
    downloadedBytes?: number;
    totalBytes?: number;
    percent: number;
    message?: string;
  }): void {
    for (const listener of this.installProgressListeners) {
      try {
        listener(data);
      } catch (err) {
        console.warn('[PluginManager] Install progress error:', err);
      }
    }
  }

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

      this.notifyInstallProgress({
        internalName: plugin.internalName,
        name: plugin.name,
        step: 'downloading',
        percent: 5,
        message: `Downloading ${plugin.name}...`,
      });

      const buffer = await fetchBuffer(plugin.url, { timeoutMs: 60_000 }, (downloaded, total, percent) => {
        const sizeStr =
          total > 0
            ? ` (${(downloaded / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB)`
            : '';
        this.notifyInstallProgress({
          internalName: plugin.internalName,
          name: plugin.name,
          step: 'downloading',
          downloadedBytes: downloaded,
          totalBytes: total,
          percent,
          message: `Downloading ${plugin.name}${sizeStr}... ${percent}%`,
        });
      });

      this.notifyInstallProgress({
        internalName: plugin.internalName,
        name: plugin.name,
        step: 'verifying',
        percent: 85,
        message: `Verifying package integrity...`,
      });

      const digest = crypto.createHash('sha256').update(buffer).digest('hex');

      if (plugin.fileHash) {
        const expected = plugin.fileHash.replace(/^sha256-/i, '').toLowerCase();
        if (expected !== digest) {
          this.notifyInstallProgress({
            internalName: plugin.internalName,
            name: plugin.name,
            step: 'error',
            percent: 0,
            message: `SHA-256 mismatch`,
          });
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

      this.notifyInstallProgress({
        internalName: plugin.internalName,
        name: plugin.name,
        step: 'complete',
        percent: 100,
        message: `${plugin.name} installed successfully.`,
      });

      return {
        ok: true,
        report,
        message: runtime
          ? `${plugin.name} installed and verified. ${runtime.reason}`
          : `${plugin.name} installed and verified. The extension runtime is unavailable, so it could not be analysed.`,
      };
    } catch (error) {
      this.notifyInstallProgress({
        internalName: plugin.internalName,
        name: plugin.name,
        step: 'error',
        percent: 0,
        message: `Installation failed`,
      });

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

    // An uninstalled extension must not keep a stored "disabled" decision.
    // Reinstalling it later would otherwise bring it back silently switched
    // off, showing zero providers with nothing on screen to explain it.
    if (this.getDisabledExtensions().includes(internalName)) {
      this.setExtensionsEnabled([internalName], true);
    }

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

  /** Wired by `main.ts`; failures are recorded from this class onwards. */
  public setDiagnostics(sink: DiagnosticsSink): void {
    this.diagnostics = sink;
  }

  /**
   * Whether the provider registry reflects what is installed.
   *
   * Lets a caller tell "no providers" from "not asked yet", which is the whole
   * difference between an empty source list and a loading one.
   */
  public providersReady(): boolean {
    return this.providersLoaded;
  }

  public getProviderLoadProgress(): ProviderLoadProgress {
    return { ...this.loadProgress, providers: this.providers.size };
  }

  public onProviderLoadProgress(
    listener: (progress: ProviderLoadProgress) => void
  ): () => void {
    this.loadProgressListeners.add(listener);
    return () => {
      this.loadProgressListeners.delete(listener);
    };
  }

  private emitLoadProgress(patch: Partial<ProviderLoadProgress>): void {
    this.loadProgress = {
      ...this.loadProgress,
      ...patch,
      providers: this.providers.size,
    };
    const snapshot = this.getProviderLoadProgress();
    for (const listener of this.loadProgressListeners) {
      try {
        listener(snapshot);
      } catch {
        // A listener that throws must not stop the load it is watching.
      }
    }
  }

  /** Wired by `main.ts`; provider outcomes are counted from here onwards. */
  public setAnalytics(sink: AnalyticsSink): void {
    this.analytics = sink;
    this.publishProvenance();
  }

  /**
   * Tells the analytics store which extension and repository each provider
   * came from.
   *
   * This class is the only layer that knows. A provider reports its own name
   * and nothing about its ancestry, so without this a poor score is a bare
   * string — and the point of ranking is to be able to say whose code and
   * whose repository is behind it.
   */
  private publishProvenance(): void {
    if (!this.analytics) return;
    for (const provider of this.providers.values()) {
      const record = this.installedPlugins.get(provider.pluginInternalName);
      this.analytics.describe(provider.name, {
        repositoryId: record?.meta?.repositoryUrl || SIDELOADED_REPOSITORY_ID,
        repositoryName: record?.meta?.repositoryUrl
          ? (findOfficialRepository(record.meta.repositoryUrl)?.name ??
             repositoryLabel(record.meta.repositoryUrl))
          : undefined,
        extensionInternalName: provider.pluginInternalName,
        extensionName: record?.meta?.name ?? provider.pluginInternalName,
      });
    }
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
   * Exactly three levels, always. There is no fourth entity in the CloudStream
   * model: a repository ships archives, an archive registers providers, and a
   * provider is what search actually asks. A tree that appears to nest deeper
   * is a rendering artefact of the common case where an archive registers one
   * provider named after itself, not a real extra level.
   *
   * An extension that registered no providers is still listed, with a reason.
   * It is loading, blocked, or lost its name to another extension, and hiding
   * it would make a failed extension indistinguishable from one that was never
   * installed.
   *
   * Indexed rather than scanned: the corpus runs to hundreds of extensions and
   * hundreds of providers, and filtering the whole registry once per extension
   * made this quadratic in the exact case it has to stay fast for.
   */
  public getProviderTree(): ProviderTreeRepository[] {
    const disabled = new Set(this.getDisabledProviders());
    const disabledExtensions = new Set(this.getDisabledExtensions());
    const disabledRepositories = new Set(this.getDisabledRepositories());
    const allowAdult = this.adultAllowed();

    const byExtension = new Map<string, ExtensionProvider[]>();
    for (const provider of this.providers.values()) {
      const bucket = byExtension.get(provider.pluginInternalName);
      if (bucket) bucket.push(provider);
      else byExtension.set(provider.pluginInternalName, [provider]);
    }

    const byRepo = new Map<string, ProviderTreeRepository>();

    for (const record of this.installedPlugins.values()) {
      const repoUrl = record.meta?.repositoryUrl ?? '';
      const repoId = repoUrl || SIDELOADED_REPOSITORY_ID;
      let repo = byRepo.get(repoId);
      if (!repo) {
        // The catalogue is what turns a bare URL into something a user can
        // judge — who publishes it, what it covers, whether the link was ever
        // confirmed to resolve. A sideloaded archive has no entry and gets
        // none of it, which is itself worth showing.
        const catalogued = findOfficialRepository(repoUrl);
        repo = {
          id: repoId,
          url: repoUrl,
          name: catalogued?.name ?? repositoryLabel(repoUrl),
          extensions: [],
          enabled: !disabledRepositories.has(repoId),
          bundled: catalogued?.bundled === true,
          description: catalogued?.description,
          category: catalogued?.category,
          iconUrl: catalogued?.iconUrl,
          verified: catalogued?.verified,
          homepageUrl: catalogued?.url,
          extensionCount: 0,
          providerCount: 0,
          enabledProviderCount: 0,
          tvTypes: [],
        };
        byRepo.set(repoId, repo);
      }

      const extensionEnabled = !disabledExtensions.has(record.internalName);
      const extensionEffective = extensionEnabled && repo.enabled;

      const providers: ProviderTreeProvider[] = (byExtension.get(record.internalName) ?? []).map(
        (provider) => {
          const ownEnabled = !disabled.has(provider.name);
          const adult = isAdultProvider(provider);
          return {
            id: provider.name,
            name: provider.name,
            lang: provider.lang,
            supportedTypes: provider.supportedTypes,
            enabled: ownEnabled,
            // Mirrors `enabledProviderNames` exactly, including the adult gate.
            // If these two ever disagree the screen is lying about what a
            // search will ask, which is the failure this whole tree exists to
            // prevent.
            effectivelyEnabled: ownEnabled && extensionEffective && (allowAdult || !adult),
            extensionInternalName: record.internalName,
            extensionName: record.meta?.name ?? record.internalName,
            repositoryId: repoId,
            repositoryName: repo.name,
            adult,
          };
        }
      );
      providers.sort((a, b) => a.name.localeCompare(b.name));

      const tvTypes = [
        ...new Set(providers.flatMap((provider) => provider.supportedTypes)),
      ].sort();

      repo.extensions.push({
        id: record.internalName,
        internalName: record.internalName,
        name: record.meta?.name ?? record.internalName,
        language: record.meta?.language,
        providers,
        enabled: extensionEnabled,
        effectivelyEnabled: extensionEffective,
        version: record.version ?? record.meta?.version,
        authors: record.meta?.authors,
        description: record.meta?.description,
        iconUrl: record.meta?.iconUrl,
        fileSize: record.meta?.fileSize,
        repositoryId: repoId,
        repositoryName: repo.name,
        tvTypes,
        enabledProviderCount: providers.filter((provider) => provider.effectivelyEnabled).length,
        ...(providers.length === 0
          ? { unavailableReason: this.explainNoProviders(record.internalName) }
          : {}),
      });
    }

    const repositories = [...byRepo.values()];
    for (const repo of repositories) {
      repo.extensions.sort((a, b) => a.name.localeCompare(b.name));
      repo.extensionCount = repo.extensions.length;
      repo.providerCount = repo.extensions.reduce((n, ext) => n + ext.providers.length, 0);
      repo.enabledProviderCount = repo.extensions.reduce(
        (n, ext) => n + ext.enabledProviderCount,
        0
      );
      repo.tvTypes = [...new Set(repo.extensions.flatMap((ext) => ext.tvTypes))].sort();
    }
    repositories.sort((a, b) => a.name.localeCompare(b.name));
    return repositories;
  }

  /** Why an installed extension contributed nothing selectable. */
  private explainNoProviders(internalName: string): string {
    const clashes = this.providerNameClashes.get(internalName);
    if (clashes && clashes.length > 0) {
      return `Its provider name is already registered by another extension: ${clashes.join(', ')}.`;
    }
    const report = this.runtimeReports.get(internalName);
    if (report?.reason) return report.reason;
    return this.providersLoaded
      ? 'This extension loaded but registered no providers.'
      : 'This extension has not been loaded yet.';
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
      if (!started) {
        /**
         * The runtime is unavailable, and that has to be said out loud.
         *
         * This used to return silently. Every installed extension then reported
         * zero providers with no reason attached, which the extensions screen
         * rendered as a permanent "JVM sidecar is initializing providers…"
         * spinner — a message that is not merely unhelpful but wrong: nothing
         * was initializing and nothing ever would. The actual cause on the
         * machine where this was found was a `JAVA_HOME` pointing at Java 17,
         * one sentence that would have ended the investigation immediately.
         */
        const status = await this.sidecar.status();
        const reason =
          status.reason ?? 'The extension runtime is not available, so providers cannot be loaded.';
        for (const record of this.installedPlugins.values()) {
          this.runtimeReports.set(record.internalName, {
            tier: 'T4_BLOCKED',
            reason,
            translated: false,
            failureKind: 'SIDECAR_UNAVAILABLE',
          });
        }
        // Leave providersLoaded false so retry occurs once runtime is ready
        this.providersLoaded = false;
        return;
      }

      // Clear any transient sidecar unavailable reports from prior cold starts
      for (const [name, report] of this.runtimeReports.entries()) {
        if (report.failureKind === 'SIDECAR_UNAVAILABLE') {
          this.runtimeReports.delete(name);
        }
      }

      // Recomputed from scratch each pass: an uninstall can resolve a clash,
      // and a stale entry would keep blaming an extension that is now fine.
      this.providerNameClashes.clear();

      const pending = [...this.installedPlugins.values()].filter(
        (record) => record.filePath && fs.existsSync(record.filePath)
      );
      this.emitLoadProgress({ loaded: 0, total: pending.length, running: true });

      for (const record of pending) {
        this.emitLoadProgress({ current: record.meta?.name ?? record.internalName });

        const response = await this.sidecar.call('load', {
          pluginId: record.internalName,
          path: record.filePath,
        });
        // Reported per archive rather than at the end. Consumers that wait on
        // this — the scope picker most visibly — can then show a list that
        // fills in, instead of nothing followed by everything.
        this.emitLoadProgress({ loaded: this.loadProgress.loaded + 1 });

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

        // Successfully loaded plugin into sidecar; remove any old failure report
        this.runtimeReports.delete(record.internalName);

        const result = response.result ?? {};
        const registered = Array.isArray(result.providers) ? result.providers : [];
        for (const raw of registered as Array<Record<string, unknown>>) {
          const name = raw.name ? String(raw.name) : null;
          if (!name) continue;

          /**
           * A provider name is the app-wide address for a provider — `cs3ext://`
           * URLs, the scope and the enable/disable list all key on it — so two
           * extensions cannot both hold one. The first keeps it, because that is
           * stable across reloads in a way "whichever loaded last" is not.
           *
           * The loser is recorded rather than dropped: without this it shows up
           * in the tree as an extension that registered nothing, which reads as
           * a translation failure and sends whoever investigates to the wrong
           * place entirely.
           */
          const owner = this.providers.get(name);
          if (owner && owner.pluginInternalName !== record.internalName) {
            const clashes = this.providerNameClashes.get(record.internalName) ?? [];
            clashes.push(`${name} (held by ${owner.pluginName})`);
            this.providerNameClashes.set(record.internalName, clashes);
            continue;
          }

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
      this.publishProvenance();
      this.emitLoadProgress({ running: false, current: undefined });
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

  /**
   * Adult content is opt-in, and the gate lives here on purpose.
   *
   * Every path that reaches a provider — search, the scope picker, source
   * discovery, playback, downloads — funnels through `enabledProviderNames`.
   * Filtering at each of those call sites would mean five places to forget;
   * filtering here means an adult provider is invisible to the app until the
   * user has turned adult content on, whatever repository it arrived in and
   * whether or not that repository was flagged.
   */
  private adultAllowed(): boolean {
    return this.datastore.getBool(SETTINGS_KEY_ADULT_ENABLED, false);
  }

  /**
   * Every gate, applied in one place.
   *
   * A provider answers only when nothing above it is switched off: not the
   * provider, not the extension that registered it, not the repository that
   * supplied that extension — and the adult gate on top. Search, the scope
   * picker, source discovery, playback and downloads all funnel through here, so
   * a single decision covers all of them; enforcing the cascade at each call
   * site would be five places to forget it.
   */
  private enabledProviderNames(): string[] {
    const disabled = new Set(this.getDisabledProviders());
    const disabledExtensions = new Set(this.getDisabledExtensions());
    const disabledRepositories = new Set(this.getDisabledRepositories());
    const allowAdult = this.adultAllowed();

    return [...this.providers.values()]
      .filter((provider) => !disabled.has(provider.name))
      .filter((provider) => !disabledExtensions.has(provider.pluginInternalName))
      .filter((provider) => !disabledRepositories.has(this.repositoryIdOf(provider.pluginInternalName)))
      .filter((provider) => allowAdult || !isAdultProvider(provider))
      .map((provider) => provider.name);
  }

  /**
   * The repository an extension came from, as the id the tree uses.
   *
   * A sideloaded archive has no repository URL and shares one synthetic id with
   * every other sideloaded archive, which is correct: they are one group in the
   * tree and the user switches them as one.
   */
  private repositoryIdOf(internalName: string): string {
    const record = this.installedPlugins.get(internalName);
    return record?.meta?.repositoryUrl || SIDELOADED_REPOSITORY_ID;
  }

  public getDisabledProviders(): string[] {
    return this.datastore.getObject<string[]>(SETTINGS_KEY_DISABLED_PROVIDERS, []) ?? [];
  }

  public getDisabledRepositories(): string[] {
    return this.datastore.getObject<string[]>(SETTINGS_KEY_DISABLED_REPOSITORIES, []) ?? [];
  }

  public getDisabledExtensions(): string[] {
    return this.datastore.getObject<string[]>(SETTINGS_KEY_DISABLED_EXTENSIONS, []) ?? [];
  }

  /**
   * Switches a whole repository on or off without touching its files.
   *
   * Returns the new disabled-repository list so the renderer re-renders from
   * what was actually stored rather than from what it assumed — the same shape
   * `setProviderEnabled` already returns, and the reason a failed write shows up
   * as the toggle springing back instead of as a lie on screen.
   */
  public setRepositoryEnabled(repositoryId: string, enabled: boolean): string[] {
    return this.setRepositoriesEnabled([repositoryId], enabled);
  }

  public setRepositoriesEnabled(repositoryIds: string[], enabled: boolean): string[] {
    const disabled = new Set(this.getDisabledRepositories());
    for (const id of repositoryIds) {
      if (enabled) disabled.delete(id);
      else disabled.add(id);
    }
    const next = [...disabled];
    this.datastore.setObject(SETTINGS_KEY_DISABLED_REPOSITORIES, next);
    return next;
  }

  public setExtensionEnabled(internalName: string, enabled: boolean): string[] {
    return this.setExtensionsEnabled([internalName], enabled);
  }

  public setExtensionsEnabled(internalNames: string[], enabled: boolean): string[] {
    const disabled = new Set(this.getDisabledExtensions());
    for (const name of internalNames) {
      if (enabled) disabled.delete(name);
      else disabled.add(name);
    }
    const next = [...disabled];
    this.datastore.setObject(SETTINGS_KEY_DISABLED_EXTENSIONS, next);
    return next;
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
  public async loadProviders(force = false): Promise<void> {
    if (force || this.providers.size === 0) {
      this.providersLoaded = false;
      this.providersLoading = null;
    }
    await this.ensureProvidersLoaded();
  }

  /**
   * Narrows a requested provider list to what is actually switched on.
   *
   * `undefined` means "every enabled provider"; an empty array means none, and
   * the two must stay distinguishable — a scoped search that resolves to
   * nothing has to search nothing, not everything.
   *
   * A named provider that is disabled is dropped rather than re-enabled, which
   * is what keeps the extensions screen authoritative over the scope picker.
   */
  private narrowToEnabled(only?: string[]): string[] {
    const enabled = this.enabledProviderNames();
    if (!only) return enabled;
    const wanted = new Set(only);
    return enabled.filter((name) => wanted.has(name));
  }

  /**
   * Searches extension providers, reporting each one the moment it answers.
   *
   * One RPC per provider, rather than the single batched call this replaced.
   * The batched form asked the sidecar for every provider at once and the
   * sidecar collected the futures in order, so the reply landed at the speed of
   * the slowest provider — with fifteen installed, a scrape that took forty
   * seconds held back fourteen answers that were ready in two. Every result was
   * already known long before the user saw any of them.
   *
   * Concurrency is capped because the sidecar dispatches each RPC onto a
   * bounded worker pool (`Main.pool`, sized to the core count); firing a
   * hundred at once would queue there instead of here, and lose the ability to
   * stop early on cancel. The provider calls themselves run on an unbounded
   * pool inside the sidecar, so the cap costs nothing in throughput.
   */
  public async searchEach(
    query: string,
    only: string[] | undefined,
    onProvider: (outcome: ProviderSearchOutcome) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.ensureProvidersLoaded();
    if (signal?.aborted) return;

    const targets = this.narrowToEnabled(only);
    if (targets.length === 0) return;

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < targets.length) {
        if (signal?.aborted) return;
        const name = targets[next++];
        const outcome = await this.searchOne(query, name);
        // A cancelled search must not keep mutating the caller's snapshot;
        // the reply that was already in flight is simply dropped.
        if (signal?.aborted) return;
        onProvider(outcome);
      }
    };

    // Read per search, not cached: changing it in settings takes effect on the
    // next search rather than the next launch.
    const lanes = Math.min(this.searchConcurrency(), targets.length);
    await Promise.all(Array.from({ length: lanes }, worker));
  }

  /** How many provider searches this app runs at once. */
  public searchConcurrency(): number {
    const stored = this.datastore.getInt(
      SETTINGS_KEY_SEARCH_CONCURRENCY,
      DEFAULT_PROVIDER_SEARCH_CONCURRENCY
    );
    if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_PROVIDER_SEARCH_CONCURRENCY;
    return Math.min(
      MAX_PROVIDER_SEARCH_CONCURRENCY,
      Math.max(MIN_PROVIDER_SEARCH_CONCURRENCY, Math.floor(stored))
    );
  }

  public setSearchConcurrency(value: number): number {
    const clamped = Math.min(
      MAX_PROVIDER_SEARCH_CONCURRENCY,
      Math.max(MIN_PROVIDER_SEARCH_CONCURRENCY, Math.floor(value) || DEFAULT_PROVIDER_SEARCH_CONCURRENCY)
    );
    this.datastore.setInt(SETTINGS_KEY_SEARCH_CONCURRENCY, clamped);
    return clamped;
  }

  public searchConcurrencyBounds(): { min: number; max: number; def: number } {
    return {
      min: MIN_PROVIDER_SEARCH_CONCURRENCY,
      max: MAX_PROVIDER_SEARCH_CONCURRENCY,
      def: DEFAULT_PROVIDER_SEARCH_CONCURRENCY,
    };
  }

  /** One provider's answer, as an outcome rather than a throw. */
  private async searchOne(query: string, name: string): Promise<ProviderSearchOutcome> {
    const started = Date.now();
    const response = await this.sidecar.call(
      'providerSearch',
      { query, providers: [name] },
      PROVIDER_CALL_TIMEOUT_MS
    );
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const error = response.error ?? 'The extension runtime did not answer.';
      this.diagnostics?.record({
        level: 'error',
        stage: 'search',
        source: name,
        query,
        message: error,
        detail: response.errorKind,
      });
      this.analytics?.observe({
        provider: name,
        stage: 'search',
        outcome: 'failure',
        latencyMs,
        error: response.errorKind ? `${response.errorKind}: ${error}` : error,
      });
      return { provider: name, results: [], latencyMs, error };
    }

    const byProvider = (response.result?.byProvider ?? {}) as Record<string, string>;
    const parsed = byProvider[name] ? safeParse(byProvider[name]) : null;
    if (!parsed) {
      const error = 'The provider returned no usable answer.';
      this.analytics?.observe({
        provider: name,
        stage: 'search',
        outcome: 'failure',
        latencyMs,
        error,
      });
      return { provider: name, results: [], latencyMs, error };
    }
    if (!parsed.ok) {
      const error =
        typeof parsed.error === 'string' ? parsed.error : 'The provider reported a failure.';
      this.diagnostics?.record({
        level: 'error',
        stage: 'search',
        source: name,
        query,
        message: error,
      });
      this.analytics?.observe({
        provider: name,
        stage: 'search',
        outcome: 'failure',
        latencyMs,
        error,
      });
      return { provider: name, results: [], latencyMs, error };
    }

    const results = mapProviderResults(name, parsed.results);
    // Recorded at `info`: knowing a provider answered — and how fast — is what
    // makes a later failure by the same provider diagnosable rather than just
    // annoying.
    this.diagnostics?.record({
      level: 'info',
      stage: 'search',
      source: name,
      query,
      message: `${results.length} result(s) in ${latencyMs}ms`,
    });
    // A clean run with no matches is `empty`, not `failure`. An anime provider
    // that has nothing for "Dune" is behaving correctly, and counting that
    // against it would rank providers by catalogue breadth rather than by
    // whether they work.
    this.analytics?.observe({
      provider: name,
      stage: 'search',
      outcome: results.length > 0 ? 'success' : 'empty',
      produced: results.length,
      latencyMs,
    });
    return { provider: name, results, latencyMs };
  }

  /**
   * Searches every enabled extension provider and waits for all of them.
   *
   * The batch form, for callers with nothing to do with a partial answer —
   * source discovery, which cannot start a stream from half a result set.
   */
  public async searchAll(query: string, only?: string[]): Promise<SearchResponse[]> {
    const out: SearchResponse[] = [];
    await this.searchEach(query, only, (outcome) => out.push(...outcome.results));
    return out;
  }

  public async loadMedia(url: string): Promise<LoadResponse | null> {
    const ref = parseExtensionUrl(url);
    if (!ref) return null;
    await this.ensureProvidersLoaded();

    const startedAt = Date.now();
    const response = await this.sidecar.call(
      'providerLoad',
      { provider: ref.provider, url: ref.target },
      PROVIDER_CALL_TIMEOUT_MS
    );
    const latencyMs = Date.now() - startedAt;

    /**
     * Every way this can fail says which way it was.
     *
     * It used to return a bare `null` for all of them, which the detail view
     * could only render as "Could not load details for this title." — the same
     * sentence whether the extension runtime was down, the provider threw, the
     * scraped page had changed shape, or the title genuinely no longer exists.
     * Four different problems, three of them actionable, one message.
     */
    /** Records the failure and hands back the error to throw. */
    const fail = (message: string, detail?: string): Error => {
      this.diagnostics?.record({
        level: 'error',
        stage: 'detail',
        source: ref.provider,
        url,
        message,
        detail,
      });
      this.analytics?.observe({
        provider: ref.provider,
        stage: 'detail',
        outcome: 'failure',
        latencyMs,
        error: detail ? `${detail}: ${message}` : message,
      });
      return new Error(message);
    };

    if (!response.ok) {
      throw fail(response.error ?? 'The extension runtime did not answer.', response.errorKind);
    }

    const parsed = safeParse(String(response.result?.json ?? ''));
    if (!parsed) throw fail(`${ref.provider} returned a reply that could not be read.`);
    if (!parsed.ok) {
      throw fail(
        typeof parsed.error === 'string'
          ? `${ref.provider}: ${parsed.error}`
          : `${ref.provider} could not load this title.`
      );
    }
    if (!parsed.found) throw fail(`${ref.provider} no longer has a page for this title.`);
    if (!parsed.detail) throw fail(`${ref.provider} returned a page with no details on it.`);

    this.analytics?.observe({
      provider: ref.provider,
      stage: 'detail',
      outcome: 'success',
      produced: 1,
      latencyMs,
    });

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
    return (await this.loadLinksDetailed(url)).links;
  }

  /**
   * Link resolution, with the reason attached when there is nothing to return.
   *
   * `loadLinks` returning a bare `[]` is why "the extension provider returned
   * no playable links for this item" was the only thing anyone could ever be
   * told. That sentence covers a timeout, a thrown extractor, a blocked host, a
   * provider with no `loadLinks` at all, a title that genuinely has no sources,
   * and a reply full of links with empty URLs — six situations, three of them
   * actionable, one message. The empty list still goes back, because a failed
   * resolve is not an exception at this layer; what changes is that the caller
   * can now say which of the six it was.
   */
  public async loadLinksDetailed(
    url: string
  ): Promise<{ links: ExtractorLink[]; diagnosis?: SourceDiagnosis }> {
    const ref = parseExtensionUrl(url);
    if (!ref) {
      return {
        links: [],
        diagnosis: {
          kind: 'unreadable-reply',
          stage: 'links',
          summary: 'This item does not carry an extension address, so no provider could be asked.',
          address: url,
          facts: [{ label: 'address', value: url }],
          at: Date.now(),
        },
      };
    }
    await this.ensureProvidersLoaded();

    const startedAt = Date.now();
    const response = await this.sidecar.call(
      'providerLoadLinks',
      { provider: ref.provider, data: ref.target },
      PROVIDER_CALL_TIMEOUT_MS
    );
    const latencyMs = Date.now() - startedAt;

    /** Shared shape for the four ways this ends with nothing. */
    const nothing = (
      kind: DiagnosisKind,
      summary: string,
      options: { hint?: string; error?: string; extra?: DiagnosisFact[]; level?: 'error' | 'warn' } = {}
    ): { links: ExtractorLink[]; diagnosis: SourceDiagnosis } => {
      this.diagnostics?.record({
        level: options.level ?? 'error',
        stage: 'links',
        source: ref.provider,
        url,
        message: summary,
        detail: options.error,
      });
      this.analytics?.observe({
        provider: ref.provider,
        stage: 'links',
        // A provider that ran and has nothing is `empty`; one that broke is
        // `failure`. The ranking treats them differently and the distinction
        // is only available here.
        outcome: kind === 'no-links' ? 'empty' : 'failure',
        latencyMs,
        error: options.error ?? summary,
      });
      return {
        links: [],
        diagnosis: {
          kind,
          stage: 'links',
          summary,
          hint: options.hint,
          provider: ref.provider,
          address: url,
          at: Date.now(),
          facts: [
            { label: 'provider', value: ref.provider },
            { label: 'address', value: url },
            { label: 'handle', value: ref.target },
            { label: 'took', value: `${latencyMs} ms` },
            ...(options.error ? [{ label: 'reported', value: options.error }] : []),
            ...(options.extra ?? []),
          ],
        },
      };
    };

    if (!response.ok) {
      const error = response.error ?? 'The extension runtime did not answer.';
      const kind: DiagnosisKind =
        response.errorKind === 'TIMEOUT'
          ? 'timeout'
          : classifyFailure(`${response.errorKind ?? ''} ${error}`);
      return nothing(
        kind,
        kind === 'timeout'
          ? `${ref.provider} did not answer in time.`
          : `${ref.provider} could not be reached.`,
        {
          error,
          extra: response.errorKind ? [{ label: 'errorKind', value: response.errorKind }] : [],
          hint:
            kind === 'timeout'
              ? 'The site is slow or unreachable from here. Other providers may still have this title.'
              : undefined,
        }
      );
    }

    const parsed = safeParse(String(response.result?.json ?? ''));
    if (!parsed?.ok) {
      const error =
        typeof parsed?.error === 'string'
          ? parsed.error
          : 'The provider returned an unreadable reply for this item.';
      const kind = classifyFailure(error);
      return nothing(kind, summarizeLinkFailure(ref.provider, kind, error), {
        error,
        hint: FAILURE_KIND_LABELS[kind as FailureKind]?.hint,
      });
    }

    const rawLinks = Array.isArray(parsed.links)
      ? (parsed.links as Array<Record<string, unknown>>)
      : [];

    if (rawLinks.length === 0) {
      // The provider ran. Whether that is a fault depends on what it said about
      // itself, and the bridge already reports it.
      const reportedFailure = parsed.reportedSuccess === false;
      return nothing(
        reportedFailure ? 'provider-error' : 'no-links',
        reportedFailure
          ? `${ref.provider} reported a failure while resolving this item.`
          : `${ref.provider} has no sources for this item.`,
        {
          level: reportedFailure ? 'error' : 'warn',
          hint: reportedFailure
            ? 'The extension ran but could not extract anything. Worth reporting to its maintainer.'
            : 'Try “Find more sources” to ask the other enabled providers.',
        }
      );
    }

    const links = rawLinks.map((link) => ({
      source: link.source ? String(link.source) : ref.provider,
      name: link.name ? String(link.name) : ref.provider,
      url: String(link.url ?? ''),
      referer: link.referer ? String(link.referer) : '',
      quality: typeof link.quality === 'number' ? link.quality : 0,
      isM3u8: Boolean(link.isM3u8) || link.type === 'M3U8',
      isDash: link.type === 'DASH',
      headers: (link.headers as Record<string, string> | undefined) ?? {},
    }));

    // Links with no address are not links. This happens when an extractor
    // half-succeeds — it built the result object and failed to fill it — and
    // it used to reach the player as a source that could never load.
    const usable = links.filter((link) => /^https?:\/\//i.test(link.url) || link.url.startsWith('magnet:'));
    if (usable.length === 0) {
      return nothing(
        'links-unusable',
        `${ref.provider} returned ${links.length} source(s), none with a usable address.`,
        {
          hint: 'The extractor produced results but could not resolve them to a playable URL — usually the file host changed.',
          extra: links.slice(0, 5).map((link, index) => ({
            label: `source ${index + 1}`,
            value: `${link.name} → ${link.url || '(empty)'}`,
          })),
        }
      );
    }

    this.diagnostics?.record({
      level: 'info',
      stage: 'links',
      source: ref.provider,
      url,
      message: `${usable.length} playable link(s)`,
    });
    this.analytics?.observe({
      provider: ref.provider,
      stage: 'links',
      outcome: 'success',
      produced: usable.length,
      latencyMs,
    });

    return { links: usable };
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

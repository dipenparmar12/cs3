#!/usr/bin/env node
/**
 * End-to-end proof that community `.cs3` extensions actually work on desktop.
 *
 * The pipeline this exercises has five links and every one of them has failed
 * silently at some point, in a way that looked exactly like the one after it:
 *
 *   repository JSON → artifact download → (DEX→JVM translation) → `load()`
 *   → `search()` → `load()` → `loadLinks()` → bytes off the wire
 *
 * The translation step is parenthesised because it is now conditional. Where a
 * repository publishes a cross-platform jar — 47 of 79 in the phisher
 * repository, 5 of 5 in `recloudstream/extensions` `[measured]` — the app
 * installs that instead and there is nothing to translate. `--lane cs3` forces
 * the DEX artifact, so the same corpus can be run both ways and compared.
 *
 * The point is bytes. A provider that answers a search has proved translation
 * and HTTP work; it has not proved the link it returns plays, and "plays" is the
 * only claim worth making. So the run ends by range-GETting a couple of MB from
 * a resolved link and reporting the number.
 *
 * Deliberately standalone: it talks to the JVM sidecar over the same
 * line-delimited JSON-RPC the Electron main process uses, without Electron in
 * the way. When this passes and the app does not, the bug is in the app; when
 * this fails, it is in the runtime or the extension. That split is most of the
 * debugging value.
 *
 * Usage:
 *   node tools/e2e/provider-e2e.mjs
 *   node tools/e2e/provider-e2e.mjs --repo MegaRepo --plugins 3 --queries "one piece,dune"
 *   node tools/e2e/provider-e2e.mjs --list
 *   node tools/e2e/provider-e2e.mjs --json report.json
 *   node tools/e2e/provider-e2e.mjs --lane cs3     # force the DEX artifact
 *
 * Exit code is 0 only if at least one provider searched *and* at least one
 * stream delivered bytes.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SIDECAR_TARGET = path.join(REPO_ROOT, 'sidecar', 'target');
const TOOLCHAIN = path.join(REPO_ROOT, 'tools', 'toolchain');

/** The repositories under test. Named so `--repo` can pick one. */
const REPOSITORIES = [
  { name: 'cs-kraptor', url: 'https://raw.githubusercontent.com/Kraptor123/cs-kraptor/builds/plugins.json' },
  {
    name: 'GermanProviders',
    url: 'https://raw.githubusercontent.com/Bnyro/GermanProviders/master/repo.json',
  },
  {
    // The OTT lane: one archive registering Netflix, Prime Video, Hotstar and
    // Disney Plus. Here because `bundled: true` in the repository catalogue is
    // a claim this harness has driven the repository end to end.
    name: 'NetMirror',
    url: 'https://raw.githubusercontent.com/Sushan64/NetMirror-Extension/builds/Netflix.json',
  },
  {
    name: 'CNCVerse',
    url: 'https://raw.githubusercontent.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/builds/CNC.json',
  },
  { name: 'phisher', url: 'https://github.com/phisher98/cloudstream-extensions-phisher' },
  { name: 'cinephile', url: 'https://github.com/rockhero1234/cinephile' },
  {
    name: 'MegaRepo',
    url: 'https://raw.githubusercontent.com/self-similarity/MegaRepo/builds/repo.json',
  },
  /**
   * CloudStream X — a bare plugin array at `builds/CS.json`, not a `repo.json`.
   *
   * Added because it is a candidate for `bundled: true`, and `bundled` in
   * `official_repositories.json` is a claim that this harness has driven the
   * repository end to end. Setting the flag without running it would make the
   * flag mean nothing.
   */
  { name: 'CSX', url: 'https://raw.githubusercontent.com/SaurabhKaperwan/CSX/builds/CS.json' },
];

/**
 * Queries chosen to have an answer almost everywhere.
 *
 * Deliberately spread across regions and eras: a German-only provider returns
 * nothing for an Indian film and vice versa, and a single query would make a
 * perfectly working provider look broken.
 */
const DEFAULT_QUERIES = ['one piece', 'dune', 'matrix'];

/** Same branch/filename practice the app probes. There is no convention here. */
const REPO_BRANCHES = ['master', 'main', 'builds', 'refs/heads/main', 'refs/heads/master'];
const REPO_FILENAMES = [
  'repo.json',
  'plugins.json',
  'repos.json',
  'CS.json',
  'builds/repo.json',
  'builds/plugins.json',
];

const RPC_TIMEOUT_MS = 90_000;
const STREAM_BYTES_WANTED = 2 * 1024 * 1024;
/** Search hits tried per provider before giving up on it. See the search stage. */
const CANDIDATES_PER_PROVIDER = 3;

// --- arguments --------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    repo: null,
    plugins: 2,
    queries: DEFAULT_QUERIES,
    list: false,
    json: null,
    keep: false,
    java: null,
    only: null,
    /**
     * `auto` mirrors the app: the cross-platform jar wherever one is published,
     * the `.cs3` otherwise. `--lane cs3` pins the DEX artifact.
     */
    lane: 'auto',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') args.list = true;
    else if (arg === '--keep') args.keep = true;
    else if (arg === '--java') args.java = argv[++i];
    else if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--plugins') args.plugins = Math.max(1, parseInt(argv[++i], 10) || 2);
    else if (arg === '--json') args.json = argv[++i];
    /**
     * Which artifact to install. `auto` (default) takes the cross-platform jar
     * wherever a repository publishes one, exactly as the app now does; `cs3`
     * forces the DEX archive, which is how the no-regression half of PRD-41 M0
     * is measured — the same corpus, both ways, compared.
     */
    else if (arg === '--lane') args.lane = argv[++i] === 'cs3' ? 'cs3' : 'auto';
    // Names a specific extension, which `--plugins N` cannot reach: it takes
    // the first N as published, and a failing extension is as likely to be
    // sixtieth as second. Reproducing a user's report meant running the whole
    // repository and waiting for the one archive that mattered.
    else if (arg === '--only') {
      args.only = argv[++i]
        .split(',')
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean);
    }
    else if (arg === '--queries') {
      args.queries = argv[++i]
        .split(',')
        .map((q) => q.trim())
        .filter(Boolean);
    }
  }
  return args;
}

// --- output -----------------------------------------------------------------

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};
const log = (...a) => console.log(...a);
const step = (msg) => log(`${C.cyan}▸${C.reset} ${msg}`);
const ok = (msg) => log(`  ${C.green}✓${C.reset} ${msg}`);
const bad = (msg) => log(`  ${C.red}✗${C.reset} ${msg}`);
const warn = (msg) => log(`  ${C.yellow}!${C.reset} ${msg}`);
const dim = (msg) => log(`  ${C.dim}${msg}${C.reset}`);

// --- java -------------------------------------------------------------------

/**
 * Finds a JVM new enough to load the sidecar, which is class file 65.
 *
 * Mirrors `SidecarSupervisor.resolveJava`, including the toolchain fallback —
 * the machine this was written on had `JAVA_HOME` on Java 17 with a perfectly
 * good JDK 21 checked into `tools/toolchain`, and every extension reported
 * itself permanently "initializing" as a result.
 */
function resolveJava(explicit) {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];

  // `--java` points at the runtime that will actually ship. Running the corpus
  // against the jlinked JRE is the only way to know the module set is complete:
  // a missing `jdk.crypto.ec` or `jdk.localedata` breaks TLS or date parsing at
  // runtime, in one provider at a time, long after the build succeeded.
  if (explicit) candidates.push(explicit);
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  try {
    for (const entry of fs.readdirSync(TOOLCHAIN).sort().reverse()) {
      if (entry.toLowerCase().startsWith('jdk')) {
        candidates.push(path.join(TOOLCHAIN, entry, 'bin', exe));
      }
    }
  } catch {
    // No toolchain directory; the other candidates still apply.
  }
  candidates.push(exe);

  const rejected = [];
  for (const candidate of candidates) {
    const isBare = candidate === exe;
    if (!isBare && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 8000 });
    const output = `${probe.stderr ?? ''}${probe.stdout ?? ''}`;
    const match = output.match(/version "(\d+)(?:\.(\d+))?/);
    if (!match) continue;
    const major = match[1] === '1' ? parseInt(match[2] ?? '0', 10) : parseInt(match[1], 10);
    if (major >= 21) return { path: candidate, major };
    rejected.push(`${isBare ? 'java on PATH' : candidate} is Java ${major}`);
  }
  throw new Error(
    `No Java 21+ found. Rejected: ${rejected.join(', ') || 'nothing was probed'}. ` +
      `Unpack a JDK 21 into tools/toolchain/ or point JAVA_HOME at one.`
  );
}

// --- sidecar rpc ------------------------------------------------------------

/** Line-delimited JSON-RPC over the sidecar's stdio, multiplexed by id. */
class Sidecar {
  constructor(javaPath, dataDir) {
    this.javaPath = javaPath;
    this.dataDir = dataDir;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = [];
  }

  start() {
    const jar = path.join(SIDECAR_TARGET, 'cs3-sidecar.jar');
    if (!fs.existsSync(jar)) {
      throw new Error(`${jar} is missing. Build it with: mvn -f sidecar/pom.xml package`);
    }
    const runtime = path.join(REPO_ROOT, 'sidecar', 'runtime');
    if (!fs.existsSync(path.join(runtime, 'cs3-provider-bridge.jar'))) {
      throw new Error(
        `${runtime}/cs3-provider-bridge.jar is missing. Build it with: ` +
          `mvn -f sidecar/runtime-deps/pom.xml package && mvn -f sidecar/bridge/pom.xml package`
      );
    }

    fs.mkdirSync(this.dataDir, { recursive: true });
    const classpath = [jar, path.join(SIDECAR_TARGET, 'lib', '*')].join(path.delimiter);

    this.proc = spawn(
      this.javaPath,
      [
        '-Xmx512m',
        '-Djava.library.path=',
        '-Dfile.encoding=UTF-8',
        '-cp',
        classpath,
        'com.cloudstream.desktop.sidecar.Main',
        `--data-dir=${this.dataDir}`,
        `--runtime-classpath=${runtime}`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) this.stderr.push(line.trim());
    });
    this.proc.on('exit', (code) => {
      for (const [, entry] of this.pending) {
        entry.resolve({ ok: false, error: `sidecar exited with code ${code}` });
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        try {
          const frame = JSON.parse(line);
          const entry = this.pending.get(String(frame.id));
          if (entry) {
            this.pending.delete(String(frame.id));
            clearTimeout(entry.timer);
            entry.resolve(frame);
          }
        } catch {
          // Plugin noise on stdout would desynchronise the channel; the sidecar
          // forces it to stderr, so anything unparsable here is worth showing.
          console.warn(`  unparsable frame: ${line.slice(0, 160)}`);
        }
      }
      index = this.buffer.indexOf('\n');
    }
  }

  call(method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    const id = String(this.nextId++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `${method} timed out after ${timeoutMs}ms` });
      }, timeoutMs + 2000);
      this.pending.set(id, { resolve, timer });
      this.proc.stdin.write(`${JSON.stringify({ id, method, params: { ...params, timeoutMs } })}\n`);
    });
  }

  /**
   * Shuts the JVM down and waits for it to actually exit.
   *
   * Waiting is not politeness. The plugin class loaders hold the `.cs3`
   * archives open, and on Windows deleting the work directory while the process
   * is still alive fails with `EBUSY` — which surfaced as the whole run exiting
   * non-zero after it had already passed.
   */
  async stop() {
    if (!this.proc || this.proc.exitCode !== null) return;
    const exited = new Promise((resolve) => this.proc.once('exit', resolve));
    try {
      this.proc.stdin.end();
    } catch {
      // Already gone; the kill below is the backstop.
    }
    const killer = setTimeout(() => this.proc?.kill(), 3000);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
    clearTimeout(killer);
  }
}

// --- repository resolution --------------------------------------------------

async function fetchJson(url, timeoutMs = 15_000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'CloudStream3-Desktop-E2E' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function looksLikeRepository(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => entry && typeof entry === 'object' && 'internalName' in entry);
  }
  return Boolean(value && typeof value === 'object' && Array.isArray(value.pluginLists));
}

function rawCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return [];
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');

  const out = [];
  for (const branch of REPO_BRANCHES) {
    for (const file of REPO_FILENAMES) {
      const candidate =
        parsed.hostname === 'gitlab.com'
          ? `https://gitlab.com/${owner}/${repo}/-/raw/${branch}/${file}`
          : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`;
      if (candidate !== url && !out.includes(candidate)) out.push(candidate);
    }
  }
  return out;
}

/** Project pages return HTML, so the raw document has to be probed for. */
async function resolveRepository(url) {
  try {
    const document = await fetchJson(url);
    if (looksLikeRepository(document)) return { url, document };
  } catch {
    // Expected for a github.com project page.
  }
  for (const candidate of rawCandidates(url)) {
    try {
      const document = await fetchJson(candidate, 8000);
      if (looksLikeRepository(document)) return { url: candidate, document };
    } catch {
      // Most candidates are 404s by design.
    }
  }
  throw new Error('Could not resolve a CloudStream repository document');
}

async function listPlugins(document) {
  if (Array.isArray(document)) return document;
  const plugins = [];
  for (const listUrl of document.pluginLists ?? []) {
    try {
      const list = await fetchJson(listUrl);
      if (Array.isArray(list)) plugins.push(...list);
    } catch (error) {
      warn(`plugin list ${listUrl}: ${error.message}`);
    }
  }
  return plugins;
}

/**
 * Which artifact to fetch, mirroring `PluginManager.chooseArtifact`.
 *
 * The harness has to make the same choice the app makes or it stops measuring
 * the app. `--lane cs3` forces the DEX artifact, which is what proves M0's
 * other half: the jar lane must not regress the archives that stay on DEX, and
 * the only way to show that is to run the same corpus both ways.
 */
function chooseArtifact(plugin, lane) {
  if (lane !== 'cs3' && plugin.jarUrl) {
    return { url: plugin.jarUrl, hash: plugin.jarHash, lane: 'jar', ext: 'csj' };
  }
  return { url: plugin.url, hash: plugin.fileHash, lane: 'cs3', ext: 'cs3' };
}

async function downloadPlugin(plugin, dir, lane) {
  const artifact = chooseArtifact(plugin, lane);

  const response = await fetch(artifact.url, {
    signal: AbortSignal.timeout(60_000),
    headers: { 'User-Agent': 'CloudStream3-Desktop-E2E' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  // Matches `PluginManager.installPlugin`, prefix strip included: repositories
  // publish the digest as `sha256-<hex>`, and comparing the raw string fails
  // against a perfectly good download. The hash checked is the one published
  // for *this* artifact — a jar verified against `fileHash` would fail every
  // time, and skipping the check on mismatch would be worse than not checking.
  if (artifact.hash) {
    const digest = createHash('sha256').update(buffer).digest('hex');
    const expected = String(artifact.hash).replace(/^sha256-/i, '').toLowerCase();
    if (expected !== digest) {
      throw new Error(`SHA-256 mismatch (published ${expected.slice(0, 12)}…, got ${digest.slice(0, 12)}…)`);
    }
  }

  const file = path.join(dir, `${plugin.internalName}.${artifact.ext}`);
  fs.writeFileSync(file, buffer);
  return { file, bytes: buffer.length, lane: artifact.lane };
}

// --- streaming proof --------------------------------------------------------

/**
 * Pulls real bytes from a resolved link.
 *
 * A `Range` request is used so the check costs a couple of MB rather than a
 * whole film, and because a server that honours ranges is also one the player's
 * seek will work against. `206` and a plain `200` are both accepted — some
 * providers front their files with servers that ignore the header.
 */
async function pullBytes(link) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Range: `bytes=0-${STREAM_BYTES_WANTED - 1}`,
    ...(link.headers ?? {}),
  };
  if (link.referer) headers.Referer = link.referer;

  const response = await fetch(link.url, {
    headers,
    signal: AbortSignal.timeout(45_000),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received >= STREAM_BYTES_WANTED) break;
  }

  return {
    bytes: received,
    status: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    acceptsRanges: response.status === 206 || response.headers.get('accept-ranges') === 'bytes',
  };
}

/** An HLS playlist is text, so "bytes arrived" is not enough — it must parse. */
function looksLikeHls(url, contentType) {
  return url.includes('.m3u8') || (contentType ?? '').includes('mpegurl');
}

/**
 * Detail page → playable handle → links, for one search result.
 *
 * The two-step is not incidental. An episode's URL already *is* the provider's
 * playable handle, but a film's is its detail page, and those differ — so
 * `loadLinks` has to be given `dataUrl` from the detail response rather than
 * the URL the search returned.
 */
async function resolveLinks(sidecar, provider, item) {
  const detail = await sidecar.call('providerLoad', { provider, url: item.url });
  if (!detail.ok) return { list: [], error: detail.error };

  let parsedDetail;
  try {
    parsedDetail = JSON.parse(detail.result?.json ?? '{}');
  } catch {
    return { list: [], error: 'unparsable detail reply' };
  }
  if (!parsedDetail.ok) return { list: [], error: parsedDetail.error ?? 'detail load failed' };
  if (parsedDetail.found === false) return { list: [], error: 'provider has no detail page for this' };

  /**
   * The bridge nests the load response under `detail`, and reading the top
   * level instead silently produced `undefined` for every handle — so the fall
   * back to the search result's page URL fired for *every* film, and providers
   * whose `loadLinks` expects an opaque handle reported "0 links" or choked on
   * being handed a URL. That understated link resolution across the whole
   * corpus. `data` is upstream's load-bearing field; see `encodeEpisode`.
   */
  const detailBody = parsedDetail.detail ?? parsedDetail;
  const handle =
    detailBody.dataUrl ??
    detailBody.episodes?.[0]?.data ??
    detailBody.episodes?.[0]?.url ??
    item.url;

  const links = await sidecar.call('providerLoadLinks', { provider, data: handle });
  if (!links.ok) return { list: [], error: links.error };

  let parsedLinks;
  try {
    parsedLinks = JSON.parse(links.result?.json ?? '{}');
  } catch {
    return { list: [], error: 'unparsable links reply' };
  }

  const list = Array.isArray(parsedLinks.links) ? parsedLinks.links.filter((l) => l?.url) : [];
  return { list, error: list.length === 0 ? (parsedLinks.error ?? undefined) : undefined };
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const repo of REPOSITORIES) log(`${repo.name.padEnd(18)} ${repo.url}`);
    return 0;
  }

  const targets = args.repo
    ? REPOSITORIES.filter((r) => r.name.toLowerCase().includes(args.repo.toLowerCase()))
    : REPOSITORIES;
  if (targets.length === 0) {
    bad(`No repository matches "${args.repo}". Try --list.`);
    return 2;
  }

  const java = resolveJava(args.java);
  step(`Java ${java.major} at ${java.path}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-e2e-'));
  const sidecar = new Sidecar(java.path, path.join(workDir, 'runtime'));
  const report = { startedAt: new Date().toISOString(), java: java.major, repositories: [] };

  try {
    sidecar.start();

    const status = await sidecar.call('status', {}, 20_000);
    if (!status.ok) throw new Error(`sidecar status failed: ${status.error}`);
    if (!status.result?.canExecute) {
      throw new Error(
        `sidecar cannot execute providers: ${status.result?.reason ?? 'no reason given'}`
      );
    }
    ok(`sidecar up, providers executable`);
    if (Array.isArray(status.result.sandboxGaps) && status.result.sandboxGaps.length > 0) {
      dim(`sandbox gaps: ${status.result.sandboxGaps.join(', ')}`);
    }

    const archives = path.join(workDir, 'plugins');
    fs.mkdirSync(archives, { recursive: true });

    // --- install ----------------------------------------------------------
    const loaded = [];
    for (const target of targets) {
      step(`${C.bold}${target.name}${C.reset}`);
      const entry = { name: target.name, url: target.url, plugins: [] };
      report.repositories.push(entry);

      let resolved;
      try {
        resolved = await resolveRepository(target.url);
        ok(`repository document: ${resolved.url}`);
      } catch (error) {
        bad(`repository: ${error.message}`);
        entry.error = error.message;
        continue;
      }

      const plugins = (await listPlugins(resolved.document))
        .filter((p) => p?.url && p?.internalName)
        // Plugins the repository itself marks as down are not a fair test.
        .filter((p) => p.status === undefined || p.status !== 0);
      ok(`${plugins.length} plugin(s) published`);

      // `--only` overrides the cap: naming three extensions and then taking the
      // first two of them would silently drop one.
      const selected = args.only
        ? plugins.filter((p) =>
            args.only.some(
              (want) =>
                String(p.internalName).toLowerCase().includes(want) ||
                String(p.name ?? '').toLowerCase().includes(want)
            )
          )
        : plugins.slice(0, args.plugins);
      if (args.only) ok(`${selected.length} plugin(s) matched --only`);

      for (const plugin of selected) {
        const record = { internalName: plugin.internalName, name: plugin.name };
        entry.plugins.push(record);
        try {
          const { file, bytes, lane } = await downloadPlugin(plugin, archives, args.lane);
          record.bytes = bytes;
          record.lane = lane;

          const result = await sidecar.call('load', {
            pluginId: plugin.internalName,
            path: file,
          });
          if (!result.ok) {
            bad(`${plugin.internalName}: ${result.error}`);
            record.error = result.error;
            continue;
          }
          const providers = result.result?.providers ?? [];
          record.tier = result.result?.tier;
          record.providers = providers.map((p) => p.name ?? String(p));
          ok(
            `${plugin.internalName}: ${record.tier} [${lane}], ${providers.length} provider(s)` +
              (providers.length > 0 ? ` — ${record.providers.join(', ')}` : '')
          );
          for (const provider of providers) {
            if (provider?.name) loaded.push({ ...provider, repo: target.name });
          }
        } catch (error) {
          bad(`${plugin.internalName}: ${error.message}`);
          record.error = error.message;
        }
      }
    }

    if (loaded.length === 0) {
      bad('No providers loaded — nothing to search.');
      report.verdict = 'no-providers';
      return 1;
    }

    // --- search -----------------------------------------------------------
    step(`Searching ${loaded.length} provider(s) × ${args.queries.length} quer(y|ies)`);
    const searchReport = [];
    report.search = searchReport;
    /** Providers that answered, with one result kept for the link stage. */
    const answered = [];

    for (const provider of loaded) {
      const record = { provider: provider.name, repo: provider.repo, queries: [] };
      searchReport.push(record);
      /**
       * Several candidates, not one.
       *
       * A provider's top hit is regularly something with no stream behind it —
       * a trailer, a listing page, an episode that has aged out of a
       * broadcaster's catch-up window. Judging the provider on that one row
       * reported working providers as broken.
       */
      const candidates = [];

      for (const query of args.queries) {
        const started = Date.now();
        const response = await sidecar.call('providerSearch', {
          providers: [provider.name],
          query,
        });
        const elapsed = Date.now() - started;

        let count = 0;
        let error;
        if (!response.ok) {
          error = response.error;
        } else {
          const raw = response.result?.byProvider?.[provider.name];
          try {
            const parsed = JSON.parse(raw ?? '{}');
            if (parsed.ok && Array.isArray(parsed.results)) {
              count = parsed.results.length;
              for (const item of parsed.results.slice(0, CANDIDATES_PER_PROVIDER)) {
                if (item?.url) candidates.push({ query, item });
              }
            } else {
              error = parsed.error ?? 'provider reported failure';
            }
          } catch {
            error = 'unparsable provider reply';
          }
        }

        record.queries.push({ query, count, ms: elapsed, error });
        const line = `${provider.name} "${query}": ${count} result(s) in ${elapsed}ms`;
        if (error) bad(`${line} — ${error}`);
        else if (count > 0) ok(line);
        else warn(line);
      }

      if (candidates.length > 0) {
        answered.push({
          provider: provider.name,
          repo: provider.repo,
          candidates: candidates.slice(0, CANDIDATES_PER_PROVIDER),
        });
      }
    }

    if (answered.length === 0) {
      bad('No provider returned a single result.');
      report.verdict = 'no-results';
      return 1;
    }
    ok(`${answered.length} of ${loaded.length} provider(s) returned results`);

    // --- resolve and stream ------------------------------------------------
    step('Resolving playable links');
    const streams = [];
    report.streams = streams;

    for (const entry of answered) {
      const record = { provider: entry.provider, repo: entry.repo, attempts: [] };
      streams.push(record);

      for (const candidate of entry.candidates) {
        const attempt = { title: candidate.item?.name, query: candidate.query };
        record.attempts.push(attempt);

        const links = await resolveLinks(sidecar, entry.provider, candidate.item);
        attempt.linkCount = links.list.length;
        if (links.error) attempt.error = links.error;

        if (links.list.length === 0) {
          warn(`${entry.provider} "${attempt.title}": 0 links (${links.error ?? 'none offered'})`);
          continue;
        }
        ok(`${entry.provider} "${attempt.title}": ${links.list.length} link(s)`);
        record.linkCount = links.list.length;

        // Only the first few are pulled: the goal is proof that the chain
        // works, not a survey of every mirror a provider knows about.
        for (const link of links.list.slice(0, 3)) {
          if (!/^https?:/i.test(link.url)) continue;
          try {
            const pulled = await pullBytes(link);
            const stream = {
              source: link.source ?? link.name,
              status: pulled.status,
              bytes: pulled.bytes,
              contentType: pulled.contentType,
              acceptsRanges: pulled.acceptsRanges,
              hls: looksLikeHls(link.url, pulled.contentType),
            };
            record.stream = stream;
            attempt.stream = stream;
            ok(
              `${entry.provider} ← ${(pulled.bytes / 1024 / 1024).toFixed(2)} MB from ` +
                `${link.source ?? 'link'} (HTTP ${pulled.status}, ` +
                `${pulled.contentType ?? 'no content-type'}` +
                `${pulled.acceptsRanges ? ', ranges ok' : ''})`
            );
            break;
          } catch (error) {
            attempt.streamError = error.message;
            warn(`${entry.provider} ← ${link.source ?? 'link'}: ${error.message}`);
          }
        }

        if (record.stream) break;
      }
    }

    // --- verdict ------------------------------------------------------------
    const withBytes = streams.filter((s) => s.stream?.bytes > 0);
    const searched = searchReport.filter((r) => r.queries.some((q) => q.count > 0));

    // --- per repository -----------------------------------------------------
    log('');
    step(`${C.bold}By repository${C.reset}`);
    const perRepo = new Map();
    for (const provider of loaded) {
      const row = perRepo.get(provider.repo) ?? { loaded: 0, answering: 0, links: 0, bytes: 0 };
      row.loaded += 1;
      perRepo.set(provider.repo, row);
    }
    for (const entry of searchReport) {
      if (entry.queries.some((q) => q.count > 0)) {
        const row = perRepo.get(entry.repo);
        if (row) row.answering += 1;
      }
    }
    for (const entry of streams) {
      const row = perRepo.get(entry.repo);
      if (!row) continue;
      if (entry.linkCount > 0) row.links += 1;
      if (entry.stream?.bytes > 0) row.bytes += 1;
    }
    report.byRepository = Object.fromEntries(perRepo);

    log(`  ${'repository'.padEnd(18)} ${'loaded'} ${'answer'} ${'links'} ${'bytes'}`);
    for (const [name, row] of perRepo) {
      const health = row.bytes > 0 ? C.green : row.answering > 0 ? C.yellow : C.red;
      log(
        `  ${health}${name.padEnd(18)}${C.reset} ` +
          `${String(row.loaded).padStart(6)} ${String(row.answering).padStart(6)} ` +
          `${String(row.links).padStart(5)} ${String(row.bytes).padStart(5)}`
      );
    }

    log('');
    step(`${C.bold}Result${C.reset}`);
    log(`  providers loaded    ${loaded.length}`);
    log(`  providers answering ${searched.length}`);
    log(`  links resolved      ${streams.filter((s) => s.linkCount > 0).length}`);
    log(`  streams with bytes  ${withBytes.length}`);

    report.verdict = withBytes.length > 0 ? 'pass' : searched.length > 0 ? 'partial' : 'fail';
    report.summary = {
      providersLoaded: loaded.length,
      providersAnswering: searched.length,
      linksResolved: streams.filter((s) => s.linkCount > 0).length,
      streamsWithBytes: withBytes.length,
    };

    if (report.verdict === 'pass') {
      ok(`${C.bold}PASS${C.reset} — extensions load, scrape and stream`);
      return 0;
    }
    if (report.verdict === 'partial') {
      warn(
        `${C.bold}PARTIAL${C.reset} — providers scrape, but no link delivered bytes. ` +
          `Bot-protected file hosts are the usual cause (doc 36 step 7, the WebView bridge).`
      );
      return 1;
    }
    bad(`${C.bold}FAIL${C.reset} — nothing scraped`);
    return 1;
  } finally {
    if (sidecar.stderr.length > 0) {
      log('');
      dim(`sidecar stderr (last 15 of ${sidecar.stderr.length}):`);
      for (const line of sidecar.stderr.slice(-15)) dim(`  ${line}`);
    }
    await sidecar.stop();
    report.finishedAt = new Date().toISOString();
    if (args.json) {
      fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
      dim(`report written to ${args.json}`);
    }
    if (args.keep) {
      dim(`work directory kept at ${workDir}`);
    } else {
      try {
        // `maxRetries` covers the moment between the JVM exiting and Windows
        // releasing its file handles. A leftover temp directory is not worth
        // failing a run that otherwise passed, so this never throws.
        fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch (error) {
        dim(`could not remove ${workDir}: ${error.message}`);
      }
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    bad(error.stack ?? error.message);
    process.exit(2);
  });

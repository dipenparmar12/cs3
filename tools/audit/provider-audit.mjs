#!/usr/bin/env node
/**
 * Provider compatibility audit: every installed provider, one stage at a
 * time, with evidence (Provider Compatibility Audit PRD, docs/roadmap/
 * 2026-10-providers-support-testing.md).
 *
 * The decisions live in desktop/electron/cs3/audit/ (pure, tested); this file
 * only does the I/O: discovers archives, copies them into the run directory
 * (never touching the profile it read them from), drives the JVM sidecar over
 * the same JSON-RPC the app uses, writes one journal line per stage, and
 * reduces the journal into reports.
 *
 * Stages: S0 discover, S1 load, S2 site (declaration, and one GET of its front
 * page), S3 catalogue, S4 search (round trip on a title the provider listed),
 * S5 detail, S6 links, then for up to three links S7 reach (HEAD, a one-byte
 * range probe, a 64 KB read, and a header differential on a 401/403), S8
 * inspect (the shipping `MediaProxy` and `MediaInspector`, under a 16 MB cap)
 * and S9 route (`decideStrategy` on eight machine profiles). Every source byte
 * goes through the headless Electron worker (`net-worker.cjs`), so Chromium's
 * network judges the source as the app's would. S10 (play) is opt-in
 * (`--verify element|ffmpeg|mpv|all`): the first routed source per provider
 * plays on the tier its route on this machine names, `<video>`/hls.js in the
 * worker's hidden window, the shipping `MediaTranscoder`, or mpv, each capped
 * at 32 MB and 12 s. Without it S10 is `skipped: stage-filter`.
 *
 * Usage (from the repo root; Java 21 and sidecar/target/cs3-sidecar.jar needed):
 *   node --experimental-strip-types tools/audit/provider-audit.mjs list --profile <userData dir>
 *   node --experimental-strip-types tools/audit/provider-audit.mjs full --profile <dir>
 *   node --experimental-strip-types tools/audit/provider-audit.mjs target --profile <dir> --provider Animegg,CineStream
 *   node --experimental-strip-types tools/audit/provider-audit.mjs resume <runId>
 *   node --experimental-strip-types tools/audit/provider-audit.mjs report <runId>
 *   node --experimental-strip-types tools/audit/provider-audit.mjs diff <runIdA> <runIdB>
 *
 * Options: --archive <file.cs3> (repeatable) · --include-adult · --rows 2 ·
 * --offline (S0–S6 only, no network worker) · --verify none|element|ffmpeg|mpv|all
 * (S10, default none) · --out <dir> (default
 * tools/audit/runs) · --java <path> · --verbose
 *
 * A maintainer tool: it contacts third-party sites, one request at a time per
 * provider. Exit code: 0 ran to completion (even with failures) · 1 diff found
 * regressions · 2 could not run.
 */

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Sidecar, resolveJava } from '../e2e/catalogue-e2e.mjs';
import { attribute } from '../../desktop/electron/cs3/audit/attribution.ts';
import { BYTE_CAPS, ByteMeter, HostLimiter } from '../../desktop/electron/cs3/audit/budget.ts';
import { judgeInspection, judgeRoute } from '../../desktop/electron/cs3/audit/mediaEvidence.ts';
import { judgeReach, judgeSite } from '../../desktop/electron/cs3/audit/networkEvidence.ts';
import { detectExtensionPicky, detectToneMapSupport, MediaInspector } from '../../desktop/electron/media/mediaInspector.ts';
import { MediaProxy } from '../../desktop/electron/mediaProxy.ts';
import { NetWorker, meteredFetch } from './net-client.mjs';
import { playConversion, playElement, playMpv } from './players.mjs';
import { judgePlayback, playbackTiers, VERIFY_CAPS, VERIFY_REQUESTS } from '../../desktop/electron/cs3/audit/playbackEvidence.ts';
import { MediaTranscoder } from '../../desktop/electron/mediaTranscoder.ts';
import { diffRuns, hasRegressions } from '../../desktop/electron/cs3/audit/diff.ts';
import {
  AUDIT_SCHEMA_VERSION,
  STAGES,
  STAGE_LABELS,
  parseJournalLine,
  printable,
} from '../../desktop/electron/cs3/audit/schema.ts';
import {
  declaration,
  judgeCatalogue,
  judgeDetail,
  judgeLinks,
  judgeLoad,
  judgeSearch,
} from '../../desktop/electron/cs3/audit/stageEvidence.ts';
import { conservation, providerResult, reduceJournal } from '../../desktop/electron/cs3/audit/stageResult.ts';
import { classifyFailure, groupingForm } from '../../desktop/electron/cs3/failureTaxonomy.ts';
import { jvmHeapMb } from '../../desktop/electron/cs3/jvmHeap.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_OUT = path.join(HERE, 'runs');
const RPC_TIMEOUT_MS = 90_000;
const LOAD_TIMEOUT_MS = 180_000;
/** The ffprobe the app ships (`build-media-runtime.mjs`), else one on PATH. */
/** The bundled media runtime first, as the app resolves it, then PATH. */
function mediaTool(name, windowsName = `${name}.exe`) {
  const exe = process.platform === 'win32' ? windowsName : name;
  const candidates = [
    path.join(REPO_ROOT, 'desktop', 'media-runtime', exe),
    ...(process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, exe)),
  ];
  return candidates.find((file) => file && fs.existsSync(file)) ?? null;
}
const FFPROBE = mediaTool('ffprobe');
const FFMPEG = mediaTool('ffmpeg');
// mpv.com, not mpv.exe: the console build is the one the app drives (AGENTS §6).
const MPV = mediaTool('mpv', 'mpv.com');

// --- arguments ----------------------------------------------------------------

function parseArgs(argv) {
  const args = { mode: argv[0], positional: [], archives: [], providers: null, rows: 2, out: DEFAULT_OUT, verify: 'none' };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--profile') args.profile = next();
    else if (arg === '--archive') args.archives.push(next());
    else if (arg === '--provider') args.providers = next().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (arg === '--rows') args.rows = Math.max(1, Number(next()) || 2);
    else if (arg === '--out') args.out = path.resolve(next());
    else if (arg === '--java') args.java = next();
    else if (arg === '--include-adult') args.includeAdult = true;
    else if (arg === '--offline') args.offline = true;
    else if (arg === '--verify') {
      args.verify = next();
      if (!VERIFY_REQUESTS.includes(args.verify)) throw new Error(`--verify takes ${VERIFY_REQUESTS.join('|')}`);
    }
    else if (arg === '--verbose') args.verbose = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else args.positional.push(arg);
  }
  return args;
}

// --- discovery ------------------------------------------------------------------

function defaultProfiles() {
  const base = process.env.APPDATA ?? path.join(os.homedir(), '.config');
  return ['CloudStream 3 Desktop (Dev)', 'CloudStream 3 Desktop'].map((name) => path.join(base, name));
}

function walkArchives(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkArchives(full, out);
    else if (entry.name.toLowerCase().endsWith('.cs3')) out.push(full);
  }
  return out;
}

/**
 * The archives a profile has installed, from its provider registry, read only.
 * Archive names are `<internalName>.<hash>.cs3`; the registry's fingerprint
 * starts with the size, which picks the right file when names prefix each other.
 */
function discoverProfile(root) {
  const registryFile = path.join(root, 'cs3-provider-registry.json');
  if (!fs.existsSync(registryFile)) return null;
  const entries = JSON.parse(fs.readFileSync(registryFile, 'utf8')).entries ?? [];
  const files = walkArchives(path.join(root, 'extensions'));
  return entries.map((entry) => {
    const size = Number(String(entry.fingerprint ?? '').split(':')[0]);
    const file = files.find((p) => path.basename(p).startsWith(`${entry.internalName}.`) && fs.statSync(p).size === size);
    return {
      internalName: entry.internalName,
      file,
      repoId: file ? path.basename(path.dirname(file)) : undefined,
      providers: (entry.providers ?? []).map((p) => String(p.name)),
    };
  });
}

function discover(args) {
  const archives = args.archives.map((file) => ({
    internalName: path.basename(file).split('.')[0],
    file: path.resolve(file),
    repoId: 'archive',
    providers: [],
  }));
  if (args.archives.length > 0 && !args.profile) return { root: null, archives };
  for (const root of args.profile ? [args.profile] : defaultProfiles()) {
    const found = discoverProfile(root);
    if (found) return { root, archives: [...archives, ...found] };
  }
  return { root: null, archives };
}

function matchesProvider(args, name) {
  if (!args.providers) return true;
  const folded = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return args.providers.some((want) => folded.includes(want.replace(/[^a-z0-9]/g, '')));
}

// --- run identity ---------------------------------------------------------------

function appSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Read, not imported: the provisioner imports `electron`. */
function runtimeGeneration() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'desktop', 'electron', 'cs3', 'runtimeProvisioner.ts'), 'utf8');
  return source.match(/const RUNTIME_GENERATION = (\d+)/)?.[1] ?? 'unknown';
}

const hostOf = (url) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return '<unparseable>';
  }
};
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashTitle = (title) => createHash('sha256').update(String(title)).digest('hex').slice(0, 12);

// --- journal --------------------------------------------------------------------

class Journal {
  constructor(file, runId) {
    this.file = file;
    this.runId = runId;
    this.fd = fs.openSync(file, 'a');
  }

  /** One line, flushed to disk before the next stage starts: a killed run loses at most one record. */
  write(fields) {
    const record = {
      schema: AUDIT_SCHEMA_VERSION,
      runId: this.runId,
      evidence: {},
      bytes: 0,
      ms: 0,
      retries: 0,
      at: new Date().toISOString(),
      ...fields,
    };
    if (record.outcome === 'fail' && record.message) {
      const message = printable(String(record.message), 400);
      record.cause = classifyFailure(message);
      record.groupingForm = printable(groupingForm(message));
      record.owner = attribute({
        stage: record.stage,
        cause: record.cause,
        reason: record.reason,
        siteAlive: record.siteAlive,
        sourceValid: record.sourceValid,
      });
    } else if (record.outcome === 'inconclusive') {
      record.owner = attribute({ stage: record.stage, reason: record.reason });
    }
    // The provider's message is kept as its grouping form only: it can carry URLs.
    delete record.message;
    delete record.siteAlive;
    delete record.sourceValid;
    fs.writeSync(this.fd, `${JSON.stringify(record)}\n`);
    fs.fsyncSync(this.fd);
    return record;
  }

  close() {
    fs.closeSync(this.fd);
  }
}

function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map(parseJournalLine).filter(Boolean);
}

// --- stages ---------------------------------------------------------------------

function seedTitles(types) {
  const bank = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus', 'seeds.json'), 'utf8'));
  const titles = types.flatMap((type) => bank[type] ?? []);
  return titles.length ? titles : bank.default;
}

const timed = async (work) => {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
};

/**
 * One host's share of the run (PRD §6.6): two calls at once, spaced, and an
 * escalating cooldown once it answers with a rate limit or a challenge. The
 * JVM makes the provider's requests, so the host is the provider's `mainUrl`.
 */
const hosts = new HostLimiter();
const THROTTLED = /\b429\b|rate.?limit|too many requests|just a moment|cf-chl|captcha/i;

class HostCooling extends Error {}

/** What a reply says went wrong, without reading the provider's content. */
function replyError(reply) {
  const inner = String(reply?.result?.json ?? '').match(/"error"\s*:\s*"([^"]{0,400})/)?.[1] ?? '';
  return `${reply?.error ?? ''} ${inner}`;
}

async function politely(host, work) {
  for (;;) {
    const gate = hosts.check(host, Date.now());
    if (gate.ok) break;
    if (gate.reason === 'cooldown') throw new HostCooling(host);
    await new Promise((resolve) => setTimeout(resolve, gate.waitMs));
  }
  hosts.started(host, Date.now());
  let reply;
  try {
    reply = await work();
    return reply;
  } finally {
    hosts.finished(host, Date.now(), THROTTLED.test(replyError(reply)));
  }
}

/** S2–S6 for one provider of a loaded archive. */
async function auditProvider(sidecar, net, journal, base, descriptor, args) {
  const decl = declaration(descriptor);
  const providerId = `${base.internalName}/${decl.name}`;
  let siteAlive;
  const common = { ...base, providerId };
  const written = new Set();
  const write = (fields) => {
    written.add(fields.stage);
    return journal.write({ siteAlive, ...common, ...fields });
  };
  const host = hostOf(decl.mainUrl) ?? decl.name;
  const ask = (method, params) => politely(host, () => sidecar.call(method, params, RPC_TIMEOUT_MS));
  const label = (title) => (decl.adultOnly ? hashTitle(title) : String(title).slice(0, 80));

  write({ stage: 'S0', outcome: 'pass', evidence: { types: decl.types, lang: decl.lang } });
  if (decl.adultOnly && !args.includeAdult) {
    for (const stage of STAGES.slice(1)) write({ stage, outcome: 'skipped', reason: 'adult-gate' });
    return { providerId, line: 'skipped (adult-only)' };
  }
  write({ stage: 'S1', outcome: 'pass', evidence: { tier: base.tier } });
  // S2: the declaration, and one GET of the site's front page.
  const declared = { mainUrlHost: hostOf(decl.mainUrl), hasMainPage: decl.hasMainPage, types: decl.types };
  // Some providers declare `mainUrl = "NONE"` (Anichi): there is no site to ask.
  if (!net || !/^https?:\/\//i.test(decl.mainUrl ?? '')) {
    write({ stage: 'S2', outcome: 'skipped', reason: net ? 'not-offered' : 'stage-filter', evidence: declared });
  } else {
    try {
      const site = await siteCheck(net, decl.mainUrl);
      siteAlive = site.judged.outcome === 'pass';
      write({ stage: 'S2', ...site.judged, evidence: { ...declared, ...site.judged.evidence }, ms: site.ms, bytes: site.bytes });
    } catch (error) {
      if (!(error instanceof HostCooling)) throw error;
      write({ stage: 'S2', outcome: 'inconclusive', reason: 'rate-limited', evidence: declared });
    }
  }

  let catalogueItems = [];
  let searchHits = [];
  let linked = 0;
  let sourceLinks = [];
  try {
    // S3: a couple of catalogue rows.
    {
      const { value: sections, ms } = await timed(() => ask('providerMainPageSections', { provider: decl.name }));
      let declared = [];
      try {
        declared = JSON.parse(String(sections.result?.json ?? '{}')).sections ?? [];
      } catch {
        declared = [];
      }
      const rows = [];
      let rowMs = ms;
      for (const section of declared.slice(0, args.rows)) {
        const { value, ms: one } = await timed(() =>
          ask('providerMainPage', {
            provider: decl.name,
            section: section.name,
            data: section.data ?? '',
            page: 1,
            horizontalImages: section.horizontalImages === true,
          })
        );
        rows.push(value);
        rowMs += one;
      }
      const judged = judgeCatalogue(decl.hasMainPage, rows);
      catalogueItems = judged.items;
      write({ stage: 'S3', ...judged, items: undefined, ms: rowMs });
    }

    // S4: search for what the provider itself listed, else a title of its type.
    const titles = [
      ...catalogueItems.map((item) => item.name).filter((name) => typeof name === 'string' && name.trim()),
      ...seedTitles(decl.types),
    ].slice(0, 2);
    for (const title of titles) {
      const { value, ms } = await timed(() => ask('providerSearch', { providers: [decl.name], query: title }));
      const judged = judgeSearch(value, decl.name);
      write({ stage: 'S4', candidate: label(title), ...judged, results: undefined, ms });
      if (judged.outcome === 'pass') {
        searchHits = judged.results;
        break;
      }
      if (judged.outcome === 'unsupported') break;
    }

    // S5 and S6 on up to two items: search hits first, then catalogue items.
    const items = [...searchHits, ...catalogueItems].slice(0, 2);
    for (const item of items) {
      const { value: detailReply, ms: detailMs } = await timed(() =>
        ask('providerLoad', { provider: decl.name, url: item.url })
      );
      const detail = judgeDetail(detailReply, item.url);
      const candidate = label(item.name ?? item.url);
      write({ stage: 'S5', candidate, ...detail, handle: undefined, ms: detailMs });
      if (detail.outcome !== 'pass' || !detail.handle) continue;

      const { value: linksReply, ms: linksMs } = await timed(() =>
        ask('providerLoadLinks', { provider: decl.name, data: detail.handle })
      );
      const links = judgeLinks(linksReply);
      write({ stage: 'S6', candidate, ...links, links: undefined, quirks: undefined, ms: linksMs });
      if (links.outcome === 'pass') {
        linked = links.links.length;
        sourceLinks = links.links;
        break;
      }
    }
    if (items.length === 0) {
      write({ stage: 'S5', outcome: 'blocked', reason: 'earlier-stage-failed' });
      write({ stage: 'S6', outcome: 'blocked', reason: 'earlier-stage-failed' });
    }
  } catch (error) {
    if (!(error instanceof HostCooling)) throw error;
    // The host asked us to slow down: what is left is not known, and not a failure.
    for (const stage of ['S3', 'S4', 'S5', 'S6']) {
      if (!written.has(stage)) write({ stage, outcome: 'inconclusive', reason: 'rate-limited', evidence: { host } });
    }
  }

  // S7–S9 on up to three of the links S6 found.
  let reached = 0;
  let inspected = 0;
  /** The first source S9 routed: the one S10 plays (§6.5, one per provider). */
  let playable = null;
  if (!net) {
    for (const stage of ['S7', 'S8', 'S9']) write({ stage, outcome: 'skipped', reason: 'stage-filter' });
  } else if (sourceLinks.length === 0) {
    for (const stage of ['S7', 'S8', 'S9']) write({ stage, outcome: 'blocked', reason: 'earlier-stage-failed' });
  } else {
    let providerBytes = 0;
    for (const link of sourceLinks.slice(0, SOURCES_PER_PROVIDER)) {
      const candidate = `${String(link.source ?? 'link').slice(0, 40)} ${link.quality ?? '?'}p #${sourceLinks.indexOf(link) + 1}`;
      let result;
      try {
        result = await auditSource(net, decl, link, args);
      } catch (error) {
        if (!(error instanceof HostCooling)) throw error;
        write({ stage: 'S7', candidate, outcome: 'inconclusive', reason: 'rate-limited', evidence: { host: hostOf(link.url) } });
        write({ stage: 'S8', candidate, outcome: 'blocked', reason: 'earlier-stage-failed' });
        write({ stage: 'S9', candidate, outcome: 'blocked', reason: 'earlier-stage-failed' });
        continue;
      }
      providerBytes += result.bytes;
      write({ stage: 'S7', candidate, ...result.reach, sniff: undefined, quirks: undefined, range: undefined, ms: result.reachMs, bytes: result.reachBytes });
      if (result.reach.outcome === 'pass') reached++;
      if (result.inspect) {
        write({ stage: 'S8', candidate, ...result.inspect, sourceValid: true, ms: result.inspectMs, bytes: result.inspectBytes });
        if (result.inspect.outcome === 'pass') inspected++;
      } else {
        write({ stage: 'S8', candidate, outcome: 'blocked', reason: 'earlier-stage-failed' });
      }
      if (result.route) write({ stage: 'S9', candidate, ...result.route, sourceValid: true });
      else write({ stage: 'S9', candidate, outcome: 'blocked', reason: 'earlier-stage-failed' });
      if (!playable && result.route?.outcome === 'pass') playable = { candidate, link, result };
      if (providerBytes >= BYTE_CAPS.provider) break;
    }
  }

  // S10: does it play? Opt-in (§16 Q5), one source, never for adult content (§9).
  let playedTiers = '';
  if (args.verify === 'none' || !net) write({ stage: 'S10', outcome: 'skipped', reason: 'stage-filter' });
  else if (decl.adultOnly) write({ stage: 'S10', outcome: 'skipped', reason: 'adult-gate' });
  else if (!playable) write({ stage: 'S10', outcome: 'blocked', reason: 'earlier-stage-failed' });
  else {
    const verified = await verifySource(net, playable.link, playable.result, args);
    if (verified.unrun) {
      const { strategy, reason } = verified.unrun;
      const outcome = reason === 'stage-filter' ? 'skipped' : 'inconclusive';
      write({ stage: 'S10', candidate: playable.candidate, outcome, reason, evidence: { strategy } });
    }
    for (const tier of verified.tiers ?? []) {
      write({
        stage: 'S10',
        candidate: `${playable.candidate} ${tier.tier}`,
        ...tier.judged,
        evidence: { strategy: tier.strategy, ...tier.judged.evidence },
        sourceValid: true,
        ms: tier.ms,
        bytes: tier.bytes,
      });
    }
    playedTiers = (verified.tiers ?? []).map((t) => ` · ${t.tier} ${t.judged.outcome}`).join('');
  }
  return {
    providerId,
    line: `${catalogueItems.length} catalogue items · ${searchHits.length} hits · ${linked} links · ${reached} reached · ${inspected} inspected${playedTiers}`,
  };
}

const SOURCES_PER_PROVIDER = 3;
/** One S2 answer per host per run: providers sharing a site share its evidence (§6.6). */
const siteCache = new Map();

async function siteCheck(net, mainUrl) {
  const host = hostOf(mainUrl) ?? mainUrl;
  if (!siteCache.has(host)) {
    siteCache.set(
      host,
      (async () => {
        const started = Date.now();
        const answer = await politely(host, () => net.fetch({ url: mainUrl, cap: 16 * 1024, timeoutMs: 15_000 }));
        return { judged: judgeSite(answer), ms: Date.now() - started, bytes: answer.bytes ?? 0 };
      })()
    );
  }
  return siteCache.get(host);
}

/** The request headers a provider gave a link: its own, plus its Referer. */
function linkHeaders(link) {
  const headers = { ...(link.headers ?? {}) };
  if (link.referer && !Object.keys(headers).some((k) => k.toLowerCase() === 'referer')) headers.Referer = link.referer;
  return headers;
}

const isOk = (answer) => answer?.ok && (answer.status === 200 || answer.status === 206);

/** S7's request ladder (§6.5), then S8 and S9 if the body is media. */
async function auditSource(net, decl, link, args) {
  const url = String(link.url);
  const type = String(link.linkType ?? link.type ?? '');
  const declared = { isM3u8: link.isM3u8 === true, isDash: link.isDash === true, torrent: type === 'TORRENT' || type === 'MAGNET', drm: Boolean(link.drm) };
  const host = hostOf(url) ?? 'unknown';
  const out = { reachBytes: 0, inspectBytes: 0, bytes: 0 };
  const started = Date.now();
  const ask = (request) =>
    politely(host, async () => {
      const answer = await net.fetch({ timeoutMs: 15_000, ...request, url });
      out.reachBytes += answer.bytes ?? 0;
      return answer;
    });

  let steps = { url, declared };
  if (!declared.torrent && /^https?:/i.test(url)) {
    let headers = linkHeaders(link);
    const head = await ask({ method: 'HEAD', headers });
    let probe = await ask({ headers: { ...headers, Range: 'bytes=0-0' }, cap: 1 });
    const requires = [];
    if (probe.ok && (probe.status === 401 || probe.status === 403)) {
      // The differential test: what does the source want that it was not given?
      const variants = [];
      if (decl.mainUrl && !headers.Referer) variants.push({ add: 'Referer', headers: { ...headers, Referer: decl.mainUrl } });
      variants.push({ add: 'no User-Agent override', headers, noUserAgent: true });
      for (const variant of variants) {
        const retry = await ask({ headers: { ...variant.headers, Range: 'bytes=0-0' }, cap: 1, noUserAgent: variant.noUserAgent });
        if (isOk(retry)) {
          headers = variant.headers;
          probe = retry;
          requires.push(variant.add);
          break;
        }
      }
    } else if (isOk(probe) && headers.Referer) {
      // It worked with the provider's Referer; is that Referer what made it work?
      const { Referer: _dropped, ...without } = headers;
      const bare = await ask({ headers: { ...without, Range: 'bytes=0-0' }, cap: 1 });
      if (bare.ok && (bare.status === 401 || bare.status === 403)) requires.push('Referer');
    }
    const read = await ask({ headers: { ...headers, Range: `bytes=0-${BYTE_CAPS.sniff - 1}` }, cap: BYTE_CAPS.sniff });
    steps = { url, declared, head, probe, read, requires };
    out.headers = headers;
  }
  out.reach = judgeReach(steps);
  out.reachMs = Date.now() - started;
  out.bytes = out.reachBytes;
  if (out.reach.outcome !== 'pass') return out;

  // S8: the shipping proxy and inspector, over the worker, under the source's byte cap.
  if (!FFPROBE) {
    out.inspect = { outcome: 'inconclusive', reason: 'host-capability-absent', evidence: { missing: 'ffprobe' } };
    return out;
  }
  const meter = new ByteMeter(BYTE_CAPS.inspect);
  const proxy = new MediaProxy(meteredFetch(net, meter));
  const inspectStarted = Date.now();
  try {
    const loop = await proxy.wrap(url, out.headers ?? linkHeaders(link), { boundedRanges: out.reach.range === 'refused' });
    const inspector = new MediaInspector(
      () => FFPROBE,
      (target) => loopbackText(target, 64 * 1024),
      (target, bytes) => loopbackBytes(target, bytes)
    );
    const inspection = await inspector.inspect(loop, declared.isM3u8);
    out.inspect = judgeInspection(inspection, meter.exhausted);
    if (out.inspect.outcome === 'pass' && inspection.metadata) {
      out.route = judgeRoute(inspection.metadata, inspection.transport, inspection.drm);
      out.inspection = { metadata: inspection.metadata, transport: inspection.transport, drm: inspection.drm };
    }
  } catch (error) {
    out.inspect = meter.exhausted
      ? { outcome: 'inconclusive', reason: 'budget-exhausted', evidence: {} }
      : { outcome: 'fail', message: String(error?.message ?? error), evidence: {} };
  } finally {
    proxy.shutdown();
  }
  out.inspectMs = Date.now() - inspectStarted;
  out.inspectBytes = meter.bytes;
  out.bytes += meter.bytes;
  return out;
}

/** Reads from the audit's own loopback proxy, which is metered; Node's fetch never leaves 127.0.0.1 here. */
async function loopbackText(url, bytes) {
  const body = await loopbackBytes(url, bytes);
  return body ? new TextDecoder().decode(body) : null;
}

async function loopbackBytes(url, bytes) {
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok && response.status !== 206) return null;
    return new Uint8Array(await response.arrayBuffer()).subarray(0, bytes);
  } catch {
    return null;
  }
}

let transcoder;
let hostEncoder;

/**
 * What this ffmpeg build understands, asked as the app asks it at launch
 * (`refreshFfmpegOptionSupport` in main.ts). Skipped, every HLS conversion
 * failed on extensionless segment URLs (`not in allowed_segment_extensions`,
 * WatchDrama, 2026-10-29): the app turns `-extension_picky` off, and the
 * audit had not.
 */
async function askMediaTools() {
  const run = (file, args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout, stderr) =>
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      );
    });
  if (FFPROBE) await detectExtensionPicky(FFPROBE, run);
  if (FFMPEG) await detectToneMapSupport(FFMPEG, run);
}

/** The shipping converter, with the media runtime the audit found. */
function conversions() {
  transcoder ??= new MediaTranscoder({ resolveBinary: (name) => (name === 'ffmpeg' ? FFMPEG : name === 'ffprobe' ? FFPROBE : null) });
  return transcoder;
}

/**
 * S10 for one source: the tiers its route on this machine names, each through
 * a fresh metered proxy capped at 32 MB and 12 s (§6.5, L3).
 */
async function verifySource(net, link, result, args) {
  const { metadata, transport, drm } = result.inspection;
  // The real encoder decides whether a conversion keeps its resolution, so it is measured, once.
  hostEncoder ??= FFMPEG
    ? await conversions().hostCapability()
    : { hardware: false, accelerator: 'cpu', logicalCores: os.cpus().length };
  const choice = playbackTiers(metadata, transport, drm, hostEncoder, args.verify, Boolean(MPV));
  if (choice.run.length === 0) return { unrun: choice.unrun };
  const tiers = [];
  for (const planned of choice.run) {
    if (planned.tier === 'ffmpeg' && !FFMPEG) {
      const judged = { outcome: 'inconclusive', reason: 'host-capability-absent', evidence: { missing: 'ffmpeg' } };
      tiers.push({ ...planned, judged, bytes: 0, ms: 0 });
      continue;
    }
    const meter = new ByteMeter(VERIFY_CAPS.bytes);
    const proxy = new MediaProxy(meteredFetch(net, meter));
    const started = Date.now();
    try {
      const loop = await proxy.wrap(String(link.url), result.headers ?? linkHeaders(link), {
        boundedRanges: result.reach.range === 'refused',
      });
      const measured =
        planned.tier === 'element'
          ? await playElement(net, loop, transport)
          : planned.tier === 'ffmpeg'
            ? await playConversion(conversions(), loop, planned.plan, transport, result.reach.range === 'ignored')
            : await playMpv(MPV, loop);
      const judged = judgePlayback({ ...measured, tier: planned.tier, budgetSpent: meter.exhausted, expectVideo: Boolean(metadata.video) });
      tiers.push({ ...planned, judged, bytes: meter.bytes, ms: Date.now() - started });
    } finally {
      proxy.shutdown();
    }
  }
  return { tiers };
}

/** One archive: copy, load, audit each provider, unload. */
async function auditArchive(sidecar, net, journal, archive, workDir, args, done) {
  if (!archive.file) {
    for (const name of archive.providers.filter((n) => matchesProvider(args, n))) {
      const providerId = `${archive.internalName}/${name}`;
      journal.write({ providerId, stage: 'S0', outcome: 'fail', message: 'The archive the registry names is not on disk.' });
    }
    return [];
  }
  // A copy, so a held class loader can never lock or change the profile's file.
  const copy = path.join(workDir, 'plugins', path.basename(archive.file));
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(archive.file, copy);
  const base = { archiveSha256: sha256(copy), repoId: archive.repoId, internalName: archive.internalName };

  const { value: loadReply, ms } = await timed(() =>
    sidecar.call('load', { pluginId: archive.internalName, path: copy }, LOAD_TIMEOUT_MS)
  );
  const loaded = judgeLoad(loadReply);
  const lines = [];
  if (loaded.outcome !== 'pass') {
    const names = archive.providers.length ? archive.providers : [archive.internalName];
    for (const name of names.filter((n) => matchesProvider(args, n))) {
      const providerId = `${archive.internalName}/${name}`;
      journal.write({ providerId, archiveSha256: base.archiveSha256, repoId: base.repoId, stage: 'S0', outcome: 'pass' });
      journal.write({ providerId, archiveSha256: base.archiveSha256, repoId: base.repoId, stage: 'S1', ...loaded, providers: undefined, ms });
      lines.push({ providerId, line: `load failed: ${String(loaded.message).slice(0, 120)}` });
    }
    return lines;
  }
  base.tier = loaded.evidence.tier;
  try {
    for (const descriptor of loaded.providers) {
      const name = String(descriptor.name ?? '');
      const providerId = `${archive.internalName}/${name}`;
      if (!matchesProvider(args, name) || done.has(providerId)) continue;
      try {
        lines.push(await auditProvider(sidecar, net, journal, base, descriptor, args));
      } catch (error) {
        journal.write({ ...base, providerId, stage: 'S3', outcome: 'fail', message: String(error?.message ?? error) });
        lines.push({ providerId, line: `audit error: ${error?.message ?? error}` });
      }
    }
  } finally {
    await sidecar.call('unload', { pluginId: archive.internalName }, 30_000);
  }
  return lines;
}

// --- reports --------------------------------------------------------------------

function writeReports(runDir, discoveredIds) {
  const records = readJournal(path.join(runDir, 'journal.ndjson'));
  const reduced = reduceJournal(records);
  const results = [...reduced].map(([id, list]) => providerResult(id, list));
  const providersDir = path.join(runDir, 'providers');
  fs.mkdirSync(providersDir, { recursive: true });
  for (const [id, list] of reduced) {
    const file = path.join(providersDir, `${id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify({ result: providerResult(id, list), records: list }, null, 2));
  }

  const stageCounts = {};
  for (const stage of STAGES) stageCounts[stage] = {};
  for (const result of results) {
    for (const [stage, outcome] of Object.entries(result.stages)) {
      stageCounts[stage][outcome] = (stageCounts[stage][outcome] ?? 0) + 1;
    }
  }
  const causes = {};
  const extractors = {};
  for (const list of reduced.values()) {
    for (const record of list) {
      if (record.outcome === 'fail') {
        const key = `${record.stage} · ${record.cause ?? 'unknown'} · ${record.groupingForm ?? ''}`;
        (causes[key] ??= { stage: record.stage, cause: record.cause, owner: record.owner, groupingForm: record.groupingForm, providers: new Set() }).providers.add(record.providerId);
      }
      if (record.stage === 'S6' && record.outcome === 'pass') {
        for (const name of record.evidence.extractors ?? []) {
          (extractors[name || '(unnamed)'] ??= { providers: new Set() }).providers.add(record.providerId);
        }
      }
    }
  }
  const extractorRows = Object.fromEntries(
    Object.entries(extractors).map(([name, row]) => [name, { providers: [...row.providers].sort() }])
  );
  const held = conservation(discoveredIds ?? results.map((r) => r.providerId), results);
  const summary = { stageCounts, byVerdict: held.byVerdict, conservation: held, providers: results };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  for (const row of Object.values(causes)) row.providers = [...row.providers].sort();
  fs.writeFileSync(path.join(runDir, 'causes.json'), JSON.stringify(Object.values(causes), null, 2));
  fs.writeFileSync(path.join(runDir, 'extractors.json'), JSON.stringify(extractorRows, null, 2));

  const outcomes = ['pass', 'fail', 'unsupported', 'skipped', 'inconclusive', 'blocked'];
  const md = [
    `# Provider audit ${path.basename(runDir)}`,
    '',
    `${results.length} providers. Verdicts: ${Object.entries(held.byVerdict).map(([v, n]) => `${v} ${n}`).join(' · ') || 'none'}.`,
    held.holds ? 'Every discovered provider is accounted for.' : `**Not accounted for:** missing ${held.missing.length}, extra ${held.extra.length}.`,
    '',
    `| Stage | ${outcomes.join(' | ')} |`,
    `|---|${outcomes.map(() => '---').join('|')}|`,
    ...STAGES.map((s) => `| ${s} ${STAGE_LABELS[s]} | ${outcomes.map((o) => stageCounts[s][o] ?? 0).join(' | ')} |`),
    '',
    '## Root causes',
    '',
    ...(Object.values(causes).length
      ? Object.values(causes)
          .sort((a, b) => b.providers.length - a.providers.length)
          .slice(0, 15)
          .map((c) => `- **${c.stage} ${c.cause}** (${c.owner}), ${c.providers.length}: \`${String(c.groupingForm).slice(0, 120)}\``)
      : ['None.']),
    '',
    '## Providers',
    '',
    '| Provider | Deepest | Verdict |',
    '|---|---|---|',
    ...results
      .sort((a, b) => a.providerId.localeCompare(b.providerId))
      .map((r) => `| ${r.providerId} | ${r.deepest ? `${r.deepest} ${STAGE_LABELS[r.deepest]}` : '—'} | ${r.verdict} |`),
    '',
    results.some((r) => r.stages.S10 && r.stages.S10 !== 'skipped')
      ? 'S10 played one source per provider; see providers/*.json for the tier and measurements.'
      : 'S10 (playback) was not asked for (`--verify`).',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'summary.md'), md);
  return summary;
}

function runEntries(runDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
  const reduced = reduceJournal(readJournal(path.join(runDir, 'journal.ndjson')));
  return summary.providers.map((result) => {
    const list = reduced.get(result.providerId) ?? [];
    const shapes = list.filter((r) => r.shapeFingerprint).map((r) => `${r.stage}:${r.shapeFingerprint}`).sort();
    const s6 = list.find((r) => r.stage === 'S6' && r.outcome === 'pass');
    return {
      providerId: result.providerId,
      deepest: result.deepest,
      verdict: result.verdict,
      shapeFingerprint: shapes.length ? createHash('sha256').update(shapes.join('|')).digest('hex').slice(0, 12) : undefined,
      capabilities: s6 && (s6.evidence.subtitles ?? 0) > 0 ? ['subtitles'] : [],
      blame: { archiveSha256: list[0]?.archiveSha256, runtime: manifest.runtimeGeneration, appSha: manifest.appSha },
    };
  });
}

// --- main -----------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !['list', 'full', 'target', 'resume', 'report', 'diff'].includes(args.mode)) {
    console.error('Mode: list | full | target | resume <runId> | report <runId> | diff <runIdA> <runIdB>. See the header of this file.');
    return 2;
  }

  if (args.mode === 'diff') {
    const [a, b] = args.positional.map((id) => path.join(args.out, id));
    if (!a || !b) throw new Error('diff needs two run ids.');
    const changes = diffRuns(runEntries(a), runEntries(b));
    const notable = changes.filter((c) => c.change !== 'UNCHANGED');
    const file = path.join(b, `diff-vs-${path.basename(a)}.json`);
    fs.writeFileSync(file, JSON.stringify(changes, null, 2));
    for (const c of notable) {
      console.log(`${c.change.padEnd(12)} ${c.providerId}  ${c.from?.verdict ?? '—'} → ${c.to?.verdict ?? '—'}  moved: ${c.moved.join(',') || '—'} (${c.owner})`);
    }
    console.log(`${notable.length} change(s) of ${changes.length}; written to ${file}`);
    return hasRegressions(changes) ? 1 : 0;
  }

  if (args.mode === 'report') {
    const runDir = path.join(args.out, args.positional[0] ?? '');
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    writeReports(runDir, manifest.discovered);
    console.log(fs.readFileSync(path.join(runDir, 'summary.md'), 'utf8'));
    return 0;
  }

  let runDir;
  let manifest;
  if (args.mode === 'resume') {
    runDir = path.join(args.out, args.positional[0] ?? '');
    manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    Object.assign(args, manifest.args, { mode: 'resume' });
  }

  const { root, archives } = discover(args);
  const selected = archives.filter(
    (a) => !args.providers || a.providers.length === 0 || a.providers.some((n) => matchesProvider(args, n))
  );
  if (args.mode === 'list') {
    console.log(root ? `Profile: ${root}` : 'No profile registry found; pass --profile or --archive.');
    for (const a of selected) console.log(`${a.file ? ' ' : '!'} ${a.internalName.padEnd(28)} ${a.providers.join(', ')}`);
    console.log(`${selected.length} archive(s), ${selected.reduce((n, a) => n + a.providers.length, 0)} provider(s).`);
    return 0;
  }
  if (selected.length === 0) {
    console.error('Nothing to audit. Pass --profile <userData dir> or --archive <file.cs3>.');
    return 2;
  }

  if (!manifest) {
    const sha = appSha();
    const generation = runtimeGeneration();
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${sha}-g${generation}`;
    runDir = path.join(args.out, runId);
    fs.mkdirSync(runDir, { recursive: true });
    manifest = {
      runId,
      schema: AUDIT_SCHEMA_VERSION,
      appSha: sha,
      runtimeGeneration: generation,
      profile: root,
      args: { profile: args.profile, archives: args.archives, providers: args.providers, rows: args.rows, includeAdult: Boolean(args.includeAdult) },
      discovered: selected.flatMap((a) => a.providers.filter((n) => matchesProvider(args, n)).map((n) => `${a.internalName}/${n}`)),
      startedAt: new Date().toISOString(),
      status: 'running',
    };
  }
  const writeManifest = () => fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeManifest();

  // A resumed run skips providers whose every stage is already in the journal.
  const done = new Set(
    [...reduceJournal(readJournal(path.join(runDir, 'journal.ndjson')))]
      .filter(([, list]) => STAGES.every((stage) => list.some((r) => r.stage === stage)))
      .map(([id]) => id)
  );

  const java = resolveJava(args.java);
  const workDir = path.join(runDir, 'work');
  // The app's heap, not a tool's: a smaller one fails translations the app completes.
  const sidecar = new Sidecar(java, path.join(workDir, 'runtime'), { heapMb: jvmHeapMb(os.totalmem()) });
  // Every source byte through Chromium's network; `--offline` runs S0–S6 only.
  const net = args.offline ? null : new NetWorker(path.join(workDir, 'net-worker'));
  const journal = new Journal(path.join(runDir, 'journal.ndjson'), manifest.runId);
  let cancelled = false;
  process.once('SIGINT', () => {
    cancelled = true;
    console.log('\nStopping after this archive; resume with: resume ' + manifest.runId);
  });

  console.log(`Run ${manifest.runId}: ${selected.length} archive(s)${done.size ? `, ${done.size} provider(s) already done` : ''}`);
  try {
    sidecar.start();
    if (net) {
      await net.start();
      console.log(`Network worker: Electron ${net.electron}; ffprobe: ${FFPROBE ?? 'missing (S8 will be inconclusive)'}`);
      await askMediaTools();
    }
    const status = await sidecar.call('status', {}, 30_000);
    if (!status.ok || !status.result?.canExecute) {
      throw new Error(`The sidecar cannot run providers: ${status.error ?? status.result?.reason ?? 'no reason given'}`);
    }
    for (const archive of selected) {
      if (cancelled) break;
      const started = Date.now();
      const lines = await auditArchive(sidecar, net, journal, archive, workDir, args, done);
      for (const { providerId, line } of lines) {
        console.log(`  ${providerId.padEnd(40)} ${line}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      }
    }
    manifest.status = cancelled ? 'cancelled' : 'complete';
  } catch (error) {
    manifest.status = 'incomplete';
    manifest.error = String(error?.message ?? error);
    console.error(manifest.error);
  } finally {
    journal.close();
    await sidecar.stop();
    await net?.stop();
    transcoder?.shutdown();
    manifest.endedAt = new Date().toISOString();
    writeManifest();
    // The JVM held the copied archives; it has exited, so the work files can go.
    fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }

  const summary = writeReports(runDir, manifest.discovered);
  console.log(`\n${fs.readFileSync(path.join(runDir, 'summary.md'), 'utf8').split('\n').slice(0, 4).join('\n')}`);
  console.log(`Reports in ${runDir}`);
  if (summary.conservation.missing.length && manifest.status === 'complete') {
    console.log(`Not reached: ${summary.conservation.missing.join(', ')}`);
  }
  return manifest.status === 'incomplete' ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error?.stack ?? error);
    process.exit(2);
  }
);

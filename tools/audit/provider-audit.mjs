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
 * Built so far: S0 discover, S1 load, S2 declaration, S3 catalogue, S4 search
 * (round trip on a title the provider listed), S5 detail, S6 links. S2's site
 * check and S7–S10 need the headless Electron network worker (PRD §5.1, M3),
 * which does not exist yet; they are written as `skipped: stage-filter`, never
 * as a pass and never as a failure.
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
 * --out <dir> (default tools/audit/runs) · --java <path> · --verbose
 *
 * A maintainer tool: it contacts third-party sites, one request at a time per
 * provider. Exit code: 0 ran to completion (even with failures) · 1 diff found
 * regressions · 2 could not run.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Sidecar, resolveJava } from '../e2e/catalogue-e2e.mjs';
import { attribute } from '../../desktop/electron/cs3/audit/attribution.ts';
import { HostLimiter } from '../../desktop/electron/cs3/audit/budget.ts';
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
/** Stages this version can run; the rest need the network worker. */
const RUNNABLE = new Set(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']);

// --- arguments ----------------------------------------------------------------

function parseArgs(argv) {
  const args = { mode: argv[0], positional: [], archives: [], providers: null, rows: 2, out: DEFAULT_OUT };
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
      record.owner = attribute({ stage: record.stage, cause: record.cause, reason: record.reason });
    } else if (record.outcome === 'inconclusive') {
      record.owner = attribute({ stage: record.stage, reason: record.reason });
    }
    // The provider's message is kept as its grouping form only: it can carry URLs.
    delete record.message;
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
async function auditProvider(sidecar, journal, base, descriptor, args) {
  const decl = declaration(descriptor);
  const providerId = `${base.internalName}/${decl.name}`;
  const common = { ...base, providerId };
  const written = new Set();
  const write = (fields) => {
    written.add(fields.stage);
    return journal.write({ ...common, ...fields });
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
  // The declaration half of S2; the site check needs the network worker.
  write({
    stage: 'S2',
    outcome: 'skipped',
    reason: 'stage-filter',
    evidence: { mainUrlHost: hostOf(decl.mainUrl), hasMainPage: decl.hasMainPage, types: decl.types },
  });

  let catalogueItems = [];
  let searchHits = [];
  let linked = 0;
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

  for (const stage of STAGES.filter((s) => !RUNNABLE.has(s))) {
    write({ stage, outcome: 'skipped', reason: 'stage-filter' });
  }
  return { providerId, line: `${catalogueItems.length} catalogue items · ${searchHits.length} hits · ${linked} links` };
}

/** One archive: copy, load, audit each provider, unload. */
async function auditArchive(sidecar, journal, archive, workDir, args, done) {
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
        lines.push(await auditProvider(sidecar, journal, base, descriptor, args));
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
    'S2 site checks and S7–S10 need the network worker and were not run.',
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
  const journal = new Journal(path.join(runDir, 'journal.ndjson'), manifest.runId);
  let cancelled = false;
  process.once('SIGINT', () => {
    cancelled = true;
    console.log('\nStopping after this archive; resume with: resume ' + manifest.runId);
  });

  console.log(`Run ${manifest.runId}: ${selected.length} archive(s)${done.size ? `, ${done.size} provider(s) already done` : ''}`);
  try {
    sidecar.start();
    const status = await sidecar.call('status', {}, 30_000);
    if (!status.ok || !status.result?.canExecute) {
      throw new Error(`The sidecar cannot run providers: ${status.error ?? status.result?.reason ?? 'no reason given'}`);
    }
    for (const archive of selected) {
      if (cancelled) break;
      const started = Date.now();
      const lines = await auditArchive(sidecar, journal, archive, workDir, args, done);
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

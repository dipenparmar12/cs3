#!/usr/bin/env node
/**
 * Counts the `.cs3` corpus the app can actually see, and what a candidate
 * repository would add to it.
 *
 * PRD-43 §3.3 and §5 are numbers, and a number in a document rots the moment
 * somebody publishes a new index. This is the command those sections name, so
 * the claim can be re-taken rather than believed.
 *
 *   node tools/research/survey-repositories.mjs                    # the catalogue
 *   node tools/research/survey-repositories.mjs --candidates a/b c/d
 *   node tools/research/survey-repositories.mjs --json out.json
 *
 * Two things it does that a naive count does not, both of which change the
 * answer materially:
 *
 * - **It resolves the way `pluginManager` resolves.** The catalogue stores a
 *   `rawRepoUrl`, but a candidate found on GitHub gives you `owner/repo` and
 *   nothing else — and there is no convention for where the index lives.
 *   `builds/repo.json`, `master/repo.json` and `builds/plugins.json` are all in
 *   use, so a candidate is probed across the same combinations the app probes.
 *
 * - **It reports what is *new*, not what is listed.** Repositories in this
 *   ecosystem fork each other heavily: measured on 2026-09-03, one 29-extension
 *   repository contributed three extensions the catalogue did not already have.
 *   Counting listings rather than novelty is how "190 extensions" becomes a
 *   claim that is true and useless. Names are normalised (case, punctuation, a
 *   leading `Provider`/`The`, a trailing `Provider`/`Pack`/`Plugin`/`Backup`/
 *   `XR`/`V2`) and matched cumulatively, so one extension is credited once.
 *
 * The dedupe matches **names, not scraped sites**: two extensions scraping one
 * site under unrelated names count as two. The novelty figure is an upper bound
 * on distinct extensions and says nothing about distinct sites.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = path.join(HERE, '..', '..', 'cs3_windows', 'electron', 'official_repositories.json');

/** Branch × filename combinations observed across the live corpus. */
const BRANCHES = ['builds', 'master', 'main', 'refs/heads/main', 'refs/heads/master'];
const FILES = ['repo.json', 'plugins.json', 'repo', 'builds/repo.json', 'builds/plugins.json'];

const TIMEOUT_MS = 25_000;

async function getJson(url) {
  const abort = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: abort, headers: { 'user-agent': 'cs3-survey' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** A repository document points at plugin lists; a plugin list is the array. */
async function pluginsFrom(doc) {
  const d = await getJson(doc);
  if (d === null) return null;
  if (Array.isArray(d)) return d;
  const out = [];
  for (const list of d.pluginLists ?? []) {
    const sub = await getJson(list);
    if (Array.isArray(sub)) out.push(...sub);
    else if (Array.isArray(sub?.plugins)) out.push(...sub.plugins);
  }
  return out;
}

async function resolveCandidate(fullName) {
  for (const branch of BRANCHES) {
    for (const file of FILES) {
      const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${file}`;
      const plugins = await pluginsFrom(url);
      if (plugins !== null) return { url, plugins };
    }
  }
  return null;
}

/**
 * Normalises an extension name for novelty matching. Deliberately blunt: this
 * exists to stop a fork being counted as a discovery, not to be a taxonomy.
 */
function normalise(name) {
  let t = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  t = t.replace(/^(provider|the)/, '');
  t = t.replace(/(provider|pack|plugin|backup|xr|v2)$/, '');
  return t;
}

function summarise(plugins) {
  const languages = {};
  let jar = 0;
  let nsfw = 0;
  const names = new Set();
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue;
    if (p.jarUrl) jar += 1;
    if ((p.tvTypes ?? []).includes('NSFW')) nsfw += 1;
    const lang = p.language || '?';
    languages[lang] = (languages[lang] ?? 0) + 1;
    const n = normalise(p.internalName || p.name);
    if (n) names.add(n);
  }
  return { count: plugins.length, jar, nsfw, languages, names };
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonAt = argv.indexOf('--json');
  const outFile = jsonAt >= 0 ? argv[jsonAt + 1] : null;
  const candAt = argv.indexOf('--candidates');
  const candidates = candAt >= 0
    ? argv.slice(candAt + 1).filter((a) => !a.startsWith('--') && a !== outFile)
    : [];

  const catalogue = JSON.parse(await readFile(CATALOGUE, 'utf8'));
  const report = { takenAt: new Date().toISOString(), catalogue: [], candidates: [] };

  const known = new Set();
  let total = 0;
  let totalJar = 0;

  console.log(`Catalogue: ${catalogue.length} repositories\n`);
  for (const repo of catalogue) {
    const plugins = await pluginsFrom(repo.rawRepoUrl);
    if (plugins === null) {
      console.log(`${repo.id.padEnd(24)} unreachable  ${repo.rawRepoUrl}`);
      report.catalogue.push({ id: repo.id, reachable: false });
      continue;
    }
    const s = summarise(plugins);
    total += s.count;
    totalJar += s.jar;
    for (const n of s.names) known.add(n);
    console.log(`${repo.id.padEnd(24)} n=${String(s.count).padEnd(5)} jar=${String(s.jar).padEnd(4)} nsfw=${s.nsfw}`);
    report.catalogue.push({ id: repo.id, reachable: true, count: s.count, jar: s.jar, nsfw: s.nsfw });
  }

  const pct = total ? ((100 * totalJar) / total).toFixed(1) : '0.0';
  console.log(`\nTOTAL ${total} extensions · ${totalJar} publishing jarUrl (${pct}%) · ${known.size} distinct names`);
  report.totals = { extensions: total, jarUrl: totalJar, distinctNames: known.size };

  if (candidates.length) console.log('\nCandidates (novelty is cumulative, in the order given):\n');
  for (const full of candidates) {
    const resolved = await resolveCandidate(full);
    if (!resolved) {
      console.log(`${full.padEnd(52)} UNRESOLVED`);
      report.candidates.push({ repo: full, resolved: false });
      continue;
    }
    const s = summarise(resolved.plugins);
    const fresh = [...s.names].filter((n) => !known.has(n));
    for (const n of fresh) known.add(n);
    console.log(
      `${full.padEnd(52)} n=${String(s.count).padEnd(5)} jar=${String(s.jar).padEnd(4)} ` +
      `new=${String(fresh.length).padEnd(4)} nsfw=${s.nsfw}  ${resolved.url}`
    );
    report.candidates.push({
      repo: full, resolved: true, doc: resolved.url,
      count: s.count, jar: s.jar, nsfw: s.nsfw, netNew: fresh.length,
      languages: s.languages, netNewNames: fresh.sort(),
    });
  }

  if (outFile) {
    await writeFile(outFile, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${outFile}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

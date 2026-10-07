#!/usr/bin/env node
/**
 * Fresh links for a reported title, from the providers actually installed.
 *
 * An issue file captures links that are signed and short-lived; a week later
 * every one answers 401/403/410 and says nothing about whether the app works.
 * This re-asks the same provider for the same title — search → load →
 * loadLinks over the sidecar's JSON-RPC, against the archives in the app's own
 * profile — and writes the links with their headers to JSON.
 *
 * Stage two is `links-play.cjs`, run under Electron, which fetches each link
 * through `net.fetch` exactly as `MediaProxy` does. Node's fetch is the wrong
 * judge: it does not apply Chromium's referrer rules, which is the class of
 * bug ("downloads but will not stream") this exists to catch.
 *
 * Usage:
 *   node tools/e2e/links-e2e.mjs --case "Hindmoviez=Dune Part Two" --case "Castle TV=Reacher" --out links.json
 *   node_modules/electron/dist/electron tools/e2e/links-play.cjs links.json
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sidecar, findInstalled, parse, resolveJava } from './catalogue-e2e.mjs';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const LINKS_PER_CASE = 8;

function parseArgs(argv) {
  const args = { cases: [], out: 'links.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--case') {
      const [provider, query] = argv[++i].split('=');
      args.cases.push({ provider: provider.trim(), query: query.trim() });
    } else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--java') args.java = argv[++i];
  }
  return args;
}

async function resolveCase(sidecar, provider, query) {
  const search = await sidecar.call('providerSearch', { providers: [provider], query }, 60_000);
  const reply = search.ok ? JSON.parse(search.result?.byProvider?.[provider] ?? '{}') : { error: search.error };
  if (!reply.ok) return { stage: 'search', error: reply.error ?? 'search failed' };
  const results = (reply.results ?? []).filter((r) => r?.url);
  if (results.length === 0) return { stage: 'search', error: 'no results' };
  const wanted = norm(query);
  const hit = results.find((r) => norm(r.name) === wanted) ?? results.find((r) => norm(r.name).startsWith(wanted)) ?? results[0];

  const detail = parse(await sidecar.call('providerLoad', { provider, url: hit.url }, 60_000));
  if (detail.error || !detail.ok) return { stage: 'load', title: hit.name, error: detail.error ?? 'load failed' };
  const body = detail.detail ?? detail;
  const handle = body.dataUrl ?? body.episodes?.[0]?.data ?? body.episodes?.[0]?.url ?? hit.url;

  const links = parse(await sidecar.call('providerLoadLinks', { provider, data: handle }, 90_000));
  const list = Array.isArray(links.links) ? links.links.filter((l) => l?.url) : [];
  if (list.length === 0) return { stage: 'links', title: hit.name, error: links.error ?? 'no links' };
  return { stage: 'ok', title: hit.name, links: list.slice(0, LINKS_PER_CASE) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sidecar = new Sidecar(resolveJava(args.java), fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-links-')));
  sidecar.start();
  const loaded = new Map(); // pluginId -> provider names
  const out = [];
  try {
    for (const c of args.cases) {
      const targets = findInstalled([norm(c.provider)]);
      let provider;
      for (const t of targets) {
        if (!loaded.has(t.pluginId)) {
          const r = await sidecar.call('load', { pluginId: t.pluginId, path: t.file }, 180_000);
          loaded.set(t.pluginId, r.ok ? (r.result?.providers ?? []).map((p) => p.name ?? String(p)) : []);
        }
        provider ??= loaded.get(t.pluginId).find((n) => norm(n) === norm(c.provider)) ??
          loaded.get(t.pluginId).find((n) => norm(n).includes(norm(c.provider)));
      }
      if (!provider) {
        out.push({ ...c, stage: 'install', error: 'provider not installed or failed to load' });
        console.log(`✗ ${c.provider} / ${c.query}: not installed`);
        continue;
      }
      const result = await resolveCase(sidecar, provider, c.query).catch((e) => ({ stage: 'exception', error: String(e?.message ?? e) }));
      out.push({ ...c, provider, ...result });
      console.log(`${result.stage === 'ok' ? '✓' : '✗'} ${provider} / ${c.query}: ${result.stage}${result.title ? ` "${result.title}"` : ''}${result.links ? ` ${result.links.length} links` : ''}${result.error ? ` — ${String(result.error).slice(0, 140)}` : ''}`);
    }
  } finally {
    await sidecar.stop();
  }
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Does each provider's home-page catalogue actually come back, and if a row is
 * empty in the app, whose fault is it?
 *
 * Drives `getMainPage` through the same sidecar JSON-RPC the main process uses
 * (`providerMainPageSections`, then `providerMainPage` for every row), with no
 * Electron in the way — the split `provider-e2e.mjs` relies on: when this shows
 * items and the app does not, the bug is in the app; when this shows an error or
 * nothing, it is the provider or its host.
 *
 * Every row is classified:
 *   OK         items came back
 *   MULTI      one request answered with several lists; the app splits them into
 *              one row each, as Android does (`src/views/ottRows.ts`)
 *   EMPTY      the provider answered with nothing (null page / empty lists)
 *   DROPPED    the provider returned items but none had a url, so the app's
 *              mapper discards them all (an empty name alone is fine)
 *   ERROR      the provider threw, timed out or the host refused
 *
 * Usage:
 *   node tools/e2e/catalogue-e2e.mjs --archive "<path to .cs3>" [--archive ...]
 *   node tools/e2e/catalogue-e2e.mjs --installed "netflix,prime"   # match installed providers
 *   node tools/e2e/catalogue-e2e.mjs --installed netflix --rows 6 --json report.json
 *
 * `--installed` reads the app's own provider registry (Dev profile first) to
 * find which installed archive registers a matching provider.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SIDECAR_TARGET = path.join(REPO_ROOT, 'sidecar', 'target');
const TOOLCHAIN = path.join(REPO_ROOT, 'tools', 'toolchain');
const CALL_TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const args = { archives: [], installed: null, rows: 0, json: null, java: null, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--archive') args.archives.push(argv[++i]);
    else if (arg === '--installed') args.installed = argv[++i].toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--rows') args.rows = Number(argv[++i]) || 0;
    else if (arg === '--json') args.json = argv[++i];
    else if (arg === '--java') args.java = argv[++i];
    else if (arg === '--profile') args.profile = argv[++i];
  }
  return args;
}

function resolveJava(explicit) {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  try {
    for (const entry of fs.readdirSync(TOOLCHAIN).sort().reverse()) {
      if (entry.toLowerCase().startsWith('jdk')) candidates.push(path.join(TOOLCHAIN, entry, 'bin', exe));
    }
  } catch {
    // No toolchain directory.
  }
  candidates.push(exe);
  for (const candidate of candidates) {
    if (candidate !== exe && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 8000 });
    const match = `${probe.stderr ?? ''}${probe.stdout ?? ''}`.match(/version "(\d+)/);
    if (match && Number(match[1]) >= 21) return candidate;
  }
  throw new Error('No Java 21+ found (tools/toolchain/jdk-*, JAVA_HOME or PATH).');
}

/** Line-delimited JSON-RPC over the sidecar's stdio. Same protocol as the app. */
class Sidecar {
  constructor(java, dataDir) {
    this.java = java;
    this.dataDir = dataDir;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = [];
  }

  start() {
    const jar = path.join(SIDECAR_TARGET, 'cs3-sidecar.jar');
    if (!fs.existsSync(jar)) throw new Error(`${jar} is missing — mvn -f sidecar/pom.xml package`);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.proc = spawn(
      this.java,
      [
        '-Xmx768m',
        '-Djava.library.path=',
        '-Dfile.encoding=UTF-8',
        '-cp',
        [jar, path.join(SIDECAR_TARGET, 'lib', '*')].join(path.delimiter),
        'com.cloudstream.desktop.sidecar.Main',
        `--data-dir=${this.dataDir}`,
        `--runtime-classpath=${path.join(REPO_ROOT, 'sidecar', 'runtime')}`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) this.stderr.push(line.trim());
      if (this.stderr.length > 2000) this.stderr.splice(0, 1000);
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
          // Not a frame; the sidecar routes plugin noise to stderr.
        }
      }
      index = this.buffer.indexOf('\n');
    }
  }

  call(method, params = {}, timeoutMs = CALL_TIMEOUT_MS) {
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

  async stop() {
    if (!this.proc || this.proc.exitCode !== null) return;
    const exited = new Promise((resolve) => this.proc.once('exit', resolve));
    this.proc.stdin.end();
    setTimeout(() => this.proc.kill(), 3000).unref();
    await exited;
  }
}

/** Which installed archives register a provider matching any of `wants`. */
function findInstalled(wants, profile) {
  const roots = profile
    ? [profile]
    : ['CloudStream 3 Desktop (Dev)', 'CloudStream 3 Desktop'].map((name) =>
        path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), name)
      );
  for (const root of roots) {
    const registryFile = path.join(root, 'cs3-provider-registry.json');
    if (!fs.existsSync(registryFile)) continue;
    const entries = JSON.parse(fs.readFileSync(registryFile, 'utf8')).entries ?? [];
    const archives = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().endsWith('.cs3')) archives.push(full);
      }
    };
    walk(path.join(root, 'extensions'));
    const picked = [];
    for (const entry of entries) {
      const names = (entry.providers ?? []).map((p) => String(p.name));
      if (!names.some((name) => wants.some((w) => name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(w)))) continue;
      // Archive file names are `<internalName>.<hash>.cs3`; size is the first
      // fingerprint field, which picks the right one when names prefix each other.
      const size = Number(String(entry.fingerprint).split(':')[0]);
      const file = archives.find(
        (p) => path.basename(p).startsWith(`${entry.internalName}.`) && fs.statSync(p).size === size
      );
      if (file) picked.push({ pluginId: entry.internalName, file });
      else console.warn(`  ! ${entry.internalName}: archive not found on disk`);
    }
    if (picked.length > 0) return picked;
  }
  return [];
}

const parse = (response) => {
  if (!response.ok) return { error: response.error ?? 'runtime did not answer' };
  try {
    return JSON.parse(String(response.result?.json ?? ''));
  } catch {
    return { error: 'unparsable reply' };
  }
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = [
    ...args.archives.map((file) => ({ pluginId: path.basename(file).split('.')[0], file })),
    ...(args.installed ? findInstalled(args.installed, args.profile) : []),
  ];
  if (targets.length === 0) {
    console.error('Nothing to test. Pass --archive <file.cs3> or --installed <name,...>.');
    process.exit(2);
  }

  const sidecar = new Sidecar(resolveJava(args.java), fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-catalogue-')));
  sidecar.start();
  const report = [];
  const tally = { OK: 0, MULTI: 0, EMPTY: 0, DROPPED: 0, ERROR: 0 };

  try {
    for (const target of targets) {
      const loaded = await sidecar.call('load', { pluginId: target.pluginId, path: target.file }, 120_000);
      if (!loaded.ok) {
        console.log(`✗ ${target.pluginId}: load failed — ${loaded.error}`);
        report.push({ plugin: target.pluginId, error: loaded.error });
        continue;
      }
      const providers = (loaded.result?.providers ?? []).map((p) => p.name ?? String(p));
      console.log(`\n■ ${target.pluginId} [${loaded.result?.tier}] — ${providers.join(', ')}`);
      if (args.installed) {
        providers.splice(
          0,
          providers.length,
          ...providers.filter((n) => args.installed.some((w) => n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(w)))
        );
      }

      for (const provider of providers) {
        const sectionsReply = parse(await sidecar.call('providerMainPageSections', { provider }));
        const sections = Array.isArray(sectionsReply.sections) ? sectionsReply.sections : [];
        const providerReport = { plugin: target.pluginId, provider, hasMainPage: sectionsReply.hasMainPage, rows: [] };
        report.push(providerReport);
        console.log(
          `  ${provider}: hasMainPage=${sectionsReply.hasMainPage} declared rows=${sections.length}` +
            (sectionsReply.error ? ` — ${sectionsReply.error}` : '')
        );

        for (const section of args.rows > 0 ? sections.slice(0, args.rows) : sections) {
          const started = Date.now();
          const reply = parse(
            await sidecar.call('providerMainPage', {
              provider,
              section: section.name,
              data: section.data ?? '',
              page: 1,
              horizontalImages: section.horizontalImages === true,
            })
          );
          const ms = Date.now() - started;
          const lists = Array.isArray(reply.sections) ? reply.sections : [];
          const raw = lists.flatMap((list) => (Array.isArray(list.items) ? list.items : []));
          // Matches the app: a catalogue item needs a url; a name is optional
          // (poster-only rows are normal — NetMirror sends no names at all).
          const usable = raw.filter((item) => item?.url);
          const unnamed = usable.filter((item) => !item.name).length;
          const status =
            reply.ok === false || reply.error
              ? 'ERROR'
              : raw.length === 0
                ? 'EMPTY'
                : usable.length === 0
                  ? 'DROPPED'
                  : lists.length > 1
                    ? 'MULTI'
                    : 'OK';
          tally[status]++;
          const detail =
            status === 'ERROR'
              ? String(reply.error ?? 'failed').slice(0, 160)
              : `${usable.length}/${raw.length} usable${unnamed ? ` (${unnamed} poster-only)` : ''} in ${lists.length} list(s)` +
                (lists.length > 1 ? ` [${lists.map((l) => l.name).join(' | ').slice(0, 120)}]` : '') +
                ` hasNext=${reply.hasNext}` +
                (usable[0] ? ` e.g. "${usable[0].name}"` : '');
          console.log(`    ${status.padEnd(7)} ${String(section.name).slice(0, 40).padEnd(40)} ${String(ms).padStart(6)}ms  ${detail}`);
          providerReport.rows.push({
            row: section.name,
            status,
            ms,
            lists: lists.map((l) => ({ name: l.name, items: (l.items ?? []).length })),
            usable: usable.length,
            raw: raw.length,
            hasNext: reply.hasNext,
            error: reply.error,
          });
        }
      }
    }
  } finally {
    await sidecar.stop();
  }

  console.log(`\nRows: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const errors = sidecar.stderr.filter((l) => /Exception|Error/.test(l)).slice(-12);
  if (errors.length) console.log(`\nLast sidecar errors:\n  ${errors.join('\n  ')}`);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ tally, report }, null, 2));
}

export { Sidecar, findInstalled, parse, resolveJava };

// Run only when invoked directly; `links-e2e.mjs` imports the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

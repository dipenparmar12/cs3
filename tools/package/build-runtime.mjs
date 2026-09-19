#!/usr/bin/env node
/**
 * Assembles everything the packaged app needs to run `.cs3` extensions.
 *
 * The end user installs one thing and streams. They do not install a JDK, they
 * do not set `JAVA_HOME`, and they never learn that a JVM is involved — so the
 * JVM has to be in the box. This produces `sidecar/dist/`, which
 * `electron-builder` copies into `resources/sidecar/` and
 * `SidecarSupervisor.resolveJava` finds as `resources/sidecar/jre/bin/java`.
 *
 *   sidecar/dist/
 *     cs3-sidecar.jar      the sidecar itself
 *     lib/                 its dependencies
 *     runtime/             library-jvm 4.8.0 + 55 transitives + the bridge
 *     jre/                 a jlinked Java 21 runtime
 *
 * Run after the three Maven builds and before `electron:build`:
 *
 *   node tools/package/build-runtime.mjs
 *   node tools/package/build-runtime.mjs --verify   # also smoke-test the JRE
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SIDECAR = path.join(REPO_ROOT, 'sidecar');
const DIST = path.join(SIDECAR, 'dist');
const TOOLCHAIN = path.join(REPO_ROOT, 'tools', 'toolchain');

/**
 * JDK modules the extension corpus actually reaches for.
 *
 * Not `ALL-MODULE-PATH`: that is 40 MB of compiler, RMI and smartcard support
 * no scraper touches. Each of these earns its place, and the ones that look
 * surprising are the ones that were needed:
 *
 *  - `jdk.crypto.ec`   — ECDHE. Without it TLS fails against most modern sites,
 *                        and the symptom is a handshake error per provider.
 *  - `jdk.unsupported` — `sun.misc.Unsafe`, which Kotlin coroutines, OkHttp and
 *                        Jackson all reach through transitively.
 *  - `jdk.localedata`  — locale-sensitive parsing. The corpus is deliberately
 *                        multilingual; a German or Turkish provider parsing
 *                        dates under a C locale silently returns nothing.
 *  - `java.sql`        — Jackson resolves `java.sql.Date` reflectively.
 *  - `java.scripting`  — Rhino is reachable through `javax.script`.
 *  - `java.naming`     — the TLS/HTTP stacks pull it in for name resolution.
 */
const MODULES = [
  'java.base',
  'java.desktop',
  'java.instrument',
  'java.logging',
  'java.management',
  'java.naming',
  'java.net.http',
  'java.prefs',
  'java.scripting',
  'java.security.jgss',
  'java.security.sasl',
  'java.sql',
  'java.xml',
  'jdk.crypto.ec',
  'jdk.localedata',
  'jdk.unsupported',
  'jdk.zipfs',
];

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', dim: '\x1b[2m' };
const step = (m) => console.log(`${C.cyan}▸${C.reset} ${m}`);
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
const dim = (m) => console.log(`  ${C.dim}${m}${C.reset}`);
const die = (m) => {
  console.error(`  ${C.red}✗${C.reset} ${m}`);
  process.exit(1);
};

function javaMajor(exe) {
  const probe = spawnSync(exe, ['-version'], { encoding: 'utf8', timeout: 8000 });
  const match = `${probe.stderr ?? ''}${probe.stdout ?? ''}`.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return match[1] === '1' ? parseInt(match[2] ?? '0', 10) : parseInt(match[1], 10);
}

/** A *JDK* is required, not a JRE: `jlink` ships only with the former. */
function findJdk() {
  const win = process.platform === 'win32';
  const candidates = [];

  try {
    for (const entry of fs.readdirSync(TOOLCHAIN).sort().reverse()) {
      if (entry.toLowerCase().startsWith('jdk')) candidates.push(path.join(TOOLCHAIN, entry));
    }
  } catch {
    // No toolchain directory; JAVA_HOME may still serve.
  }
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  for (const home of candidates) {
    const java = path.join(home, 'bin', win ? 'java.exe' : 'java');
    const jlink = path.join(home, 'bin', win ? 'jlink.exe' : 'jlink');
    if (!fs.existsSync(java) || !fs.existsSync(jlink)) continue;
    const major = javaMajor(java);
    if (major !== null && major >= 21) return { home, jlink, major };
  }

  die(
    'No JDK 21+ with jlink found. Unpack one into tools/toolchain/ or point JAVA_HOME at it. ' +
      `Looked in: ${candidates.join(', ') || 'nowhere'}`
  );
}

function killDistProcesses() {
  if (process.platform !== 'win32') return;
  try {
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Process -Name java -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*sidecar\\dist\\*" } | Stop-Process -Force',
      ],
      { timeout: 5000 }
    );
  } catch {
    // Best-effort
  }
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      lastError = err;
      if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        killDistProcesses();
        spawnSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 400'],
          { timeout: 3000 }
        );
        continue;
      }
      throw err;
    }
  }
  if (lastError) throw lastError;
}

/**
 * Mirrors a directory by **difference**, never by delete-then-copy.
 *
 * The old version wiped the destination first, and on Windows that is the whole
 * of the reported "packaging halts in the middle": a jar this app is *running*
 * cannot be unlinked, so `bun run dist:portable` died with a raw Node stack —
 *
 *     Error: EBUSY: resource busy or locked, unlink
 *     'sidecar\dist\lib\antlr-runtime-3.5.3.jar'
 *
 * — for a file whose bytes were already exactly right. Nothing about that
 * failure needed to happen: 58 identical jars were about to be deleted and
 * copied back.
 *
 * So a file is written only when it differs by size or is older than its
 * source, and extras are removed afterwards. A locked file that is already
 * correct is never touched, which means a build no longer requires the app to
 * be closed — and when a file genuinely must be replaced while something holds
 * it, `report` says which file and which app rather than printing a stack.
 */
function copyDir(from, to, label) {
  if (!fs.existsSync(from)) die(`${label} is missing at ${from}`);
  fs.mkdirSync(to, { recursive: true });

  let copied = 0;
  let kept = 0;
  const wanted = new Set();

  const mirror = (sourceDir, targetDir) => {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = path.join(targetDir, entry.name);
      wanted.add(path.relative(to, target));
      if (entry.isDirectory()) {
        mirror(source, target);
        continue;
      }
      const src = fs.statSync(source);
      const dst = fs.existsSync(target) ? fs.statSync(target) : null;
      if (dst && dst.size === src.size && dst.mtimeMs >= src.mtimeMs) {
        kept += 1;
        continue;
      }
      try {
        fs.copyFileSync(source, target);
        copied += 1;
      } catch (error) {
        if (error.code === 'EBUSY' || error.code === 'EPERM') {
          die(
            `${path.basename(target)} is in use, so ${label} could not be updated.\n` +
              `  ${target}\n` +
              '  Close CloudStream (including any running `bun run dev`) and build again.'
          );
        }
        throw error;
      }
    }
  };
  mirror(from, to);

  for (const existing of fs.readdirSync(to, { recursive: true })) {
    const full = path.join(to, existing);
    if (wanted.has(existing) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    fs.rmSync(full, { force: true });
  }

  const count = fs.readdirSync(to).length;
  ok(
    `${label}: ${count} entr${count === 1 ? 'y' : 'ies'}` +
      (kept > 0 ? ` (${copied} copied, ${kept} already current)` : '')
  );
}

function dirSizeMb(dir) {
  let total = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  try {
    walk(dir);
  } catch {
    return 0;
  }
  return total / 1024 / 1024;
}

function main() {
  const verify = process.argv.includes('--verify');
  const jdk = findJdk();
  step(`JDK ${jdk.major} at ${jdk.home}`);

  fs.mkdirSync(DIST, { recursive: true });
  killDistProcesses();

  // --- the sidecar and its classpath ------------------------------------
  step('Collecting the extension runtime');

  const jar = path.join(SIDECAR, 'target', 'cs3-sidecar.jar');
  if (!fs.existsSync(jar)) die(`${jar} is missing. Run: mvn -f sidecar/pom.xml package`);
  fs.copyFileSync(jar, path.join(DIST, 'cs3-sidecar.jar'));
  ok('cs3-sidecar.jar');

  copyDir(path.join(SIDECAR, 'target', 'lib'), path.join(DIST, 'lib'), 'sidecar dependencies');

  const runtime = path.join(SIDECAR, 'runtime');
  if (!fs.existsSync(path.join(runtime, 'cs3-provider-bridge.jar'))) {
    die(
      'sidecar/runtime/cs3-provider-bridge.jar is missing. Run:\n' +
        '    mvn -f sidecar/runtime-deps/pom.xml package\n' +
        '    mvn -f sidecar/bridge/pom.xml package'
    );
  }
  if (!fs.readdirSync(runtime).some((f) => f.startsWith('library-jvm') && f.endsWith('.jar'))) {
    die('sidecar/runtime has no library-jvm jar. Run: mvn -f sidecar/runtime-deps/pom.xml package');
  }
  copyDir(runtime, path.join(DIST, 'runtime'), 'provider classpath');

  // --- the JRE ------------------------------------------------------------
  step('Linking a Java runtime');

  const jreDir = path.join(DIST, 'jre');

  /**
   * Relinking is skipped when the linked runtime already matches this request.
   *
   * jlink takes the better part of a minute and produces ~90 MB of identical
   * output whenever neither the JDK nor the module list has moved — and it
   * cannot write into an existing directory, so the step also had to delete a
   * tree that a running app may hold open. The stamp records the two things
   * that decide the output: which JDK linked it, and which modules were asked
   * for. Both matter — the module list is curated, and a build that quietly
   * reused a JRE missing `jdk.crypto.ec` would ship TLS that fails site by
   * site (AGENTS.md §3).
   */
  const stampFile = path.join(jreDir, 'cs3-link-stamp.json');
  const stamp = JSON.stringify({ jdk: jdk.home, major: jdk.major, modules: MODULES });
  const linkedJava = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const alreadyLinked =
    !process.argv.includes('--relink') &&
    fs.existsSync(linkedJava) &&
    fs.existsSync(stampFile) &&
    fs.readFileSync(stampFile, 'utf8') === stamp;

  if (alreadyLinked) {
    ok(`jre: reusing the linked runtime (${MODULES.length} modules, same JDK)`);
  } else {
    // jlink refuses to write into an existing directory, and a stale JRE from a
    // previous run would otherwise be shipped unchanged.
    cleanDir(jreDir);

    const result = spawnSync(
      jdk.jlink,
      [
        '--add-modules',
        MODULES.join(','),
        '--output',
        jreDir,
        '--no-header-files',
        '--no-man-pages',
        // Debug info is deliberately kept. Community plugins fail in ways that
        // are diagnosed from stack traces, and stripping line numbers to save
        // ~10 MB would trade the only diagnostic that has ever worked here.
        '--compress',
        'zip-6',
      ],
      { encoding: 'utf8', stdio: 'pipe' }
    );

    if (result.status !== 0) {
      die(`jlink failed:\n${result.stderr || result.stdout}`);
    }

    const major = javaMajor(linkedJava);
    if (major === null || major < 21) {
      die(`the linked runtime reports Java ${major}, expected 21+`);
    }
    fs.writeFileSync(stampFile, stamp);
    ok(`jre: Java ${major}, ${dirSizeMb(jreDir).toFixed(0)} MB, ${MODULES.length} modules`);
  }

  // --- smoke test ---------------------------------------------------------
  if (verify) {
    step('Smoke-testing the linked runtime');
    const classpath = [
      path.join(DIST, 'cs3-sidecar.jar'),
      path.join(DIST, 'lib', '*'),
    ].join(path.delimiter);

    const probe = spawnSync(
      linkedJava,
      [
        '-Djava.library.path=',
        '-cp',
        classpath,
        'com.cloudstream.desktop.sidecar.Main',
        `--data-dir=${path.join(DIST, '.smoke')}`,
        `--runtime-classpath=${path.join(DIST, 'runtime')}`,
      ],
      { encoding: 'utf8', input: '{"id":"1","method":"status","params":{}}\n', timeout: 60_000 }
    );

    const reply = (probe.stdout ?? '').split('\n').find((l) => l.trim().startsWith('{'));
    if (!reply) die(`the sidecar produced no reply under the linked JRE.\n${probe.stderr ?? ''}`);

    let parsed;
    try {
      parsed = JSON.parse(reply);
    } catch {
      die(`unparsable reply: ${reply.slice(0, 200)}`);
    }
    if (!parsed.ok) die(`status failed: ${parsed.error}`);
    if (!parsed.result?.canExecute) {
      die(`the runtime cannot execute providers: ${parsed.result?.reason ?? 'no reason given'}`);
    }
    ok('the sidecar starts under the linked JRE and can execute providers');
    fs.rmSync(path.join(DIST, '.smoke'), { recursive: true, force: true });
  }

  step(`Ready: ${DIST} (${dirSizeMb(DIST).toFixed(0)} MB)`);
  dim('electron-builder copies this to resources/sidecar/ via extraResources.');
}

main();

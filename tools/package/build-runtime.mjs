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

function copyDir(from, to, label) {
  if (!fs.existsSync(from)) die(`${label} is missing at ${from}`);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const count = fs.readdirSync(to).length;
  ok(`${label}: ${count} entr${count === 1 ? 'y' : 'ies'}`);
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
  // jlink refuses to write into an existing directory, and a stale JRE from a
  // previous run would otherwise be shipped unchanged.
  fs.rmSync(jreDir, { recursive: true, force: true });

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

  const jreJava = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const major = javaMajor(jreJava);
  if (major === null || major < 21) die(`the linked runtime reports Java ${major}, expected 21+`);
  ok(`jre: Java ${major}, ${dirSizeMb(jreDir).toFixed(0)} MB, ${MODULES.length} modules`);

  // --- smoke test ---------------------------------------------------------
  if (verify) {
    step('Smoke-testing the linked runtime');
    const classpath = [
      path.join(DIST, 'cs3-sidecar.jar'),
      path.join(DIST, 'lib', '*'),
    ].join(path.delimiter);

    const probe = spawnSync(
      jreJava,
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

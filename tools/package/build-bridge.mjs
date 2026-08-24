#!/usr/bin/env node
/**
 * Builds `cs3-provider-bridge.jar` without resolving `library-jvm` from JitPack.
 *
 * `sidecar/bridge/pom.xml` is the real build and stays the reference. It cannot
 * run everywhere: `com.github.recloudstream.cloudstream:library-jvm` is
 * published on JitPack and nowhere else, and an egress policy that blocks it
 * fails the build at dependency resolution before a line is compiled — a 403 on
 * a POM, with nothing about the Kotlin in it at fault.
 *
 * The jars are already vendored in `sidecar/runtime/`. That directory *is* the
 * classpath the bridge is compiled against and loaded by, so compiling straight
 * from it produces the same output the POM does; `kotlin-compiler-embeddable`
 * resolves from Central, which is reachable. This is a workaround for the
 * network, not for the build — if Maven can resolve, prefer it.
 *
 *   node tools/package/build-bridge.mjs
 *
 * Requires `sidecar/target/cs3-sidecar-android-shim.jar`, which `mvn -f
 * sidecar/pom.xml package` produces: the bridge's `Plugin` takes an
 * `android.content.Context` and will not compile without the shims.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridgeDir = path.join(root, 'sidecar', 'bridge');
const runtimeDir = path.join(root, 'sidecar', 'runtime');
const shimJar = path.join(root, 'sidecar', 'target', 'cs3-sidecar-android-shim.jar');
const outDir = path.join(bridgeDir, 'target');
const classesDir = path.join(outDir, 'classes');
const jarPath = path.join(outDir, 'cs3-provider-bridge.jar');

/** Kept in step with `kotlin.version` in the bridge POM. */
const KOTLIN_VERSION = '2.3.21';
/** Kept in step with the POM's `<args>`; see the comments there for why each. */
const OPT_INS = ['com.lagradost.cloudstream3.InternalAPI', 'kotlin.uuid.ExperimentalUuidApi'];

const die = (message) => {
  console.error(`build-bridge: ${message}`);
  process.exit(1);
};

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8', ...opts });

function resolveFromLocalRepository(groupPath, artifact, version) {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const jar = path.join(home, '.m2', 'repository', ...groupPath.split('/'), artifact, version,
    `${artifact}-${version}.jar`);
  if (fs.existsSync(jar)) return jar;

  // `dependency:get` is the only Maven step here, and it only ever touches
  // Central — the repository that is reachable.
  const got = run('mvn', ['-q', 'dependency:get',
    `-Dartifact=${groupPath.replaceAll('/', '.')}:${artifact}:${version}`]);
  if (got.status !== 0 || !fs.existsSync(jar)) {
    die(`could not obtain ${artifact} ${version} from Maven Central. Is mvn on PATH?`);
  }
  return jar;
}

function classpathEntries() {
  if (!fs.existsSync(runtimeDir)) {
    die(`${path.relative(root, runtimeDir)} does not exist. Run:\n` +
      `  mvn -f sidecar/runtime-deps/pom.xml package`);
  }
  const jars = fs.readdirSync(runtimeDir)
    .filter((name) => name.endsWith('.jar'))
    // The bridge's own previous output. Leaving it on the classpath would
    // compile these sources against last build's copy of themselves, which
    // hides a signature change until something links against it at runtime.
    .filter((name) => !name.startsWith('cs3-provider-bridge'))
    .map((name) => path.join(runtimeDir, name));

  if (!jars.some((jar) => path.basename(jar).startsWith('library-jvm'))) {
    die(`library-jvm is missing from ${path.relative(root, runtimeDir)}. Run:\n` +
      `  mvn -f sidecar/runtime-deps/pom.xml package`);
  }
  if (!fs.existsSync(shimJar)) {
    die(`${path.relative(root, shimJar)} is missing. Run:\n  mvn -f sidecar/pom.xml package`);
  }
  return [...jars, shimJar];
}

function kotlinSources() {
  const srcDir = path.join(bridgeDir, 'src', 'main', 'kotlin');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kt')) found.push(full);
    }
  };
  walk(srcDir);
  if (found.length === 0) die('no Kotlin sources found');
  return found;
}

/**
 * `kotlin-compiler-embeddable` is not self-contained: it is compiled Kotlin, so
 * running it needs the very stdlib it is about to compile against, plus the
 * script-runtime and daemon halves it loads reflectively. Omitting them fails
 * with `NoClassDefFoundError: kotlin/jvm/internal/markers/KMappedMarker`, which
 * reads like a version conflict and is not one.
 */
const compilerClasspath = [
  resolveFromLocalRepository('org/jetbrains/kotlin', 'kotlin-compiler-embeddable', KOTLIN_VERSION),
  resolveFromLocalRepository('org/jetbrains/kotlin', 'kotlin-stdlib', KOTLIN_VERSION),
  resolveFromLocalRepository('org/jetbrains/kotlin', 'kotlin-reflect', KOTLIN_VERSION),
  resolveFromLocalRepository('org/jetbrains/kotlin', 'kotlin-script-runtime', KOTLIN_VERSION),
  resolveFromLocalRepository('org/jetbrains/kotlin', 'kotlin-daemon-embeddable', KOTLIN_VERSION),
  resolveFromLocalRepository('org/jetbrains/intellij/deps', 'trove4j', '1.0.20200330'),
  // The compiler pipeline itself runs on coroutines. Taken from the vendored
  // runtime rather than fetched, so the compiler and the code it compiles agree
  // on one version.
  path.join(runtimeDir, 'kotlinx-coroutines-core-jvm-1.11.0.jar'),
  // Codegen writes @Nullable/@NotNull onto every generated parameter and
  // resolves them from its own classpath, not the compile classpath. Missing,
  // it fails inside FunctionCodegen rather than as a resolution error.
  path.join(runtimeDir, 'annotations-13.0.jar'),
];
const classpath = classpathEntries();
const sources = kotlinSources();

fs.rmSync(classesDir, { recursive: true, force: true });
fs.mkdirSync(classesDir, { recursive: true });

console.log(`build-bridge: compiling ${sources.length} files against ${classpath.length} jars`);
const compiled = run('java', [
  '-cp', compilerClasspath.join(path.delimiter),
  'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
  '-no-stdlib',            // kotlin-stdlib is on the runtime classpath already;
                           // a second copy on one loader is the hazard the POM
                           // marks every dependency `provided` to avoid.
  '-jvm-target', '21',
  '-classpath', classpath.join(path.delimiter),
  '-d', classesDir,
  ...OPT_INS.flatMap((optIn) => [`-opt-in=${optIn}`]),
  ...sources,
]);
if (compiled.status !== 0) die('Kotlin compilation failed');

const jarred = run('jar', ['--create', '--file', jarPath, '-C', classesDir, '.']);
if (jarred.status !== 0) die('jar failed');

fs.copyFileSync(jarPath, path.join(runtimeDir, 'cs3-provider-bridge.jar'));
const size = (fs.statSync(jarPath).size / 1024).toFixed(0);
console.log(`build-bridge: wrote ${path.relative(root, jarPath)} (${size} KB) and copied it into sidecar/runtime/`);

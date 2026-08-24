/**
 * Sidecar stderr, folded into records that can be counted.
 *
 *   node --experimental-strip-types electron/cs3/sidecarStderr.test.mts
 *
 * This exists because the gap it closes was invisible. `logger.ts` states that
 * "the sidecar logs to stderr, which the supervisor captures and re-emits
 * through here" — and it did not: stderr went to `console.warn` and nowhere
 * else. Every extension failure was therefore visible only to whoever had a
 * terminal open, and the one workflow this codebase relies on for extension
 * problems — count the log before fixing anything — could not be run on them.
 *
 * The fixtures are real: both traces below were pasted from a user's console,
 * verbatim, because that was the only way to get them.
 *
 * What matters is not that lines are logged but that they are logged in a shape
 * a `GROUP BY` can use. Thirty stack lines as thirty records cannot be grouped
 * and push the cause out of the ring; one record with `missingClass` promoted
 * to a field is what turned 113 load failures into six missing types.
 */
import assert from 'node:assert/strict';
import { SidecarStderrReader, type SidecarRecord } from './sidecarStderr.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** Feeds the reader line by line, exactly as the stderr handler does. */
function absorb(lines: string): SidecarRecord[] {
  const records: SidecarRecord[] = [];
  const reader = new SidecarStderrReader((record) => records.push(record));
  for (const line of lines.split('\n')) reader.push(line);
  reader.flush();
  return records;
}

const ULTIMA = `INFO PluginInstance: Adding Ultima (NONE) MainAPI
java.lang.reflect.InvocationTargetException
    at java.base/java.lang.reflect.Method.invoke(Method.java:580)
    at com.cloudstream.desktop.sidecar.PluginHost.invokeLoad(PluginHost.java:380)
Caused by: java.lang.NoClassDefFoundError: com/lagradost/cloudstream3/CloudStreamApp
    at cs3-plugin-Ultima//com.phisher98.UltimaPlugin.load(Unknown Source)
    ... 9 more
Caused by: java.lang.ClassNotFoundException: com.lagradost.cloudstream3.CloudStreamApp
    at java.base/java.net.URLClassLoader.findClass(URLClassLoader.java:445)
    ... 12 more
INFO PluginInstance: Adding XD Movies`;

test('one exception becomes one record, not one per stack line', () => {
  const records = absorb(ULTIMA);
  // Three heads: the two INFO lines and the exception between them.
  assert.equal(records.length, 3, `got ${records.length}: ${records.map((r) => r.message)}`);
});

test('the stack travels with its message as detail', () => {
  const [, exception] = absorb(ULTIMA);
  assert.match(String(exception.message), /InvocationTargetException/);
  assert.match(String(exception.detail), /Caused by: java\.lang\.NoClassDefFoundError/);
  assert.match(String(exception.detail), /\.\.\. 12 more/);
});

test('the missing class is promoted to a field, so it can be grouped', () => {
  /**
   * The whole point. Counting free text produces a tally with one entry per
   * failure; counting this field is what produced "six classes cover 100% of
   * 113 load failures".
   */
  const [, exception] = absorb(ULTIMA);
  assert.equal(exception.missingClass, 'com.lagradost.cloudstream3.CloudStreamApp');
});

test('an uncaught throwable is an error even with no level prefix', () => {
  // The JVM prints these itself, with no INFO/ERROR word in front. Recording
  // them at `info` would hide every plugin crash from a problems-only view.
  const [, exception] = absorb(ULTIMA);
  assert.equal(exception.level, 'error');
});

test("the JVM's own level is honoured where it prints one", () => {
  const records = absorb(ULTIMA);
  assert.equal(records[0].level, 'info');
  assert.equal(records[0].message, 'PluginInstance: Adding Ultima (NONE) MainAPI');
  assert.equal(records[2].level, 'info');
});

test('a DEBUG trace stays debug — it was caught, and is not a failure', () => {
  /**
   * MegaProvider's `getRepositories` throws inside Jackson and upstream's
   * `safeApiCall` catches it. Promoting that to `error` would put a handled
   * condition in a problems-only view beside real crashes.
   */
  const records = absorb(`DEBUG ApiError: safeApiCall: Unresolved class: class com.mega.MegaPlugin$getRepositories$VerifiedRepo (kind = CLASS)
kotlin.reflect.jvm.internal.KotlinReflectionInternalError: Unresolved class
    at cs3-shared//kotlin.reflect.jvm.internal.KClassImpl.createSyntheticClassOrFail(KClassImpl.kt:635)
    at cs3-plugin-MegaProvider//com.mega.MegaPlugin.getRepositories(Unknown Source)`);
  assert.equal(records[0].level, 'debug');
  assert.match(String(records[0].message), /safeApiCall/);
  // No class is missing here; nothing should be invented.
  assert.equal(records[0].missingClass, undefined);
});

test('a runaway stack is bounded rather than becoming the log', () => {
  const flood = ['ERROR boom', ...Array.from({ length: 500 }, (_, i) => `    at a.b.C.m${i}(C.java:${i})`)];
  const [record] = absorb(flood.join('\n'));
  assert.ok(String(record.detail).split('\n').length <= 80);
});

// --- runner ------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);

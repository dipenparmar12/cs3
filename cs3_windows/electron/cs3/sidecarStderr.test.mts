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
  /**
   * The prefix is stripped from the message and decides the level.
   *
   * This used to assert `info` against the two `PluginInstance: Adding …`
   * lines in {@link ULTIMA}, which is now the one case where the JVM's level is
   * deliberately *not* honoured — see the registration test below. Those lines
   * are the only INFO the loader prints, so testing the rule on them tested the
   * exception instead. The rule itself is unchanged.
   */
  const [record] = absorb('INFO Serienstream: main page loaded');
  assert.equal(record.level, 'info');
  assert.equal(record.message, 'Serienstream: main page loaded');
  assert.equal(absorb('WARN Aniworld: mirror 2 refused')[0].level, 'warn');
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


// --- attribution and cause, measured from 21 real session logs ---------------
//
// Every fixture below is a verbatim line shape from a user's own log, with the
// occurrence count that made it worth handling. The counts are the argument:
// 5,407 of 6,069 records in that log were sidecar stderr, `missingClass`
// matched none of them, and the reader could not tell 200 lines of
// registration chatter from 240 real network failures because both landed at
// `info` with no attribution.

test('the plugin tag becomes a field, so the log can be grouped by extension', () => {
  const [record] = absorb('GDFlix: No server matched');
  assert.equal(record.source, 'GDFlix');
  // The tag stays in the message too: two extractors both saying "No server
  // matched" are one row in any view that does not show the source column.
  assert.match(record.message, /^GDFlix:/);
});

test("android.util.Log's own level and tag are honoured over any guess", () => {
  const [debug] = absorb('[plugin D/Ayzen] audinifer.com');
  assert.equal(debug.level, 'debug');
  assert.equal(debug.source, 'Ayzen');
  assert.equal(debug.message, 'audinifer.com');

  const [error] = absorb('[plugin E/StreamPlay] every mirror refused');
  assert.equal(error.level, 'error');
  assert.equal(error.source, 'StreamPlay');
});

test('an unprefixed network failure is a problem, not information', () => {
  // 74 + 50 + 43 + 35 occurrences across the sampled logs, every one of them
  // recorded at `info` before this — below the threshold of a problems-only
  // view, which is the only view anyone debugging opens.
  for (const line of [
    'Exception in NiceHttp: java.net.SocketException Connection reset',
    'Exception in NiceHttp: java.net.SocketTimeoutException Read timed out',
    'Exception in NiceHttp: java.net.UnknownHostException usa.eat-peach.sbs',
    'ApiError: safeApiCall: Read timed out',
  ]) {
    const [record] = absorb(line);
    assert.equal(record.level, 'warn', line);
    assert.ok(record.cause, `no cause for: ${line}`);
  }
});

test('the cause comes from the shared taxonomy, so it groups with everything else', () => {
  assert.equal(absorb('ApiError: safeApiCall: Read timed out')[0].cause, 'timeout');
  assert.equal(
    absorb('Exception in NiceHttp: java.net.UnknownHostException usa.eat-peach.sbs')[0].cause,
    'network'
  );
  assert.equal(
    absorb('Error:: Error processing links org.json.JSONException: A JSONObject text must begin with {')[0].cause,
    'unreadable-reply'
  );
});

test('registration chatter is demoted rather than dropped', () => {
  // ~200 occurrences at INFO. "Which providers did this archive register" is a
  // real question; it is not worth 200 rows at the level a problems view reads.
  const [record] = absorb('INFO PluginInstance: Adding PixelDrain (https://pixeldrain.dev/) ExtractorApi');
  assert.equal(record.level, 'debug');
  // And it is not a failure, so it must carry no cause — the taxonomy's last
  // rule matches anything containing "Error", which would file it as one.
  assert.equal(record.cause, undefined);
});

test('an informational line carries no cause', () => {
  const [record] = absorb('StreamPlay: Progress: 3/8 providers');
  assert.equal(record.level, 'info');
  assert.equal(record.cause, undefined);
});

test("upstream's logError divider is not an event", () => {
  // 290 occurrences of a row of dashes. It marks the block that follows; the
  // block's own lines say what happened.
  const records = absorb(
    'ApiError: -------------------------------------------------------------------\n' +
      'ApiError: safeApiCall: Connection reset'
  );
  assert.equal(records.length, 1, records.map((r) => r.message).join(' | '));
  assert.match(records[0].message, /Connection reset/);
});

test('a JUL header and the line under it are one record, not two', () => {
  // SimpleFormatter prints <date> <class> <method> and the message beneath.
  // 151 headers in the sampled logs: read separately they are 151 records
  // saying nothing plus 151 messages with no origin.
  const records = absorb(
    'Aug 25, 2026 1:23:45 PM okhttp3.internal.platform.Platform log\n' +
      'A connection to https://enc-dec.app/ was leaked. Did you forget to close a response body?'
  );
  assert.equal(records.length, 1, records.map((r) => r.message).join(' | '));
  assert.equal(records[0].source, 'okhttp3.internal.platform.Platform');
  assert.match(records[0].message, /was leaked/);
});

test('a sentence containing a colon does not donate a tag', () => {
  // Without the bound on the tag pattern, every URL-bearing sentence adds its
  // own row to the tally — which is the failure this whole module exists to
  // avoid, arriving through the attribution instead of the message.
  const [record] = absorb(
    'MNuNHelper: MNuN Playlist is not a "Master Playlist". Removing this link as it is invalid and will not open in player: https://example.com/a.m3u8'
  );
  assert.equal(record.source, 'MNuNHelper');
});

test('a bare throwable is attributed to its own class', () => {
  const [record] = absorb('java.io.IOException: Canceled');
  assert.equal(record.source, 'java.io.IOException');
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

/**
 * The extension issue ledger — the durable "count before fixing" surface.
 *
 *   node --experimental-strip-types electron/cs3/extensionIssues.test.mts
 *
 * Every fixture is a verbatim line shape from a real 21-session log, and the
 * grouping rules are what that log demanded: 6,069 records, of which 5,407 were
 * sidecar stderr, collapsing to well under a hundred distinct problems. Getting
 * the fingerprint wrong fails in two directions and both are silent —
 * too coarse and two unrelated failures become one row that nobody can act on;
 * too fine and the tally grows one row per host and says nothing at all.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ExtensionIssueLog } from './extensionIssues.ts';
import { describe } from './sidecarStderr.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** An in-memory ledger; nothing here needs the disk except the one test that does. */
function ledger(sessionId = 's1', appVersion?: string) {
  return new ExtensionIssueLog({ file: '', sessionId, appVersion, persist: false });
}

/** Feeds a raw stderr line through the real reader, as the supervisor does. */
function feed(log: ExtensionIssueLog, line: string, plugin?: string) {
  return log.recordSidecar(describe(line), plugin);
}

test('informational lines are not issues', () => {
  const log = ledger();
  assert.equal(feed(log, 'INFO PluginInstance: Adding Voe (https://voe.sx/) ExtractorApi'), null);
  assert.equal(feed(log, 'StreamPlay: Progress: 3/8 providers'), null);
  assert.equal(log.list().length, 0);
});

test('the same failure from different hosts is one row', () => {
  // The whole point. Without grouping this is three rows and a tally that says
  // nothing; with it, one row saying an extractor times out.
  const log = ledger();
  feed(log, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
  feed(log, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
  feed(log, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
  const issues = log.list();
  assert.equal(issues.length, 1);
  assert.equal(issues[0].occurrences, 3);
  assert.equal(issues[0].cause, 'timeout');
  assert.equal(issues[0].source, 'GDFlix');
});

test('two extensions with the same symptom stay two rows', () => {
  // Attribution is what makes a row assignable. Folding these together gives
  // one row covering nine extensions that nobody can act on.
  const log = ledger();
  feed(log, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
  feed(log, 'Driveseed: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
  assert.equal(log.list().length, 2);
});

test('numbers that identify a failure are not grouped away', () => {
  /**
   * `groupingForm` removes durations and byte counts and deliberately leaves
   * bare integers. A shorter report that merges 403 with 404 says something
   * false: one needs a browser and the other needs a different source.
   */
  const log = ledger();
  feed(log, 'Cinevood: request failed with HTTP 403');
  feed(log, 'Cinevood: request failed with HTTP 404');
  assert.equal(log.list().length, 2);
});

test('a duration is grouped away, because it differs every time', () => {
  const log = ledger();
  feed(log, 'Aniworld: request failed, gave up after 20000 ms');
  feed(log, 'Aniworld: request failed, gave up after 31500 ms');
  assert.equal(log.list().length, 1);
  assert.equal(log.list()[0].occurrences, 2);
});

test('sessions count launches, occurrences count events', () => {
  /**
   * The two answer different questions. Forty occurrences in one session is a
   * retry loop; forty across forty sessions is a site that has been down for a
   * month. A ledger reporting only the first number cannot tell them apart.
   */
  const line = 'Cinevood: Exception in NiceHttp: java.net.SocketException Connection reset';
  const first = ledger('s1');
  feed(first, line);
  feed(first, line);
  const [issue] = first.list();
  assert.equal(issue.occurrences, 2);
  assert.equal(issue.sessions, 1);

  // A second launch, same problem: the id has to survive the restart or the
  // count starts over and a long-running problem always looks new.
  const second = new ExtensionIssueLog({ file: '', sessionId: 's2', persist: false });
  const seeded = second as unknown as { issues: Map<string, unknown> };
  seeded.issues.set(issue.id, { ...issue });
  feed(second, line);
  const [again] = second.list();
  assert.equal(again.id, issue.id, 'the fingerprint must be stable across sessions');
  assert.equal(again.occurrences, 3);
  assert.equal(again.sessions, 2);
});

test('a row keeps the worst level it has ever been seen at', () => {
  const log = ledger();
  log.recordSidecar({ level: 'warn', message: 'Ayzen: mirror refused', cause: 'blocked' });
  log.recordSidecar({ level: 'error', message: 'Ayzen: mirror refused', cause: 'blocked' });
  log.recordSidecar({ level: 'warn', message: 'Ayzen: mirror refused', cause: 'blocked' });
  assert.equal(log.list()[0].level, 'error');
});

test('a later occurrence can supply the stack the first one lacked', () => {
  const log = ledger();
  log.recordSidecar({ level: 'error', message: 'Anichi: load failed', cause: 'provider-error' });
  log.recordSidecar({
    level: 'error',
    message: 'Anichi: load failed',
    cause: 'provider-error',
    detail: '    at com.example.Anichi.load(Anichi.kt:41)',
    missingClass: 'com.lagradost.cloudstream3.CloudStreamApp',
  });
  const [issue] = log.list();
  assert.equal(issue.occurrences, 2);
  assert.match(String(issue.detail), /Anichi\.kt:41/);
  assert.equal(issue.missingClass, 'com.lagradost.cloudstream3.CloudStreamApp');
});

test('a plugin that will not load is an issue, though it never reaches stderr', () => {
  // The host learns this from a failed `load` reply, not from a tagged line.
  // It is also the single most actionable category there is.
  const log = ledger();
  const issue = log.recordPluginFailure({
    plugin: 'Ultima',
    reason: 'NoClassDefFoundError: com/lagradost/cloudstream3/CloudStreamApp',
    tier: 'T4_BLOCKED',
  });
  assert.ok(issue);
  assert.equal(issue.source, 'Ultima');
  assert.equal(issue.cause, 'runtime-unavailable');
  assert.deepEqual(issue.plugins, ['Ultima']);
});

test('the summary counts both distinct problems and total occurrences', () => {
  /**
   * Six hundred occurrences across three rows is an afternoon; across two
   * hundred rows it is a different project. A tally with only one of the two
   * numbers cannot distinguish them, which is the decision it exists to inform.
   */
  const log = ledger();
  for (let i = 0; i < 5; i++) feed(log, 'GDFlix: Read timed out');
  feed(log, 'Driveseed: Read timed out');
  feed(log, 'Voe: java.net.UnknownHostException usa.eat-peach.sbs');

  const summary = log.summary();
  const timeout = summary.find((s) => s.cause === 'timeout');
  assert.ok(timeout);
  assert.equal(timeout.occurrences, 6);
  assert.equal(timeout.issues, 2);
  // Ordered by occurrences, so the biggest cause is what you read first.
  assert.equal(summary[0].cause, 'timeout');
});

test('muting hides a row without forgetting it', () => {
  // A muted row that starts happening again is the regression signal. Deleting
  // it means the next occurrence looks new.
  const log = ledger();
  const issue = feed(log, 'Binged: does not implement that operation');
  assert.ok(issue);
  assert.ok(log.annotate(issue.id, { muted: true, note: 'review catalogue, no loadLinks — correct' }));
  assert.equal(log.list().length, 0);
  assert.equal(log.list({ includeMuted: true }).length, 1);
  assert.equal(log.summary().length, 0, 'a triaged row must not inflate the tally');

  feed(log, 'Binged: does not implement that operation');
  const [still] = log.list({ includeMuted: true });
  assert.equal(still.occurrences, 2, 'occurrences keep accruing while muted');
  assert.match(String(still.note), /review catalogue/);
});

test('a connection leak is recorded and is not filed as a provider failure', () => {
  /**
   * 159 occurrences in the sampled logs — every unclassified problem record in
   * it. The scrape succeeded; a socket leaked. Counting it as `provider-error`
   * reports providers as having failed 159 times that did not fail at all.
   */
  const log = ledger();
  const issue = feed(
    log,
    'A connection to https://enc-dec.app/ was leaked. Did you forget to close a response body?'
  );
  assert.ok(issue);
  assert.equal(issue.cause, 'resource-leak');
});

test('the report leads with the tally, not the transcript', () => {
  const log = ledger();
  for (let i = 0; i < 3; i++) feed(log, 'GDFlix: Read timed out');
  const text = log.report({ app: '0.4.0' });
  const tallyAt = text.indexOf('Failures by cause');
  const issuesAt = text.indexOf('\nIssues');
  assert.ok(tallyAt > 0 && issuesAt > tallyAt, 'the count has to come before the list');
  assert.match(text, /app: 0\.4\.0/);
  assert.match(text, /Timed out/);
});

test('versions are stamped, so a fix can be dated', () => {
  const log = ledger('s1', '0.4.0');
  const issue = feed(log, 'GDFlix: Read timed out');
  assert.equal(issue?.firstSeenVersion, '0.4.0');
  assert.equal(issue?.lastSeenVersion, '0.4.0');
});

test('the ledger survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-issues-'));
  const file = path.join(dir, 'issues.json');
  try {
    const first = new ExtensionIssueLog({ file, sessionId: 's1' });
    feed(first, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
    feed(first, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
    first.flush();

    const second = new ExtensionIssueLog({ file, sessionId: 's2' });
    const [issue] = second.list();
    assert.ok(issue, 'nothing was read back');
    assert.equal(issue.occurrences, 2);
    assert.equal(issue.sessions, 1, 'the new session has not seen it yet');

    feed(second, 'GDFlix: Exception in NiceHttp: java.net.SocketTimeoutException Read timed out');
    assert.equal(second.list()[0].occurrences, 3);
    assert.equal(second.list()[0].sessions, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt or absent file starts empty rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-issues-'));
  try {
    const file = path.join(dir, 'issues.json');
    fs.writeFileSync(file, '{ this is not json');
    const log = new ExtensionIssueLog({ file, sessionId: 's1' });
    assert.equal(log.list().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bySource says where effort pays', () => {
  const log = ledger();
  for (let i = 0; i < 4; i++) feed(log, `GDFlix: Read timed out on mirror ${i}`);
  feed(log, 'Voe: Read timed out');
  const [top] = log.bySource();
  assert.equal(top.source, 'GDFlix');
  assert.equal(top.occurrences, 4);
  assert.equal(top.issues, 4, 'four distinct mirrors, because the integer is meaningful');
});


test('a cancelled call is not an issue', () => {
  /**
   * 79 occurrences across a real log, every one filed as an extension throwing.
   * Fifteen scrapes are in flight when the viewer types a new query; the scope
   * closing throws in all fifteen. There is nothing here to fix.
   */
  const log = ledger();
  assert.equal(feed(log, 'Exception in NiceHttp: java.io.IOException Canceled'), null);
  assert.equal(feed(log, 'ApiError: safeApiCall: Parent job is Cancelling'), null);
  assert.equal(feed(log, 'kotlinx.coroutines.JobCancellationException: Job was cancelled'), null);
  assert.equal(log.list().length, 0);
});

test("a stack frame's line number is not read as an HTTP status", () => {
  /**
   * `RealCall.java:519` contains a three-digit integer, and `server-error`
   * tests for one — so `IOException: Canceled` under an OkHttp stack was
   * classified as the host returning a 5xx, 23 times. A plausible category on
   * a real failure is the worst answer a taxonomy can give, because nothing
   * about it looks wrong.
   */
  const record = describe('Voe: extraction failed', [
    'at okhttp3.internal.connection.RealCall.execute(RealCall.java:519)',
  ]);
  assert.notEqual(record.cause, 'server-error');
});

test('the JVM says "Connection reset" where Node says ECONNRESET', () => {
  // 108 network failures in a real log reached `provider-error` purely for
  // being phrased in Java, reporting the extension as throwing when the
  // connection never arrived at all.
  const log = ledger();
  assert.equal(feed(log, 'Exception in NiceHttp: java.net.SocketException Connection reset')?.cause, 'network');
  assert.equal(feed(log, 'ApiError: safeApiCall: Connection reset')?.cause, 'network');
});



test('a wrong shim method is our problem, not the extension author\'s', () => {
  /**
   * `NoClassDefFoundError` was already classified as ours; the rest of the
   * linkage family was not, and it is the half a shim gets wrong more often —
   * a class that is present and has the wrong shape. Three documented examples
   * in this repo (SharedPreferences as a class, getResources returning Object,
   * aniListApi declared as the wrapper type) all threw one of these, and all
   * were landing under "the extension itself threw. Worth reporting to its
   * maintainer" — blaming a scraper author for a method we failed to provide.
   */
  const log = ledger();
  const issue = log.recordPluginFailure({
    plugin: 'Ultima',
    reason:
      "NoSuchMethodError: 'com.lagradost.cloudstream3.utils.Event com.lagradost.cloudstream3.MainActivity$Companion.getBookmarksUpdatedEvent()'",
    tier: 'T4_BLOCKED',
  });
  assert.equal(issue?.cause, 'runtime-unavailable');

  assert.equal(
    log.recordPluginFailure({ plugin: 'X', reason: 'IncompatibleClassChangeError: Found class …, but interface was expected' })?.cause,
    'runtime-unavailable'
  );
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

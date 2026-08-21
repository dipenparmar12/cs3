/**
 * The structured logger and its redaction.
 *
 *   node --experimental-strip-types electron/logging/logger.test.mts
 *
 * Two things here are worth pinning and neither is visible from using the app.
 *
 * **Redaction**, because getting it wrong is not a bug in the log, it is a
 * credential disclosure in the one artefact designed to be pasted into an issue
 * and handed to a stranger. Provider URLs are signed CDN addresses whose query
 * string *is* the key; a log that records them verbatim gives away working
 * access to someone else's infrastructure.
 *
 * **Crash-safety and retention**, because both are only ever exercised at the
 * moment nobody is watching. A log that loses its tail on a crash is useless
 * for the crash, and one that never prunes fills a user's disk silently.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger, scopedLogger, setLogger } from './logger.ts';
import { redact, redactHeaders, redactUrl } from './redact.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-log-'));
const makeLogger = (name: string) =>
  new Logger({ directory: path.join(WORK, name), level: 'trace' });

const linesOf = (logger: Logger): Array<Record<string, unknown>> =>
  fs
    .readFileSync(logger.logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

// --- redaction --------------------------------------------------------------

test('a signed CDN URL keeps its shape and loses its signature', () => {
  /**
   * The structure is the diagnostic value — which host, which path, and the
   * fact that it *was* signed, which distinguishes an expired link from one
   * that never carried credentials. Only the secret goes.
   */
  const redacted = redactUrl(
    'https://cdn.example.com/movie/dune.mkv?Expires=1700000000&Signature=abc123XYZ&Key-Pair-Id=K123'
  );
  assert.ok(redacted.includes('cdn.example.com/movie/dune.mkv'));
  assert.ok(redacted.includes('Expires=1700000000'), 'a deadline is not a secret and is useful');
  assert.ok(!redacted.includes('abc123XYZ'));
  assert.ok(!redacted.includes('K123'));
});

test('a JWT is removed wherever it appears, not only in a named parameter', () => {
  // Providers put these in paths and fragments too, so a parameter-name rule
  // alone does not find them.
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.ok(!redactUrl(`https://h.example/v/${jwt}/index.m3u8`).includes(jwt));
  assert.ok(!redact(`Request failed for token ${jwt} after 2 attempts`).includes(jwt));
});

test('a URL embedded in a sentence is redacted too', () => {
  // The common case: almost nothing logs a bare URL, and almost everything logs
  // "Request to <url> failed with 403".
  const text = redact('Request to https://h.example/f?access_token=SECRET99 failed with 403');
  assert.ok(!text.includes('SECRET99'));
  assert.ok(text.includes('403'), 'the useful half of the message survives');
});

test('a magnet link is left alone', () => {
  // An infohash is a content address, not a credential, and it is the single
  // most useful identifier a torrent log can carry.
  const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Dune';
  assert.equal(redactUrl(magnet), magnet);
});

test('a malformed URL is redacted rather than throwing', () => {
  /**
   * Scraped URLs carry spaces, pipes and stray percent signs, all of which
   * `new URL()` rejects. A redactor that threw would take down the logging of
   * the exact failure worth recording.
   */
  const value = 'https://h.example/a b|c?token=LEAKME&x=1';
  const redacted = redactUrl(value);
  assert.ok(!redacted.includes('LEAKME'));
});

test('Authorization and Cookie headers are masked whatever they contain', () => {
  const headers = redactHeaders({
    Referer: 'https://provider.example/watch',
    Authorization: 'Bearer sk-live-9999',
    Cookie: 'session=abc',
    'User-Agent': 'Mozilla/5.0',
  });
  assert.ok(!JSON.stringify(headers).includes('sk-live-9999'));
  assert.ok(!JSON.stringify(headers).includes('session=abc'));
  assert.equal(headers?.Referer, 'https://provider.example/watch');
  assert.equal(headers?.['User-Agent'], 'Mozilla/5.0');
});

test('redaction is applied by the logger, not left to the call site', () => {
  // A rule that has to be remembered at four hundred call sites is a rule that
  // holds at three hundred and ninety of them.
  const logger = makeLogger('redact');
  logger.error('sources', 'source_resolution_failed', {
    url: 'https://h.example/f?token=LEAKME',
    error: 'HTTP 403 for https://h.example/f?Signature=ALSOLEAK',
  });
  logger.flush();
  const raw = fs.readFileSync(logger.logFile, 'utf8');
  assert.ok(!raw.includes('LEAKME'));
  assert.ok(!raw.includes('ALSOLEAK'));
  assert.ok(raw.includes('403'));
  logger.shutdown();
});

// --- structure --------------------------------------------------------------

test('every record carries the session, a sequence and a level', () => {
  const logger = makeLogger('structure');
  logger.info('playback', 'stream_started', { mediaTitle: 'Dune', engine: 'mpv' });
  logger.warn('playback', 'stream_stalled', { mediaTitle: 'Dune' });
  logger.flush();

  const [first, second] = linesOf(logger);
  assert.equal(first.event, 'stream_started');
  assert.equal(first.level, 'info');
  assert.equal(first.scope, 'playback');
  assert.equal(first.session, logger.session);
  assert.equal(second.seq, (first.seq as number) + 1, 'sequence orders records inside a millisecond');
  logger.shutdown();
});

test('a scoped logger applies its standing context to every event', () => {
  /**
   * The reason scoping exists: a `provider` field present on four call sites
   * out of five produces a log that cannot be grouped, which for the one
   * question worth asking of it is the same as no log at all.
   */
  const logger = makeLogger('scoped');
  const provider = logger.child('provider', { provider: 'Hindmoviez', extension: 'Phisher' });
  provider.info('search_completed', { results: 12 });
  provider.child({ sourceId: 'abc' }).error('link_failed', { httpStatus: 403 });
  logger.flush();

  const records = linesOf(logger);
  assert.equal(records[0].provider, 'Hindmoviez');
  assert.equal(records[0].extension, 'Phisher');
  assert.equal(records[1].sourceId, 'abc');
  assert.equal(records[1].provider, 'Hindmoviez', 'child context adds, it does not replace');
  logger.shutdown();
});

test('begin() records one line carrying the duration and the outcome', async () => {
  // Two lines to correlate versus one row to sort. The start is still emitted
  // at trace, because an operation that never finishes leaves no end record and
  // the start is then the only evidence it hung.
  const logger = makeLogger('timing');
  const done = logger.child('resolve', { provider: 'X' }).begin('resolve_links');
  await new Promise((resolve) => setTimeout(resolve, 12));
  done({ status: 'ok', results: 3 });
  logger.flush();

  const finished = linesOf(logger).find((record) => record.event === 'resolve_links');
  assert.ok(finished, 'the completion record should exist');
  assert.ok((finished!.durationMs as number) >= 10);
  assert.equal(finished!.status, 'ok');
  assert.ok(linesOf(logger).some((r) => r.event === 'resolve_links_started'));
  logger.shutdown();
});

test('a failed operation is warned rather than reported as success', () => {
  const logger = makeLogger('timing-fail');
  logger.child('resolve', {}).begin('resolve_links')({ error: 'timed out' });
  logger.flush();
  assert.equal(linesOf(logger).find((r) => r.event === 'resolve_links')?.level, 'warn');
  logger.shutdown();
});

test('unserialisable context loses the fields, never the event', () => {
  const logger = makeLogger('circular');
  const circular: Record<string, unknown> = { name: 'loop' };
  circular.self = circular;
  logger.error('app', 'weird_thing', { circular });
  logger.flush();
  assert.equal(linesOf(logger)[0].event, 'weird_thing');
  logger.shutdown();
});

// --- levels and querying ----------------------------------------------------

test('records below the level are dropped at the call site', () => {
  const logger = makeLogger('levels');
  logger.setLevel('warn');
  logger.debug('app', 'ignored');
  logger.info('app', 'also_ignored');
  logger.error('app', 'kept');
  logger.flush();
  const records = linesOf(logger);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'kept');
  logger.shutdown();
});

test('the in-memory ring answers a query without re-reading the file', () => {
  const logger = makeLogger('query');
  logger.info('sources', 'found', { provider: 'A', mediaTitle: 'Dune' });
  logger.error('mpv', 'open_failed', { error: 'HTTP 522' });
  logger.info('sources', 'found', { provider: 'B', mediaTitle: 'Oppenheimer' });

  assert.equal(logger.query({ scopes: ['mpv'] }).length, 1);
  assert.equal(logger.query({ level: 'error' }).length, 1);
  assert.equal(logger.query({ search: 'dune' }).length, 1);
  assert.equal(logger.query({ event: 'found' }).length, 2);
  logger.shutdown();
});

// --- persistence ------------------------------------------------------------

test('NDJSON survives truncation: earlier lines stay parseable', () => {
  /**
   * The whole reason for append-only lines over a rewritten JSON array. A crash
   * mid-write loses the tail and nothing else — and a crash is precisely when
   * the log matters.
   */
  const logger = makeLogger('crash');
  for (let i = 0; i < 20; i++) logger.info('app', 'tick', { i });
  logger.flush();

  const raw = fs.readFileSync(logger.logFile, 'utf8');
  const truncated = raw.slice(0, Math.floor(raw.length * 0.6));
  const parsed = truncated
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    });
  assert.ok(parsed.filter(Boolean).length >= 10, 'most of a truncated log still parses');
  logger.shutdown();
});

test('each session writes its own file', () => {
  // Sessions are the unit users report in — "it broke, I restarted, now it
  // works" — so the previous run has to survive intact rather than interleaved.
  const dir = path.join(WORK, 'sessions');
  const first = new Logger({ directory: dir, level: 'trace' });
  first.info('app', 'launched');
  first.shutdown();

  const second = new Logger({ directory: dir, level: 'trace' });
  second.info('app', 'launched');
  second.shutdown();

  assert.notEqual(first.logFile, second.logFile);
  assert.ok(fs.existsSync(first.logFile) && fs.existsSync(second.logFile));
  assert.ok(second.sessions().length >= 2);
});

test('a logger whose directory cannot be created still works in memory', () => {
  // Logging is the thing that reports problems; it failing loudly would be
  // absurd, and it failing fatally would take the app with it.
  const blocked = path.join(WORK, 'blocked');
  fs.writeFileSync(blocked, 'not a directory');
  const logger = new Logger({ directory: path.join(blocked, 'logs') });
  logger.info('app', 'still_works');
  logger.flush();
  assert.equal(logger.query({ event: 'still_works' }).length, 1);
});

// --- late binding -----------------------------------------------------------

/**
 * The bug this pins cost twenty-one sessions of blank logs.
 *
 * Nine services bind their scope at module scope — `const log =
 * scopedLogger('mpv')` — and module bodies run when `main.ts` imports them,
 * which is *before* `main.ts` reaches `setLogger()`. When `child()` captured the
 * logger alive at that moment, all nine bound to the throwaway instance
 * `getLogger()` lazily creates, writing to a directory nobody reads. Every choke
 * point the architecture notes describe as instrumented — mpv, playback,
 * ffprobe, ffmpeg, sources, downloads, discovery — wrote into a void, and the
 * first engine failure that needed them had to be diagnosed from a timestamp gap.
 */
test('a scope bound before setLogger still writes to the installed logger', () => {
  // Exactly the module-scope shape, evaluated before any logger is installed.
  const log = scopedLogger('mpv', { component: 'surface' });

  const real = makeLogger('late-binding');
  setLogger(real);

  log.info('open', { url: 'http://127.0.0.1:9/stream/1' });
  real.flush();

  const records = linesOf(real).filter((r) => r.event === 'open');
  assert.equal(records.length, 1, 'the record never reached the installed logger');
  assert.equal(records[0].scope, 'mpv');
  // Standing context survives the late resolution.
  assert.equal(records[0].component, 'surface');
});

test('a scope follows a logger replaced after it was created', () => {
  const log = scopedLogger('playback');
  const first = makeLogger('follow-first');
  setLogger(first);
  log.info('decided');

  // A second launch, or a test installing its own: records go to the new one.
  const second = makeLogger('follow-second');
  setLogger(second);
  log.info('decided_again');

  first.flush();
  second.flush();
  assert.equal(linesOf(first).filter((r) => r.event === 'decided_again').length, 0);
  assert.equal(linesOf(second).filter((r) => r.event === 'decided_again').length, 1);
});

test('an explicitly bound child stays with the logger it came from', () => {
  // `logger.child(...)` is still a binding, which is what tests and any service
  // constructed after `setLogger` rely on.
  const owner = makeLogger('explicit-binding');
  const log = owner.child('ffmpeg');
  setLogger(makeLogger('somewhere-else'));

  log.warn('spawned');
  owner.flush();
  assert.equal(linesOf(owner).filter((r) => r.event === 'spawned').length, 1);
});

// --- runner -----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
try {
  fs.rmSync(WORK, { recursive: true, force: true });
} catch {
  // Windows sometimes holds a handle briefly; the temp dir is disposable.
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);

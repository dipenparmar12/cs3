#!/usr/bin/env node
/**
 * Proof that a failing network cannot take the application with it.
 *
 * This exists because of a crash report:
 *
 *     Uncaught Exception:
 *     Error: net::ERR_HTTP2_PROTOCOL_ERROR
 *       at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138489)
 *       at SimpleURLLoaderWrapper.emit (node:events:509:28)
 *
 * The stack was reproduced exactly, under Electron 43, against a real HTTP/2
 * origin that answers a request normally and then fails mid-body. The shape is
 * the whole diagnosis: `net.fetch` resolves, every `await` and `catch` at the
 * call site has already run, and the transport fails afterwards on a body stream
 * nobody is listening to. `Readable.fromWeb(body).pipe(res)` does not forward
 * errors, so that stream reached an `EventEmitter` with no `error` handler.
 *
 * The parts checked here are the ones that decide whether a failure is
 * contained, retried, resumed, or reported — the pure logic, so it runs in a
 * second with no Electron, no network and no fixtures. The end-to-end proof (the
 * shipped `MediaProxy` streaming a deliberately broken 3 MB file under Electron
 * and reassembling it byte-perfectly) is described in the commit; this is the
 * part worth keeping runnable.
 *
 * Usage:
 *   node tools/e2e/network-resilience.mjs
 *
 * Exit code is 0 only if every case passes.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const APP = path.join(REPO_ROOT, 'cs3_windows');

/**
 * Compiled on the fly rather than checked in.
 *
 * The alternative — duplicating the classifier here — would let the copy drift
 * from the module it claims to test, which is the one failure mode a test like
 * this must not have.
 */
function compileModules() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-net-'));
  // Bun and npm install this shim under different names, and both appear in the
  // wild for this project.
  const binDir = path.join(APP, 'node_modules', '.bin');
  const tsc = ['tsc.exe', 'tsc.cmd', 'tsc']
    .map((name) => path.join(binDir, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!tsc) throw new Error(`no tsc found in ${binDir}`);
  const result = spawnSync(
    tsc,
    [
      path.join(APP, 'electron', 'networkResilience.ts'),
      path.join(APP, 'electron', 'mediaProxy.ts'),
      '--ignoreConfig',
      '--outDir', out,
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node10',
      '--ignoreDeprecations', '6.0',
      '--skipLibCheck',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' }
  );

  const emitted = path.join(out, 'electron', 'networkResilience.js');
  if (!fs.existsSync(emitted)) {
    console.error(result.stdout || result.stderr);
    throw new Error('tsc produced no output');
  }
  return out;
}

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  }
}

const outDir = compileModules();
// CommonJS output, loaded with `require`: the emitted ESM keeps TypeScript's
// extensionless relative imports, which Node's ESM resolver rejects.
const load = createRequire(import.meta.url);
const net = load(path.join(outDir, 'electron', 'networkResilience.js'));
const proxy = load(path.join(outDir, 'electron', 'mediaProxy.js'));

// --- classification -------------------------------------------------------
//
// The distinction that matters is transient versus settled. Retrying a 404
// wastes the user's time; not retrying a reset connection loses them a source
// that works.

console.log('\nclassifying network errors');

const classify = (error) => {
  const { code, retryable, http2, aborted } = net.classifyNetworkError(error);
  return { code, retryable, http2, aborted };
};

check(
  'the reported HTTP/2 error is retryable and triggers a downgrade',
  classify(new Error('net::ERR_HTTP2_PROTOCOL_ERROR')),
  { code: 'ERR_HTTP2_PROTOCOL_ERROR', retryable: true, http2: true, aborted: false }
);

check(
  'a truncated body is retryable — this is what a dropped film looks like',
  classify(new Error('net::ERR_CONTENT_LENGTH_MISMATCH')),
  { code: 'ERR_CONTENT_LENGTH_MISMATCH', retryable: true, http2: false, aborted: false }
);

check(
  'a reset connection is retryable but is not an HTTP/2 fault',
  classify(new Error('net::ERR_CONNECTION_RESET')),
  { code: 'ERR_CONNECTION_RESET', retryable: true, http2: false, aborted: false }
);

check(
  'a refused name lookup is settled, not transient',
  classify(new Error('net::ERR_NAME_NOT_RESOLVED')),
  { code: 'ERR_NAME_NOT_RESOLVED', retryable: false, http2: false, aborted: false }
);

check(
  'a blocked request is settled — retrying sends the same rejected headers',
  classify(new Error('net::ERR_BLOCKED_BY_CLIENT')),
  { code: 'ERR_BLOCKED_BY_CLIENT', retryable: false, http2: false, aborted: false }
);

{
  // undici hides the reason one level down, so the top-level message alone
  // ("fetch failed") would classify as an unknown non-network error.
  const wrapped = new TypeError('fetch failed');
  wrapped.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  check(
    "Node's nested cause is unwrapped, not just the top-level message",
    classify(wrapped),
    { code: 'ECONNRESET', retryable: true, http2: false, aborted: false }
  );
}

{
  const aborted = new Error('The operation was aborted');
  aborted.name = 'AbortError';
  check(
    'a cancelled request is never retried — the user closed the player',
    classify(aborted),
    { code: null, retryable: false, http2: false, aborted: true }
  );
}

check('a plain bug is not mistaken for a network fault', classify(new TypeError('x is not a function')), {
  code: null,
  retryable: false,
  http2: false,
  aborted: false,
});

// --- backoff --------------------------------------------------------------

console.log('\nbacking off');

{
  const policy = { attempts: 4, baseDelayMs: 400, maxDelayMs: 4000 };
  const samples = [1, 2, 3, 4, 5].map((attempt) => net.backoffFor(attempt, policy));
  const bounds = [
    [200, 400],
    [400, 800],
    [800, 1600],
    [1600, 3200],
    [2000, 4000],
  ];
  const withinBounds = samples.every((value, i) => value >= bounds[i][0] && value <= bounds[i][1]);
  check('each wait is longer than the last, and capped', withinBounds, true);

  // Jitter matters: an origin that resets one connection has usually reset all
  // of them, and a fixed backoff retries fifteen providers in the same
  // millisecond.
  const repeated = new Set(Array.from({ length: 30 }, () => net.backoffFor(3, policy)));
  check('waits are jittered rather than identical', repeated.size > 1, true);
}

// --- retry, downgrade, and what must not be retried -----------------------

console.log('\nretrying');

function recorder() {
  const entries = [];
  return { entries, record: (entry) => entries.push(entry) };
}

{
  // Fails once with the reported error, then succeeds.
  let calls = 0;
  const log = recorder();
  const client = new net.ResilientFetch({
    primary: async () => {
      calls++;
      if (calls === 1) throw new Error('net::ERR_HTTP2_PROTOCOL_ERROR');
      return { status: 200, url: 'https://origin.test/a' };
    },
    fallback: async () => ({ status: 200, url: 'https://origin.test/a', viaFallback: true }),
    policy: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    diagnostics: log,
  });

  const response = await client.fetch('https://origin.test/a');
  check('a transient HTTP/2 failure is retried and succeeds', response.status, 200);
  check('the origin is remembered as HTTP/2-hostile', client.downgradedOrigins(), [
    'https://origin.test',
  ]);
  check(
    'the retry used the HTTP/1.1 fallback rather than repeating on a broken transport',
    response.viaFallback,
    true
  );
  check(
    'the recovery is recorded, not silent',
    log.entries.some((e) => e.level === 'info' && /Recovered/.test(e.message)),
    true
  );
}

{
  // A permanently broken source must not be retried forever.
  let calls = 0;
  const client = new net.ResilientFetch({
    primary: async () => {
      calls++;
      throw new Error('net::ERR_CONNECTION_RESET');
    },
    policy: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  });

  await client.fetch('https://dead.test/a').then(
    () => check('a permanently failing origin rejects', false, true),
    () => check('a permanently failing origin rejects', true, true)
  );
  check('and is attempted a bounded number of times', calls, 3);
}

{
  // A settled answer is not worth repeating.
  let calls = 0;
  const client = new net.ResilientFetch({
    primary: async () => {
      calls++;
      throw new Error('net::ERR_NAME_NOT_RESOLVED');
    },
    policy: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  });
  await client.fetch('https://nowhere.test/a').catch(() => {});
  check('a non-retryable failure is attempted exactly once', calls, 1);
}

{
  // Retrying a POST can double-submit; nothing in the app needs it.
  let calls = 0;
  const client = new net.ResilientFetch({
    primary: async () => {
      calls++;
      throw new Error('net::ERR_CONNECTION_RESET');
    },
    policy: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  });
  await client.fetch('https://api.test/a', { method: 'POST' }).catch(() => {});
  check('a POST is never repeated, however transient the failure', calls, 1);
}

{
  // Cancelling must stop the work, not race it.
  let calls = 0;
  const controller = new AbortController();
  const client = new net.ResilientFetch({
    primary: async () => {
      calls++;
      controller.abort();
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    },
    policy: { attempts: 3, baseDelayMs: 5, maxDelayMs: 10 },
  });
  await client.fetch('https://slow.test/a', { signal: controller.signal }).catch(() => {});
  check('an aborted request stops immediately', calls, 1);
}

{
  // Diagnostics have to be pasteable into an issue without leaking a signed URL
  // token that happens to live in a header value.
  const log = recorder();
  const client = new net.ResilientFetch({
    primary: async () => {
      throw new Error('net::ERR_HTTP2_PROTOCOL_ERROR');
    },
    policy: { attempts: 1 },
    diagnostics: log,
  });
  await client
    .fetch('https://origin.test/film.mp4', {
      headers: { Referer: 'https://origin.test/', Authorization: 'Bearer super-secret' },
    })
    .catch(() => {});

  const detail = log.entries.map((e) => e.detail ?? '').join('\n');
  check('the report names the failing code', /ERR_HTTP2_PROTOCOL_ERROR/.test(detail), true);
  check('the report names the origin and attempt', /origin:\s+https:\/\/origin\.test/.test(detail), true);
  check('header names are reported', /headers:.*Authorization/.test(detail), true);
  check('header values are not', /super-secret/.test(detail), false);
}

// --- the Referer rule that silently killed http:// sources ----------------
//
// Measured under Electron 43: an https referrer on an http request is refused
// by Chromium before it reaches the network, surfacing as ERR_BLOCKED_BY_CLIENT.
// Extensions report https referrers; plenty of the media URLs they hand back are
// plain http. Every one of those was dead, and looked like a network fault.

console.log('\naligning Referer with the target scheme');

check(
  'an https referer is downgraded for an http target',
  proxy.alignRefererScheme('http://cdn.test/film.mp4', { Referer: 'https://site.test/watch' }),
  { Referer: 'http://site.test/watch' }
);

check(
  'the host is preserved — it is what hotlink checks actually look at',
  proxy.alignRefererScheme('http://cdn.test/film.mp4', { Referer: 'https://site.test/watch' })
    .Referer.includes('site.test'),
  true
);

check(
  'an https target is left alone',
  proxy.alignRefererScheme('https://cdn.test/film.mp4', { Referer: 'https://site.test/watch' }),
  { Referer: 'https://site.test/watch' }
);

check(
  'other headers are untouched',
  proxy.alignRefererScheme('http://cdn.test/f.mp4', {
    'User-Agent': 'Mozilla/5.0',
    Range: 'bytes=0-',
  }),
  { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-' }
);

check(
  'header casing as providers actually send it',
  proxy.alignRefererScheme('http://cdn.test/f.mp4', { referer: 'https://site.test/' }),
  { referer: 'http://site.test/' }
);

fs.rmSync(outDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

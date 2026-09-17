/**
 * Telling a bot wall from a refusal.
 *
 *   bun run test bot-challenge
 *   node --experimental-strip-types electron/torrent/botChallenge.test.mts
 *
 * Two cases carry the weight:
 *
 *  - **A challenge served as HTTP 200.** It parsed to zero rows and was
 *    reported as "this indexer has nothing", which is a search that silently
 *    got smaller — the failure this repository treats as its worst.
 *  - **A 403 that is a block, not a challenge.** Opening a browser at one costs
 *    seconds on every search and changes nothing, so being too eager here is
 *    worse than not detecting it at all.
 */
import assert from 'node:assert/strict';
import { ChallengeError, detectChallenge } from './botChallenge.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const CF = { server: 'cloudflare', 'cf-ray': '8ab2c3d4e5f6-LHR' };

// --- the case that looked like success ---------------------------------------

test('a challenge served as HTTP 200 is still a challenge', () => {
  const verdict = detectChallenge({
    status: 200,
    headers: CF,
    bodyPrefix: '<!DOCTYPE html><title>Just a moment...</title><div id="cf-challenge-running">',
  });
  assert.equal(verdict.kind, 'cloudflare-challenge');
  assert.equal(verdict.solvable, true);
});

test('every documented challenge marker is recognised', () => {
  for (const marker of [
    'cf-browser-verification',
    '/cdn-cgi/challenge-platform/h/b/',
    'window._cf_chl_opt = {',
    'Checking your browser before accessing',
    'Enable JavaScript and cookies to continue',
  ]) {
    const verdict = detectChallenge({ status: 403, headers: CF, bodyPrefix: marker });
    assert.equal(verdict.kind, 'cloudflare-challenge', marker);
    assert.equal(verdict.solvable, true, marker);
  }
});

test('the cf-mitigated header alone is enough, with no body at all', () => {
  const verdict = detectChallenge({
    status: 403,
    headers: { ...CF, 'cf-mitigated': 'challenge' },
  });
  assert.equal(verdict.kind, 'cloudflare-challenge');
  assert.equal(verdict.solvable, true);
});

test('headers are matched however they are cased', () => {
  const verdict = detectChallenge({
    status: 403,
    headers: { Server: 'Cloudflare', 'CF-Mitigated': 'CHALLENGE' },
  });
  assert.equal(verdict.kind, 'cloudflare-challenge');
});

// --- what must not send a browser anywhere -----------------------------------

test('an ordinary page is not a challenge', () => {
  const verdict = detectChallenge({
    status: 200,
    headers: { server: 'nginx' },
    bodyPrefix: '<table class="table-list"><tbody><tr><td>Dune 2160p</td></tr></tbody></table>',
  });
  assert.equal(verdict.kind, 'none');
  assert.equal(verdict.solvable, false);
});

/**
 * A listing page whose footer says "Performance & security by Cloudflare" is a
 * working page. Sending every search through a browser on the strength of that
 * would be worse than the failure this module exists to fix.
 */
test('a working page that merely mentions Cloudflare is left alone', () => {
  const verdict = detectChallenge({
    status: 200,
    headers: CF,
    bodyPrefix:
      '<table class="table-list"><tr><td>Dune</td></tr></table>' +
      '<footer>Performance &amp; security by Cloudflare</footer>',
  });
  assert.equal(verdict.kind, 'none');
});

test('a WAF block is named as a block, and is not solvable', () => {
  const verdict = detectChallenge({
    status: 403,
    headers: CF,
    bodyPrefix: '<title>Attention Required! | Cloudflare</title>Sorry, you have been blocked',
  });
  assert.equal(verdict.kind, 'cloudflare-block');
  assert.equal(verdict.solvable, false);
});

test('error code 1020 is a block', () => {
  const verdict = detectChallenge({
    status: 403,
    headers: CF,
    bodyPrefix: 'error code: 1020',
  });
  assert.equal(verdict.kind, 'cloudflare-block');
  assert.equal(verdict.solvable, false);
});

// --- rate limiting, which is neither ------------------------------------------

test('429 is a rate limit, not a bot wall', () => {
  const verdict = detectChallenge({ status: 429, headers: CF });
  assert.equal(verdict.kind, 'rate-limited');
  assert.equal(verdict.solvable, false);
});

/**
 * A rate-limited Cloudflare host answers 503 as well, and a browser makes it
 * worse: it issues a dozen subrequests where the scrape issued one.
 */
test('503 with Retry-After is a rate limit and outranks the challenge check', () => {
  const verdict = detectChallenge({
    status: 503,
    headers: { ...CF, 'retry-after': '30' },
  });
  assert.equal(verdict.kind, 'rate-limited');
  assert.equal(verdict.solvable, false);
});

test('503 without Retry-After behind Cloudflare is treated as a wall', () => {
  const verdict = detectChallenge({ status: 503, headers: CF, bodyPrefix: 'just a moment' });
  assert.equal(verdict.kind, 'cloudflare-challenge');
});

// --- other walls ---------------------------------------------------------------

test('DDoS-Guard is recognised and honestly reported as unsolvable', () => {
  const byHeader = detectChallenge({ status: 403, headers: { server: 'ddos-guard' } });
  assert.equal(byHeader.kind, 'ddos-guard');
  assert.equal(byHeader.solvable, false);

  const byBody = detectChallenge({
    status: 200,
    headers: {},
    bodyPrefix: '<script src="https://check.ddos-guard.net/check.js">',
  });
  assert.equal(byBody.kind, 'ddos-guard');
});

// --- the honest unknown ---------------------------------------------------------

/**
 * Refused behind Cloudflare with nothing to read. Guessing "block" costs a
 * working indexer forever; guessing "challenge" costs one browser window that
 * finds out. The cheaper mistake wins.
 */
test('a 403 with no body is given the benefit of the doubt', () => {
  const verdict = detectChallenge({ status: 403, headers: CF });
  assert.equal(verdict.kind, 'cloudflare-challenge');
  assert.equal(verdict.solvable, true);
});

test('a 403 from a host that is not behind Cloudflare is not our problem', () => {
  const verdict = detectChallenge({ status: 403, headers: { server: 'nginx' } });
  assert.equal(verdict.kind, 'none');
});

test('a 404 is never a challenge', () => {
  assert.equal(detectChallenge({ status: 404, headers: CF, bodyPrefix: '' }).kind, 'none');
});

test('missing headers are survivable', () => {
  assert.equal(detectChallenge({ status: 500 }).kind, 'none');
});

// --- the error type -------------------------------------------------------------

test('the error carries the verdict rather than restating it', () => {
  const verdict = detectChallenge({ status: 403, headers: { ...CF, 'cf-mitigated': 'challenge' } });
  const error = new ChallengeError(verdict, 'https://1337x.to/search/dune/1/', 403);
  assert.equal(error.name, 'ChallengeError');
  assert.equal(error.kind, 'cloudflare-challenge');
  assert.equal(error.solvable, true);
  assert.equal(error.status, 403);
  assert.equal(error.message, verdict.reason);
  assert.ok(error instanceof Error, 'must still be catchable as an Error');
});

// --- runner ----------------------------------------------------------------

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

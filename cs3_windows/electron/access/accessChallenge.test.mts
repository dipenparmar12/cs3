/**
 * What the classifier is allowed to conclude from a refused response.
 *
 *   bun run test:access
 *   node --experimental-strip-types electron/access/accessChallenge.test.mts
 *
 * Two failures are pinned here above all others, because both are expensive and
 * neither shows up as an error:
 *
 *  - Opening a browser window for something no person can fix (a rate limit, a
 *    legal block) teaches users that the window is noise. The one time it
 *    matters they will close it.
 *  - Classifying a *working* page as a challenge because it happens to embed a
 *    captcha widget somewhere interrupts a scrape that was succeeding.
 */
import assert from 'node:assert/strict';
import { classifyAccess, needsHuman, type ResponseFacts } from './accessChallenge.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const facts = (over: Partial<ResponseFacts> = {}): ResponseFacts => ({
  url: 'https://ext.to/search/?q=dune',
  status: 200,
  headers: { 'content-type': 'text/html' },
  ...over,
});

const HTML = (inner: string) => `<!doctype html><html><head></head><body>${inner}</body></html>`;

// --- the case this was built for -------------------------------------------

test('cf-mitigated: challenge is a bot challenge, whatever the status', () => {
  // The exact signature recorded against ext.to: 403, server: cloudflare,
  // cf-mitigated: challenge.
  const result = classifyAccess(
    facts({ status: 403, headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' } })
  );
  assert.equal(result.type, 'BOT_CHALLENGE');
  assert.equal(result.system, 'Cloudflare');
  assert.equal(needsHuman(result), true);
});

test('a Cloudflare interstitial is recognised from its body alone', () => {
  const result = classifyAccess(
    facts({
      status: 503,
      headers: { server: 'cloudflare', 'content-type': 'text/html' },
      body: HTML('<div id="cf-wrapper">Checking your browser before accessing ext.to</div>'),
    })
  );
  assert.equal(result.type, 'BOT_CHALLENGE');
  assert.equal(result.system, 'Cloudflare');
});

test('Turnstile is human verification, not a silent browser check', () => {
  // The distinction is real: an interstitial clears itself given a real
  // browser, a Turnstile checkbox does not clear until someone ticks it.
  const result = classifyAccess(
    facts({
      status: 403,
      body: HTML('<div class="cf-turnstile" data-sitekey="x"></div>'),
    })
  );
  assert.equal(result.type, 'HUMAN_VERIFICATION');
});

// --- other vendors, because the next site will not be Cloudflare -----------

test('DataDome, Imperva, Akamai and PerimeterX are each recognised', () => {
  const cases: Array<[string, ResponseFacts]> = [
    ['DataDome', facts({ status: 403, headers: { 'x-datadome': 'protected' } })],
    ['Imperva', facts({ status: 403, headers: { 'x-iinfo': '1-2-3' } })],
    ['Akamai', facts({ status: 403, headers: { 'set-cookie': '_abck=deadbeef; Path=/' } })],
    [
      'PerimeterX',
      facts({ status: 403, body: HTML('<script src="//client.perimeterx.net/x/main.min.js">') }),
    ],
  ];
  for (const [system, input] of cases) {
    const result = classifyAccess(input);
    assert.equal(result.system, system, `expected ${system}`);
    assert.equal(result.type, 'BOT_CHALLENGE');
  }
});

test('hCaptcha and reCAPTCHA are human verification', () => {
  for (const marker of ['<div class="h-captcha"></div>', '<div class="g-recaptcha"></div>']) {
    assert.equal(classifyAccess(facts({ status: 403, body: HTML(marker) })).type, 'HUMAN_VERIFICATION');
  }
});

// --- the rule that keeps the window meaningful -----------------------------

test('a rate limit never opens a browser', () => {
  // The site is counting, not asking. A page shown to someone who only needs to
  // wait is a window that means nothing.
  const result = classifyAccess(facts({ status: 429, headers: { 'retry-after': '30' } }));
  assert.equal(result.type, 'RATE_LIMITED');
  assert.equal(result.requiresUserInteraction, false);
  assert.equal(result.canResume, true);
  assert.equal(result.retryAfterSeconds, 30);
  assert.equal(needsHuman(result), false);
});

test('a rate limit outranks a recognised challenge vendor', () => {
  // Cloudflare rate-limiting is still rate-limiting. Clicking cannot help.
  const result = classifyAccess(
    facts({ status: 429, headers: { 'cf-mitigated': 'challenge', 'retry-after': '5' } })
  );
  assert.equal(result.type, 'RATE_LIMITED');
});

test('a legal block cannot be resumed and asks nobody', () => {
  const result = classifyAccess(facts({ status: 451, body: HTML('Unavailable for legal reasons') }));
  assert.equal(result.type, 'ACCESS_DENIED');
  assert.equal(result.canResume, false);
  assert.equal(result.requiresUserInteraction, false);
});

test('a machine-readable 403 is a decision, not a challenge', () => {
  // An API answering `{"error":"forbidden"}` is not showing anyone a page.
  const result = classifyAccess(
    facts({ status: 403, headers: { 'content-type': 'application/json' }, body: '{"error":"forbidden"}' })
  );
  assert.equal(result.type, 'ACCESS_DENIED');
  assert.equal(needsHuman(result), false);
});

// --- not interrupting a scrape that is working -----------------------------

test('a successful page is not a challenge', () => {
  const result = classifyAccess(facts({ status: 200, body: HTML('<table id="results">…</table>') }));
  assert.equal(result.type, 'NONE');
  assert.equal(needsHuman(result), false);
});

test('a large successful page carrying a captcha widget is still successful', () => {
  // A results page with a login form or a comment box further down embeds the
  // same markup a challenge page does. Treating it as a challenge would stop a
  // scrape that had already succeeded.
  const result = classifyAccess(
    facts({
      status: 200,
      body: HTML('<div class="g-recaptcha"></div>' + 'x'.repeat(80_000)),
    })
  );
  assert.equal(result.type, 'NONE');
});

test('a small 200 that is nothing but a challenge page is a challenge', () => {
  // Cloudflare's managed challenge answers 200. A body too small to be the
  // content is the signal that separates it from the case above.
  const result = classifyAccess(
    facts({ status: 200, body: HTML('<div id="challenge-form">/cdn-cgi/challenge-platform/h/b</div>') })
  );
  assert.equal(result.type, 'BOT_CHALLENGE');
});

test('a body marker is never trusted on a non-HTML response', () => {
  // A video whose bytes contain "datadome" is not a challenge.
  const result = classifyAccess(
    facts({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: 'binary…datadome…binary',
    })
  );
  assert.equal(result.type, 'NONE');
});

// --- the fallbacks ---------------------------------------------------------

test('401 is a login wall', () => {
  assert.equal(classifyAccess(facts({ status: 401 })).type, 'LOGIN_REQUIRED');
});

test('a 403 login page is a login wall, not an unknown refusal', () => {
  const result = classifyAccess(
    facts({ status: 403, body: HTML('<form><input type="password" name="pwd"></form>') })
  );
  assert.equal(result.type, 'LOGIN_REQUIRED');
});

test('an age gate is a consent requirement', () => {
  const result = classifyAccess(
    facts({ status: 200, body: HTML('<h1>Age verification</h1><p>You must be 18 to enter.</p>') })
  );
  assert.equal(result.type, 'CONSENT_REQUIRED');
  assert.equal(result.requiresUserInteraction, true);
});

test('an unrecognised HTML refusal stays interactive', () => {
  // Opening the page is the only remaining way to learn what it wants, which is
  // exactly what the hand-off is for. Calling it ACCESS_DENIED would drop a
  // site one click would have opened.
  const result = classifyAccess(facts({ status: 403, body: HTML('<h1>Access denied</h1>') }));
  assert.equal(result.type, 'UNKNOWN');
  assert.equal(needsHuman(result), true);
});

test('a 500 is a server problem, not an access problem', () => {
  // Nobody should be shown a page because a backend fell over.
  const result = classifyAccess(facts({ status: 500, body: HTML('<h1>Internal Server Error</h1>') }));
  assert.equal(result.type, 'NONE');
});

test('Retry-After as an HTTP-date is understood', () => {
  const when = new Date(Date.now() + 45_000).toUTCString();
  const result = classifyAccess(facts({ status: 429, headers: { 'retry-after': when } }));
  assert.ok((result.retryAfterSeconds ?? 0) >= 40 && (result.retryAfterSeconds ?? 0) <= 46);
});

test('header names are matched case-insensitively', () => {
  // Node lower-cases them; Electron's net does too; a raw capture may not.
  const result = classifyAccess(facts({ status: 403, headers: { 'CF-Mitigated': 'challenge' } }));
  assert.equal(result.type, 'BOT_CHALLENGE');
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

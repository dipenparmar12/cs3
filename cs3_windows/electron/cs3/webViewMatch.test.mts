/**
 * What a page's subrequests mean to a `WebViewResolver`.
 *
 *   bun run test:webview
 *   node --experimental-strip-types electron/cs3/webViewMatch.test.mts
 *
 * Pinned because none of these failures announces itself. A pattern that will
 * not compile makes a live provider look like a dead site; a blacklist that
 * cancels one file too many makes a Cloudflare page fail to solve and reads as
 * bot protection nobody can beat. Both arrive as "this extension stopped
 * working", months after the change that caused them.
 */
import assert from 'node:assert/strict';
import {
  classifyRequest,
  compilePattern,
  compilePatterns,
  shouldBlock,
} from './webViewMatch.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const inputs = (intercept: string, additional: string[] = []) => ({
  intercept: compilePattern(intercept),
  additional: compilePatterns(additional),
});

// --- translating a Java regex ----------------------------------------------

test('an ordinary provider pattern compiles unchanged', () => {
  const compiled = compilePattern('master\\.m3u8');
  assert.ok(compiled.regex);
  assert.equal(compiled.regex!.test('https://cdn.test/hls/master.m3u8?t=1'), true);
});

test('containsMatchIn is a search, not a full match', () => {
  // Kotlin's `containsMatchIn` is unanchored. Treating these as full matches
  // would make almost every provider pattern in the corpus match nothing.
  const compiled = compilePattern('\\.m3u8');
  assert.equal(compiled.regex!.test('https://a.test/x/y.m3u8?token=abc'), true);
});

test('a possessive quantifier is accepted as its greedy equivalent', () => {
  // Java has `a++`; JavaScript does not, and rejects the pattern outright. The
  // difference is backtracking, not the set of strings matched.
  const compiled = compilePattern('/hls/[a-z]++/index\\.m3u8');
  assert.ok(compiled.regex, compiled.reason ?? '');
  assert.equal(compiled.regex!.test('https://x.test/hls/abc/index.m3u8'), true);
});

test('Java anchors are translated', () => {
  const compiled = compilePattern('\\Ahttps://good\\.test/.*\\z');
  assert.ok(compiled.regex, compiled.reason ?? '');
  assert.equal(compiled.regex!.test('https://good.test/a'), true);
  assert.equal(compiled.regex!.test('https://bad.test/a'), false);
});

test('an escaped backslash before A is not mistaken for a Java anchor', () => {
  // The reason the translation is escape-aware. A naive replace turns the `\\A`
  // inside `\\\\A` into `^` and produces a different *valid* pattern — no error,
  // no warning, and a provider that quietly stops matching.
  const compiled = compilePattern('x\\\\Ay');
  assert.ok(compiled.regex, compiled.reason ?? '');
  assert.equal(compiled.regex!.test('x\\Ay'), true);
});

test('one-or-more literal plus signs survives the possessive rewrite', () => {
  // `\\++` is an escaped plus with a greedy quantifier, not a possessive one.
  // Dropping that `+` would change what the pattern matches.
  const compiled = compilePattern('a\\++b');
  assert.ok(compiled.regex, compiled.reason ?? '');
  assert.equal(compiled.regex!.test('a+++b'), true);
  assert.equal(compiled.regex!.test('ab'), false);
});

test('a Java character class is left alone', () => {
  const compiled = compilePattern('[+*?]+\\.m3u8');
  assert.ok(compiled.regex, compiled.reason ?? '');
  assert.equal(compiled.regex!.test('++.m3u8'), true);
});

test('a construct JavaScript would misread is refused rather than mismatched', () => {
  // `\\p{Alpha}` compiles in JavaScript as the literal letter `p` followed by a
  // group — no error, and it matches nothing a browser requests. Refusing says
  // so; compiling would hide it behind a 60-second timeout.
  const posix = compilePattern('\\p{Alpha}+\\.m3u8');
  assert.equal(posix.regex, null);
  assert.ok(posix.reason!.includes('\\p{'));

  const quoted = compilePattern('\\Qhttps://a.test/\\E.*');
  assert.equal(quoted.regex, null);
});

test('a pattern that cannot be translated is reported, not silently dead', () => {
  // The important half. A pattern quietly treated as "never matches" spends the
  // full browser timeout on every link and then reports the site had nothing —
  // indistinguishable from a provider whose host is down.
  const compiled = compilePattern('(?<!foo)+[');
  assert.equal(compiled.regex, null);
  assert.ok(compiled.reason && compiled.reason.length > 0);
});

test('a reused pattern matches every time', () => {
  // One RegExp is shared across every request of a resolve. If it were built
  // with /g, `lastIndex` would carry between calls and match every other one.
  const compiled = compilePattern('\\.m3u8');
  assert.equal(compiled.regex!.test('https://a.test/1.m3u8'), true);
  assert.equal(compiled.regex!.test('https://a.test/2.m3u8'), true);
  assert.equal(compiled.regex!.test('https://a.test/3.m3u8'), true);
});

// --- classification order --------------------------------------------------

test('the intercept pattern is tested before the blacklist', () => {
  // A provider whose answer *is* an .mp4 — several are — would otherwise have
  // the one request it exists to catch cancelled as an unwanted media file.
  assert.deepEqual(
    classifyRequest('https://cdn.test/video/movie.mp4', inputs('\\.mp4')),
    { kind: 'intercept' }
  );
});

test('additional urls are collected without stopping the page', () => {
  assert.deepEqual(
    classifyRequest('https://cdn.test/audio/hi.m3u8', inputs('never-matches', ['\\.m3u8'])),
    { kind: 'additional' }
  );
});

test('intercept wins over additional when both match', () => {
  assert.deepEqual(
    classifyRequest('https://cdn.test/master.m3u8', inputs('master\\.m3u8', ['\\.m3u8'])),
    { kind: 'intercept' }
  );
});

test('an unmatched ordinary request is allowed', () => {
  assert.deepEqual(
    classifyRequest('https://site.test/player.js', inputs('\\.m3u8')),
    { kind: 'allow' }
  );
});

// --- the blacklist ---------------------------------------------------------

test('images and fonts are blocked', () => {
  assert.equal(shouldBlock('https://site.test/img/poster.jpg'), true);
  assert.equal(shouldBlock('https://site.test/f/Inter.woff2'), true);
  assert.equal(shouldBlock('https://site.test/favicon.ico'), true);
});

test('the blacklist reads the path, never the query', () => {
  // `?poster=…jpg` and `?v=….ts` cache busters are routine, and cancelling the
  // script they decorate breaks the page that was about to solve the challenge.
  assert.equal(shouldBlock('https://site.test/app.js?poster=/a/b.jpg'), false);
  assert.equal(shouldBlock('https://site.test/bundle.js?v=1.ts'), false);
});

test('a percent-encoded extension is still that extension', () => {
  assert.equal(shouldBlock('https://site.test/a%2Fb%2Ejpg'), true);
});

test('Cloudflare and recaptcha are never blocked', () => {
  // /cdn-cgi/ is the challenge machinery itself, and it serves .css and .js
  // under paths the list would otherwise catch. Blocking any of it blocks the
  // only thing this feature exists to do.
  assert.equal(shouldBlock('https://site.test/cdn-cgi/styles/challenge.css'), false);
  assert.equal(shouldBlock('https://www.google.com/recaptcha/api2/anchor.png'), false);
});

test('websockets are not blocked, matching what Android actually does', () => {
  // Upstream lists "wss://" in `blacklistedFiles` but tests it against
  // `Url(url).encodedPath`, which never contains a scheme — so the entry is
  // unreachable and Android does not block them. Implementing the apparent
  // intent instead would be a behaviour change no measured run supports.
  assert.equal(shouldBlock('wss://site.test/socket'), false);
});

test('a data: url is left alone rather than treated as unparsable', () => {
  // Pages build their own scripts this way; it costs no network and cancelling
  // it breaks them.
  assert.equal(shouldBlock('data:text/javascript,console.log(1)'), false);
  assert.equal(shouldBlock('blob:https://site.test/abc-123'), false);
});

test('an uncompilable intercept pattern matches nothing rather than throwing', () => {
  // It is reported elsewhere; here the contract is only that classification
  // still answers for every request instead of failing the whole resolve.
  assert.deepEqual(classifyRequest('https://a.test/x.m3u8', inputs('[')), { kind: 'allow' });
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

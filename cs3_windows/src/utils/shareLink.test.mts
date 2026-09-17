/**
 * What a link may say, and what it must never be able to say.
 *
 *   bun run test share-link
 *   node --experimental-strip-types src/utils/shareLink.test.mts
 *
 * A share link arrives from an untrusted party — it came through a chat app
 * from someone who got it from someone else. So most of this file is about the
 * hostile case, and the standard is not "is it valid" but **the worst a forged
 * link can do is open the wrong page**.
 *
 * The round trip is tested too, but it is the easy half.
 */
import assert from 'node:assert/strict';
import {
  SHARE_VERSION,
  decodeShareLink,
  describeShare,
  encodeShareLink,
  isShareableAddress,
  sign,
} from './shareLink.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const episode = {
  url: 'cs3meta://cinemeta/series/tt9288030',
  id: 'tt9288030',
  title: 'Reacher',
  year: 2026,
  type: 'series' as const,
  season: 4,
  episode: 2,
  provider: 'Torrentio',
  repository: 'netmirror',
  language: 'en',
};

/** Rebuilds a link with a different body, keeping the structure valid. */
function withBody(body: string): string {
  return `cloudstream://media/${body}.${sign(body)}`;
}

// --- the round trip --------------------------------------------------------

test('a link survives being encoded and read back', () => {
  const result = decodeShareLink(encodeShareLink(episode));
  assert.ok(result.ok, 'should decode');
  assert.equal(result.payload.title, 'Reacher');
  assert.equal(result.payload.season, 4);
  assert.equal(result.payload.episode, 2);
  assert.equal(result.payload.provider, 'Torrentio');
  assert.equal(result.payload.v, SHARE_VERSION);
});

test('a movie needs no season or episode', () => {
  const result = decodeShareLink(
    encodeShareLink({ url: 'cs3meta://cinemeta/movie/tt1160419', title: 'Dune', year: 2021 })
  );
  assert.ok(result.ok);
  assert.equal(result.payload.season, undefined);
  assert.equal(result.payload.episode, undefined);
});

// --- the hostile cases, which are the point --------------------------------

test('a link can never name something to go and fetch', () => {
  /**
   * The rule the whole format rests on. A payload pointing at `http(s)` or a
   * magnet would be handed to the resolver — that is "open this link" becoming
   * "fetch whatever the sender chose", and it is the one thing a message from a
   * stranger must not be able to do.
   */
  for (const url of [
    'https://evil.example/payload.mkv',
    'http://127.0.0.1:9/admin',
    'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    'file:///C:/Windows/System32',
    'javascript:alert(1)',
    'data:text/html,<script>',
  ]) {
    assert.equal(isShareableAddress(url), false, `${url} must not be shareable`);
    const link = withBody(
      Buffer.from(JSON.stringify({ v: 1, url, title: 'Anything' })).toString('base64url')
    );
    const result = decodeShareLink(link);
    assert.equal(result.ok, false, `${url} must be refused`);
  }
});

test('only addresses the app resolves itself are accepted', () => {
  for (const url of [
    'cs3meta://cinemeta/movie/tt1160419',
    'cs3ext://SomeProvider/handle',
    'cs3native://internetArchive/item',
  ]) {
    assert.equal(isShareableAddress(url), true, url);
  }
});

test('a poster that is not a picture is dropped, not rendered', () => {
  // Display-only fields still reach the DOM. `javascript:` in an `<img src>` is
  // inert in modern browsers, but the payload is the wrong place to find out.
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      url: 'cs3meta://cinemeta/movie/tt1',
      title: 'X',
      poster: 'javascript:alert(1)',
    })
  ).toString('base64url');
  const result = decodeShareLink(withBody(body));
  assert.ok(result.ok);
  assert.equal(result.payload.poster, undefined);
});

test('fields of the wrong type are dropped rather than passed on', () => {
  // Decoded JSON is attacker-shaped. A `season` that is not a number reaches
  // `SourceQuery` and then a provider.
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      url: 'cs3meta://cinemeta/series/tt1',
      title: 'X',
      season: 'drop table',
      episode: -5,
      year: {},
      provider: 42,
    })
  ).toString('base64url');
  const result = decodeShareLink(withBody(body));
  assert.ok(result.ok);
  assert.equal(result.payload.season, undefined);
  assert.equal(result.payload.episode, undefined);
  assert.equal(result.payload.year, undefined);
  assert.equal(result.payload.provider, undefined);
});

test('a repository is a catalogue id, and stays a string', () => {
  /**
   * `ott:installSuggestion` takes a repository id and never a URL, so that
   * "set up Netflix" cannot install arbitrary code. A share link is a stranger
   * handing over that same argument, so it obeys the same rule.
   */
  const result = decodeShareLink(encodeShareLink({ ...episode, repository: 'netmirror' }));
  assert.ok(result.ok);
  assert.equal(result.payload.repository, 'netmirror');
  assert.doesNotMatch(String(result.payload.repository), /https?:|\/\//);
});

// --- corruption in transit, which is what the tag is for --------------------

test('a truncated link is refused rather than opening the wrong thing', () => {
  const link = encodeShareLink(episode);
  for (const cut of [1, 4, 12]) {
    const truncated = link.slice(0, link.length - cut);
    const result = decodeShareLink(truncated);
    assert.equal(result.ok, false, `truncation by ${cut} should be refused`);
  }
});

test('a body edited in transit fails its tag', () => {
  const link = encodeShareLink(episode);
  const [prefix, tag] = link.split('.');
  const tampered = `${prefix.slice(0, -1)}X.${tag}`;
  const result = decodeShareLink(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.kind, 'corrupt');
});

test('damage is reported differently from "not our link"', () => {
  // The sender can fix one of these by sending it again; the other is not a
  // CloudStream link at all, and telling someone to resend it wastes their time.
  const notOurs = decodeShareLink('https://example.com/watch/123');
  assert.equal(notOurs.ok, false);
  assert.equal(notOurs.ok === false && notOurs.kind, 'malformed');

  const damaged = decodeShareLink(encodeShareLink(episode).slice(0, -2));
  assert.equal(damaged.ok === false && damaged.kind, 'corrupt');
});

// --- versions --------------------------------------------------------------

test('a newer link says to update the app rather than guessing', () => {
  /**
   * Reading unknown fields with today's meanings is how a link opens
   * confidently on the wrong content. Refusing names the thing the recipient
   * can actually do about it.
   */
  const body = Buffer.from(
    JSON.stringify({ v: SHARE_VERSION + 1, url: 'cs3meta://cinemeta/movie/tt1', title: 'X' })
  ).toString('base64url');
  const result = decodeShareLink(withBody(body));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.kind, 'unsupported');
  assert.match(result.ok === false ? result.reason : '', /update/i);
});

test('an older link keeps working', () => {
  // Backward compatibility is the whole reason `v` exists. A v1 payload must
  // still open on every later build.
  const body = Buffer.from(
    JSON.stringify({ v: 1, url: 'cs3meta://cinemeta/movie/tt1160419', title: 'Dune' })
  ).toString('base64url');
  const result = decodeShareLink(withBody(body));
  assert.ok(result.ok, 'a v1 link must always open');
});

// --- the description -------------------------------------------------------

test('one description, so every surface says the same thing', () => {
  assert.equal(describeShare({ title: 'Reacher', year: 2026, season: 4, episode: 2 }), 'Reacher — S4E2 (2026)');
  assert.equal(describeShare({ title: 'Dune', year: 2021 }), 'Dune (2021)');
  assert.equal(describeShare({ title: 'Untitled' }), 'Untitled');
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);

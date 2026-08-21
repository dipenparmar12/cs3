/**
 * Why a source would not open, and — the part that is acted on — whether it is
 * gone or merely not ready.
 *
 *   node --experimental-strip-types electron/media/unreadableSource.test.mts
 *
 * `dead` is not advisory. `PlaybackEngine.prepare` refuses outright when it is
 * set, and `VideoPlayer` skips to the next source. So a wrong `true` walks the
 * viewer down the whole source list without playing anything, and a wrong
 * `false` spends an ffmpeg startup and a player timeout on a 404.
 *
 * The loopback cases are the ones that shipped broken. The torrent engine, the
 * media proxy and the transcoder all serve from 127.0.0.1, and a torrent
 * answers no byte until its first piece lands — which from a cold swarm
 * routinely takes longer than this probe waits. Reporting that as a dead link
 * is what made torrent playback fail "most of the time".
 *
 * The fetcher is a stub because the branch under test is the classification,
 * not HTTP. Every shape it returns is one observed in the session logs.
 */
import assert from 'node:assert/strict';
import { describeUnreadableSource } from './unreadableSource.ts';
import type { ResilientFetch } from '../networkResilience.ts';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

/** The narrow slice of ResilientFetch this module uses. */
function stub(reply: { status: number } | Error): ResilientFetch {
  return {
    fetch: async () => {
      if (reply instanceof Error) throw reply;
      return { status: reply.status, body: null } as unknown as Response;
    },
  } as unknown as ResilientFetch;
}

const TORRENT = 'http://127.0.0.1:57143/webtorrent/abc123/Some.Release.2026.mkv';
const PROXY = 'http://localhost:62009/stream/1';
const REMOTE = 'https://cdn.example.com/video.mp4?token=abc';

// --- a link that is genuinely gone -------------------------------------------

test('a remote 404 is dead, and says the link expired', async () => {
  const result = await describeUnreadableSource(stub({ status: 404 }), REMOTE);
  assert.equal(result.dead, true);
  assert.equal(result.status, 404);
  assert.match(result.reason, /no longer exists/i);
});

test('a remote 403 is dead — hotlink protection and expiry both answer it', async () => {
  const result = await describeUnreadableSource(stub({ status: 403 }), REMOTE);
  assert.equal(result.dead, true);
  assert.match(result.reason, /refused/i);
});

test('a remote timeout is dead: the host never answered at all', async () => {
  const result = await describeUnreadableSource(
    stub(new Error('The operation was aborted due to timeout')),
    REMOTE
  );
  assert.equal(result.dead, true);
  assert.match(result.reason, /could not be reached/i);
});

// --- alive, but unreadable ---------------------------------------------------

test('a 200 that would not probe is alive, so an external player is still offered', async () => {
  const result = await describeUnreadableSource(stub({ status: 200 }), REMOTE);
  assert.equal(result.dead, false);
  assert.match(result.reason, /format could not be read/i);
});

test('a non-http address is alive: nothing was asked, so nothing is known', async () => {
  const result = await describeUnreadableSource(stub({ status: 200 }), 'magnet:?xt=urn:btih:abc');
  assert.equal(result.dead, false);
});

// --- our own servers ---------------------------------------------------------

test('a torrent still finding peers is NOT dead', async () => {
  /**
   * The bug, exactly as logged: `/webtorrent/` on loopback, aborted by timeout.
   * Marked dead, `prepare` refused, the player skipped — and the swarm was fine.
   */
  const result = await describeUnreadableSource(
    stub(new Error('The operation was aborted due to timeout')),
    TORRENT
  );
  assert.equal(result.dead, false, 'a buffering torrent was reported as a gone link');
  assert.match(result.reason, /has not produced any data yet/i);
});

test('a slow loopback proxy is NOT dead', async () => {
  const result = await describeUnreadableSource(stub(new Error('socket hang up')), PROXY);
  assert.equal(result.dead, false);
});

test('a loopback status code is still trusted', async () => {
  /**
   * The proxy forwards the upstream status, so a 403 arriving on loopback
   * really is the CDN refusing — it is only the *transport* verdict that cannot
   * be trusted about a server we are running ourselves. Blanket-excusing
   * loopback would trade one wrong answer for the opposite one.
   */
  const refused = await describeUnreadableSource(stub({ status: 403 }), PROXY);
  assert.equal(refused.dead, true);

  const gone = await describeUnreadableSource(stub({ status: 404 }), TORRENT);
  assert.equal(gone.dead, true);
});

// --- runner ------------------------------------------------------------------

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
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);

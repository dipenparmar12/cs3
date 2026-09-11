/**
 * A start that fails walks on; a source the viewer named does not.
 *
 *   bun run test playback-failover
 *   node --experimental-strip-types electron/playbackFailover.test.mts
 *
 * The reported failure: a title found **70 sources**, the app tried one
 * 120-seeder torrent, and stopped — `Tried 1 source and none started. … No
 * peers answered for this torrent — the swarm looks dead.` — with a
 * 3,564-seeder release four rows down that was never asked.
 *
 * `startBestStream` does have a four-candidate walk, but the two paths that
 * reach `beginStream` with `failover: false` hand it a *single* candidate, and
 * its `catch` recovered only when that candidate carried a `directUrl` — the
 * branch written for expired provider links. A torrent with a dead swarm fell
 * through it to `phase = 'error'`. The asymmetry was never a decision about
 * torrents; it is what that branch happened to be written against.
 *
 * The opposite rule is tested beside it, because it *is* a decision and not an
 * oversight: `selectSource` tries exactly what the viewer picked and stops.
 * Someone who chose a particular release — for its language, its size, its
 * audio — has not asked for a different one, and quietly playing another
 * answers a question they did not ask. A fix for the first rule that also broke
 * the second would pass every case here except the last one.
 */
import assert from 'node:assert/strict';
import { PlaybackSessionManager } from './playbackSession.ts';
import type { ContentService } from './contentService.ts';
import type { TorrentResult } from '../src/types/torrent';

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const source = (n: number): TorrentResult =>
  ({
    title: `Release ${n}`,
    infoHash: `hash${n}`,
    magnet: `magnet:?xt=urn:btih:hash${n}`,
    seeders: 100 - n,
    indexerName: 'Torrentio',
  }) as TorrentResult;

/**
 * A `ContentService` that records which sources each pass was offered.
 *
 * Only the members `beginStream` actually reaches are implemented; the cast is
 * deliberate rather than a shortcut, so the test states its own surface instead
 * of pretending to build the whole service.
 */
function stubContent(playable: Set<string>) {
  const offered: string[][] = [];

  const content = {
    startBestStream: async (
      candidates: TorrentResult[],
      _season?: number,
      _episode?: number,
      opts: { maxAttempts?: number } = {}
    ) => {
      const tried = candidates.slice(0, opts.maxAttempts ?? 4);
      offered.push(tried.map((c) => c.infoHash!));
      const winner = tried.find((c) => playable.has(c.infoHash!));
      if (!winner) {
        /**
         * The attempts ride on the error, exactly as `startBestStream` does it.
         *
         * That is the contract the walk depends on: it rules out what was
         * *attempted*, and a stub that threw a bare error would let the caller
         * fall back to retiring one source a pass — passing this file while the
         * real thing crawled.
         */
        throw Object.assign(
          new Error(
            `Tried ${tried.length} source${tried.length === 1 ? '' : 's'} and none started. ` +
              'No peers answered for this torrent — the swarm looks dead.'
          ),
          {
            attempts: tried.map((c) => ({
              title: c.title,
              indexerName: c.indexerName,
              infoHash: c.infoHash,
              error: 'No peers answered for this torrent — the swarm looks dead.',
            })),
          }
        );
      }
      return {
        handle: { infoHash: winner.infoHash!, url: 'http://127.0.0.1/x', files: [] },
        source: winner,
        attempts: [],
      };
    },
    getEngine: () => ({ stopStream: async () => {} }),
    getCache: () => ({
      recordSuccess: () => {},
      recordFailure: () => {},
      invalidate: () => {},
    }),
  } as unknown as ContentService;

  return { content, offered };
}

/** Opens a session and plants a source list on it. */
function sessionWith(manager: PlaybackSessionManager, sources: TorrentResult[]): string {
  const snapshot = manager.start(
    { mediaUrl: 'cs3meta://cinemeta/series/tt9288030?s=4&e=2', season: 4, episode: 2 } as never,
    'Reacher'
  );
  const sessions = (
    manager as unknown as {
      sessions: Map<string, { sources: TorrentResult[]; activeInfoHash?: string }>;
    }
  ).sessions;
  const session = sessions.get(snapshot.sessionId)!;
  session.sources = sources;
  // The skip path retires whatever is playing, so give it one to retire.
  session.activeInfoHash = sources[0]?.infoHash;
  return snapshot.sessionId;
}

// --- the bug ---------------------------------------------------------------

test('a failed start walks on instead of ending the session', async () => {
  const sources = Array.from({ length: 10 }, (_, i) => source(i));
  // Only the ninth works — far past the single candidate a skip step offers.
  const { content, offered } = stubContent(new Set(['hash8']));
  const manager = new PlaybackSessionManager(content);
  const id = sessionWith(manager, sources);

  const after = await manager.skipCurrentSource(id, 'the swarm looks dead');

  assert.ok(offered.length > 1, `expected more than one pass, got ${offered.length}`);
  assert.ok(
    offered.flat().includes('hash8'),
    `the working source was never offered; passes were ${JSON.stringify(offered)}`
  );
  assert.equal(after?.phase, 'playing');
});

test('the walk stays bounded rather than trying all seventy', async () => {
  const sources = Array.from({ length: 70 }, (_, i) => source(i));
  const { content, offered } = stubContent(new Set()); // nothing works
  const manager = new PlaybackSessionManager(content);
  const id = sessionWith(manager, sources);

  const after = await manager.skipCurrentSource(id, 'the swarm looks dead');

  assert.equal(after?.phase, 'error');
  const tried = new Set(offered.flat()).size;
  assert.ok(tried > 1, 'more than one source should have been tried');
  assert.ok(tried <= 12, `the walk must stay bounded; it tried ${tried} of 70`);
});

test('running out says how far it got, not just that one source failed', async () => {
  const sources = Array.from({ length: 70 }, (_, i) => source(i));
  const { content } = stubContent(new Set());
  const manager = new PlaybackSessionManager(content);
  const id = sessionWith(manager, sources);

  const after = await manager.skipCurrentSource(id, 'the swarm looks dead');

  assert.equal(after?.phase, 'error');
  assert.match(
    after!.error!,
    /of 70 sources were tried/,
    `the message should carry the session's own count, got: ${after!.error}`
  );
});

// --- the decision that must survive the fix ---------------------------------

test('a source the viewer picked is the only one tried', async () => {
  const sources = Array.from({ length: 10 }, (_, i) => source(i));
  // The picked one is dead and a later one would work; the walk must not run.
  const { content, offered } = stubContent(new Set(['hash5']));
  const manager = new PlaybackSessionManager(content);
  const id = sessionWith(manager, sources);

  const after = await manager.selectSource(id, 'hash0');

  assert.equal(after?.phase, 'error', 'an explicit pick that fails is an error, not a substitute');
  assert.deepEqual(
    offered,
    [['hash0']],
    `only the picked source may be attempted; passes were ${JSON.stringify(offered)}`
  );
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);

/**
 * Which episode "Play" starts.
 *
 *   node --experimental-strip-types src/utils/resumePoint.test.mts
 *
 * Pure, and pinned because every wrong answer here is silent. The player opens,
 * something plays, and the viewer is simply in the wrong place — which they
 * read as the app having forgotten them rather than as a bug, and therefore
 * never report as one.
 */
import assert from 'node:assert/strict';
import { inPlayOrder, pickResumePoint, resumeSeconds } from './resumePoint.ts';
import { episodeKey, type EpisodeWatchState } from '../components/player/seriesContext.ts';
import type { Episode } from '../types/api.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const ep = (season: number, episode: number): Episode =>
  ({ name: `S${season}E${episode}`, url: `u/${season}/${episode}`, season, episode }) as Episode;

/** Two seasons of four, in a deliberately shuffled order. */
const SERIES = [ep(2, 1), ep(1, 3), ep(1, 1), ep(2, 2), ep(1, 4), ep(1, 2)];

function watched(
  entries: Array<[Episode, Partial<EpisodeWatchState>]>
): Record<string, EpisodeWatchState> {
  const state: Record<string, EpisodeWatchState> = {};
  for (const [episode, partial] of entries) {
    state[episodeKey(episode.season, episode.episode)] = {
      positionSeconds: 0,
      durationSeconds: 2400,
      completed: false,
      ...partial,
    };
  }
  return state;
}

test('nothing watched starts at the first episode', () => {
  assert.equal(pickResumePoint(SERIES, {}).episode?.name, 'S1E1');
  assert.equal(pickResumePoint(SERIES, undefined).episode?.name, 'S1E1');
  assert.equal(pickResumePoint(SERIES, {}).resumeAt, undefined);
});

test('an unfinished episode is resumed where it stopped', () => {
  const state = watched([
    [ep(1, 1), { completed: true }],
    [ep(1, 2), { positionSeconds: 640 }],
  ]);
  const point = pickResumePoint(SERIES, state);
  assert.equal(point.episode?.name, 'S1E2');
  assert.equal(point.resumeAt, 640);
});

test('a finished episode advances to the next one, from its start', () => {
  const state = watched([
    [ep(1, 1), { completed: true }],
    [ep(1, 2), { completed: true }],
  ]);
  const point = pickResumePoint(SERIES, state);
  assert.equal(point.episode?.name, 'S1E3');
  assert.equal(point.resumeAt, undefined, 'a new episode starts at the top');
});

test('the next episode crosses a season boundary', () => {
  const state = watched([[ep(1, 4), { completed: true }]]);
  assert.equal(pickResumePoint(SERIES, state).episode?.name, 'S2E1');
});

test('a finished series offers itself again rather than nothing', () => {
  // The viewer pressed Play. A button that does nothing is the worse answer.
  const state = watched([[ep(2, 2), { completed: true }]]);
  assert.equal(pickResumePoint(SERIES, state).episode?.name, 'S1E1');
});

test('rewatching an early episode does not drag "continue" backwards', () => {
  /**
   * The furthest episode with history wins, not the most recently updated one.
   * Someone who has finished a series and dips back into episode 2 writes a
   * fresh timestamp on an early episode — and a recency rule would then send
   * every later Play back to the start of a show they have already seen.
   */
  const state = watched([
    [ep(1, 1), { completed: true }],
    [ep(1, 2), { completed: true }],
    [ep(1, 3), { completed: true }],
    [ep(2, 1), { positionSeconds: 900 }],
  ]);
  // Episode 2 rewatched most recently; S2E1 is still where they were.
  const point = pickResumePoint(SERIES, state);
  assert.equal(point.episode?.name, 'S2E1');
  assert.equal(point.resumeAt, 900);
});

test('a film has no episode and no resume point of its own', () => {
  assert.deepEqual(pickResumePoint([], {}), { episode: null, resumeAt: undefined });
});

test('a live channel is never resumed', () => {
  // Yesterday's twenty minutes in is not a point in today's broadcast.
  const state = watched([[ep(1, 1), { positionSeconds: 1200 }]]);
  assert.equal(pickResumePoint(SERIES, state, { isLive: true }).resumeAt, undefined);
  assert.equal(resumeSeconds(state, ep(1, 1), { isLive: true }), undefined);
  assert.equal(resumeSeconds(state, ep(1, 1)), 1200);
});

test('a completed episode reports no resume position', () => {
  const state = watched([[ep(1, 1), { positionSeconds: 2350, completed: true }]]);
  assert.equal(resumeSeconds(state, ep(1, 1)), undefined);
});

test('inPlayOrder sorts by season then episode and does not mutate', () => {
  const before = [...SERIES];
  assert.deepEqual(
    inPlayOrder(SERIES).map((e) => e.name),
    ['S1E1', 'S1E2', 'S1E3', 'S1E4', 'S2E1', 'S2E2']
  );
  assert.deepEqual(SERIES, before);
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

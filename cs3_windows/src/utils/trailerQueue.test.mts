/**
 * What plays after a trailer ends, and the boundary autoplay must not cross.
 *
 *   bun run test trailer-queue
 *   node --experimental-strip-types src/utils/trailerQueue.test.mts
 *
 * The interesting cases are the two refusals. Autoplay that crosses from the
 * trailer rail into the related rail answers a question nobody asked — the
 * split `videoGallery.ts` draws exists precisely because a featurette is not a
 * trailer — and a queue that wraps never stops, which turns a convenience into
 * something the viewer has to go and interrupt.
 */
import assert from 'node:assert/strict';

import { TitleVideoKind, type TitleVideo } from '../types/metadata.ts';
import { buildTrailerQueue, current, step, upNext } from './trailerQueue.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const video = (
  id: string,
  kind: TitleVideoKind,
  season?: number
): TitleVideo => ({
  id,
  title: id,
  url: `https://example.test/${id}`,
  kind,
  label: id,
  host: 'web',
  season,
});

const trailerA = video('trailer-a', TitleVideoKind.Trailer);
const teaserB = video('teaser-b', TitleVideoKind.Teaser);
const seasonC = video('season-c', TitleVideoKind.Trailer, 2);
const seasonD = video('season-d', TitleVideoKind.Trailer, 1);
const clipE = video('clip-e', TitleVideoKind.Clip);
const featuretteF = video('featurette-f', TitleVideoKind.Featurette);

const all = [trailerA, clipE, seasonC, teaserB, featuretteF, seasonD];

test('the queue is every trailer, in the order the gallery drew them', () => {
  const queue = buildTrailerQueue(all, trailerA.id);
  assert.deepEqual(
    queue.videos.map((entry) => entry.id),
    // Series-wide first, then seasons ascending — `groupVideos`'s order.
    [trailerA.id, teaserB.id, seasonD.id, seasonC.id]
  );
  assert.equal(queue.index, 0);
});

test('a season heading is not a boundary', () => {
  const queue = buildTrailerQueue(all, seasonD.id);
  assert.equal(current(queue)?.id, seasonD.id);
  assert.equal(upNext(queue)?.id, seasonC.id);
});

test('autoplay never crosses from trailers into related videos', () => {
  /**
   * The load-bearing case. The last trailer is `season-c`; the related rail
   * starts right under it on screen, and rolling on into it is the "pressed
   * Official Trailer, got eleven minutes of interviews" failure.
   */
  const queue = buildTrailerQueue(all, seasonC.id);
  assert.equal(upNext(queue), null);
  assert.equal(step(queue, 1), null);
});

test('a related video plays on into the next related video', () => {
  const queue = buildTrailerQueue(all, clipE.id);
  assert.deepEqual(
    queue.videos.map((entry) => entry.id),
    [clipE.id, featuretteF.id]
  );
  assert.equal(upNext(queue)?.id, featuretteF.id);
});

test('nothing wraps, at either end', () => {
  const first = buildTrailerQueue(all, trailerA.id);
  assert.equal(step(first, -1), null);
  const last = buildTrailerQueue(all, seasonC.id);
  assert.equal(step(last, 1), null);
});

test('stepping back returns the previous entry without touching the list', () => {
  const queue = buildTrailerQueue(all, teaserB.id);
  const back = step(queue, -1);
  assert.equal(back?.index, 0);
  assert.equal(back && current(back)?.id, trailerA.id);
  assert.deepEqual(back?.videos, queue.videos);
});

test('a video the grouping does not place still plays, alone', () => {
  const stray = video('stray', TitleVideoKind.Trailer);
  const queue = buildTrailerQueue([stray], stray.id);
  assert.equal(current(queue)?.id, stray.id);
  assert.equal(upNext(queue), null);
});

test('an unknown id is an empty queue rather than a wrong video', () => {
  const queue = buildTrailerQueue(all, 'nothing-like-this');
  assert.equal(queue.index, -1);
  assert.equal(current(queue), null);
  assert.equal(step(queue, 1), null);
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

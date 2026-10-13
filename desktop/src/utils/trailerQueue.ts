/**
 * What plays after a trailer ends.
 *
 * Pure and beside `videoGallery.ts` for the same reason that module gives:
 * Node's type-stripping loader cannot load JSX, and the rule is the half worth
 * testing. Every wrong answer here is silent — the viewer presses one trailer
 * and something else starts — which is the shape this repository tests rather
 * than argues about.
 *
 * ## The one line this draws
 *
 * **Autoplay stays inside the rail the viewer pressed.** `groupVideos` already
 * separates trailers from clips, featurettes, making-ofs and interviews, and it
 * separates them because they answer different questions. A trailer rolling on
 * into an eleven-minute cast interview is exactly the failure that split exists
 * to prevent, arriving through the back door of a feature meant to be
 * convenient — so a trailer follows a trailer, and a related video follows a
 * related video.
 *
 * Seasons are *not* a second boundary. They are a heading over one rail the
 * viewer scrolls through as one thing, and stopping autoplay at a heading would
 * be a rule nobody can see.
 *
 * **Nothing wraps.** A queue that returns to its first entry never ends, and an
 * autoplaying popup that never ends is one the viewer has to notice and close.
 * `step` answers `null` at both ends, which is what stops the countdown being
 * offered at all.
 */

import type { TitleVideo } from '../types/metadata.ts';
import { groupVideos } from './videoGallery.ts';

export interface TrailerQueue {
  /** In the order the gallery drew them, which is the order a viewer expects. */
  videos: TitleVideo[];
  /** Always a valid index into `videos`, or `-1` when the queue is empty. */
  index: number;
}

/**
 * The queue a video belongs to, positioned at that video.
 *
 * An id that is in neither rail answers with a queue of one rather than an
 * empty one: the viewer pressed something, and refusing to play it because the
 * grouping disagrees would be worse than playing it alone.
 */
export function buildTrailerQueue(videos: TitleVideo[], startId: string): TrailerQueue {
  const grouped = groupVideos(videos);
  const trailers = grouped.trailerGroups.flatMap((group) => group.videos);

  for (const rail of [trailers, grouped.related]) {
    const index = rail.findIndex((video) => video.id === startId);
    if (index >= 0) return { videos: rail, index };
  }

  const only = videos.find((video) => video.id === startId);
  return only ? { videos: [only], index: 0 } : { videos: [], index: -1 };
}

/** The entry `delta` steps away, or `null` at either end. */
export function step(queue: TrailerQueue, delta: number): TrailerQueue | null {
  if (queue.index < 0) return null;
  const index = queue.index + delta;
  if (index < 0 || index >= queue.videos.length) return null;
  return { videos: queue.videos, index };
}

/** The entry that would play next, for the "Up next" line. */
export function upNext(queue: TrailerQueue): TitleVideo | null {
  const next = step(queue, 1);
  return next ? next.videos[next.index] : null;
}

/** The entry playing now. `null` only for an empty queue. */
export function current(queue: TrailerQueue): TitleVideo | null {
  return queue.index >= 0 ? (queue.videos[queue.index] ?? null) : null;
}

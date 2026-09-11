import type { MpvSnapshot, MpvTrack } from '../../src/types/mpv.ts';

/**
 * Which snapshots have to reach the renderer *now*, and which can wait a tick.
 *
 * `MpvEngine` emits on every `property-change` frame mpv sends, and `OBSERVED`
 * asks for several properties that are not events but continuously moving
 * numbers: `estimated-vf-fps` and `frame-drop-count` are recomputed as frames
 * are presented, `demuxer-cache-time` moves as the cache fills, `time-pos`
 * ticks once per presented frame, and `video-params` is re-sent whenever any
 * member of it is recalculated. Each of those frames ran the full path — rebuild both track
 * arrays in `snapshot()`, then **two** `webContents.send` calls (`mpv:update`
 * and `external:update`) — and on the far side every push sets renderer state,
 * which re-renders `VideoPlayer` and re-runs `NativeEngineStage`'s snapshot
 * effect, whose dependency array holds five callbacks that are fresh closures on
 * every render.
 *
 * So the cost of one moving number was a full render of the largest component in
 * the app, at whatever rate mpv felt like reporting, for the whole length of a
 * film — and only ever while the native engine held the stream, which is exactly
 * when it was reported: the window stops answering for seconds at a time and
 * then comes back.
 *
 * ## Why coalescing is safe here and would not be for a delta channel
 *
 * An `MpvSnapshot` is complete state, never a diff — `src/types/mpv.ts` says so
 * and gives the reason (the renderer can be closed and reopened mid-playback).
 * Dropping an intermediate snapshot therefore loses nothing: the next one says
 * everything the dropped one would have. That is not true of `playback:*`
 * progress or of anything carrying a transition, which is why this module splits
 * them rather than throttling everything.
 *
 * **Anything the UI branches on is delivered immediately.** A state change, an
 * error, a pause, a track selection, a different file: those are decisions, and
 * a control bar that takes 200ms to notice the user's own click is a worse bug
 * than the one being fixed. Only the numbers that merely redraw themselves —
 * playhead, buffer, frame rate, dropped frames — are allowed to arrive on the
 * next tick, and a tick is bounded well under the interval at which a person
 * can see a progress bar move.
 */

/**
 * How long a snapshot carrying only moving numbers may be held.
 *
 * 200ms is five updates a second, which is about what `<video>` fires
 * `timeupdate` at — so the scrubber moves as smoothly as it does on the
 * element path, and no more.
 *
 * **Measured, because the obvious assumption is wrong.** Observing `time-pos`
 * does not deliver a `property-change` once a second; it delivers one **per
 * presented frame**. Against a 1080p25 file (`--vo=null`, 15s sample) mpv sent
 * 450 property changes: 375 `time-pos` (25/s), 56 `demuxer-cache-time` (3.7/s),
 * the rest once each. That is 30 `emit()` calls a second — 60 `webContents.send`
 * calls, since main sends `mpv:update` and `external:update` for each — and a
 * 60fps stream doubles it. The playhead therefore needs bounding just as much
 * as the properties with no natural rate at all.
 */
export const COALESCE_MS = 200;

/** Track identity, as the track menus read it. */
function trackShape(tracks: readonly MpvTrack[] | undefined): string {
  return (tracks ?? []).map((t) => `${t.id}:${t.selected ? 1 : 0}`).join(',');
}

/**
 * The fields that are allowed to arrive late, named explicitly.
 *
 * Stated as an opt-out rather than comparing a list of important fields, so that
 * a field added to `MpvSnapshot` later defaults to being **delivered**. Getting
 * that default the other way round would make the next field that drives a
 * decision arrive up to {@link COALESCE_MS} late, which is a lag with no error
 * and nothing in a log — the hardest kind of bug to find in a player.
 */
const COALESCEABLE = new Set<keyof MpvSnapshot>([
  'positionSeconds',
  'durationSeconds',
  'bufferedSeconds',
  'frameRate',
  'droppedFrames',
  'startupLatencyMs',
]);

/**
 * Whether this snapshot differs from the last delivered one in a way the UI
 * decides something on.
 *
 * A first snapshot is always significant: there is nothing on screen yet.
 */
export function isSignificantChange(
  previous: MpvSnapshot | null,
  next: MpvSnapshot
): boolean {
  if (!previous) return true;

  // The union of both sides' keys: an optional field that has just become
  // absent (`pixelFormat` on a file with no video) is as much a change as one
  // that has just appeared, and iterating only `next` would miss it.
  const keys = new Set<keyof MpvSnapshot>([
    ...(Object.keys(previous) as Array<keyof MpvSnapshot>),
    ...(Object.keys(next) as Array<keyof MpvSnapshot>),
  ]);

  for (const key of keys) {
    if (COALESCEABLE.has(key)) continue;

    if (key === 'audioTracks' || key === 'subtitleTracks') {
      // Compared by identity and selection rather than deep-equal: the menus
      // read nothing else, and mpv re-sends `track-list` as one whole array
      // whenever any member of it is re-read.
      if (trackShape(previous[key]) !== trackShape(next[key])) return true;
      continue;
    }

    if (previous[key] !== next[key]) return true;
  }

  return false;
}

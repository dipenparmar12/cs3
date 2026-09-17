/**
 * What may wait 200ms, and what may not.
 *
 *   bun run test mpv-emit
 *   node --experimental-strip-types electron/media/mpvEmitPolicy.test.mts
 *
 * The two rules that matter in opposite directions: a moving number must not
 * cost a render of the whole player, and a decision must never be held back.
 * The last test is the one that keeps the second rule true as the snapshot grows
 * — it fails if a new field is added to `MpvSnapshot` and quietly treated as
 * telemetry.
 */
import assert from 'node:assert/strict';
import type { MpvSnapshot, MpvTrack } from '../../src/types/mpv.ts';
import { COALESCE_MS, isSignificantChange } from './mpvEmitPolicy.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const track = (id: number, selected = false): MpvTrack => ({
  id,
  type: 'audio',
  isDefault: false,
  isForced: false,
  selected,
  external: false,
});

const base: MpvSnapshot = {
  sessionId: 's1',
  state: 'playing',
  url: 'http://127.0.0.1:5000/stream/abc',
  title: 'A Film',
  positionSeconds: 12,
  durationSeconds: 7200,
  bufferedSeconds: 30,
  paused: false,
  volume: 100,
  muted: false,
  speed: 1,
  fullscreen: false,
  width: 1920,
  height: 1080,
  videoCodec: 'hevc',
  audioCodec: 'eac3',
  hardwareDecoder: 'd3d11va',
  frameRate: 23.976,
  droppedFrames: 0,
  audioTracks: [track(1, true), track(2)],
  subtitleTracks: [],
  selectedAudioId: 1,
  selectedSubtitleId: null,
  error: null,
  startupLatencyMs: 900,
};
const from = (patch: Partial<MpvSnapshot>): MpvSnapshot => ({ ...base, ...patch });

// --- the first rule: a moving number is not worth a render -------------------

test('the playhead alone may wait', () => {
  assert.equal(isSignificantChange(base, from({ positionSeconds: 13 })), false);
});

/**
 * These four are why the freeze happened. `estimated-vf-fps` and
 * `frame-drop-count` are recomputed as frames are presented and have no natural
 * rate at all.
 */
test('frame rate, dropped frames, buffer and duration may wait', () => {
  assert.equal(isSignificantChange(base, from({ frameRate: 23.974 })), false);
  assert.equal(isSignificantChange(base, from({ droppedFrames: 1 })), false);
  assert.equal(isSignificantChange(base, from({ bufferedSeconds: 31 })), false);
  assert.equal(isSignificantChange(base, from({ durationSeconds: 7201 })), false);
});

test('all of them moving together still may wait', () => {
  const next = from({
    positionSeconds: 13,
    bufferedSeconds: 44,
    frameRate: 23.9,
    droppedFrames: 7,
    durationSeconds: 7201,
  });
  assert.equal(isSignificantChange(base, next), false);
});

test('an unchanged snapshot is not significant', () => {
  assert.equal(isSignificantChange(base, from({})), false);
});

// --- the second rule: a decision is never held back -------------------------

test('the first snapshot always goes, because nothing is on screen yet', () => {
  assert.equal(isSignificantChange(null, base), true);
});

test('a state change goes immediately', () => {
  for (const state of ['loading', 'paused', 'buffering', 'ended', 'error', 'idle'] as const) {
    assert.equal(isSignificantChange(base, from({ state })), true, state);
  }
});

/**
 * A control bar that takes 200ms to notice the viewer's own click is a worse
 * bug than the one this module fixes.
 */
test('anything the viewer just did goes immediately', () => {
  assert.equal(isSignificantChange(base, from({ paused: true })), true);
  assert.equal(isSignificantChange(base, from({ muted: true })), true);
  assert.equal(isSignificantChange(base, from({ volume: 80 })), true);
  assert.equal(isSignificantChange(base, from({ speed: 1.5 })), true);
  assert.equal(isSignificantChange(base, from({ fullscreen: true })), true);
});

test('a failure goes immediately, and so does clearing one', () => {
  assert.equal(isSignificantChange(base, from({ error: 'could not open' })), true);
  assert.equal(isSignificantChange(from({ error: 'x' }), base), true);
});

test('a different file or session goes immediately', () => {
  assert.equal(isSignificantChange(base, from({ url: 'http://127.0.0.1:5000/stream/xyz' })), true);
  assert.equal(isSignificantChange(base, from({ sessionId: 's2' })), true);
});

test('a track selection or a changed track list goes immediately', () => {
  assert.equal(isSignificantChange(base, from({ selectedAudioId: 2 })), true);
  assert.equal(isSignificantChange(base, from({ selectedSubtitleId: 3 })), true);
  assert.equal(
    isSignificantChange(base, from({ audioTracks: [track(1), track(2, true)] })),
    true,
    'the selected member moved'
  );
  assert.equal(
    isSignificantChange(base, from({ audioTracks: [track(1, true), track(2), track(3)] })),
    true,
    'a track appeared'
  );
  assert.equal(
    isSignificantChange(base, from({ subtitleTracks: [track(1)] })),
    true,
    'an attached subtitle arrived'
  );
});

test('what the decoder note is built from goes immediately', () => {
  assert.equal(isSignificantChange(base, from({ hardwareDecoder: 'no' })), true);
  assert.equal(isSignificantChange(base, from({ videoCodec: 'h264' })), true);
  assert.equal(isSignificantChange(base, from({ audioCodec: 'aac' })), true);
  assert.equal(isSignificantChange(base, from({ width: 3840, height: 2160 })), true);
  assert.equal(isSignificantChange(base, from({ title: 'Another Film' })), true);
});

/**
 * An optional field that has just become absent is as much a change as one that
 * has just appeared; iterating only the new snapshot's keys would miss it.
 */
test('an optional field appearing or disappearing goes immediately', () => {
  const withFormat = from({ pixelFormat: 'yuv420p10' });
  assert.equal(isSignificantChange(base, withFormat), true);
  assert.equal(isSignificantChange(withFormat, base), true);
  assert.equal(isSignificantChange(base, from({ colorTransfer: 'pq' })), true);
});

// --- keeping the default safe as the type grows ------------------------------

/**
 * The guard on the rule above. Every field of `MpvSnapshot` is either named as
 * coalesceable in the module or must make a change significant; a field that is
 * neither would be delayed by accident, with no error and nothing in a log.
 *
 * If this fails after you added a field: decide which it is. A number that only
 * redraws itself goes in `COALESCEABLE`; anything else needs no action beyond
 * making this test pass, which it will once the field differs.
 */
test('every field of the snapshot is accounted for', () => {
  const coalesceable = new Set([
    'positionSeconds',
    'durationSeconds',
    'bufferedSeconds',
    'frameRate',
    'droppedFrames',
    'startupLatencyMs',
  ]);
  const sentinels: Partial<Record<keyof MpvSnapshot, unknown>> = {
    sessionId: 'other',
    state: 'idle',
    url: 'other',
    title: 'other',
    paused: true,
    volume: 1,
    muted: true,
    speed: 2,
    fullscreen: true,
    width: 1,
    height: 1,
    pixelFormat: 'other',
    colorTransfer: 'other',
    videoCodec: 'other',
    audioCodec: 'other',
    hardwareDecoder: 'other',
    audioTracks: [track(9, true)],
    subtitleTracks: [track(9, true)],
    selectedAudioId: 99,
    selectedSubtitleId: 99,
    error: 'other',
  };

  const unaccounted: string[] = [];
  for (const key of Object.keys(base) as Array<keyof MpvSnapshot>) {
    if (coalesceable.has(key)) continue;
    if (!(key in sentinels)) {
      unaccounted.push(`${key} (no sentinel in this test)`);
      continue;
    }
    if (!isSignificantChange(base, from({ [key]: sentinels[key] } as Partial<MpvSnapshot>))) {
      unaccounted.push(`${key} (change was treated as telemetry)`);
    }
  }
  assert.deepEqual(unaccounted, []);
});

test('the coalescing interval is above the rate a playhead changes', () => {
  // `time-pos` is reported about once a second, so the scrubber loses nothing.
  assert.ok(COALESCE_MS > 0 && COALESCE_MS <= 1_000);
});

// --- runner ------------------------------------------------------------------

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

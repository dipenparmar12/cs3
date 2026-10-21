/**
 * Picking an audio track: which route it takes, and which track it enables.
 *
 *   bun run test audio-track-switch
 *   node --experimental-strip-types src/components/player/audioTrackSwitch.test.mts
 *
 * The reported bug: on a direct file with two dubs, choosing the second sent
 * the stream to a forced re-encode, or to mpv's own window, because every
 * direct file took the path written for streams whose contents are unknown.
 */
import assert from 'node:assert/strict';
import {
  audioSwitchRoute,
  enableLiveTrack,
  liveTrackFor,
  liveTrackLabel,
  type AudioSwitchInput,
} from './audioTrackSwitch.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const directFile: AudioSwitchInput = {
  index: 1,
  liveMatch: false,
  measured: true,
  inSegments: false,
  isConverted: false,
  defaultIndex: 0,
};

// --- routes ----------------------------------------------------------------

test('a measured direct file is remuxed for another dub, never force-converted', () => {
  assert.equal(audioSwitchRoute(directFile), 'prepare');
});

test('the element switches in place when it offers the track', () => {
  assert.equal(audioSwitchRoute({ ...directFile, liveMatch: true }), 'live');
  assert.equal(audioSwitchRoute({ ...directFile, liveMatch: true, measured: false }), 'live');
});

test('picking the track already playing does nothing', () => {
  assert.equal(audioSwitchRoute({ ...directFile, index: 0 }), 'none');
  assert.equal(audioSwitchRoute({ ...directFile, index: 2, defaultIndex: 2 }), 'none');
});

test('in-segment HLS plays the first language whatever the default says', () => {
  const hls = { ...directFile, inSegments: true, measured: false, defaultIndex: 1 };
  assert.equal(audioSwitchRoute({ ...hls, index: 0 }), 'none');
  assert.equal(audioSwitchRoute({ ...hls, index: 1 }), 'prepare');
});

test('on a conversion even the default track needs a new preparation', () => {
  assert.equal(audioSwitchRoute({ ...directFile, index: 0, isConverted: true }), 'prepare');
});

test('contents never measured still take the forced conversion', () => {
  assert.equal(audioSwitchRoute({ ...directFile, measured: false }), 'convert');
});

// --- live tracks -----------------------------------------------------------

test('a probed track maps to the live track at the same position', () => {
  const live = [{ id: '2', language: 'eng' }, { id: '3', language: 'hin' }];
  assert.deepEqual(liveTrackFor(live, { index: 1, language: 'hin' }, 2), live[1]);
  assert.equal(liveTrackFor([], { index: 0 }, 0), undefined);
  assert.equal(liveTrackFor([live[0]], { index: 0 }, 1), undefined, 'one track is nothing to switch');
});

test('when the counts differ, a language carried by one live track names it', () => {
  // hls.js lists one rendition group; the manifest held two (128k and 64k).
  const live = [{ id: '0', language: 'en' }, { id: '1', language: 'hi' }];
  assert.deepEqual(liveTrackFor(live, { index: 3, language: 'hin' }, 4), live[1]);
  assert.equal(liveTrackFor(live, { index: 3, language: 'tam' }, 4), undefined);
  assert.equal(liveTrackFor(live, { index: 3, language: 'und' }, 4), undefined, 'untagged is no evidence');
  const twins = [{ language: 'en' }, { language: 'en' }, { language: 'hi' }];
  assert.equal(liveTrackFor(twins, { index: 0, language: 'eng' }, 5), undefined, 'two carry it: no guess');
});

test('enabling by id turns on exactly one track', () => {
  // Ids that are also positions: the old match enabled both "1" and index 1.
  const list = [
    { id: '1', enabled: true },
    { id: '2', enabled: false },
  ];
  assert.equal(enableLiveTrack(list, '1'), true);
  assert.deepEqual(list.map((t) => t.enabled), [true, false]);
  assert.equal(enableLiveTrack(list, '2'), true);
  assert.deepEqual(list.map((t) => t.enabled), [false, true]);
});

test('tracks without ids are addressed by position', () => {
  const list = [
    { id: '', enabled: true },
    { id: '', enabled: false },
  ];
  assert.equal(enableLiveTrack(list, 1), true);
  assert.deepEqual(list.map((t) => t.enabled), [false, true]);
});

test('an id nothing carries changes nothing', () => {
  const list = [{ id: '2', enabled: true }];
  assert.equal(enableLiveTrack(list, '9'), false);
  assert.deepEqual(list.map((t) => t.enabled), [true]);
  assert.equal(enableLiveTrack([], '1'), false);
});

test('a muxer handler name is not a label', () => {
  for (const name of ['SoundHandler', 'Sound Media Handler', 'GPAC ISO Audio Handler', 'Core Media Audio']) {
    assert.equal(liveTrackLabel(name), undefined, name);
  }
  assert.equal(liveTrackLabel('Hindi (Original)'), 'Hindi (Original)');
  assert.equal(liveTrackLabel('  '), undefined);
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

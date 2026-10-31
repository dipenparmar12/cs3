import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MediaMetadata, PlaybackStrategyType } from '../../../src/types/media';
import type { decideStrategy } from '../../media/decisionEngine.ts';
import { fmp4MediaSeconds, judgePlayback, playbackTiers, type PlayMeasurement } from './playbackEvidence.ts';

const META = { formatName: 'mp4', video: { codec: 'h264' }, audio: [], subtitles: [] } as unknown as MediaMetadata;
const NO_DRM = { type: 'none' as const };
const HOST = { hardware: false, accelerator: 'cpu' as const, logicalCores: 8 };

/** A decision engine that answers `off` and `auto` as told. */
function routes(off: PlaybackStrategyType, auto: PlaybackStrategyType = off): typeof decideStrategy {
  return ((_m, _t, _r, _h, _d, native) => ({
    strategy: native?.policy === 'auto' ? auto : off,
    plan: {} as never,
    directPlayable: false,
    explanation: '',
  })) as typeof decideStrategy;
}

const tiers = (request: Parameters<typeof playbackTiers>[4], decide: typeof decideStrategy, mpv = true) =>
  playbackTiers(META, 'progressive', NO_DRM, HOST, request, mpv, decide);

test('each source plays on the tier its route names', () => {
  assert.deepEqual(tiers('all', routes('DIRECT')).run.map((t) => t.tier), ['element']);
  assert.deepEqual(tiers('all', routes('HLS_NATIVE')).run.map((t) => t.tier), ['element']);
  assert.deepEqual(tiers('all', routes('REMUX_CONTAINER')).run.map((t) => t.tier), ['ffmpeg']);
  assert.deepEqual(tiers('all', routes('FULL_TRANSCODE', 'NATIVE_MPV')).run.map((t) => t.tier), ['ffmpeg', 'mpv']);
  assert.deepEqual(tiers('none', routes('DIRECT')).run, []);
});

test('mpv asked for alone plays every source; without mpv it cannot', () => {
  assert.deepEqual(tiers('mpv', routes('DIRECT')).run.map((t) => t.tier), ['mpv']);
  assert.equal(tiers('mpv', routes('DIRECT'), false).unrun?.reason, 'host-capability-absent');
});

test('a route the audit cannot drive is named, and a flag that leaves it out is a skip', () => {
  assert.deepEqual(tiers('all', routes('DASH_NATIVE')).unrun, { strategy: 'DASH_NATIVE', reason: 'host-capability-absent' });
  assert.deepEqual(tiers('element', routes('REMUX_CONTAINER')).unrun, { strategy: 'REMUX_CONTAINER', reason: 'stage-filter' });
});

const played = (over: Partial<PlayMeasurement>): PlayMeasurement => ({
  tier: 'element',
  playedSeconds: 5,
  startMs: 900,
  wallMs: 6000,
  budgetSpent: false,
  expectVideo: true,
  width: 1280,
  height: 720,
  ...over,
});

test('two seconds of playhead with a picture is a pass', () => {
  assert.equal(judgePlayback(played({})).outcome, 'pass');
  assert.equal(judgePlayback(played({ playedSeconds: 1.9 })).outcome, 'inconclusive');
  assert.equal(judgePlayback(played({ width: 0 })).outcome, 'fail');
  assert.equal(judgePlayback(played({ width: undefined, expectVideo: false })).outcome, 'pass');
});

test('a decoder error fails; a network error, a spent budget or no start are not one run’s verdict', () => {
  const decode = judgePlayback(played({ playedSeconds: 0, error: { kind: 'decode', message: 'PIPELINE_ERROR_DECODE' } }));
  assert.equal(decode.outcome, 'fail');
  assert.equal(judgePlayback(played({ playedSeconds: 0, error: { kind: 'network', message: 'x' } })).reason, 'network-flaky');
  assert.equal(judgePlayback(played({ playedSeconds: 0, budgetSpent: true, error: { kind: 'decode', message: 'x' } })).reason, 'budget-exhausted');
  assert.equal(judgePlayback(played({ playedSeconds: 0 })).reason, 'network-flaky');
});

test('a conversion slower than realtime is the machine, not the source', () => {
  const slow = judgePlayback(played({ tier: 'ffmpeg', playedSeconds: 3, startMs: 2000, wallMs: 12_000 }));
  assert.equal(slow.reason, 'host-capability-absent');
  assert.equal(slow.evidence.realtime, 0.3);
  assert.equal(judgePlayback(played({ tier: 'ffmpeg', playedSeconds: 30, startMs: 2000, wallMs: 12_000, width: undefined })).outcome, 'pass');
});

// --- a fragmented MP4, built box by box -----------------------------------------------------------

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
}

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function trak(trackId: number, timescale: number, handler: string): Uint8Array {
  return box(
    'trak',
    box('tkhd', words(0, 0, 0, trackId)),
    box('mdia', box('mdhd', words(0, 0, 0, timescale)), box('hdlr', words(0, 0), ascii(handler)))
  );
}

const MOOV = box('moov', trak(1, 48_000, 'soun'), trak(2, 12_800, 'vide'));

/** One fragment per track: 1 s of video (12 800 ticks), and half a second of audio, so the tracks disagree. */
function fragment(index: number): Uint8Array {
  const video = box(
    'traf',
    box('tfhd', words(0x08, 2, 512)),
    box('tfdt', words(0, index * 12_800)),
    box('trun', words(0, 25))
  );
  const audio = box('traf', box('tfhd', words(0, 1)), box('tfdt', words(0, index * 48_000)), box('trun', words(0x100, 1, 24_000)));
  return concat(box('moof', audio, video), box('mdat', new Uint8Array(64)));
}

test('media seconds come from the video track’s whole fragments', () => {
  const file = concat(MOOV, fragment(0), fragment(1), fragment(2));
  assert.equal(fmp4MediaSeconds(file), 3);
  // A fragment whose samples were cut off has not been delivered.
  assert.equal(fmp4MediaSeconds(file.subarray(0, file.length - 10)), 2);
  assert.equal(fmp4MediaSeconds(MOOV), null);
  assert.equal(fmp4MediaSeconds(new Uint8Array(0)), null);
});

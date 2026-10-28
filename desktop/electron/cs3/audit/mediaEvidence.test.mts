import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MediaMetadata } from '../../../src/types/media';
import { isPlayableAudioCodec } from '../../media/decisionEngine.ts';
import { ROUTE_PROFILES, judgeInspection, judgeRoute } from './mediaEvidence.ts';

function meta(audioCodecs: string[], videoCodec = 'h264', formatName = 'mov,mp4,m4a,3gp,3g2,mj2'): MediaMetadata {
  return {
    formatName,
    durationSeconds: 5400,
    video: { index: 0, codec: videoCodec, bitDepth: 8, pixelFormat: 'yuv420p', width: 1920, height: 1080, frameRate: 24, isHdr: false },
    // `playable` as the inspector stamps it.
    audio: audioCodecs.map((codec, index) => ({ index: index + 1, codec, channels: 2, language: 'eng', playable: isPlayableAudioCodec(codec) })),
    subtitles: [],
  } as unknown as MediaMetadata;
}

const inspection = (metadata: MediaMetadata | null, over = {}) => ({
  metadata,
  transport: 'progressive' as const,
  drm: { type: 'none' as const },
  timedOut: false,
  probeIncomplete: false,
  probeBytesTransferred: 1000,
  ...over,
});

test('an inspected source records its streams; a spent budget is inconclusive, not a failure', () => {
  const pass = judgeInspection(inspection(meta(['aac'])), false);
  assert.equal(pass.outcome, 'pass');
  assert.deepEqual((pass.evidence.video as { width: number }).width, 1920);
  assert.equal((pass.evidence.audio as unknown[]).length, 1);
  assert.equal(judgeInspection(inspection(null), true).reason, 'budget-exhausted');
  assert.equal(judgeInspection(inspection(null, { timedOut: true }), false).reason, 'network-flaky');
  assert.equal(judgeInspection(inspection(null, { error: 'Invalid data found' }), false).outcome, 'fail');
});

test('the profile matrix asks the real decision engine for every machine', () => {
  assert.equal(ROUTE_PROFILES.length, 8);
  const judged = judgeRoute(meta(['aac']), 'progressive', { type: 'none' });
  assert.equal(judged.outcome, 'pass');
  assert.equal(Object.keys(judged.evidence.strategies as object).length, 8);
  assert.equal((judged.evidence.strategies as Record<string, string>)['plain/software/off'], 'DIRECT');
});

test('HEVC flips between profiles, and the flip is recorded', () => {
  const judged = judgeRoute(meta(['aac'], 'hevc'), 'progressive', { type: 'none' });
  assert.equal(judged.evidence.flips, true);
});

test('a broken promise fails the stage: deaf audio sent DIRECT, DRM sent to ffmpeg', () => {
  const direct = () => ({ strategy: 'DIRECT' as const, directPlayable: true, plan: {} as never, explanation: '' });
  const remux = () => ({ strategy: 'REMUX_CONTAINER' as const, directPlayable: false, plan: {} as never, explanation: '' });
  assert.equal(judgeRoute(meta(['eac3']), 'progressive', { type: 'none' }, direct).outcome, 'fail');
  assert.equal(judgeRoute(meta(['eac3', 'aac']), 'progressive', { type: 'none' }, direct).outcome, 'pass');
  assert.equal(judgeRoute(meta(['aac']), 'dash', { type: 'widevine' } as never, remux).outcome, 'fail');
  // And the shipping engine keeps the promise.
  assert.equal(judgeRoute(meta(['eac3']), 'progressive', { type: 'none' }).outcome, 'pass');
});

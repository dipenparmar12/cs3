/**
 * `prepare` answers the question it was asked: the same stream, asked for in
 * another language, is a different verdict.
 *
 *   bun run test playbackEngine
 *
 * The capability cache was keyed on the URL alone. For an HLS stream carrying
 * four languages in its segments (Castle TV), the English verdict is
 * `HLS_NATIVE` — hls.js, which plays only the first — and picking Hindi in the
 * player was answered from that cache in 2 ms with the same English stream.
 * Measured in the running app on 2026-10-15; this pins it.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import { PlaybackEngine } from './playbackEngine.ts';
import { MediaProxy } from '../mediaProxy.ts';
import { MediaTranscoder } from '../mediaTranscoder.ts';
import type { BinaryDownloader } from '../binaryDownloader.ts';
import type { HostEncodeCapability } from '../../src/types/media.ts';

const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:12',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXTINF:4.680000,',
  'https://cdn.example/castle/0.jpg',
  '#EXTINF:4.280000,',
  'https://cdn.example/castle/1.jpg',
  '#EXT-X-ENDLIST',
].join('\n');
const SEGMENT = new Uint8Array(
  fs.readFileSync(new URL('./fixtures/castle-tv-4audio-head.m2ts', import.meta.url))
);
const GPU: HostEncodeCapability = { hardware: true, accelerator: 'qsv', logicalCores: 8 };

const opened: Array<{ shutdown(): void }> = [];
// Their loopback servers would keep the process alive past the last test.
after(() => opened.forEach((server) => server.shutdown()));

function engine() {
  const proxy = new MediaProxy(async () =>
    new Response(PLAYLIST, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } })
  );
  const transcoder = new MediaTranscoder({ resolveBinary: () => 'ffmpeg' } as unknown as BinaryDownloader);
  transcoder.hostCapability = async () => GPU;
  opened.push(proxy, transcoder);
  const playback = new PlaybackEngine({
    proxy,
    transcoder,
    nativeEngine: () => ({ available: false, policy: 'off' }),
    fetchText: async () => PLAYLIST,
    fetchBytes: async () => SEGMENT,
    describeUnreadable: async () => ({ reason: 'unreadable', dead: false }),
    diagnostics: { record() {} },
  });
  playback.setCapabilities({ video: { h264: true, vp9: true, av1: true, hevc: false, hevc10: false } });
  return playback;
}

const URL_ = 'https://cdn.example/castle/index_366.m3u8';

test('the same stream asked for in another language is not answered from the cache', async () => {
  const playback = engine();
  const english = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'eng' });
  assert.equal(english.capability.requiredStrategy, 'HLS_NATIVE');

  const hindi = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  assert.equal(hindi.capability.requiredStrategy, 'REMUX_CONTAINER');
  assert.equal(hindi.capability.transformationPlan.selectedAudioIndex, 1);
  assert.ok(hindi.sessionId, 'the Hindi track needs a conversion session');

  // And back: a cached Hindi verdict must not answer English either.
  const again = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'eng' });
  assert.equal(again.capability.requiredStrategy, 'HLS_NATIVE');
});

test('a converted HLS title has the length its playlist states', async () => {
  const hindi = await engine().prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  assert.equal(hindi.capability.metadata?.durationSeconds, 4.68 + 4.28);
});

test('the forced conversion keeps the chosen track', async () => {
  const forced = await engine().prepare({
    url: URL_,
    isM3u8: true,
    preferredAudioLanguage: 'tam',
    force: true,
    refresh: true,
  });
  assert.equal(forced.capability.requiredStrategy, 'FULL_TRANSCODE');
  assert.equal(forced.capability.transformationPlan.selectedAudioIndex, 2);
});

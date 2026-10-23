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

type FetchBytes = (url: string, bytes: number) => Promise<Uint8Array | null>;

function engine(options: { fetchBytes?: FetchBytes; inspections?: unknown } = {}) {
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
    fetchBytes: options.fetchBytes ?? (async () => SEGMENT),
    describeUnreadable: async () => ({ reason: 'unreadable', dead: false }),
    diagnostics: { record() {} },
    ...(options.inspections ? { inspections: options.inspections as never } : {}),
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

test('a track picked by index is not answered from the default-track verdict', async () => {
  // The player's menu re-prepares with the index it was given. Keyed without
  // it, the second pick would be answered with the first verdict (hls.js, the
  // first language) exactly as the language once was.
  const playback = engine();
  const first = await playback.prepare({ url: URL_, isM3u8: true });
  assert.equal(first.capability.requiredStrategy, 'HLS_NATIVE');

  const tamil = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioIndex: 2 });
  assert.equal(tamil.capability.requiredStrategy, 'REMUX_CONTAINER');
  assert.equal(tamil.capability.transformationPlan.selectedAudioIndex, 2);
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

/**
 * Castle TV, 2026-10-20: a segment read that failed once decided "one language"
 * for the stream. The manifest's guess (one audio track, no video) was stored as
 * a measurement, and every later switch to Hindi was answered `HLS_NATIVE` from
 * it — audio never changed, and the menu never offered the other languages.
 */
function memoryInspections() {
  const stored = new Map<string, unknown>();
  return {
    stored,
    read: (key: string) => (stored.get(key) as never) ?? null,
    write: (key: string, metadata: unknown, transport: unknown, drm: unknown) => {
      stored.set(key, { metadata, transport, drm });
    },
  };
}

test('a segment read that fails once is retried, and the languages are found', async () => {
  let calls = 0;
  const playback = engine({
    fetchBytes: async () => (++calls === 1 ? null : SEGMENT),
  });
  const hindi = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  assert.equal(hindi.capability.requiredStrategy, 'REMUX_CONTAINER');
  assert.equal(hindi.capability.transformationPlan.selectedAudioIndex, 1);
  assert.equal(hindi.capability.languagesUnverified, undefined);
});

test('an unreadable segment is flagged and is neither cached nor persisted', async () => {
  const inspections = memoryInspections();
  const playback = engine({ fetchBytes: async () => null, inspections });
  const first = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  assert.equal(first.capability.languagesUnverified, true, 'the answer is a guess and says so');
  assert.equal(inspections.stored.size, 0, 'a guess is not stored as a measurement');
});

test('after an unreadable segment, the next ask measures again and finds every language', async () => {
  const inspections = memoryInspections();
  let readable = false;
  const playback = engine({
    fetchBytes: async () => (readable ? SEGMENT : null),
    inspections,
  });
  const guess = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  assert.equal(guess.capability.requiredStrategy, 'HLS_NATIVE');

  readable = true;
  const measured = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  assert.equal(measured.capability.requiredStrategy, 'REMUX_CONTAINER');
  assert.equal(measured.capability.metadata?.audio.length, 4);
  assert.equal(measured.capability.transformationPlan.selectedAudioIndex, 1);
  assert.equal(inspections.stored.size, 1, 'a real measurement is stored');
});

test('a session is recorded once, when the next one replaces it or it is closed', async () => {
  // PRD-40.1 §4.3: exactly one record per session at its terminal state.
  const playback = engine();
  await playback.prepare({ url: URL_, isM3u8: true });
  assert.equal(playback.getTelemetry().length, 0, 'a session still playing has no terminal state');

  const hindi = await playback.prepare({ url: URL_, isM3u8: true, preferredAudioLanguage: 'hin' });
  const [first] = playback.getTelemetry();
  assert.equal(playback.getTelemetry().length, 1);
  assert.equal(first.terminalState, 'engine-switch');
  assert.equal(first.selectedEngine, 'hlsjs');
  assert.equal(first.inspectionStrategy, 'manifest-hls');

  playback.close(hindi.sessionId);
  playback.close(hindi.sessionId);
  const records = playback.getTelemetry();
  assert.equal(records.length, 2, 'closing twice records once');
  assert.equal(records[1].terminalState, 'user-abort');
  assert.equal(records[1].selectedStrategy, 'REMUX_CONTAINER');
  assert.equal(records[1].sessionId, hindi.sessionId);
});

/**
 * HLS whose audio languages are muxed inside the segments (Castle TV, CNC
 * Verse): found from the first segment, offered, and switched by remux.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { firstPlaylistEntry, hlsPlaylistDuration, parseHlsManifest, withSegmentStreams } from './mediaInspector.ts';
import { readTsStreams } from './tsProgram.ts';
import { decideStrategy } from './decisionEngine.ts';
import type { HostEncodeCapability, RendererCapabilities } from '../../src/types/media.ts';

// The playlist's shape as served: a media playlist, no #EXT-X-MEDIA, no CODECS,
// segments named .jpg. Segment URLs are loopback once the proxy rewrites them.
const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:12',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXTINF:4.680000,',
  'http://127.0.0.1:5000/stream/abc/0.jpg',
  '#EXTINF:4.280000,',
  'http://127.0.0.1:5000/stream/abc/1.jpg',
  '#EXT-X-ENDLIST',
].join('\n');
const BASE = 'http://127.0.0.1:5000/stream/abc/index.m3u8';
const streams = readTsStreams(
  new Uint8Array(fs.readFileSync(new URL('./fixtures/castle-tv-4audio-head.m2ts', import.meta.url)))
)!;

const GPU: HostEncodeCapability = { hardware: true, accelerator: 'qsv', logicalCores: 8 };
const PLAIN: RendererCapabilities = { video: { h264: true, vp9: true, av1: true, hevc: false, hevc10: false } };

test('the next place to look: first segment of a media playlist, first variant of a master', () => {
  assert.deepEqual(firstPlaylistEntry(PLAYLIST, BASE), { kind: 'segment', url: 'http://127.0.0.1:5000/stream/abc/0.jpg' });
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1600000\nhigh/index.m3u8\n';
  assert.deepEqual(firstPlaylistEntry(master, 'https://cdn.example/x/master.m3u8'), {
    kind: 'variant',
    url: 'https://cdn.example/x/low/index.m3u8',
  });
  assert.equal(firstPlaylistEntry('#EXTM3U\n', BASE), null);
});

test('the manifest alone invents one track; the segment knows four', () => {
  const manifestOnly = parseHlsManifest(PLAYLIST)!;
  assert.equal(manifestOnly.audio.length, 1);

  const measured = withSegmentStreams(manifestOnly, streams, PLAYLIST);
  assert.deepEqual(measured.audio.map((a) => a.language), ['eng', 'hin', 'tam', 'tel']);
  assert.deepEqual(measured.audio.map((a) => a.index), [0, 1, 2, 3]);
  assert.equal(measured.audioMuxedInSegments, true);
  // No CODECS in the playlist: the video codec is the segment's, measured.
  assert.equal(measured.video?.codec, 'h264');
});

test('a declared CODECS keeps the manifest video; one audio stream is not "muxed languages"', () => {
  const declared = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1.2.4.L120,mp4a.40.2"\nv.m3u8\n';
  const fromMaster = withSegmentStreams(parseHlsManifest(declared)!, streams, declared);
  assert.equal(fromMaster.video?.codec, 'hevc');
  const single = withSegmentStreams(parseHlsManifest(PLAYLIST)!, streams.slice(0, 2), PLAYLIST);
  assert.equal(single.audioMuxedInSegments, undefined);
});

test('the first language goes to hls.js untouched; any other is remuxed, never re-encoded', () => {
  const meta = withSegmentStreams(parseHlsManifest(PLAYLIST)!, streams, PLAYLIST);

  const english = decideStrategy(meta, 'hls', PLAIN, GPU, undefined, undefined, 'eng');
  assert.equal(english.strategy, 'HLS_NATIVE');

  const hindi = decideStrategy(meta, 'hls', PLAIN, GPU, undefined, undefined, 'hin');
  assert.equal(hindi.strategy, 'REMUX_CONTAINER');
  assert.equal(hindi.plan.videoAction, 'copy');
  assert.equal(hindi.plan.audioAction, 'copy');
  assert.equal(hindi.plan.selectedAudioIndex, 1);
  // ADTS AAC out of TS needs aac_adtstoasc in MP4; the transcoder reads this.
  assert.equal(hindi.plan.copiedAudioCodec, 'aac');

  assert.equal(decideStrategy(meta, 'hls', PLAIN, GPU, undefined, undefined, 'tel').plan.selectedAudioIndex, 3);
});

test('a multi-audio file plays the remembered language, not the file default (remux, copy)', () => {
  const file = {
    formatName: 'matroska,webm',
    video: { index: 0, codec: 'h264', bitDepth: 8, pixelFormat: 'yuv420p', width: 1920, height: 1080, frameRate: 24, isHdr: false, isInterlaced: false },
    audio: [
      { index: 0, codec: 'aac', channels: 2, language: 'eng', isDefault: true, isForced: false, playable: true },
      { index: 1, codec: 'aac', channels: 2, language: 'hin', isDefault: false, isForced: false, playable: true },
    ],
    subtitles: [],
  };
  const caps = { ...PLAIN, containers: { mkv: true } } as RendererCapabilities;
  const english = decideStrategy(file, 'progressive', caps, GPU, undefined, undefined, 'eng');
  const hindi = decideStrategy(file, 'progressive', caps, GPU, undefined, undefined, 'hin');
  // Whatever the default route is for English, Hindi must not be handed to the element.
  assert.notEqual(hindi.strategy, 'DIRECT');
  assert.equal(hindi.plan.selectedAudioIndex, 1);
  if (hindi.strategy === 'REMUX_CONTAINER') assert.equal(hindi.plan.videoAction, 'copy');
  assert.equal(english.plan.selectedAudioIndex, 0);
});

test('a finished playlist states its own length; a live or cut-short one does not', () => {
  // PLAYLIST above is the served shape: two segments and #EXT-X-ENDLIST.
  assert.equal(hlsPlaylistDuration(PLAYLIST), 4.68 + 4.28);
  assert.equal(parseHlsManifest(PLAYLIST)!.durationSeconds, 4.68 + 4.28);
  // A live window, or a 64 KB read that stopped before the end, is not a length.
  const live = PLAYLIST.replace('#EXT-X-ENDLIST', '');
  assert.equal(hlsPlaylistDuration(live), undefined);
  assert.equal(parseHlsManifest(live)!.durationSeconds, undefined);
  // A master playlist has no segments of its own.
  assert.equal(hlsPlaylistDuration('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n'), undefined);
});

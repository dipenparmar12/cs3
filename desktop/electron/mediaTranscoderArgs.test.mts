/**
 * The ffmpeg arguments for a session with a separate audio address (YouTube
 * trailers: a DASH video rung and a DASH audio rung muxed by stream copy).
 *
 * Input options apply to the next `-i` only, so each input needs its own
 * reconnect options and its own `-ss`. Pure: nothing is spawned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaTranscoder } from './mediaTranscoder.ts';
import type { BinaryDownloader } from './binaryDownloader.ts';

const transcoder = new MediaTranscoder({ resolveBinary: () => 'ffmpeg' } as unknown as BinaryDownloader);

const session = {
  url: 'http://127.0.0.1:5000/stream/1',
  audioUrl: 'http://127.0.0.1:5000/stream/2',
  transport: 'progressive' as const,
  plan: {
    videoAction: 'copy',
    audioAction: 'copy',
    selectedAudioIndex: 0,
    containerAction: 'mp4_fragmented',
    subtitleAction: 'ignore',
  },
} as unknown as Parameters<MediaTranscoder['buildArgs']>[0];

/** The options written between the previous `-i` (or the start) and this input's `-i`. */
function optionsBefore(args: string[], input: string): string[] {
  const at = args.indexOf(input);
  assert.ok(at > 0 && args[at - 1] === '-i', `${input} is not an input`);
  let start = at - 2;
  while (start >= 0 && args[start - 1] !== '-i') start--;
  return args.slice(Math.max(0, start + 1), at - 1);
}

test('the audio input reconnects after a dropped connection, like the video input', () => {
  const args = transcoder.buildArgs(session, 0);
  const audio = optionsBefore(args, session.audioUrl!);
  assert.ok(audio.includes('-reconnect'), `audio input options: ${audio.join(' ')}`);
  assert.ok(audio.includes('-reconnect_streamed'));
  assert.ok(audio.includes('-reconnect_at_eof'));
  const video = args.slice(0, args.indexOf(session.url));
  assert.ok(video.includes('-reconnect'));
});

test('a seek is applied to both inputs, so the audio starts where the video does', () => {
  const args = transcoder.buildArgs(session, 42);
  const audio = optionsBefore(args, session.audioUrl!);
  assert.deepEqual(audio.slice(audio.indexOf('-ss'), audio.indexOf('-ss') + 2), ['-ss', '42']);
  const video = args.slice(0, args.indexOf(session.url));
  assert.ok(video.includes('-ss'));
});

test('no seek, no -ss on either input (vacuous case)', () => {
  const args = transcoder.buildArgs(session, 0);
  assert.equal(args.includes('-ss'), false);
});

test('a session without separate audio has exactly one input', () => {
  const args = transcoder.buildArgs({ ...session, audioUrl: undefined }, 0);
  assert.equal(args.filter((arg) => arg === '-i').length, 1);
});

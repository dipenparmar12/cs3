/**
 * The compatibility engine against real ffmpeg, on real files.
 *
 *   bun run test:pipeline
 *   node --experimental-strip-types electron/media/pipeline.test.mts
 *
 * `decisionEngine.test.mts` asserts the *decision* from hand-written metadata.
 * This asserts the two halves either side of it, which that one cannot reach:
 * that ffprobe's real output parses into the metadata the decision expects, and
 * that the arguments built from a plan produce a stream Chromium can actually
 * decode. Those are the two places a change breaks silently — a renamed ffprobe
 * field yields `codec: ''` and every file classifies as playable, and a bad
 * filter argument yields an ffmpeg that exits 1 into a pipe nobody is reading.
 *
 * Fixtures are **synthesised, not downloaded**. The PRD-38 corpus is 25 GB
 * files behind expiring provider links; a five-second colour bar with the same
 * container and codec combination exercises exactly the same code paths and can
 * be regenerated on any machine in about a second.
 *
 * Skips itself when ffmpeg is not installed, because it is a real dependency
 * fetched on first use rather than something a checkout has.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { MediaInspector, detectExtensionPicky } from './mediaInspector.ts';
import { runTool } from './runTool.ts';
import { MediaTranscoder } from '../mediaTranscoder.ts';
import type { BinaryDownloader } from '../binaryDownloader.ts';
import { decideStrategy, planForAudioTrack } from './decisionEngine.ts';
import type { HostEncodeCapability, RendererCapabilities } from '../../src/types/media.ts';

// --- binaries --------------------------------------------------------------

function findBinary(name: string): string | null {
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'CloudStream 3 Desktop', 'bin', `${name}.exe`),
    path.join(process.env.APPDATA ?? '', 'CloudStream 3 Desktop', 'bin', name),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const found = execFileSync(which, [name], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    return found || null;
  } catch {
    return null;
  }
}

const FFMPEG = findBinary('ffmpeg');
const FFPROBE = findBinary('ffprobe');

if (!FFMPEG || !FFPROBE) {
  console.log('  skip  ffmpeg/ffprobe are not installed; media pipeline tests skipped');
  process.exit(0);
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-media-'));

/** Colour bars with a tone, in whatever container and codecs are asked for. */
function synthesise(name: string, args: string[]): string {
  const target = path.join(WORK, name);
  execFileSync(
    FFMPEG!,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      ...args,
      target,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  return target;
}

function probeJson(file: string): Record<string, unknown> {
  const raw = execFileSync(
    FFPROBE!,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { encoding: 'utf8', maxBuffer: 8 << 20 }
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

// --- harness ---------------------------------------------------------------

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const inspector = new MediaInspector(
  () => FFPROBE,
  async () => null // No manifests here; every fixture is a local file.
);

/**
 * The real transcoder, given only the one method it uses from the downloader.
 *
 * `BinaryDownloader` owns downloads, checksums and a settings surface, none of
 * which this exercises; standing a real one up would make the test depend on
 * the network. The cast is narrow and deliberate.
 */
const transcoder = new MediaTranscoder({
  resolveBinary: (name: string) => (name === 'ffmpeg' ? FFMPEG : FFPROBE),
} as unknown as BinaryDownloader);

const PLAIN: RendererCapabilities = {
  video: { h264: true, vp9: true, av1: true, hevc: false, hevc10: false },
};

/** A build with platform HEVC decoders — the case that reaches the copy path. */
const HEVC_HOST_CAPS: RendererCapabilities = {
  video: { h264: true, vp9: true, av1: true, hevc: true, hevc10: true },
};
const CPU_HOST: HostEncodeCapability = { hardware: false, accelerator: 'cpu', logicalCores: 8 };

/** Runs the whole chain and returns the converted bytes plus what they contain. */
async function convert(file: string, caps = PLAIN, host = CPU_HOST) {
  const inspection = await inspector.inspect(file);
  assert.ok(inspection.metadata, `inspection failed for ${path.basename(file)}: ${inspection.error}`);
  const decision = decideStrategy(inspection.metadata, inspection.transport, caps, host);

  const url = await transcoder.createSession(file, decision.plan, inspection.transport);
  assert.ok(url, 'a transcode session should have opened');

  const response = await fetch(url!);
  assert.equal(response.status, 200, 'the loopback server should answer 200');
  const bytes = Buffer.from(await response.arrayBuffer());

  const out = path.join(WORK, `out-${path.basename(file)}.mp4`);
  fs.writeFileSync(out, bytes);
  transcoder.closeSession(url!.split('/').pop()!);
  return { inspection, decision, bytes, result: probeJson(out) };
}

type Stream = {
  codec_type?: string;
  codec_name?: string;
  /** The MP4 sample entry — `avc1`, `hev1`, `hvc1`. The HEVC one decides playability. */
  codec_tag_string?: string;
  pix_fmt?: string;
  channels?: number;
  height?: number;
};
const streamsOf = (probe: Record<string, unknown>) => (probe.streams ?? []) as Stream[];
const videoOf = (probe: Record<string, unknown>) =>
  streamsOf(probe).find((s) => s.codec_type === 'video');
const audioOf = (probe: Record<string, unknown>) =>
  streamsOf(probe).find((s) => s.codec_type === 'audio');

// --- inspection accuracy ---------------------------------------------------

test('ffprobe output parses into the metadata the decision engine expects', async () => {
  const file = synthesise('h264-aac.mkv', [
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const { metadata } = await inspector.inspect(file);
  assert.ok(metadata);
  assert.equal(metadata!.formatName.includes('matroska'), true);
  assert.equal(metadata!.video?.codec, 'h264');
  assert.equal(metadata!.video?.bitDepth, 8);
  assert.equal(metadata!.video?.width, 640);
  assert.equal(metadata!.video?.height, 360);
  assert.equal(metadata!.audio.length, 1);
  assert.equal(metadata!.audio[0].codec, 'aac');
  assert.equal(metadata!.audio[0].channels, 2);
  assert.equal(metadata!.audio[0].index, 0);
});

test('10-bit HEVC is reported as 10-bit, not as HEVC', async () => {
  // The distinction the whole guard rests on: a build that decodes 8-bit HEVC
  // answers yes to a plain HEVC probe and then fails on Main 10.
  const file = synthesise('hevc10.mkv', [
    '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-preset', 'ultrafast', '-x265-params', 'log-level=none',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const { metadata } = await inspector.inspect(file);
  assert.equal(metadata?.video?.codec, 'hevc');
  assert.equal(metadata?.video?.bitDepth, 10);
  assert.equal(metadata?.video?.pixelFormat, 'yuv420p10le');
});

test('audio ordinals are counted among audio streams, not all streams', async () => {
  // `-map 0:a:N` takes the audio ordinal. Using ffprobe's `stream.index` would
  // silently select the wrong track on any file whose video is not last.
  const file = synthesise('multi-audio.mkv', [
    '-map', '0:v', '-map', '1:a', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a:0', 'aac', '-ac:a:0', '2', '-metadata:s:a:0', 'language=eng',
    '-c:a:1', 'ac3', '-ac:a:1', '6', '-metadata:s:a:1', 'language=hin',
    '-shortest',
  ]);
  const { metadata } = await inspector.inspect(file);
  assert.equal(metadata?.audio.length, 2);
  assert.deepEqual(metadata?.audio.map((a) => a.index), [0, 1]);
  assert.equal(metadata?.audio[0].language, 'eng');
  assert.equal(metadata?.audio[1].codec, 'ac3');
  assert.equal(metadata?.audio[1].channels, 6);
  assert.equal(metadata?.audio[1].playable, false);
});

test('embedded subtitle tracks are listed and classified', async () => {
  const srt = path.join(WORK, 'sub.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\nhello\n\n');
  const target = path.join(WORK, 'with-subs.mkv');
  execFileSync(
    FFMPEG!,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-i', srt,
      '-map', '0:v', '-map', '1:a', '-map', '2:s',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-c:s', 'srt', '-shortest',
      target,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const { metadata } = await inspector.inspect(target);
  assert.equal(metadata?.subtitles.length, 1);
  assert.equal(metadata?.subtitles[0].codec, 'subrip');
  assert.equal(metadata?.subtitles[0].isBitmap, false);
});

// --- execution: the plan produces something decodable ----------------------

test('MKV / H.264 / AAC is remuxed to fragmented MP4 with both streams intact', async () => {
  const file = synthesise('remux.mkv', [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const { decision, bytes, result } = await convert(file);
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.ok(bytes.length > 10_000, `expected real output, got ${bytes.length} bytes`);
  // `ftyp` is the first box of any MP4; its absence means ffmpeg wrote an error.
  assert.equal(bytes.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.equal(videoOf(result)?.codec_name, 'h264');
  assert.equal(audioOf(result)?.codec_name, 'aac');
});

test('HEVC copied into MP4 carries the hvc1 tag a browser will accept', async () => {
  /**
   * The one failure in this file that exit codes cannot catch, and the reason
   * it is asserted on the bytes rather than on the process.
   *
   * HEVC has two MP4 sample entries. `hev1` keeps parameter sets in-band;
   * `hvc1` puts them in the sample description, and **browsers accept only
   * `hvc1`**. ffmpeg's muxer defaults to `hev1` when copying, so the remux
   * exits 0, produces a structurally valid MP4 with the right codecs in it, and
   * plays nothing at all.
   *
   * It is the exact mismatch the capability probe sets up: `VIDEO_CODEC_PROBES`
   * asks about `hvc1.1.6.L93.B0`, and a build that says yes to that was then
   * handed `hev1`. Measured on the bundled ffmpeg before the fix: `hev1`.
   */
  const file = synthesise('hevc-remux.mkv', [
    '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-x265-params', 'log-level=none',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const { decision, bytes, result } = await convert(file, HEVC_HOST_CAPS);
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.videoTag, 'hvc1');
  assert.equal(bytes.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.equal(videoOf(result)?.codec_name, 'hevc');
  assert.equal(
    videoOf(result)?.codec_tag_string,
    'hvc1',
    'hev1 mux is valid, plays in VLC, and shows nothing in a browser'
  );
});

test('VP8 is remuxed into WebM, and the output really is a WebM', async () => {
  /**
   * The failure this replaces was total, not partial. `ffmpeg -c:v copy -f mp4`
   * on a VP8 stream answers `Could not find tag for codec vp8 in stream #0,
   * codec not currently supported in container`, then `Could not write header`,
   * and exits having produced nothing — while every earlier step looked right,
   * because both codecs are ones the browser decodes.
   *
   * AVI as the wrapper on purpose: a Matroska carrying WebM-legal codecs *is* a
   * WebM to Chromium and plays directly, so it never reaches a remux at all.
   *
   * The assertion is on the bytes, not on ffmpeg's exit status. That is the
   * whole point — the sibling case (Vorbis into MP4) exits zero and produces a
   * file nothing can play.
   */
  const file = synthesise('vp8.avi', [
    '-c:v', 'libvpx', '-b:v', '200k', '-cpu-used', '8',
    '-c:a', 'libvorbis', '-shortest',
  ]);
  const { decision, bytes, result } = await convert(file);
  assert.equal(decision.plan.containerAction, 'webm');
  assert.ok(bytes.length > 1_000, `expected real output, got ${bytes.length} bytes`);
  // 0x1A45DFA3 is the EBML magic every Matroska/WebM file starts with. An MP4
  // would carry `ftyp` at offset 4 instead, and a failed mux carries nothing.
  assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3');
  assert.equal(videoOf(result)?.codec_name, 'vp8');
  assert.equal(audioOf(result)?.codec_name, 'vorbis');
});

test('Vorbis beside H.264 is re-encoded, because MP4 would carry it silently unplayed', async () => {
  /**
   * The dangerous half: ffmpeg writes Vorbis into MP4 without complaint, so
   * exit status says success, and Chromium plays no audio from the result
   * because Vorbis is a WebM/Ogg codec there. Nothing downstream could have
   * caught it — the file is well-formed.
   */
  const file = synthesise('vorbis.mkv', [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'libvorbis', '-shortest',
  ]);
  const { decision, result } = await convert(file);
  assert.equal(decision.plan.containerAction, 'mp4_fragmented');
  assert.notEqual(decision.plan.audioAction, 'copy');
  assert.equal(audioOf(result)?.codec_name, 'aac');
});

test('AC-3 audio becomes stereo AAC while the video is copied untouched', async () => {
  // The silent-audio bug, end to end. Video must stay bit-identical H.264 —
  // re-encoding it to reach stereo audio is the expensive mistake.
  const file = synthesise('ac3.mkv', [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'ac3', '-ac', '6', '-shortest',
  ]);
  const { decision, result } = await convert(file);
  assert.equal(decision.strategy, 'AUDIO_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(videoOf(result)?.codec_name, 'h264');
  assert.equal(audioOf(result)?.codec_name, 'aac');
  assert.equal(audioOf(result)?.channels, 2, 'multi-channel must be downmixed to stereo');
});

test('DTS audio becomes stereo AAC', async () => {
  const file = synthesise('dts.mkv', [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'dca', '-strict', '-2', '-ac', '6', '-shortest',
  ]);
  const { decision, result } = await convert(file);
  assert.equal(decision.plan.audioAction, 'transcode');
  assert.equal(audioOf(result)?.codec_name, 'aac');
  assert.equal(audioOf(result)?.channels, 2);
});

test('HEVC 10-bit comes back as 8-bit H.264 that Chromium can decode', async () => {
  const file = synthesise('hevc10-out.mkv', [
    '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-preset', 'ultrafast', '-x265-params', 'log-level=none',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const { decision, result } = await convert(file);
  assert.equal(decision.strategy, 'VIDEO_TRANSCODE');
  assert.equal(videoOf(result)?.codec_name, 'h264');
  assert.equal(videoOf(result)?.pix_fmt, 'yuv420p', '10-bit H.264 would be undecodable too');
  assert.equal(audioOf(result)?.codec_name, 'aac');
});

test('the software 4K guard actually scales the output', async () => {
  // Encoding 4K in the test would take longer than the whole suite, so this
  // asserts the filter is applied by checking the height of what came out.
  const file = synthesise('tall.mkv', [
    '-vf', 'scale=2560:1440',
    '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-x265-params', 'log-level=none',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const inspection = await inspector.inspect(file);
  assert.equal(inspection.metadata?.video?.height, 1440);

  const decision = decideStrategy(inspection.metadata!, 'progressive', PLAIN, CPU_HOST);
  assert.equal(decision.plan.videoAction, 'downscale');

  const url = await transcoder.createSession(file, decision.plan, 'progressive');
  const response = await fetch(url!);
  const out = path.join(WORK, 'downscaled.mp4');
  fs.writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  transcoder.closeSession(url!.split('/').pop()!);

  assert.equal(videoOf(probeJson(out))?.height, 1080);
});

test('a file with no audio produces video without an empty audio track', async () => {
  const target = path.join(WORK, 'silent.mkv');
  execFileSync(
    FFMPEG!,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      target,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const { decision, result } = await convert(target);
  assert.equal(decision.plan.selectedAudioIndex, -1);
  assert.equal(videoOf(result)?.codec_name, 'h264');
  assert.equal(audioOf(result), undefined);
});

test('a second audio track can be selected and is what comes out', async () => {
  const file = synthesise('switch.mkv', [
    '-map', '0:v', '-map', '1:a', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a:0', 'aac', '-ac:a:0', '2',
    '-c:a:1', 'ac3', '-ac:a:1', '6',
    '-shortest',
  ]);
  const inspection = await inspector.inspect(file);
  const decision = decideStrategy(inspection.metadata!, 'progressive', PLAIN, CPU_HOST);
  // Track 0 is playable AAC stereo, so that is what the engine picks.
  assert.equal(decision.plan.selectedAudioIndex, 0);

  const url = await transcoder.createSession(file, decision.plan, 'progressive');
  const token = url!.split('/').pop()!;

  /**
   * The plan is re-derived for the new track, not just re-indexed.
   *
   * Pointing the original copy-the-audio plan at track 1 made ffmpeg refuse
   * outright — `Cannot write moov atom before AC3 packets` — because AC-3 in MP4
   * takes its extradata from the first packet and a fragmented output writes its
   * header before one exists. The viewer sees that as "the Hindi dub is broken".
   */
  const target = inspection.metadata!.audio[1];
  assert.equal(transcoder.updatePlan(token, planForAudioTrack(decision.plan, target)), true);

  const response = await fetch(url!);
  const out = path.join(WORK, 'track1.mp4');
  fs.writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  transcoder.closeSession(token);

  const switched = audioOf(probeJson(out));
  assert.equal(switched?.codec_name, 'aac', '6-channel AC-3 must be re-encoded, not copied');
  assert.equal(switched?.channels, 2);
});

test('embedded SubRip is served as WebVTT', async () => {
  const srt = path.join(WORK, 'sub2.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\nfirst line\n\n2\n00:00:02,000 --> 00:00:04,000\nsecond line\n\n');
  const target = path.join(WORK, 'vtt-source.mkv');
  execFileSync(
    FFMPEG!,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-i', srt,
      '-map', '0:v', '-map', '1:a', '-map', '2:s',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-c:s', 'srt', '-shortest',
      target,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  const inspection = await inspector.inspect(target);
  const decision = decideStrategy(inspection.metadata!, 'progressive', PLAIN, CPU_HOST);
  assert.equal(decision.plan.subtitleAction, 'extract_webvtt');

  const url = await transcoder.createSession(target, decision.plan, 'progressive');
  const token = url!.split('/').pop()!;
  const vttUrl = transcoder.subtitleUrl(token, 0);
  assert.ok(vttUrl);

  const vtt = await (await fetch(vttUrl!)).text();
  transcoder.closeSession(token);
  // `<track>` rejects SubRip silently; WEBVTT is the only header it accepts.
  assert.equal(vtt.startsWith('WEBVTT'), true, `expected WebVTT, got: ${vtt.slice(0, 40)}`);
  assert.equal(vtt.includes('first line'), true);
});

test('seeking restarts the conversion at the requested time', async () => {
  const file = synthesise('seek.mkv', [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac', '-ac', '2', '-shortest',
  ]);
  const inspection = await inspector.inspect(file);
  const decision = decideStrategy(inspection.metadata!, 'progressive', PLAIN, CPU_HOST);
  const url = await transcoder.createSession(file, decision.plan, 'progressive');
  const token = url!.split('/').pop()!;

  const out = path.join(WORK, 'seeked.mp4');
  const response = await fetch(`${url}?t=2`);
  fs.writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  transcoder.closeSession(token);

  // A 4s source seeked to 2s yields roughly 2s. Bounded by the keyframe
  // interval, so the assertion is generous on purpose.
  const duration = Number((probeJson(out).format as { duration?: string })?.duration ?? 0);
  assert.ok(duration > 0.5 && duration < 3.5, `expected ~2s of output, got ${duration}s`);
});

/**
 * The image-named-segment case, end to end against the installed ffmpeg.
 *
 * This one earns a real fixture rather than a decision assertion because the
 * thing that broke was neither our decision nor our arguments — it was FFmpeg
 * changing what its own flag means. 7.1 added `-extension_picky`, defaulted it
 * to on, and it is evaluated *before* the allow-list, so `-allowed_extensions
 * ALL` became a no-op and every provider serving segments from `.png` or from
 * extensionless URLs failed again with the exact message the original fix was
 * written against. Nothing in this repository changed on the day that started
 * happening, which is why only a test that actually runs the binary can catch it.
 *
 * `Hdmovie2` is the provider that does this in the wild; the fixture reproduces
 * it locally so the assertion does not depend on a third-party CDN.
 */
test('HLS segments served as .png are probed, not refused', async () => {
  const dir = path.join(WORK, 'hls-png');
  fs.mkdirSync(dir, { recursive: true });
  const playlist = path.join(dir, 'index.m3u8');

  execFileSync(
    FFMPEG!,
    [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=6',
      '-f', 'lavfi', '-i', 'sine=duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
      // The whole point: segments that do not look like video.
      '-hls_segment_filename', path.join(dir, 'seg%d.png'),
      playlist,
    ],
    { stdio: 'ignore' }
  );

  /**
   * Served over HTTP rather than probed from disk. The refusal lives in the HLS
   * demuxer's URL handling, and a local path takes a different route through it
   * — a file-based fixture passes while the shipping path stays broken.
   */
  const server = http.createServer((request, response) => {
    const file = path.join(dir, path.basename((request.url ?? '/').split('?')[0]));
    if (!fs.existsSync(file)) {
      response.writeHead(404);
      return response.end();
    }
    // Deliberately not `video/*`: a CDN disguising segments as images says so.
    response.writeHead(200, { 'Content-Type': 'image/png' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    await detectExtensionPicky(FFPROBE!, (command, args, timeoutMs) =>
      runTool(command, args, timeoutMs)
    );

    const result = await inspector.inspect(`http://127.0.0.1:${port}/index.m3u8`);
    assert.equal(result.transport, 'hls');
    assert.ok(result.metadata, `probe failed: ${result.error}`);
    assert.equal(result.metadata?.video?.codec, 'h264');
    assert.equal(result.metadata?.audio[0]?.codec, 'aac');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

transcoder.shutdown();
fs.rmSync(WORK, { recursive: true, force: true });
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);

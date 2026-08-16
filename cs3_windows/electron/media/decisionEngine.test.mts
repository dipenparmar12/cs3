/**
 * The PRD-37 §7.2 and PRD-38 §3.1 compatibility matrices, as executable rows.
 *
 *   bun run test:media
 *   node --experimental-strip-types electron/media/decisionEngine.test.mts
 *
 * Same shape as `sharedDiscovery.test.mts`: Node strips the types itself, so
 * there is no framework, no transform and no config to keep working.
 *
 * This module earns tests for a specific reason. Every entry in the matrix was
 * *measured* — real files from real providers, probed with ffprobe and played
 * until they failed — and the cost of re-measuring one is a 25 GB download from
 * a CDN that may have expired the link. The measurements are cheap to encode and
 * expensive to reproduce, so they are encoded. A regression here is silent in the
 * worst way: choosing `-c:v copy` for a 10-bit HEVC file produces an MP4 that
 * downloads perfectly and plays nothing, which is indistinguishable from a bad
 * provider unless something is asserting the decision itself.
 */
import assert from 'node:assert/strict';
import type {
  AudioStreamMetadata,
  HostEncodeCapability,
  MediaMetadata,
  MediaTransport,
  RendererCapabilities,
  SubtitleStreamMetadata,
  VideoStreamMetadata,
} from '../../src/types/media.ts';
import {
  blindFallbackPlan,
  canPlayContainer,
  canPlayVideo,
  decideStrategy,
  isTenBitOrDeeper,
  selectAudioTrack,
} from './decisionEngine.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- fixtures --------------------------------------------------------------

function video(overrides: Partial<VideoStreamMetadata> = {}): VideoStreamMetadata {
  return {
    index: 0,
    codec: 'h264',
    profile: 'High',
    bitDepth: 8,
    pixelFormat: 'yuv420p',
    width: 1920,
    height: 1080,
    frameRate: 23.976,
    isHdr: false,
    isInterlaced: false,
    ...overrides,
  };
}

function audio(overrides: Partial<AudioStreamMetadata> = {}): AudioStreamMetadata {
  const codec = overrides.codec ?? 'aac';
  return {
    index: 0,
    codec,
    channels: 2,
    isDefault: true,
    isForced: false,
    playable: !['ac3', 'eac3', 'dts', 'truehd'].includes(codec),
    ...overrides,
  };
}

function subtitle(overrides: Partial<SubtitleStreamMetadata> = {}): SubtitleStreamMetadata {
  return {
    index: 0,
    codec: 'subrip',
    isDefault: false,
    isForced: false,
    isBitmap: false,
    ...overrides,
  };
}

function media(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    video: video(),
    audio: [audio()],
    subtitles: [],
    ...overrides,
  };
}

const GPU: HostEncodeCapability = { hardware: true, accelerator: 'qsv', logicalCores: 8 };
const CPU: HostEncodeCapability = { hardware: false, accelerator: 'cpu', logicalCores: 8 };
const BIG_CPU: HostEncodeCapability = { hardware: false, accelerator: 'cpu', logicalCores: 24 };

/** A renderer that decodes nothing exotic — the common Windows Electron build. */
const PLAIN: RendererCapabilities = {
  video: { h264: true, vp9: true, av1: true, hevc: false, hevc10: false },
};
/** A build with platform HEVC decoders, including Main 10. */
const HEVC_CAPABLE: RendererCapabilities = {
  video: { h264: true, vp9: true, av1: true, hevc: true, hevc10: true },
};

const decide = (
  metadata: MediaMetadata,
  transport: MediaTransport = 'progressive',
  caps: RendererCapabilities | null = PLAIN,
  host: HostEncodeCapability = GPU,
  eme = false
) => decideStrategy(metadata, transport, caps, host, eme);

// --- container classification ---------------------------------------------

test('Matroska is judged by its contents, not its name', () => {
  // ffprobe reports every Matroska file as `matroska,webm`, so the name alone
  // cannot tell a playable WebM from an unplayable MKV.
  assert.equal(canPlayContainer('matroska,webm', 'vp9', 'opus'), true);
  assert.equal(canPlayContainer('matroska,webm', 'h264', 'aac'), false);
  assert.equal(canPlayContainer('matroska,webm', 'av1', 'aac'), false);
  assert.equal(canPlayContainer('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'aac'), true);
});

test('an unrecognised container is assumed unplayable', () => {
  // Remuxing something that would have played costs one stream copy; not
  // remuxing something that will not play costs the viewer the film.
  assert.equal(canPlayContainer('avi', 'h264', 'mp3'), false);
  assert.equal(canPlayContainer('mpegts', 'h264', 'aac'), false);
  assert.equal(canPlayContainer(undefined, 'h264', 'aac'), false);
});

// --- bit depth -------------------------------------------------------------

test('bit depth is read from the pixel format', () => {
  assert.equal(isTenBitOrDeeper('yuv420p'), false);
  assert.equal(isTenBitOrDeeper('yuv420p10le'), true);
  assert.equal(isTenBitOrDeeper('yuv422p12le'), true);
  assert.equal(isTenBitOrDeeper('p010le'), true);
});

test('10-bit is asked about separately from the codec', () => {
  // A build that decodes 8-bit HEVC answers yes to a plain HEVC probe and then
  // fails on Main 10; a measured 10-bit file was stream-copied as playable.
  const eightBitOnly: RendererCapabilities = { video: { hevc: true, hevc10: false } };
  assert.equal(canPlayVideo('hevc', 'yuv420p', eightBitOnly), true);
  assert.equal(canPlayVideo('hevc', 'yuv420p10le', eightBitOnly), false);
});

test('an unmeasured 10-bit codec is treated as undecodable', () => {
  assert.equal(canPlayVideo('hevc', 'yuv420p10le', null), false);
  assert.equal(canPlayVideo('h264', 'yuv420p10le', PLAIN), false);
});

test('the renderer overrides the static table in both directions', () => {
  assert.equal(canPlayVideo('hevc', 'yuv420p', null), false);
  assert.equal(canPlayVideo('hevc', 'yuv420p', HEVC_CAPABLE), true);
});

// --- PRD-37 §7.2 decision matrix ------------------------------------------

test('MP4 / H.264 / AAC plays directly', () => {
  const decision = decide(media());
  assert.equal(decision.strategy, 'DIRECT');
  assert.equal(decision.directPlayable, true);
  assert.equal(decision.plan.videoAction, 'none');
});

test('WebM / VP9 / Opus plays directly', () => {
  const decision = decide(
    media({ formatName: 'matroska,webm', video: video({ codec: 'vp9' }), audio: [audio({ codec: 'opus' })] })
  );
  assert.equal(decision.strategy, 'DIRECT');
});

test('MKV / H.264 / AAC is remuxed, both streams copied', () => {
  const decision = decide(media({ formatName: 'matroska,webm' }));
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.audioAction, 'copy');
  assert.equal(decision.plan.containerAction, 'mp4_fragmented');
});

test('MP4 / H.264 / E-AC-3 transcodes audio only — the silent-audio bug', () => {
  const decision = decide(media({ audio: [audio({ codec: 'eac3', channels: 6 })] }));
  assert.equal(decision.strategy, 'AUDIO_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.audioAction, 'transcode');
  assert.equal(decision.plan.targetAudioCodec, 'aac');
});

test('MKV / H.264 / AC-3 remuxes and transcodes audio in one pass', () => {
  const decision = decide(
    media({ formatName: 'matroska,webm', audio: [audio({ codec: 'ac3', channels: 6 })] })
  );
  assert.equal(decision.strategy, 'AUDIO_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.audioAction, 'transcode');
});

test('DTS-HD MA 7.1 is transcoded without touching the video', () => {
  // "Meet Dave", 26.14 GB BluRay REMUX: H.264 High in Matroska with 8-channel
  // DTS-HD MA. Re-encoding 41 Mbps of pristine H.264 to reach stereo audio
  // would be the single most expensive mistake in the matrix.
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ bitrate: 41_400_000 }),
      audio: [audio({ codec: 'dts', channels: 8, profile: 'DTS-HD MA' })],
    })
  );
  assert.equal(decision.strategy, 'AUDIO_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'copy');
});

test('multi-channel AAC is downmixed even though the codec is fine', () => {
  // 5.1 decoded by Chromium routes to the wrong outputs on most desktop setups,
  // which sounds exactly like missing dialogue.
  const decision = decide(media({ audio: [audio({ codec: 'aac', channels: 6 })] }));
  assert.equal(decision.strategy, 'AUDIO_TRANSCODE');
  assert.equal(decision.plan.audioAction, 'transcode');
});

test('HEVC 10-bit is transcoded, never copied', () => {
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc', profile: 'Main 10', bitDepth: 10, pixelFormat: 'yuv420p10le' }),
    })
  );
  assert.equal(decision.strategy, 'VIDEO_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'transcode');
  assert.equal(decision.plan.targetVideoCodec, 'h264');
  assert.equal(decision.plan.targetPixelFormat, 'yuv420p');
});

test('HEVC 10-bit with unplayable audio is a full transcode', () => {
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc', bitDepth: 10, pixelFormat: 'yuv420p10le' }),
      audio: [audio({ codec: 'eac3', channels: 6 })],
    })
  );
  assert.equal(decision.strategy, 'FULL_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'transcode');
  assert.equal(decision.plan.audioAction, 'transcode');
});

test('a build with HEVC decoders only remuxes it', () => {
  // AC-COMPAT-4: a machine that can decode HEVC must not re-encode it for nothing.
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc', bitDepth: 10, pixelFormat: 'yuv420p10le' }),
    }),
    'progressive',
    HEVC_CAPABLE
  );
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.videoAction, 'copy');
});

test('AV1 10-bit in Matroska is remuxed, not re-encoded', () => {
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'av1', bitDepth: 10, pixelFormat: 'yuv420p10le' }),
    }),
    'progressive',
    { video: { av1: true, av110: true } }
  );
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
});

test('MPEG-2 and VC-1 are transcoded', () => {
  for (const codec of ['mpeg2video', 'vc1', 'wmv3', 'mpeg4']) {
    const decision = decide(media({ formatName: 'mpegts', video: video({ codec }) }));
    assert.equal(decision.plan.videoAction !== 'copy', true, `${codec} must not be copied`);
  }
});

// --- the 4K software-encoder guard (PRD-38 E-02) ---------------------------

test('4K HEVC on a GPU keeps its resolution', () => {
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc', bitDepth: 10, pixelFormat: 'yuv420p10le', width: 3840, height: 2160 }),
    }),
    'progressive',
    PLAIN,
    GPU
  );
  assert.equal(decision.plan.videoAction, 'transcode');
  assert.equal(decision.plan.targetHeight, undefined);
  assert.equal(decision.plan.hardwareAccelerator, 'qsv');
});

test('4K HEVC on software encoding is downscaled to 1080p', () => {
  // Measured: libx264 at 3840x2160 produced 11-13 FPS (0.47x realtime), so the
  // player drained its buffer in three seconds and stalled forever. The same
  // encode at 1080p ran at 26-28 FPS and played smoothly.
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc', bitDepth: 10, pixelFormat: 'yuv420p10le', width: 3840, height: 2160 }),
    }),
    'progressive',
    PLAIN,
    CPU
  );
  assert.equal(decision.plan.videoAction, 'downscale');
  assert.equal(decision.plan.targetHeight, 1080);
});

test('1080p on software encoding keeps its resolution', () => {
  const decision = decide(
    media({ formatName: 'matroska,webm', video: video({ codec: 'hevc', width: 1920, height: 1080 }) }),
    'progressive',
    PLAIN,
    CPU
  );
  assert.equal(decision.plan.videoAction, 'transcode');
  assert.equal(decision.plan.targetHeight, undefined);
});

test('a many-core machine keeps 4K even without a GPU encoder', () => {
  const decision = decide(
    media({ formatName: 'matroska,webm', video: video({ codec: 'hevc', width: 3840, height: 2160 }) }),
    'progressive',
    PLAIN,
    BIG_CPU
  );
  assert.equal(decision.plan.videoAction, 'transcode');
});

// --- audio track selection -------------------------------------------------

test('the default track wins when it is playable', () => {
  const track = selectAudioTrack([
    audio({ index: 0, codec: 'aac', language: 'jpn', isDefault: false }),
    audio({ index: 1, codec: 'aac', language: 'eng', isDefault: true }),
  ]);
  assert.equal(track?.index, 1);
});

test('an unplayable default is swapped only for the same language', () => {
  // Movies4u ships three E-AC-3 5.1 tracks beside an AAC stereo of the same
  // film; copying the AAC is free where transcoding E-AC-3 is not.
  const track = selectAudioTrack([
    audio({ index: 0, codec: 'eac3', channels: 6, language: 'eng', isDefault: true }),
    audio({ index: 1, codec: 'aac', channels: 2, language: 'eng', isDefault: false }),
  ]);
  assert.equal(track?.index, 1);
});

test('a cheaper track in a different language is never substituted', () => {
  // Silently swapping an English default for a Hindi AAC track because it was
  // cheaper would be a far worse bug than a few percent of one CPU core.
  const track = selectAudioTrack([
    audio({ index: 0, codec: 'eac3', channels: 6, language: 'eng', isDefault: true }),
    audio({ index: 1, codec: 'aac', channels: 2, language: 'hin', isDefault: false }),
  ]);
  assert.equal(track?.index, 0);
});

test('a file with no audio maps no audio stream', () => {
  const decision = decide(media({ formatName: 'matroska,webm', audio: [] }));
  assert.equal(decision.plan.selectedAudioIndex, -1);
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
});

// --- transports ------------------------------------------------------------

test('HLS carrying playable codecs is left to hls.js', () => {
  const decision = decide(
    media({ formatName: 'hls', video: video(), audio: [audio()] }),
    'hls'
  );
  assert.equal(decision.strategy, 'HLS_NATIVE');
  assert.equal(decision.plan.videoAction, 'none');
});

test('HLS carrying HEVC falls through to the transcoder', () => {
  // hls.js hands demuxed samples to the same MSE that backs <video>; it cannot
  // invent decoders, so an HEVC ladder fails there exactly as a bare file would.
  const decision = decide(
    media({ formatName: 'hls', video: video({ codec: 'hevc' }) }),
    'hls'
  );
  assert.equal(decision.strategy, 'VIDEO_TRANSCODE');
});

test('HLS carrying AC-3 transcodes only the audio', () => {
  const decision = decide(
    media({ formatName: 'hls', audio: [audio({ codec: 'ac3', channels: 6 })] }),
    'hls'
  );
  assert.equal(decision.strategy, 'AUDIO_TRANSCODE');
  assert.equal(decision.plan.videoAction, 'copy');
});

test('DASH is remuxed rather than handed to a demuxer that rejects XML', () => {
  const decision = decide(media({ formatName: 'dash' }), 'dash');
  assert.equal(decision.strategy, 'DASH_REMUX');
  assert.equal(decision.plan.containerAction, 'mp4_fragmented');
});

test('encrypted streams bypass FFmpeg entirely', () => {
  // FFmpeg holds no keys: probing one wastes twenty seconds on noise and
  // remuxing one produces an unplayable file.
  const decision = decide(media({ formatName: 'dash' }), 'dash', PLAIN, GPU, true);
  assert.equal(decision.strategy, 'EME_NATIVE');
  assert.equal(decision.plan.videoAction, 'none');
});

// --- subtitles -------------------------------------------------------------

test('text subtitle tracks are marked for extraction', () => {
  const decision = decide(
    media({ formatName: 'matroska,webm', subtitles: [subtitle({ codec: 'ass' })] })
  );
  assert.equal(decision.plan.subtitleAction, 'extract_webvtt');
});

test('bitmap-only subtitles are ignored rather than extracted into nothing', () => {
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      subtitles: [subtitle({ codec: 'hdmv_pgs_subtitle', isBitmap: true })],
    })
  );
  assert.equal(decision.plan.subtitleAction, 'ignore');
});

test('subtitles never force a video transcode', () => {
  const decision = decide(
    media({ formatName: 'matroska,webm', subtitles: [subtitle({ codec: 'subrip' })] })
  );
  assert.equal(decision.plan.videoAction, 'copy');
});

// --- INV-RACE-3 ------------------------------------------------------------

test('the blind fallback never copies video', () => {
  // The legacy fallback ran `-c:v copy` on unverified codec information, which
  // re-wrapped an undecodable HEVC bitstream into MP4 — so the second attempt
  // failed identically to the first and looked like the same bug twice.
  assert.equal(blindFallbackPlan(GPU).videoAction, 'transcode');
  assert.equal(blindFallbackPlan(CPU).videoAction, 'downscale');
  assert.equal(blindFallbackPlan(CPU).targetHeight, 1080);
  assert.equal(blindFallbackPlan(GPU).audioAction, 'transcode');
});

// --- runner ----------------------------------------------------------------

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

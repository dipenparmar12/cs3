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
  NativeEngineCapability,
  RendererCapabilities,
  SubtitleStreamMetadata,
  VideoStreamMetadata,
} from '../../src/types/media.ts';
import {
  blindFallbackPlan,
  canPlayContainer,
  canPlayVideo,
  chooseCopyContainer,
  decideStrategy,
  isPlayableAudioCodec,
  isTenBitOrDeeper,
  predictOutput,
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
    playable: isPlayableAudioCodec(codec),
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

test("HEVC copied into MP4 is tagged hvc1, not ffmpeg's default hev1", () => {
  /**
   * The difference between a stream that plays and one that does not, and it
   * gives nothing away when it is wrong: ffmpeg exits 0, the MP4 is valid, both
   * codecs are decodable, and the player shows nothing.
   *
   * HEVC has two MP4 sample entries — `hev1` carries parameter sets in-band,
   * `hvc1` puts them in the sample description — and browsers accept only
   * `hvc1`. ffmpeg's muxer defaults to `hev1` when copying.
   *
   * It is the exact mismatch the capability probe sets up: `VIDEO_CODEC_PROBES`
   * asks `canPlayType` with the codecs string `hvc1.1.6.L93.B0` — the *hvc1*
   * form — so a build that answers yes is then handed `hev1`.
   */
  const decision = decide(
    media({ formatName: 'matroska,webm', video: video({ codec: 'hevc' }) }),
    'progressive',
    HEVC_CAPABLE
  );
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.videoTag, 'hvc1');
});

test('HEVC copied beside re-encoded audio is tagged too', () => {
  // The audio-only branch is a second copy path into MP4, and it had the same
  // hole. AC-3 forces the audio transcode; the video is still copied.
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc' }),
      audio: [audio({ codec: 'ac3', channels: 6 })],
    }),
    'progressive',
    HEVC_CAPABLE
  );
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.videoTag, 'hvc1');
});

test('nothing but HEVC is tagged, and never in WebM', () => {
  // H.264 already muxes as `avc1`; forcing a tag on it would be wrong. WebM has
  // no sample entries at all, so the question does not arise.
  assert.equal(decide(media({ formatName: 'matroska,webm' })).plan.videoTag, undefined);
  const vp8 = decide(
    media({
      formatName: 'avi',
      video: video({ codec: 'vp8' }),
      audio: [audio({ codec: 'opus' })],
    }),
    'progressive',
    { video: { vp8: true, vp9: true } }
  );
  assert.equal(vp8.plan.containerAction, 'webm');
  assert.equal(vp8.plan.videoTag, undefined);
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

// --- extended format & codec test suite ------------------------------------

test('10-bit H.264 (Hi10P) and 4:2:2 chroma formats trigger video transcode', () => {
  const hi10p = decide(media({ video: video({ codec: 'h264', pixelFormat: 'yuv420p10le' }) }));
  assert.equal(hi10p.strategy, 'VIDEO_TRANSCODE');
  assert.equal(hi10p.plan.targetVideoCodec, 'h264');

  const chroma422 = decide(media({ video: video({ codec: 'h264', pixelFormat: 'yuv422p' }) }));
  assert.equal(chroma422.strategy, 'VIDEO_TRANSCODE');
});

test('uncompressed PCM, WMA, ADPCM and RealAudio trigger audio transcode to AAC', () => {
  const pcm = decide(media({ audio: [audio({ codec: 'pcm_s16le' })] }));
  assert.equal(pcm.strategy, 'AUDIO_TRANSCODE');
  assert.equal(pcm.plan.targetAudioCodec, 'aac');

  const wma = decide(media({ audio: [audio({ codec: 'wmapro' })] }));
  assert.equal(wma.strategy, 'AUDIO_TRANSCODE');
  assert.equal(wma.plan.targetAudioCodec, 'aac');

  const adpcm = decide(media({ audio: [audio({ codec: 'adpcm_ms' })] }));
  assert.equal(adpcm.strategy, 'AUDIO_TRANSCODE');
  assert.equal(adpcm.plan.targetAudioCodec, 'aac');
});

test('DivX, XviD, MPEG-4 Part 2, WMV and RealVideo trigger video transcode', () => {
  const mpeg4 = decide(media({ video: video({ codec: 'mpeg4' }) }));
  assert.equal(mpeg4.strategy, 'VIDEO_TRANSCODE');

  const wmv = decide(media({ video: video({ codec: 'wmv3' }) }));
  assert.equal(wmv.strategy, 'VIDEO_TRANSCODE');

  const rv40 = decide(media({ video: video({ codec: 'rv40' }) }));
  assert.equal(rv40.strategy, 'VIDEO_TRANSCODE');
});

// --- native engine routing -------------------------------------------------

/**
 * These rows are the answer to "when is mpv worth leaving the in-app player
 * for?", and they are asserted rather than reasoned about because the failure
 * mode is invisible in both directions. Route too little and a 4K HEVC release
 * still gets downscaled to 1080p on a machine that could have played it
 * untouched. Route too much and every television episode with AC-3 audio opens a
 * second window, which reads as the app being broken rather than as a policy.
 */

const MPV_OFF: NativeEngineCapability = { available: true, policy: 'off' };
const MPV_AUTO: NativeEngineCapability = { available: true, policy: 'auto' };
const MPV_AGGRESSIVE: NativeEngineCapability = { available: true, policy: 'aggressive' };
const MPV_MISSING: NativeEngineCapability = { available: false, policy: 'aggressive' };

const decideNative = (
  metadata: MediaMetadata,
  native: NativeEngineCapability,
  transport: MediaTransport = 'progressive',
  caps: RendererCapabilities | null = PLAIN,
  host: HostEncodeCapability = GPU
) => decideStrategy(metadata, transport, caps, host, false, native);

const HEVC_10BIT_4K = media({
  formatName: 'matroska,webm',
  video: video({ codec: 'hevc', pixelFormat: 'yuv420p10le', bitDepth: 10, width: 3840, height: 2160 }),
  audio: [audio({ codec: 'eac3', channels: 6, playable: false })],
});

test('an uninstalled engine changes nothing at all', () => {
  // The transcoding ladder has to remain a complete answer on its own: it is
  // what runs on every machine without mpv, and the fallback when mpv fails.
  assert.equal(decideNative(HEVC_10BIT_4K, MPV_MISSING).strategy, 'FULL_TRANSCODE');
  assert.equal(decideNative(HEVC_10BIT_4K, MPV_OFF).strategy, 'FULL_TRANSCODE');
});

test('4K HEVC 10-bit routes to the native engine instead of being re-encoded', () => {
  const decision = decideNative(HEVC_10BIT_4K, MPV_AUTO);
  assert.equal(decision.strategy, 'NATIVE_MPV');
  // Nothing is left in the plan for `mediaTranscoder` to act on.
  assert.equal(decision.plan.videoAction, 'none');
  assert.equal(decision.plan.audioAction, 'none');
  assert.equal(decision.plan.containerAction, 'passthrough');
});

test('the software 4K downscale is what the engine exists to avoid', () => {
  // Same file, no GPU encoder: the browser path would hand back 1080p.
  const browser = decideNative(HEVC_10BIT_4K, MPV_OFF, 'progressive', PLAIN, CPU);
  assert.equal(browser.plan.videoAction, 'downscale');
  assert.equal(browser.plan.targetHeight, 1080);

  const native = decideNative(HEVC_10BIT_4K, MPV_AUTO, 'progressive', PLAIN, CPU);
  assert.equal(native.strategy, 'NATIVE_MPV');
  assert.equal(native.plan.targetHeight, undefined);
});

test('a stream that already plays natively is never taken away from the in-app player', () => {
  // Routing this would trade a working single-window experience for CPU that
  // was never being spent.
  assert.equal(decideNative(media(), MPV_AGGRESSIVE).strategy, 'DIRECT');
  assert.equal(
    decideNative(media({ formatName: 'hls' }), MPV_AGGRESSIVE, 'hls').strategy,
    'HLS_NATIVE'
  );
});

test('encrypted streams stay with EME, which is the only thing holding keys', () => {
  const decision = decideStrategy(media(), 'hls', PLAIN, GPU, true, MPV_AGGRESSIVE);
  assert.equal(decision.strategy, 'EME_NATIVE');
});

test('under `auto` a plain MKV remux stays in the app', () => {
  // H.264 + AAC in Matroska: the wrapper is wrong and nothing else. The remux
  // runs at ~27x realtime and loses nothing, so there is no case for a window.
  const mkv = media({ formatName: 'matroska,webm' });
  assert.equal(decideNative(mkv, MPV_AUTO).strategy, 'REMUX_CONTAINER');
  assert.equal(decideNative(mkv, MPV_AGGRESSIVE).strategy, 'NATIVE_MPV');
});

test('under `auto` surround audio routes rather than being flattened to stereo', () => {
  /**
   * The row a user's own catalogue produced. `1080p WEB-DL … EAC3 5.1` in
   * Matroska is the modal provider release, not an edge case, and the earlier
   * rule sent every one of them through a stereo downmix — reported as
   * "Audio re-encoded, video copied untouched … EAC3 audio has no decoder here"
   * on title after title. The 5.1 is decodable on the GPU for free.
   */
  for (const codec of ['eac3', 'ac3', 'dts']) {
    const decision = decideNative(
      media({
        formatName: 'matroska,webm',
        audio: [audio({ codec, channels: 6, playable: false })],
      }),
      MPV_AUTO
    );
    assert.equal(decision.strategy, 'NATIVE_MPV', `${codec} 5.1 should route`);
  }
});

test('under `auto` a stereo track is left in the app, whatever its codec', () => {
  // Nothing is thrown away here: the codec swap is cheap and stereo is stereo
  // on the other side. Routing it would cost a window to buy nothing.
  const stereoAc3 = media({ audio: [audio({ codec: 'ac3', channels: 2, playable: false })] });
  assert.equal(decideNative(stereoAc3, MPV_AUTO).strategy, 'AUDIO_TRANSCODE');
});

test('under `auto` lossless stereo still routes, because that loss is permanent', () => {
  // Two channels of TrueHD re-encoded to 192 kbit AAC is not recoverable, so
  // the codec rule survives underneath the channel rule rather than being
  // replaced by it.
  const truehd = media({ audio: [audio({ codec: 'truehd', channels: 2, playable: false })] });
  assert.equal(decideNative(truehd, MPV_AUTO).strategy, 'NATIVE_MPV');
});

test('under `auto` lossless and object-based audio routes at any channel count', () => {
  for (const codec of ['truehd', 'dtshd', 'dts-hd ma', 'flac', 'pcm_s24le']) {
    const decision = decideNative(
      media({ audio: [audio({ codec, channels: 8, playable: false })] }),
      MPV_AUTO
    );
    assert.equal(decision.strategy, 'NATIVE_MPV', `${codec} should route to the native engine`);
  }
});

test('the routing decision reads the selected track, not the first one', () => {
  // An English TrueHD default beside a Hindi TrueHD track: whichever is chosen,
  // the answer is the same — but the lookup must find *a* track. A plan whose
  // selected index matches nothing must not silently decide "no lossless audio".
  const decision = decideNative(
    media({
      audio: [
        audio({ index: 0, codec: 'truehd', channels: 8, language: 'eng', playable: false, isDefault: true }),
        audio({ index: 1, codec: 'truehd', channels: 8, language: 'hin', playable: false }),
      ],
    }),
    MPV_AUTO
  );
  assert.equal(decision.strategy, 'NATIVE_MPV');
  assert.equal(decision.plan.selectedAudioIndex, 0);
});

test('a build with HEVC decoders keeps its remux rather than routing under `auto`', () => {
  // The renderer's measurement wins here exactly as it does everywhere else: if
  // this machine decodes HEVC, there is no re-encode to escape from.
  const decision = decideNative(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'hevc', pixelFormat: 'yuv420p10le', bitDepth: 10 }),
    }),
    MPV_AUTO,
    'progressive',
    HEVC_CAPABLE
  );
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
});

test('HLS carrying HEVC routes, because hls.js cannot invent a decoder either', () => {
  const decision = decideNative(
    media({ formatName: 'hls', video: video({ codec: 'hevc' }) }),
    MPV_AUTO,
    'hls'
  );
  assert.equal(decision.strategy, 'NATIVE_MPV');
});

test('DASH routes only when the browser path would have re-encoded it', () => {
  // A remux of a playable DASH ladder is cheap and keeps the in-app player.
  const plain = decideNative(media({ formatName: 'dash' }), MPV_AUTO, 'dash');
  assert.equal(plain.strategy, 'DASH_REMUX');

  const hevc = decideNative(
    media({ formatName: 'dash', video: video({ codec: 'hevc' }) }),
    MPV_AGGRESSIVE,
    'dash'
  );
  assert.equal(hevc.strategy, 'NATIVE_MPV');
});

test('the explanation keeps the browser-side reason and says what changed', () => {
  const decision = decideNative(HEVC_10BIT_4K, MPV_AUTO);
  assert.match(decision.explanation, /native engine \(mpv\)/);
  assert.match(decision.explanation, /HEVC/);
  assert.match(decision.explanation, /HDR/);
});

// --- the output container is chosen, not assumed ---------------------------

test('VP8 is remuxed into WebM, because ffmpeg refuses to write it into MP4', () => {
  /**
   * Measured, not assumed. `ffmpeg -c:v copy -f mp4` on a VP8 stream answers
   * `Could not find tag for codec vp8 in stream #0, codec not currently
   * supported in container` and then `Could not write header` — the command
   * dies and the viewer gets nothing. Both streams decode here, so this took
   * the copy path and produced no output at all.
   *
   * The wrapper is AVI rather than Matroska on purpose: a Matroska carrying
   * WebM-legal codecs *is* a WebM to Chromium and plays directly, so it never
   * reaches a remux. It takes a container Chromium cannot demux at all to get
   * WebM-only codecs onto this path.
   */
  const decision = decide(
    media({
      formatName: 'avi',
      video: video({ codec: 'vp8' }),
      audio: [audio({ codec: 'vorbis' })],
    })
  );
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.containerAction, 'webm');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.audioAction, 'copy');
});

test('Vorbis is re-encoded rather than copied into MP4, though ffmpeg would write it', () => {
  /**
   * The silent half of the bug. ffmpeg muxes Vorbis into MP4 without complaint
   * — verified — and Chromium plays no audio from it, because Vorbis is a
   * WebM/Ogg codec there. An exit-status check believes this worked. Beside
   * H.264 there is no shared container, so the audio is what moves.
   */
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'h264' }),
      audio: [audio({ codec: 'vorbis' })],
    })
  );
  assert.notEqual(decision.plan.audioAction, 'copy');
  assert.equal(decision.plan.containerAction, 'mp4_fragmented');
});

test('a codec pair with no shared container is re-encoded, not copied', () => {
  /**
   * VP8 beside AAC: MP4 will not take the video, WebM will not take the audio.
   * This is the *common* shape of the bug — a Matroska whose audio is ordinary
   * AAC, which is exactly why the container is unplayable in the first place.
   */
  assert.equal(chooseCopyContainer('vp8', 'aac'), null);
  const decision = decide(
    media({
      formatName: 'matroska,webm',
      video: video({ codec: 'vp8' }),
      audio: [audio({ codec: 'aac' })],
    })
  );
  assert.notEqual(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.containerAction, 'mp4_fragmented');
});

test('the ordinary Matroska case is unchanged: H.264 + AAC still goes to MP4', () => {
  // The modal provider release. Everything above must not disturb it.
  const decision = decide(media({ formatName: 'matroska,webm' }));
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.containerAction, 'mp4_fragmented');
  assert.equal(decision.plan.videoAction, 'copy');
  assert.equal(decision.plan.audioAction, 'copy');
});

test('chooseCopyContainer prefers MP4 and reaches for WebM only when it must', () => {
  assert.equal(chooseCopyContainer('h264', 'aac'), 'mp4_fragmented');
  assert.equal(chooseCopyContainer('vp9', 'opus'), 'mp4_fragmented');
  assert.equal(chooseCopyContainer('vp9', 'vorbis'), 'webm');
  assert.equal(chooseCopyContainer('vp8', 'opus'), 'webm');
  assert.equal(chooseCopyContainer('h264', undefined), 'mp4_fragmented');
  assert.equal(chooseCopyContainer('mpeg2video', 'vorbis'), null);
});

test('HEVC is muxable in MP4, so a build that decodes it still gets a cheap remux', () => {
  /**
   * The distinction the tables exist to keep: mux legality and decoder support
   * are different questions. Folding "no decoder here" into "cannot be muxed"
   * would force a full re-encode on every build that grew a platform HEVC
   * decoder, which is the exact case the runtime capability override serves.
   */
  const decision = decide(
    media({ formatName: 'matroska,webm', video: video({ codec: 'hevc' }) }),
    'progressive',
    HEVC_CAPABLE
  );
  assert.equal(decision.strategy, 'REMUX_CONTAINER');
  assert.equal(decision.plan.videoAction, 'copy');
});

// --- the output is validated before it is acted on -------------------------

test('predictOutput describes what will come out, not what went in', () => {
  const metadata = media({
    formatName: 'matroska,webm',
    video: video({ codec: 'hevc' }),
    audio: [audio({ codec: 'eac3', channels: 6, playable: false })],
  });
  const predicted = predictOutput(
    metadata,
    {
      videoAction: 'transcode',
      targetVideoCodec: 'h264',
      targetPixelFormat: 'yuv420p',
      audioAction: 'transcode',
      targetAudioCodec: 'aac',
      selectedAudioIndex: 0,
      containerAction: 'mp4_fragmented',
      subtitleAction: 'ignore',
    },
    PLAIN
  );
  assert.equal(predicted.container, 'mp4');
  assert.equal(predicted.videoCodec, 'h264');
  assert.equal(predicted.audioCodec, 'aac');
  assert.equal(predicted.mimeType, 'video/mp4');
  assert.equal(predicted.playable, true);
});

test('a plan whose output would not play is rejected, with the reason', () => {
  // Exactly the case an exit-status check cannot catch: ffmpeg writes it and
  // the browser plays nothing.
  const predicted = predictOutput(
    media({ audio: [audio({ codec: 'vorbis' })] }),
    {
      videoAction: 'copy',
      audioAction: 'copy',
      selectedAudioIndex: 0,
      containerAction: 'mp4_fragmented',
      subtitleAction: 'ignore',
    },
    PLAIN
  );
  assert.equal(predicted.playable, false);
  assert.match(predicted.problems.join(' '), /vorbis/i);
});

test('predicted output catches a copied multichannel track', () => {
  // Copying 6 channels forward leaves the dialogue-routing problem in place,
  // which is the bug the downmix exists to fix wearing a different costume.
  const predicted = predictOutput(
    media({ audio: [audio({ codec: 'aac', channels: 6 })] }),
    {
      videoAction: 'copy',
      audioAction: 'copy',
      selectedAudioIndex: 0,
      containerAction: 'mp4_fragmented',
      subtitleAction: 'ignore',
    },
    PLAIN
  );
  assert.equal(predicted.playable, false);
  assert.match(predicted.problems.join(' '), /6-channel/);
});

test('passthrough is not second-guessed: nothing is produced to validate', () => {
  // HLS and EME outputs are not ffmpeg's, so there is no output to predict.
  const predicted = predictOutput(
    media(),
    {
      videoAction: 'none',
      audioAction: 'none',
      selectedAudioIndex: 0,
      containerAction: 'passthrough',
      subtitleAction: 'ignore',
    },
    PLAIN
  );
  assert.equal(predicted.container, 'source');
  assert.equal(predicted.playable, true);
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

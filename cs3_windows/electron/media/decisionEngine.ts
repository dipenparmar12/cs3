import type {
  AudioStreamMetadata,
  HostEncodeCapability,
  MediaMetadata,
  MediaTransport,
  PlaybackStrategyType,
  RendererCapabilities,
  TransformationPlan,
} from '../../src/types/media';

/**
 * Decides how to play a stream, from what is actually inside it.
 *
 * Pure by design, and that is the point rather than a stylistic preference:
 * every playback failure in PRD-37 §4.1 came from a decision made against
 * incomplete information at the wrong moment. Making the decision a total
 * function of (metadata, renderer capabilities, host encoder) means it can be
 * tested exhaustively against the §7.2 matrix without a network, a GPU or a
 * file — see `decisionEngine.test.mts`.
 *
 * The rule that governs the whole file: **cheapest strategy that actually
 * works**. Copying a stream is close to free and re-encoding one is not, so the
 * two are never conflated. Remuxing a 25 GB MKV runs at ~27x realtime; software
 * encoding the same file at 4K runs at 0.5x and stalls the player after three
 * seconds. Those are not two points on a scale, they are working and broken.
 */

/** Codecs Chromium ships no decoder for. Measured with `canPlayType`, not looked up. */
const UNSUPPORTED_AUDIO = new Set([
  'ac3', 'eac3', 'ec-3', 'dts', 'dtshd', 'dca', 'truehd', 'mlp', 'pcm_bluray', 'pcm_dvd',
]);

/**
 * Video codecs assumed undecodable until the renderer says otherwise.
 *
 * Conservative on purpose: transcoding something that would have played costs
 * CPU, while failing to transcode something that will not play costs the viewer
 * the film. `hevc` is the entry that matters and the one most likely to be
 * corrected at runtime — some builds decode it through platform decoders.
 */
const UNSUPPORTED_VIDEO = new Set([
  'hevc', 'h265', 'mpeg2video', 'vc1', 'wmv1', 'wmv2', 'wmv3',
  'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'mpeg4', 'msvideo1',
  'prores', 'dnxhd', 'cinepak', 'rv40', 'vp6f', 'flv1', 'theora',
]);

/**
 * Containers Chromium can demux, and the trap inside that sentence.
 *
 * ffprobe reports Matroska as `matroska,webm` for *every* Matroska file, because
 * WebM is a Matroska subset — so the name alone cannot tell a playable WebM from
 * an unplayable MKV. The contents decide it: Chromium demuxes Matroska only for
 * the codecs WebM permits, so VP9 + Opus plays and the overwhelmingly more common
 * H.264 + AAC does not. PRD-38 measured 100% of dual-audio provider streams as
 * Matroska, which is why this one line decides most of the corpus.
 */
const PLAYABLE_CONTAINERS = ['mp4', 'mov', 'm4a', 'm4v', '3gp', '3g2', 'webm', 'ogg'];

const WEBM_VIDEO = new Set(['vp8', 'vp9', 'av1']);
const WEBM_AUDIO = new Set(['opus', 'vorbis']);

/** Text subtitle codecs that survive conversion to WebVTT. */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'webvtt', 'vtt', 'ass', 'ssa', 'mov_text', 'text', 'eia_608', 'subviewer',
]);

/**
 * More than stereo is transcoded even when the codec is fine.
 *
 * Not an aesthetic call. A 5.1 track decoded by Chromium routes to the wrong
 * outputs on most desktop setups, which sounds exactly like the dialogue has
 * gone missing — a different bug wearing the costume of the one the downmix
 * exists to fix. The measured file that exposed this carried 6-channel AAC,
 * every codec supported, and no audible dialogue.
 */
const MAX_DIRECT_CHANNELS = 2;

/**
 * Above this, software encoding cannot keep up and the player stalls.
 *
 * Measured on the 25.65 GB 4K HEVC sample (PRD-37 §2): libx264 `veryfast` at
 * native 3840x2160 produced 11–13 FPS — 0.47x realtime — so Chromium drained the
 * initial buffer in three seconds and buffered forever. The same encode scaled to
 * 1080p ran at 26–28 FPS, 1.06x–1.17x realtime, and played smoothly. The stall
 * was never a network problem and never a codec problem; it was arithmetic.
 */
const SOFTWARE_ENCODE_MAX_HEIGHT = 1080;

/**
 * Cores above which software 4K encoding is allowed to keep full resolution.
 *
 * The measurement above was taken on an ordinary desktop. A 16-thread machine
 * clears realtime at 4K, and downscaling it would be throwing away resolution to
 * solve a problem it does not have. Below that, the guard applies — losing 4K is
 * a visible compromise and stalling is not playback at all.
 */
const SOFTWARE_4K_CORE_THRESHOLD = 16;

export interface StrategyDecision {
  directPlayable: boolean;
  strategy: PlaybackStrategyType;
  plan: TransformationPlan;
  explanation: string;
}

function bitDepthOf(pixelFormat: string | undefined): number {
  if (!pixelFormat) return 8;
  const match = /(\d{2})(le|be)\b/i.exec(pixelFormat);
  if (match) return Number(match[1]);
  if (/^p010/i.test(pixelFormat)) return 10;
  return 8;
}

export function isTenBitOrDeeper(pixelFormat: string | undefined): boolean {
  return bitDepthOf(pixelFormat) > 8;
}

export function isTextSubtitle(codec: string): boolean {
  return TEXT_SUBTITLE_CODECS.has(codec.toLowerCase());
}

export function isPlayableAudioCodec(codec: string): boolean {
  return !UNSUPPORTED_AUDIO.has(codec.toLowerCase());
}

/**
 * Whether this build can decode this video stream **at this bit depth**.
 *
 * Bit depth is asked about separately because it is supported separately: a
 * build that decodes 8-bit HEVC Main answers "yes" to a plain HEVC probe and
 * then fails on Main 10. A measured 1280x536 HEVC `yuv420p10le` file was
 * therefore stream-copied into MP4 as "playable" and still would not play.
 *
 * Where the renderer has given no 10-bit-specific answer, the assumption is that
 * it cannot be played. Converting something that would have worked costs CPU;
 * the reverse costs the viewer the film.
 */
export function canPlayVideo(
  codec: string | undefined,
  pixelFormat: string | undefined,
  capabilities: RendererCapabilities | null
): boolean {
  if (!codec) return true;
  const name = codec.toLowerCase();

  if (isTenBitOrDeeper(pixelFormat)) {
    return capabilities?.video?.[`${name}10`] === true;
  }

  const measured = capabilities?.video?.[name];
  if (typeof measured === 'boolean') return measured;
  return !UNSUPPORTED_VIDEO.has(name);
}

/**
 * Whether Chromium can demux this container as it stands.
 *
 * Matroska is decided by its contents; everything else by name. An unrecognised
 * container is assumed unplayable — remuxing something that would have played
 * costs one stream copy, and not remuxing something that will not play costs the
 * viewer the film.
 */
export function canPlayContainer(
  formatName: string | undefined,
  videoCodec: string | undefined,
  audioCodec: string | undefined
): boolean {
  if (!formatName) return false;
  const names = formatName.toLowerCase().split(',').map((name) => name.trim());

  if (names.includes('matroska')) {
    const video = (videoCodec ?? '').toLowerCase();
    const audio = (audioCodec ?? '').toLowerCase();
    return (!video || WEBM_VIDEO.has(video)) && (!audio || WEBM_AUDIO.has(audio));
  }

  return names.some((name) => PLAYABLE_CONTAINERS.includes(name));
}

/**
 * Picks the audio track to play.
 *
 * Starts from the file's own default, which is what Android does and what the
 * releaser intended. The one refinement: when the default cannot be decoded but
 * a track **in the same language** can, the playable one wins — PRD-38 measured
 * Movies4u shipping three E-AC-3 5.1 tracks beside an AAC stereo track of the
 * same film, and copying the AAC is free where transcoding the E-AC-3 is not.
 *
 * Language is required to match. Silently swapping an English default for a
 * Hindi AAC track because it happened to be cheaper would be a far worse bug
 * than a few percent of one CPU core.
 */
export function selectAudioTrack(audio: AudioStreamMetadata[]): AudioStreamMetadata | null {
  if (audio.length === 0) return null;
  const preferred = audio.find((track) => track.isDefault) ?? audio[0];
  if (preferred.playable && preferred.channels <= MAX_DIRECT_CHANNELS) return preferred;

  const sameLanguage = audio.find(
    (track) =>
      track !== preferred &&
      track.playable &&
      track.channels > 0 &&
      track.channels <= MAX_DIRECT_CHANNELS &&
      Boolean(track.language) &&
      track.language === preferred.language
  );
  return sameLanguage ?? preferred;
}

function describeResolution(width: number, height: number): string {
  if (!width || !height) return 'unknown resolution';
  return `${width}x${height}`;
}

/**
 * The plan for a stream whose contents are unknown.
 *
 * INV-RACE-3: `-c:v copy` must never run on unverified codec information. The
 * legacy fallback did exactly that — it re-wrapped an undecodable HEVC bitstream
 * into MP4 and handed Chromium the same undecodable payload in a new box, which
 * is why the second failure looked identical to the first. When we do not know,
 * we re-encode; that always produces something playable, at a cost that is only
 * paid on a source that has already failed once.
 */
export function blindFallbackPlan(host: HostEncodeCapability): TransformationPlan {
  return {
    videoAction: host.hardware ? 'transcode' : 'downscale',
    targetVideoCodec: 'h264',
    targetPixelFormat: 'yuv420p',
    targetHeight: host.hardware ? undefined : SOFTWARE_ENCODE_MAX_HEIGHT,
    hardwareAccelerator: host.accelerator,
    audioAction: 'transcode',
    targetAudioCodec: 'aac',
    selectedAudioIndex: 0,
    containerAction: 'mp4_fragmented',
    subtitleAction: 'ignore',
  };
}

/**
 * Whether a source that is otherwise direct-playable still needs the encoder
 * guard applied — the software 4K case.
 */
function videoTranscodeAction(
  height: number,
  host: HostEncodeCapability
): { action: 'transcode' | 'downscale'; targetHeight?: number } {
  const softwareOnly = !host.hardware;
  const tooTall = height > SOFTWARE_ENCODE_MAX_HEIGHT;
  const underpowered = host.logicalCores < SOFTWARE_4K_CORE_THRESHOLD;

  if (softwareOnly && tooTall && underpowered) {
    return { action: 'downscale', targetHeight: SOFTWARE_ENCODE_MAX_HEIGHT };
  }
  return { action: 'transcode' };
}

/**
 * The decision, from measured metadata alone.
 *
 * Never consults the URL. AC-COMPAT-2 exists because the previous implementation
 * did: it searched the link for the strings `hevc`, `x265` and `10bit`, which is
 * a guess about a filename a scraper produced, and it was wrong in both
 * directions — a `2160p.HEVC` release that was actually H.264, and a bare
 * `?id=…` Google Drive URL carrying 10-bit HEVC with nothing in it to match.
 */
export function decideStrategy(
  metadata: MediaMetadata,
  transport: MediaTransport,
  capabilities: RendererCapabilities | null,
  host: HostEncodeCapability,
  /** True for ClearKey/Widevine/PlayReady. AES-128 HLS is *not* one of these. */
  requiresEme = false
): StrategyDecision {
  const video = metadata.video;
  const track = selectAudioTrack(metadata.audio);
  const audioIndex = track?.index ?? -1;

  const hasTextSubtitles = metadata.subtitles.some((sub) => isTextSubtitle(sub.codec));
  const subtitleAction: TransformationPlan['subtitleAction'] = hasTextSubtitles
    ? 'extract_webvtt'
    : 'ignore';

  const videoPlayable = canPlayVideo(video?.codec, video?.pixelFormat, capabilities);
  const audioPlayable = !track || (track.playable && track.channels <= MAX_DIRECT_CHANNELS);
  const containerPlayable = canPlayContainer(
    metadata.formatName,
    video?.codec,
    track?.codec
  );

  /**
   * Encrypted content skips this engine entirely.
   *
   * FFmpeg has no keys, so a probe of a Widevine stream reports nonsense and a
   * remux of one produces an unplayable file — and both take seconds to fail.
   * The renderer's EME pipeline is the only thing that can decrypt it, so it is
   * handed over untouched with the DRM configuration attached.
   */
  if (requiresEme) {
    return {
      directPlayable: true,
      strategy: 'EME_NATIVE',
      plan: {
        videoAction: 'none',
        audioAction: 'none',
        selectedAudioIndex: audioIndex,
        containerAction: 'passthrough',
        subtitleAction: 'ignore',
      },
      explanation:
        'Encrypted stream: decrypted by the browser through EME. FFmpeg is ' +
        'bypassed because it holds no decryption keys.',
    };
  }

  /**
   * A DASH manifest never reaches the `<video>` element.
   *
   * Chromium demuxes DASH only through MSE with a JavaScript player driving it;
   * handed an `.mpd` directly it reports `Unable to parse XML declaration`,
   * because an XML document has arrived at a binary demuxer. ffmpeg's `dash`
   * demuxer reads it properly, so it is remuxed like any other container we
   * cannot hand over — one path, no second player library to keep current.
   */
  if (transport === 'dash') {
    return {
      directPlayable: false,
      strategy: 'DASH_REMUX',
      plan: {
        videoAction: videoPlayable ? 'copy' : videoTranscodeAction(video?.height ?? 0, host).action,
        targetVideoCodec: videoPlayable ? undefined : 'h264',
        targetPixelFormat: videoPlayable ? undefined : 'yuv420p',
        hardwareAccelerator: videoPlayable ? undefined : host.accelerator,
        audioAction: audioPlayable ? 'copy' : 'transcode',
        targetAudioCodec: audioPlayable ? undefined : 'aac',
        selectedAudioIndex: audioIndex,
        containerAction: 'mp4_fragmented',
        subtitleAction,
      },
      explanation:
        'MPEG-DASH manifest: repackaged into fragmented MP4, because a browser ' +
        'cannot demux a DASH manifest without a JavaScript player driving it.',
    };
  }

  /**
   * HLS is hls.js's job — but only when hls.js can actually decode the payload.
   *
   * It demuxes MPEG-TS in JavaScript, decrypts AES-128 and SAMPLE-AES itself and
   * switches renditions, none of which ffmpeg would do better; remuxing an
   * adaptive ladder would also collapse it to one fixed bitrate. So a playable
   * payload is handed straight over, and the segments still travel through
   * `MediaProxy` so the provider's `Referer` reaches every segment and key.
   *
   * What it cannot do is invent decoders. hls.js hands demuxed samples to the
   * same Media Source Extensions that back the `<video>` element, so an HLS
   * ladder carrying HEVC or AC-3 fails exactly as a bare file would — with a
   * `bufferAddCodecError` rather than anything about codecs. That case falls
   * through to the transcoder below.
   */
  if (transport === 'hls' && videoPlayable && audioPlayable) {
    return {
      directPlayable: true,
      strategy: 'HLS_NATIVE',
      plan: {
        videoAction: 'none',
        audioAction: 'none',
        selectedAudioIndex: audioIndex,
        containerAction: 'passthrough',
        subtitleAction: 'ignore',
      },
      explanation: 'HLS playlist: played natively by hls.js, which demuxes and decrypts it.',
    };
  }

  if (containerPlayable && videoPlayable && audioPlayable) {
    return {
      directPlayable: true,
      strategy: 'DIRECT',
      plan: {
        videoAction: 'none',
        audioAction: 'none',
        selectedAudioIndex: audioIndex,
        containerAction: 'passthrough',
        subtitleAction: 'ignore',
      },
      explanation: `Plays natively: ${metadata.formatName} / ${video?.codec ?? 'no video'} / ${
        track?.codec ?? 'no audio'
      }.`,
    };
  }

  const reasons: string[] = [];
  if (!containerPlayable) reasons.push(`${metadata.formatName} cannot be demuxed by the browser`);
  if (!videoPlayable && video) {
    reasons.push(
      `${video.codec.toUpperCase()}${
        video.bitDepth > 8 ? ` ${video.bitDepth}-bit` : ''
      } video has no decoder here`
    );
  }
  if (!audioPlayable && track) {
    reasons.push(
      track.playable
        ? `${track.channels}-channel audio is downmixed to stereo`
        : `${track.codec.toUpperCase()} audio has no decoder here`
    );
  }

  // Only the wrapper is wrong. Both streams copied — the cheap case, and by
  // PRD-38's count the most common one across the whole provider corpus.
  if (videoPlayable && audioPlayable) {
    return {
      directPlayable: false,
      strategy: 'REMUX_CONTAINER',
      plan: {
        videoAction: 'copy',
        audioAction: 'copy',
        selectedAudioIndex: audioIndex,
        containerAction: 'mp4_fragmented',
        subtitleAction,
      },
      explanation: `Repackaged without re-encoding: ${reasons.join('; ')}.`,
    };
  }

  if (videoPlayable && !audioPlayable) {
    return {
      directPlayable: false,
      strategy: 'AUDIO_TRANSCODE',
      plan: {
        videoAction: 'copy',
        audioAction: 'transcode',
        targetAudioCodec: 'aac',
        selectedAudioIndex: audioIndex,
        containerAction: 'mp4_fragmented',
        subtitleAction,
      },
      explanation: `Audio re-encoded, video copied untouched: ${reasons.join('; ')}.`,
    };
  }

  const { action, targetHeight } = videoTranscodeAction(video?.height ?? 0, host);
  const guardNote =
    action === 'downscale'
      ? ` Scaled to ${targetHeight}p: software encoding ${describeResolution(
          video?.width ?? 0,
          video?.height ?? 0
        )} runs at about half realtime, which stalls playback after a few seconds.`
      : '';

  return {
    directPlayable: false,
    strategy: audioPlayable ? 'VIDEO_TRANSCODE' : 'FULL_TRANSCODE',
    plan: {
      videoAction: action,
      targetVideoCodec: 'h264',
      targetPixelFormat: 'yuv420p',
      targetHeight,
      hardwareAccelerator: host.accelerator,
      audioAction: audioPlayable ? 'copy' : 'transcode',
      targetAudioCodec: audioPlayable ? undefined : 'aac',
      selectedAudioIndex: audioIndex,
      containerAction: 'mp4_fragmented',
      subtitleAction,
    },
    explanation: `Video re-encoded to H.264 via ${host.accelerator.toUpperCase()}: ${reasons.join(
      '; '
    )}.${guardNote}`,
  };
}

export const DECISION_CONSTANTS = {
  MAX_DIRECT_CHANNELS,
  SOFTWARE_ENCODE_MAX_HEIGHT,
  SOFTWARE_4K_CORE_THRESHOLD,
};

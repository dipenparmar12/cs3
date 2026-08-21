import type {
  AudioStreamMetadata,
  HostEncodeCapability,
  MediaMetadata,
  MediaTransport,
  NativeEngineCapability,
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
  'ac3', 'eac3', 'ec-3', 'dts', 'dtshd', 'dca', 'dts-hd ma', 'dts-hd hra', 'dts:x', 'dts_express', 'truehd', 'mlp',
  'pcm_bluray', 'pcm_dvd', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_s16be', 'pcm_s24be', 'pcm_f32le', 'pcm_f64le', 'pcm_u8', 'pcm_alaw', 'pcm_mulaw',
  'wma', 'wmav1', 'wmav2', 'wmapro', 'wmalossless', 'wmavoice',
  'cook', 'ra_144', 'ra_288', 'atrac3', 'atrac3p', 'sipr',
  'mp2', 'mp1', 'ape', 'tta', 'wavpack', 'shorten', 'tak', 'amr_nb', 'amr_wb', 'speex', 'g729', 'g723_1', 'g726',
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
  'hevc', 'h265', 'mpeg2video', 'mpeg1video', 'vc1', 'wmv1', 'wmv2', 'wmv3', 'wvc1',
  'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'mpeg4', 'msvideo1', 'divx',
  'prores', 'dnxhd', 'cinepak', 'rv10', 'rv20', 'rv30', 'rv40', 'vp6', 'vp6f', 'vp6a', 'vp7', 'flv1', 'theora',
  'h263', 'h263p', 'h263i', 'svq1', 'svq3', 'indeo3', 'indeo4', 'indeo5', 'mjpeg', 'mjpegb', 'dvvideo',
  'qtrle', 'rawvideo', 'vvc', 'h266',
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

/**
 * What may be *copied* into each output container, and why this is two
 * questions rather than one.
 *
 * A stream copy needs both to hold, and treating them as a single "is this
 * playable" flag produced a real failure in each direction:
 *
 * 1. **ffmpeg must be able to mux it.** Measured, not looked up: `libvpx` into
 *    fragmented MP4 fails with `Could not find tag for codec vp8 in stream #0,
 *    codec not currently supported in container`, and the command dies at the
 *    header. A Matroska carrying VP8 has both streams the browser can decode,
 *    so it took the copy path and produced nothing at all.
 * 2. **The browser must decode it *in that container*.** ffmpeg writes Vorbis
 *    into MP4 quite happily — verified — and Chromium will not play it, because
 *    Vorbis is supported only in WebM and Ogg. This one is the worse of the two:
 *    the command succeeds, so anything checking an exit status believes it
 *    worked, and the viewer gets a silent black player.
 *
 * The mux tables are deliberately *broad* — HEVC, AC-3 and E-AC-3 are all legal
 * in MP4 — because whether a decoder exists is a separate question that
 * `canPlayVideo` and `UNSUPPORTED_AUDIO` already answer, and one of them is
 * measured at runtime. Folding "no decoder" into "cannot be muxed" would force a
 * re-encode on the builds that grew a platform HEVC decoder, which is the exact
 * thing the runtime capability override exists to avoid.
 */
const MP4_MUXABLE_VIDEO = new Set([
  'h264', 'avc1', 'hevc', 'h265', 'hvc1', 'vp9', 'av1', 'av01', 'mpeg4', 'mpeg2video', 'vvc', 'h266',
]);
const MP4_MUXABLE_AUDIO = new Set([
  'aac', 'mp4a', 'mp3', 'ac3', 'eac3', 'ec-3', 'opus', 'flac', 'alac', 'dts', 'dca', 'vorbis',
]);
const WEBM_MUXABLE_VIDEO = new Set(['vp8', 'vp9', 'av1', 'av01']);
const WEBM_MUXABLE_AUDIO = new Set(['opus', 'vorbis']);

/**
 * Codecs the browser decodes elsewhere but not inside this container.
 *
 * Only MP4 has entries, and only one that matters: Vorbis. It is a WebM/Ogg
 * codec as far as Chromium is concerned, and MP4 is the wrapper everything else
 * in this pipeline targets, so without this a WebM-sourced Vorbis track is
 * quietly repackaged into something that plays no audio.
 */
const MP4_UNDECODABLE = new Set(['vorbis', 'vp8']);

/**
 * The cheapest container that can carry these codecs untouched, or `null`.
 *
 * `null` is the important answer: no wrapper exists that both ffmpeg will write
 * and the browser will play for this combination — VP8 beside AAC is the
 * canonical case, legal in neither — so a copy is impossible and one of the
 * streams has to be re-encoded. Returning a container anyway is what produced
 * the original bug.
 *
 * MP4 is preferred where both work: it is what the rest of the pipeline is
 * built around (fragmented, seekable by restart, one `Content-Type`), and WebM
 * is reached only by codecs MP4 will not take.
 *
 * Callers must already have established that the codecs *have* decoders; this
 * answers only where they can be put.
 */
export function chooseCopyContainer(
  videoCodec: string | undefined,
  audioCodec: string | undefined
): 'mp4_fragmented' | 'webm' | null {
  const video = videoCodec?.toLowerCase();
  const audio = audioCodec?.toLowerCase();

  // An absent stream constrains nothing — audio-only and video-only both remux.
  const fits = (codec: string | undefined, muxable: Set<string>, blocked?: Set<string>) =>
    !codec || (muxable.has(codec) && !blocked?.has(codec));

  if (fits(video, MP4_MUXABLE_VIDEO, MP4_UNDECODABLE) && fits(audio, MP4_MUXABLE_AUDIO, MP4_UNDECODABLE)) {
    return 'mp4_fragmented';
  }
  if (fits(video, WEBM_MUXABLE_VIDEO) && fits(audio, WEBM_MUXABLE_AUDIO)) return 'webm';
  return null;
}

/** Whether an audio stream survives the move into MP4 — Vorbis does not. */
function audioCopyableIntoMp4(codec?: string): boolean {
  if (!codec) return true;
  const lower = codec.toLowerCase();
  return MP4_MUXABLE_AUDIO.has(lower) && !MP4_UNDECODABLE.has(lower);
}

/** Whether one stream alone could be copied into the container we would target. */
/**
 * The MP4 sample entry to write for a video stream being copied.
 *
 * HEVC is the only codec that needs saying. ffmpeg's MP4 muxer defaults to the
 * `hev1` entry when copying HEVC, and browsers accept only `hvc1` — so a remux
 * that looks perfect (exit 0, valid MP4, both codecs decodable) produces a
 * player showing nothing. WebM has no sample entries, so the question does not
 * arise there.
 */
function videoTagFor(
  container: 'mp4_fragmented' | 'webm',
  codec?: string
): 'hvc1' | undefined {
  if (container !== 'mp4_fragmented') return undefined;
  const name = (codec ?? '').toLowerCase();
  return name === 'hevc' || name === 'h265' ? 'hvc1' : undefined;
}

function videoCopyableInto(container: 'mp4_fragmented' | 'webm', codec?: string): boolean {
  if (!codec) return true;
  const lower = codec.toLowerCase();
  if (container === 'webm') return WEBM_MUXABLE_VIDEO.has(lower);
  return MP4_MUXABLE_VIDEO.has(lower) && !MP4_UNDECODABLE.has(lower);
}

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

/**
 * Multichannel: more than stereo, and therefore something a downmix throws away.
 *
 * The first version of this rule routed only *lossless* audio — TrueHD, DTS-HD
 * MA, DTS:X — on the theory that AC-3 and E-AC-3 5.1 were a recoverable loss and
 * that routing them would push most television releases out of the in-app player
 * for a few percent of one core.
 *
 * **A user's own catalogue disproved the premise.** The report was "this happens
 * on most of the content", with `Audio re-encoded, video copied untouched:
 * matroska,webm cannot be demuxed by the browser; EAC3 audio has no decoder
 * here` on title after title — a 1080p WEB-DL with E-AC-3 5.1 in Matroska is not
 * an edge case, it is the modal release. So the rule the old comment described
 * as protecting the common case was in fact degrading it: nearly every film and
 * episode played back as stereo, permanently, while the 5.1 sat unused in a file
 * the machine could decode on its GPU for free.
 *
 * The line is now channels rather than codec. Anything above stereo that would
 * be downmixed goes to the native engine; genuine stereo stays in the app, where
 * a container remux costs nothing and loses nothing.
 */
const LOSSLESS_OR_OBJECT_AUDIO = new Set([
  'truehd', 'mlp', 'dtshd', 'dts-hd ma', 'dts-hd hra', 'dts:x',
  'pcm_bluray', 'pcm_dvd', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_s16be', 'pcm_s24be',
  'flac', 'alac', 'ape', 'tta', 'wavpack',
]);

/** The engine is absent unless a caller says otherwise, which keeps every existing decision intact. */
const NO_NATIVE_ENGINE: NativeEngineCapability = { available: false, policy: 'off' };

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
  const c = codec.toLowerCase();
  if (c.startsWith('adpcm_') || c.startsWith('pcm_')) return false;
  return !UNSUPPORTED_AUDIO.has(c);
}

/**
 * Whether this build can decode this video stream **at this bit depth and chroma format**.
 *
 * Bit depth and chroma subsampling are validated strictly: Chromium's built-in
 * H.264 engine only supports 8-bit YUV 4:2:0. High chroma subsampling (4:2:2, 4:4:4,
 * RGB) and 10/12-bit profiles (Hi10P, Main 10) require hardware/transcoder mapping.
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

  // High chroma subsampling (4:2:2, 4:4:4, RGB) is never decodable by Chromium's video pipeline
  if (pixelFormat && (/422|444|gbr|rgb/i.test(pixelFormat))) {
    return false;
  }

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

/**
 * Re-derives the audio half of a plan for a different track.
 *
 * A plan is built for the track it selected, and switching to another one is not
 * a matter of changing an index: the new track may need transcoding where the
 * old one was copied. Caught by the pipeline test rather than reasoned about —
 * switching to a 6-channel AC-3 track under a plan that copied stereo AAC made
 * ffmpeg refuse outright with `Cannot write moov atom before AC3 packets`,
 * because AC-3 in MP4 takes its extradata from the first packet and the
 * fragmented output writes its header before one exists.
 *
 * The user-visible form of that bug is the worst kind: the viewer picks the
 * Hindi dub and playback stops, with the failure attributed to the source.
 */
export function planForAudioTrack(
  plan: TransformationPlan,
  track: AudioStreamMetadata | undefined
): TransformationPlan {
  if (!track) return { ...plan, selectedAudioIndex: -1, audioAction: 'none' };
  const playable = track.playable && track.channels <= MAX_DIRECT_CHANNELS;
  return {
    ...plan,
    selectedAudioIndex: track.index,
    audioAction: playable ? 'copy' : 'transcode',
    targetAudioCodec: playable ? undefined : 'aac',
  };
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
 * What the *browser* side would do with this stream, ignoring mpv entirely.
 *
 * Kept separate from {@link decideStrategy} so the transcoding ladder stays a
 * complete, testable answer on its own: it is what runs on every machine with no
 * native engine installed, and it is the fallback when mpv fails to start.
 */
function decideBrowserStrategy(
  metadata: MediaMetadata,
  transport: MediaTransport,
  capabilities: RendererCapabilities | null,
  host: HostEncodeCapability,
  requiresEme: boolean
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

  /**
   * Only the wrapper is wrong. Both streams copied — the cheap case, and by
   * PRD-38's count the most common one across the whole provider corpus.
   *
   * The container is *chosen*, not assumed, and that is the fix for the reported
   * `Repackaged without re-encoding: matroska,webm cannot be demuxed by the
   * browser`. That message was truthful about the input and silent about the
   * output, and for VP8 the output did not exist: ffmpeg refuses to write VP8
   * into MP4 and the whole command dies at the header. `chooseCopyContainer`
   * answers `webm` for exactly those codecs and `null` when no wrapper can carry
   * them, in which case a copy is impossible and the branches below re-encode.
   */
  const copyContainer =
    videoPlayable && audioPlayable ? chooseCopyContainer(video?.codec, track?.codec) : null;

  if (copyContainer) {
    return {
      directPlayable: false,
      strategy: 'REMUX_CONTAINER',
      plan: {
        videoAction: 'copy',
        audioAction: 'copy',
        selectedAudioIndex: audioIndex,
        containerAction: copyContainer,
        videoTag: videoTagFor(copyContainer, video?.codec),
        subtitleAction,
      },
      explanation:
        `Repackaged into ${copyContainer === 'webm' ? 'WebM' : 'fragmented MP4'} ` +
        `without re-encoding: ${reasons.join('; ')}.`,
    };
  }

  /**
   * Audio alone is re-encoded — but only into a container that will take the
   * video being copied beside it.
   *
   * AAC is the target and AAC is MP4-only among our outputs, so a VP8 video
   * cannot be copied next to it: that pair is legal in neither wrapper. When the
   * video would not survive the move, the branch below re-encodes both, which
   * is more expensive and is the only thing that actually plays.
   */
  if (videoPlayable && !audioPlayable && videoCopyableInto('mp4_fragmented', video?.codec)) {
    return {
      directPlayable: false,
      strategy: 'AUDIO_TRANSCODE',
      plan: {
        videoAction: 'copy',
        audioAction: 'transcode',
        targetAudioCodec: 'aac',
        selectedAudioIndex: audioIndex,
        containerAction: 'mp4_fragmented',
        videoTag: videoTagFor('mp4_fragmented', video?.codec),
        subtitleAction,
      },
      explanation: `Audio re-encoded, video copied untouched: ${reasons.join('; ')}.`,
    };
  }

  if (videoPlayable && !audioPlayable) {
    reasons.push(
      `${(video?.codec ?? 'that video').toUpperCase()} cannot be carried beside AAC in any ` +
        'container the browser plays'
    );
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
      /**
       * The video is being re-encoded to H.264, which fixes the container to
       * MP4 — so audio that MP4 will not carry has to be re-encoded too, even
       * though the browser could decode it as it stands. Vorbis is the case:
       * playable, and unplayable in the wrapper this output has to use.
       */
      audioAction:
        audioPlayable && audioCopyableIntoMp4(track?.codec) ? 'copy' : 'transcode',
      targetAudioCodec:
        audioPlayable && audioCopyableIntoMp4(track?.codec) ? undefined : 'aac',
      selectedAudioIndex: audioIndex,
      containerAction: 'mp4_fragmented',
      subtitleAction,
    },
    explanation: `Video re-encoded to H.264 via ${host.accelerator.toUpperCase()}: ${reasons.join(
      '; '
    )}.${guardNote}`,
  };
}

/**
 * Whether the native engine should take this stream off ffmpeg's hands.
 *
 * Applied *after* the browser-side decision rather than instead of it, and that
 * ordering is deliberate: the transcoding ladder stays the thing that decides
 * what a stream needs, and this only answers "and is that worth doing here?".
 * Remove mpv from the machine and every decision reverts exactly to what it was,
 * with no second code path to keep correct.
 *
 * The rules, and what each is protecting:
 *
 * - **Encrypted streams never route.** mpv holds no CDM. Handing it a Widevine
 *   stream produces the same undecryptable noise ffmpeg would, minus the EME
 *   pipeline that could actually have played it.
 * - **Streams that already play natively never route.** The in-app player is the
 *   better experience — one window, our controls, our subtitles — and spending
 *   that to avoid CPU which was never being spent is a straight loss.
 * - **Under `auto`, any re-encode of the video routes.** This is the case the
 *   engine exists for: the only strategy that is both expensive and lossy, and
 *   the one that on a software-only host downscales 4K to 1080p or fails to hold
 *   realtime at all.
 * - **Under `auto`, audio that would be downmixed routes.** Anything above
 *   stereo, plus lossless and object-based formats at any channel count. See
 *   {@link LOSSLESS_OR_OBJECT_AUDIO} for why this is channels rather than codec.
 * - **Under `aggressive`, anything not already playing natively routes** —
 *   including the cheap remux, which still flattens 5.1 to stereo.
 */
export function shouldRouteToNativeEngine(
  decision: StrategyDecision,
  metadata: MediaMetadata,
  native: NativeEngineCapability
): boolean {
  if (!native.available || native.policy === 'off') return false;
  if (decision.strategy === 'EME_NATIVE') return false;
  if (decision.strategy === 'DIRECT' || decision.strategy === 'HLS_NATIVE') return false;

  if (native.policy === 'aggressive') return true;

  if (decision.strategy === 'VIDEO_TRANSCODE' || decision.strategy === 'FULL_TRANSCODE') {
    return true;
  }

  /**
   * The plan names the track it selected; asking about any other one would
   * reason about audio nobody is going to hear.
   */
  const selected = metadata.audio.find(
    (track) => track.index === decision.plan.selectedAudioIndex
  );
  if (!selected || decision.plan.audioAction !== 'transcode') return false;

  /**
   * A downmix is the loss worth a window; a codec swap on stereo is not.
   *
   * `MAX_DIRECT_CHANNELS` is the same constant the browser path uses to decide
   * it must flatten the track, so this asks exactly the question "is the app
   * about to throw away speakers?" — the answer that made E-AC-3 5.1, the modal
   * provider release, play back in stereo on every title.
   */
  if (selected.channels > MAX_DIRECT_CHANNELS) return true;

  return LOSSLESS_OR_OBJECT_AUDIO.has(selected.codec.toLowerCase());
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
/**
 * The last gate before a plan is acted on: if its output would not play, don't
 * emit it.
 *
 * Every branch above is reasoned through and this still earns its place, for
 * the same reason `predictOutput` does — the expensive failures here are the
 * ones where every individual step looks right. A full re-encode is the one
 * answer that is always available, so an unplayable plan is escalated to it
 * rather than shipped and discovered by the viewer.
 *
 * Strategies that do not go through ffmpeg at all are left alone: `EME_NATIVE`
 * is decrypted by the browser, `HLS_NATIVE` is demuxed by hls.js, and neither
 * produces an output this can predict.
 */
function validated(
  decision: StrategyDecision,
  metadata: MediaMetadata,
  capabilities: RendererCapabilities | null,
  host: HostEncodeCapability
): StrategyDecision {
  if (decision.plan.containerAction === 'passthrough') return decision;

  const predicted = predictOutput(metadata, decision.plan, capabilities);
  if (predicted.playable) return decision;

  const { action, targetHeight } = videoTranscodeAction(metadata.video?.height ?? 0, host);
  return {
    directPlayable: false,
    strategy: 'FULL_TRANSCODE',
    plan: {
      videoAction: action,
      targetVideoCodec: 'h264',
      targetPixelFormat: 'yuv420p',
      targetHeight,
      hardwareAccelerator: host.accelerator,
      audioAction: decision.plan.selectedAudioIndex >= 0 ? 'transcode' : 'none',
      targetAudioCodec: decision.plan.selectedAudioIndex >= 0 ? 'aac' : undefined,
      selectedAudioIndex: decision.plan.selectedAudioIndex,
      containerAction: 'mp4_fragmented',
      subtitleAction: decision.plan.subtitleAction,
    },
    explanation:
      'Fully re-encoded: the cheaper plan would have produced something this ' +
      `browser cannot play (${predicted.problems.join('; ')}).`,
  };
}

export function decideStrategy(
  metadata: MediaMetadata,
  transport: MediaTransport,
  capabilities: RendererCapabilities | null,
  host: HostEncodeCapability,
  /** True for ClearKey/Widevine/PlayReady. AES-128 HLS is *not* one of these. */
  requiresEme = false,
  native: NativeEngineCapability = NO_NATIVE_ENGINE
): StrategyDecision {
  const decision = validated(
    decideBrowserStrategy(metadata, transport, capabilities, host, requiresEme),
    metadata,
    capabilities,
    host
  );
  if (!shouldRouteToNativeEngine(decision, metadata, native)) return decision;

  /**
   * The plan is emptied rather than carried over.
   *
   * mpv demuxes, decodes and renders the whole thing itself, so every field here
   * would describe work nobody is going to do. Leaving a `transcode` in it is a
   * live trap for the next reader of `mediaTranscoder`, which takes a plan and
   * builds ffmpeg arguments from it without asking which strategy produced it.
   */
  return {
    directPlayable: false,
    strategy: 'NATIVE_MPV',
    plan: {
      videoAction: 'none',
      audioAction: 'none',
      selectedAudioIndex: decision.plan.selectedAudioIndex,
      containerAction: 'passthrough',
      subtitleAction: 'ignore',
    },
    /**
     * The browser-side reason is kept, because it is still the answer to "why
     * can this not just play?". What changes is what is done about it.
     */
    explanation:
      'Played by the native engine (mpv) with hardware decoding, untouched: ' +
      `${decision.explanation.replace(/\.$/, '')}. Nothing is re-encoded, so the ` +
      'resolution, HDR and full channel layout are preserved.',
  };
}

/**
 * What a plan will actually produce, and whether the browser can play it.
 *
 * The rule this enforces, from the reported failure: **a remux is not
 * successful because ffmpeg exited zero.** Two different things can go wrong
 * after a plan looks reasonable, and neither is visible from the exit status:
 *
 * - ffmpeg refuses the mux (VP8 into MP4) and the command dies at the header,
 *   which at least fails loudly;
 * - ffmpeg writes it happily and Chromium cannot decode the result (Vorbis into
 *   MP4, verified both ways), which fails *silently* as a black player.
 *
 * So the output is predicted from the plan and checked before anything runs.
 * Pure, because that is what makes it testable against the same matrix the
 * decisions are.
 */
export interface PredictedOutput {
  container: 'source' | 'mp4' | 'webm';
  videoCodec?: string;
  audioCodec?: string;
  mimeType: string;
  /** Empty when the output is playable; each entry names one reason it is not. */
  problems: string[];
  playable: boolean;
}

export function predictOutput(
  metadata: MediaMetadata,
  plan: TransformationPlan,
  capabilities: RendererCapabilities | null
): PredictedOutput {
  // Passthrough hands the source over untouched, so the source is the output.
  if (plan.containerAction === 'passthrough') {
    return {
      container: 'source',
      videoCodec: metadata.video?.codec,
      audioCodec: metadata.audio[plan.selectedAudioIndex]?.codec,
      mimeType: 'application/octet-stream',
      problems: [],
      playable: true,
    };
  }

  const container = plan.containerAction === 'webm' ? 'webm' : 'mp4';
  const sourceAudio = metadata.audio.find((track) => track.index === plan.selectedAudioIndex);

  const videoCodec =
    plan.videoAction === 'none'
      ? metadata.video?.codec
      : plan.videoAction === 'copy'
        ? metadata.video?.codec
        : (plan.targetVideoCodec ?? 'h264');
  const audioCodec =
    plan.selectedAudioIndex < 0
      ? undefined
      : plan.audioAction === 'transcode'
        ? (plan.targetAudioCodec ?? 'aac')
        : sourceAudio?.codec;

  const problems: string[] = [];

  // 1. Will ffmpeg write it, and will the browser read it, in this container?
  const videoMuxable = container === 'webm' ? WEBM_MUXABLE_VIDEO : MP4_MUXABLE_VIDEO;
  const audioMuxable = container === 'webm' ? WEBM_MUXABLE_AUDIO : MP4_MUXABLE_AUDIO;
  const blocked = container === 'webm' ? undefined : MP4_UNDECODABLE;

  if (videoCodec && !videoMuxable.has(videoCodec.toLowerCase())) {
    problems.push(`${videoCodec} cannot be muxed into ${container}`);
  } else if (videoCodec && blocked?.has(videoCodec.toLowerCase())) {
    problems.push(`${videoCodec} is not decodable inside ${container}`);
  }
  if (audioCodec && !audioMuxable.has(audioCodec.toLowerCase())) {
    problems.push(`${audioCodec} cannot be muxed into ${container}`);
  } else if (audioCodec && blocked?.has(audioCodec.toLowerCase())) {
    problems.push(`${audioCodec} is not decodable inside ${container}`);
  }

  // 2. Independently: is there a decoder for it at all? A container that
  //    accepts a stream is no use if nothing can decode what is inside it.
  if (videoCodec && !canPlayVideo(videoCodec, plan.targetPixelFormat, capabilities)) {
    problems.push(`${videoCodec} has no decoder here`);
  }
  if (audioCodec && UNSUPPORTED_AUDIO.has(audioCodec.toLowerCase())) {
    problems.push(`${audioCodec} has no decoder here`);
  }

  // 3. The downmix rule, applied to the output rather than the input: copying a
  //    6-channel track forward leaves the dialogue-routing problem in place.
  const outputChannels = plan.audioAction === 'transcode' ? 2 : (sourceAudio?.channels ?? 0);
  if (outputChannels > MAX_DIRECT_CHANNELS) {
    problems.push(`${outputChannels}-channel audio would not route correctly`);
  }

  return {
    container,
    videoCodec,
    audioCodec,
    mimeType: container === 'webm' ? 'video/webm' : 'video/mp4',
    problems,
    playable: problems.length === 0,
  };
}

export const DECISION_CONSTANTS = {
  MAX_DIRECT_CHANNELS,
  SOFTWARE_ENCODE_MAX_HEIGHT,
  SOFTWARE_4K_CORE_THRESHOLD,
};

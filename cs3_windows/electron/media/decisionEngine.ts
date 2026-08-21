import { clearKeysToHex } from '../../src/utils/clearKey.ts';
import type {
  AudioStreamMetadata,
  DrmConfiguration,
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
 * The pixel rate the core threshold was actually measured against.
 *
 * `SOFTWARE_4K_CORE_THRESHOLD` says "16 threads clear realtime at 4K", and for
 * as long as 4K was the largest thing anyone streamed that was the whole rule.
 * It is not any more: 8K is four times the pixels of 4K, so a 16-thread machine
 * that holds 1.0x at 3840x2160 holds roughly 0.25x at 7680x4320 — and the guard
 * as written let it through at full resolution, producing exactly the stall the
 * guard exists to prevent, on the most expensive files in the corpus.
 *
 * Expressing the threshold as pixels per second instead of as a height keeps the
 * same measured verdicts at 4K and extends them: the question is how much work
 * the encoder has to do, and height alone stopped answering it once resolutions
 * above 4K became ordinary.
 */
const UHD_PIXELS = 3840 * 2160;

/**
 * Resolutions above 4K, which the browser path should not attempt at all.
 *
 * Even where a host *could* encode 8K in realtime, the result is handed to a
 * Chromium decoder that has to keep up as well, and the memory cost of an 8K
 * surface is four times a 4K one. The native engine decodes it on the GPU
 * untouched, which is both cheaper and better — so above 4K, routing is not an
 * optimisation, it is the only thing that plays.
 */
const ABOVE_UHD_HEIGHT = 2160;

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

/** Unencrypted unless a caller says otherwise, for the same reason. */
const NO_DRM: DrmConfiguration = { type: 'none' };

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
  host: HostEncodeCapability,
  width = 0
): { action: 'transcode' | 'downscale'; targetHeight?: number } {
  if (host.hardware) return { action: 'transcode' };
  if (height <= SOFTWARE_ENCODE_MAX_HEIGHT) return { action: 'transcode' };

  /**
   * How much encoding this frame size actually asks for, relative to the 4K
   * frame the core threshold was measured on.
   *
   * Width is used when the source reports it and derived from a 16:9 frame when
   * it does not — an anamorphic or ultra-wide 2160-tall frame is more pixels
   * than a 3840x2160 one, and the old height-only test called them equal.
   */
  const pixels = (width || Math.round((height * 16) / 9)) * height;
  /**
   * `Math.max(1, …)` is what keeps every verdict measured at or below 4K
   * exactly as it was. The threshold only *rises* with frame size, so this
   * tightens the guard where it was wrong — above 4K — and changes nothing
   * where it was measured.
   */
  const budget = SOFTWARE_4K_CORE_THRESHOLD * Math.max(1, pixels / UHD_PIXELS);

  if (host.logicalCores < budget) {
    return { action: 'downscale', targetHeight: SOFTWARE_ENCODE_MAX_HEIGHT };
  }
  return { action: 'transcode' };
}

/**
 * Whether this stream can only be decrypted by a CDM in the renderer.
 *
 * HLS AES-128 and SAMPLE-AES are deliberately **not** in this set. hls.js
 * fetches the key over HTTP and decrypts in JavaScript, so routing them to an
 * EME path they do not need would break streams that work today. `unknown` is
 * in the set: an unrecognised system is exactly as unreadable to FFmpeg as a
 * recognised one, and the whole purpose of the verdict is to keep FFmpeg off it.
 */
export function requiresEmeDecryption(drm: DrmConfiguration): boolean {
  return (
    drm.type === 'clearkey' ||
    drm.type === 'widevine' ||
    drm.type === 'playready' ||
    drm.type === 'unknown'
  );
}

/** The ClearKey pairs, in FFmpeg's hex form, when there are usable ones. */
export function decryptableClearKeys(drm: DrmConfiguration): Record<string, string> | null {
  if (drm.type !== 'clearkey' || !drm.clearKeys) return null;
  const hex = clearKeysToHex(drm.clearKeys);
  return Object.keys(hex).length > 0 ? hex : null;
}

/**
 * Why an encrypted stream is being handed to the renderer, and what to expect.
 *
 * The distinction this draws is the one a viewer actually needs. A ClearKey
 * stream with its keys attached is going to play; a Widevine one is not, because
 * this app ships no CDM. Reporting both as "encrypted stream" made a working
 * case and an impossible one look identical, and sent people looking for a
 * provider fault in the second.
 */
function explainEme(drm: DrmConfiguration, transport: MediaTransport): string {
  if (drm.type === 'clearkey' && drm.clearKeys) {
    if (transport === 'dash') {
      return (
        'ClearKey-encrypted DASH: played by Shaka Player, which drives Media ' +
        'Source Extensions and decrypts with the key the provider supplied. ' +
        'FFmpeg is bypassed — its DASH demuxer refuses decryption keys outright.'
      );
    }
    return (
      'ClearKey-encrypted: decrypted in the browser with the key the provider ' +
      'supplied. Nothing is re-encoded.'
    );
  }

  if (drm.type === 'widevine' || drm.type === 'playready') {
    const system = drm.type === 'widevine' ? 'Widevine' : 'PlayReady';
    /**
     * Shaka performs the licence exchange, but only a CDM can answer it. On a
     * stock Electron build there is none, so this reports the limit by name
     * rather than failing as a broken file — and the message stays accurate if
     * a CDM-carrying build is ever adopted, because then it simply plays.
     */
    return (
      `${system}-protected stream. The licence exchange is handled, but decrypting ` +
      `needs a ${system} CDM, which a stock Electron build does not ship — the ` +
      'Android app gets one from the device. This is a licensing limit, not a ' +
      'fault in the source or the provider.'
    );
  }

  if (drm.type === 'clearkey') {
    return (
      'ClearKey-encrypted, but the provider supplied no key. Nothing here can ' +
      'decrypt it; FFmpeg is bypassed because it would report the result as a ' +
      'corrupt file rather than as encrypted content.'
    );
  }

  return (
    'Encrypted by a DRM system this build does not recognise. FFmpeg is bypassed ' +
    'because it holds no keys and would report the stream as corrupt.'
  );
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
  drm: DrmConfiguration
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
   * Encrypted content, and the one case where "encrypted" does not mean "not
   * ours".
   *
   * ClearKey is a licence that *is* the key, so when the provider supplied one
   * there are two things that can decrypt the stream: the renderer's EME
   * pipeline, and FFmpeg via `-decryption_keys`. Which one to use is decided by
   * whether anything else about the stream needs work.
   *
   * - Nothing else needs work → EME. It costs nothing and preserves everything.
   * - The codec or the container also needs converting → FFmpeg, which has to
   *   decrypt before it can read a frame anyway. Measured: a CENC file read
   *   without the key probes with correct codec *names* and then decodes to
   *   garbage, which is precisely the "corrupt download" symptom.
   *
   * FFmpeg can only do this on a progressive input. Its DASH demuxer rejects
   * the option outright — `Option decryption_key not found`, fatal to the whole
   * command line rather than ignored — so a DASH ClearKey stream can only go to
   * EME, and needs a JavaScript DASH player to get there. That player is not
   * built; the stream is named accurately instead of failing as a bad file.
   */
  if (requiresEmeDecryption(drm)) {
    const everythingElseIsFine = containerPlayable && videoPlayable && audioPlayable;
    const ffmpegCanDecrypt = Boolean(decryptableClearKeys(drm)) && transport === 'progressive';
    const ffmpegShouldDecrypt = ffmpegCanDecrypt && !everythingElseIsFine;

    /**
     * Encrypted DASH is Shaka's, and this is the case that used to have no
     * answer at all.
     *
     * FFmpeg cannot help — its DASH demuxer refuses decryption keys outright —
     * and a bare `.mpd` handed to the media element is an XML document arriving
     * at a binary demuxer. Shaka drives MSE and owns the EME handshake, so it is
     * the only thing here that can do both. What it cannot do is invent
     * decoders: an encrypted ladder carrying HEVC on a machine without an HEVC
     * decoder still has nowhere to go, and falls through to be reported.
     */
    if (transport === 'dash' && videoPlayable && audioPlayable) {
      return {
        directPlayable: true,
        strategy: 'DASH_NATIVE',
        plan: {
          videoAction: 'none',
          audioAction: 'none',
          selectedAudioIndex: audioIndex,
          containerAction: 'passthrough',
          subtitleAction: 'ignore',
        },
        explanation: explainEme(drm, transport),
      };
    }

    if (!ffmpegShouldDecrypt) {
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
        explanation: explainEme(drm, transport),
      };
    }
    // Falls through: FFmpeg decrypts and converts in one pass. The keys are
    // attached to whichever plan the ladder below produces.
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
    /**
     * Shaka plays it whenever the browser can decode what is inside.
     *
     * The remux below still works and is still the fallback, but it is the
     * expensive way to be worse: it spends an ffmpeg process, and DASH's whole
     * point is the adaptive ladder, which a remux flattens to one fixed
     * rendition. Handing the manifest to a player that speaks DASH keeps every
     * rendition and costs nothing.
     */
    if (videoPlayable && audioPlayable) {
      return {
        directPlayable: true,
        strategy: 'DASH_NATIVE',
        plan: {
          videoAction: 'none',
          audioAction: 'none',
          selectedAudioIndex: audioIndex,
          containerAction: 'passthrough',
          subtitleAction: 'ignore',
        },
        explanation:
          'MPEG-DASH manifest: played by Shaka Player, which drives Media Source ' +
          'Extensions directly and keeps the adaptive ladder.',
      };
    }

    return {
      directPlayable: false,
      strategy: 'DASH_REMUX',
      plan: {
        videoAction: videoPlayable
        ? 'copy'
        : videoTranscodeAction(video?.height ?? 0, host, video?.width ?? 0).action,
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

  const { action, targetHeight } = videoTranscodeAction(video?.height ?? 0, host, video?.width ?? 0);
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
  /**
   * Anything already playing in the browser stays there. `DASH_NATIVE` joins
   * this list rather than being routed: Shaka is playing it natively through
   * MSE, so there is no re-encode to avoid — and under DRM mpv holds no CDM,
   * which would turn a working stream into an unplayable one.
   */
  if (
    decision.strategy === 'DIRECT' ||
    decision.strategy === 'HLS_NATIVE' ||
    decision.strategy === 'DASH_NATIVE'
  ) {
    return false;
  }

  if (native.policy === 'aggressive') return true;

  if (decision.strategy === 'VIDEO_TRANSCODE' || decision.strategy === 'FULL_TRANSCODE') {
    return true;
  }

  /**
   * Above 4K, a container remux is not the cheap answer it is everywhere else.
   *
   * The remux itself stays cheap — it is still a stream copy — but it leaves
   * Chromium decoding the result, and an 8K frame is four times the samples of a
   * 4K one with four times the surface memory behind it. The native engine hands
   * the same bitstream to D3D11VA or NVDEC and spends nothing. This is the
   * resolution tier where "the browser can technically demux it" and "the
   * machine can actually play it" come apart.
   */
  if ((metadata.video?.height ?? 0) > ABOVE_UHD_HEIGHT) return true;

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
 * The two things FFmpeg needs that the ladder itself does not decide.
 *
 * Applied after the strategy rather than inside it, because neither changes
 * *which* strategy is right — they change what the command line has to say once
 * one has been chosen. Folding them into the ladder would mean repeating both at
 * five return sites.
 */
function withFfmpegExtras(
  decision: StrategyDecision,
  metadata: MediaMetadata,
  drm: DrmConfiguration,
  transport: MediaTransport
): StrategyDecision {
  const encoding = decision.plan.videoAction === 'transcode' || decision.plan.videoAction === 'downscale';
  const running = encoding || decision.plan.videoAction === 'copy' || decision.plan.audioAction !== 'none';
  if (!running) return decision;

  /**
   * HDR that is being re-encoded has to be tone-mapped, or it comes out grey.
   *
   * `-pix_fmt yuv420p` converts the *storage* format and says nothing about the
   * transfer function, so a PQ or HLG source re-encoded to 8-bit SDR keeps its
   * HDR-referred values and is displayed as if they were SDR ones: washed out,
   * flat, and desaturated. It is not an error and nothing reports it — the file
   * plays perfectly and simply looks wrong, which is why it survived this long.
   *
   * Only set when the video is actually being re-encoded. A copied stream keeps
   * its own metadata and is displayed correctly by whatever eventually decodes
   * it, and tone-mapping is not something a `-c:v copy` could do anyway.
   */
  const tonemapHdr = encoding && Boolean(metadata.video?.isHdr);

  /**
   * ClearKey, where FFmpeg is the thing that can use it.
   *
   * Progressive only: measured, the DASH demuxer fails the whole command line
   * with `Option decryption_key not found` rather than ignoring it.
   */
  const keys = transport === 'progressive' ? decryptableClearKeys(drm) : null;

  if (!tonemapHdr && !keys) return decision;

  return {
    ...decision,
    plan: {
      ...decision.plan,
      ...(tonemapHdr ? { tonemapHdr: true } : {}),
      ...(keys ? { decryptionKeys: keys } : {}),
    },
    explanation: [
      decision.explanation.replace(/\.$/, ''),
      keys ? 'Decrypted with the ClearKey the provider supplied' : null,
      tonemapHdr ? 'HDR tone-mapped to SDR, which a re-encode to 8-bit needs or the picture comes out grey' : null,
    ]
      .filter(Boolean)
      .join('. ') + '.',
  };
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
  /**
   * What is known about encryption. ClearKey/Widevine/PlayReady take the EME
   * path; HLS AES-128 and SAMPLE-AES are *not* DRM as far as this engine is
   * concerned, because hls.js decrypts them itself.
   */
  drm: DrmConfiguration = NO_DRM,
  native: NativeEngineCapability = NO_NATIVE_ENGINE
): StrategyDecision {
  const browser = decideBrowserStrategy(metadata, transport, capabilities, host, drm);
  const decision = withFfmpegExtras(browser, metadata, drm, transport);
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

export const DECISION_CONSTANTS = {
  MAX_DIRECT_CHANNELS,
  SOFTWARE_ENCODE_MAX_HEIGHT,
  SOFTWARE_4K_CORE_THRESHOLD,
};

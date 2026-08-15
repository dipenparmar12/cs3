# 37 — Universal Media Compatibility & Adaptive Playback Engine

> **Document ID**: `PRD-37-UNIVERSAL-MEDIA-COMPATIBILITY-ENGINE`  
> **Status**: Approved Specification / Architecture Contract  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Baseline**: Android v4.8.0 (`a72f9e6c`), Electron 43+, Windows 10 (1809+) / 11 x64  
> **Generated**: 2026-08-15  

---

## 1. Executive Summary

This document specifies the **Universal Media Compatibility and Adaptive Playback Engine** for CloudStream 3 Desktop (`cs3_windows`). 

The core challenge in porting CloudStream from Android to desktop is that **Android delegates media decoding to ExoPlayer backed by device-level hardware/software decoders (including MediaCodec and `nextlib-media3ext` FFmpeg modules)**, whereas **Electron desktop relies on an embedded Chromium `<video>` renderer whose native container and codec support is strictly restricted**. 

Chromium rejects or fails silently on a significant fraction of real-world community provider streams — notably **2160p / 4K HEVC (H.265, including 10-bit Main 10) streams from GDFlix, Google Drive, and Googleusercontent**, **MKV containers containing H.264/AAC**, and **broadcast audio codecs (AC-3, E-AC-3, DTS, TrueHD)**.

The existing architecture suffered from a critical race condition: media playback was initiated directly on resolved URLs before media inspection had completed. When direct playback failed, fallback logic frequently attempted naive stream copying (`-c:v copy`), which re-wrapped incompatible HEVC/10-bit bitstreams into MP4 without transcoding the video payload, resulting in total playback failure.

The **Universal Media Compatibility Engine** introduces a deterministic, pre-playback media inspection and adaptive translation pipeline between provider source resolution and the Chromium player. The engine inspects the underlying media stream, constructs a **Source Capability Model**, evaluates compatibility against measured Chromium and GPU capabilities, and dynamically selects the least-expensive valid playback strategy (**Direct Playback → Container Remuxing → Audio Transcoding → Video Transcoding → Full Transcoding**). 

The entire process is transparent to the user: clicking "Play" delivers instant, resilient, OTT-grade playback regardless of container, codec, pixel format, or host provider.

---

## 2. Problem Statement & Root Cause Analysis

### 2.1 The Architectural Gap

In upstream Android CloudStream, playback uses ExoPlayer with custom extractors (`UpdatedMatroskaExtractor`, 3,242 lines) and bundled FFmpeg extensions (`nextlib-media3ext`). In Electron, the naive playback flow was:

```text
[ Provider Source Resolution ]
             │
             ▼
     [ Raw Stream URL ]
             │
             ▼
    [ Chromium <video> ] ───► FAILS on MKV, HEVC 10-bit, AC-3, DTS, 4K Google Drive
```

This failed because:
1. **Source metadata was never evaluated before playback began.**
2. **Downloadability was conflated with Direct Playability** (`Downloadable != Directly Playable`).
3. **Chromium's demuxing and decoding limitations were encountered at runtime without prior mediation.**

### 2.2 The Target Architecture

The Universal Media Compatibility Engine replaces this with a strictly sequenced, non-racing pipeline:

```text
             [ Provider Source Resolution ]
                            │
                            ▼
               [ Local Media Proxy Wrap ]
                            │
                            ▼
          [ Pre-Playback Media Inspection (FFprobe) ]
                            │
                            ▼
            [ Source Capability Model Synthesis ]
                            │
                            ▼
             [ Compatibility Decision Engine ]
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
 [ Directly Compatible ]               [ Incompatible / Mixed ]
        │                                       │
        │                                       ▼
        │                            [ Adaptive Playback Engine ]
        │                                       │
        │                        ┌──────────────┼──────────────┐
        │                        ▼              ▼              ▼
        │                    [ Remux ]    [ Audio Xcode ] [ Video Xcode ]
        │                        │              │              │
        │                        └──────────────┼──────────────┘
        │                                       │
        │                                       ▼
        │                           [ Progressive HTTP Stream ]
        │                                       │
        └───────────────────┬───────────────────┘
                            ▼
                [ Normalized Playable Source ]
                            │
                            ▼
                  [ Player Component UI ]
```

---

## 3. Known 2160p / 4K & Codec Compatibility Analysis

### 3.1 The 2160p / 4K GDFlix & Google Drive Failure Mode

High-bitrate 2160p / 4K content hosted on Google Drive, GDFlix, and Googleusercontent presents a convergence of compatibility barriers:

1. **Video Codec & Bit Depth**: 4K releases are almost universally encoded in **HEVC / H.265 Main 10 (`yuv420p10le`)** or **AV1 10-bit**. Chromium on Windows lacks native software decoders for HEVC and only decodes HEVC if platform hardware decoders (MediaFoundation/D3D11) and appropriate OS extensions are active.
2. **Container Mismatch**: GDFlix and Drive-based 4K rips are packaged in Matroska (`.mkv`). Chromium only supports Matroska container demuxing if the streams inside are WebM-compliant (`vp8`, `vp9`, `av1` video + `opus`, `vorbis` audio). An MKV containing H.264/AAC or HEVC/AC-3 cannot be demuxed by Chromium.
3. **HTTP Transport & Redirect Behavior**: Google Drive / Googleusercontent links require specific cookie headers, spoofed `User-Agent`, handle multiple 302/307 redirects, and deliver chunked `206 Partial Content` streams. Direct player `fetch` fails when origin headers are missing.
4. **The False-Positive Trap**: An HEVC 10-bit MKV file downloads at full speed (e.g. 50 MB/s via aria2c) because downloading only requires byte transport. Attempting to feed the same URL directly into `<video src="...">` produces an immediate decode error or a permanent loading stall.

### 3.2 The Silent Audio Drop Bug

Chromium includes no native decoders for **AC-3 (Dolby Digital)**, **E-AC-3 (Dolby Digital Plus / Atmos)**, **DTS**, or **TrueHD**. 

When Chromium encounters an MP4 or MKV with H.264 video and AC-3 audio:
- `video.canPlayType('video/x-matroska')` returns `"maybe"`.
- Chromium successfully decodes the H.264 video frames.
- Chromium **silently drops the audio track**.
- The video plays smoothly, no `error` event is emitted, and decode telemetry shows thousands of video frames decoded and **0 bytes of audio processed**.

The engine must independently analyze and adapt audio streams without forcing unnecessary video transcoding.

---

## 4. Elimination of Probe and Transcode Race Conditions

### 4.1 Root Cause of the Existing Race Condition

In the legacy implementation:
1. `VideoPlayer` mounted and immediately assigned `videoRef.current.src = streamUrl`.
2. Simultaneously, a background `useEffect` invoked `media:probe`.
3. Chromium's media parser crashed on the unsupported HEVC/MKV bitstream within ~150ms.
4. Chromium's `onerror` listener fired, triggering a fallback handler (`forceTranscode`).
5. Because `probe` had not yet completed, the fallback handler assumed `needsVideoTranscode = false` and spawned FFmpeg with `-c:v copy`.
6. FFmpeg re-wrapped the unplayable HEVC stream into an MP4 container.
7. Chromium failed a second time on the resulting MP4 container because the video codec inside was still HEVC 10-bit.

### 4.2 Architectural Guarantees & State Invariants

The new engine enforces the following strict invariants:

| ID | Invariant | Rule |
|---|---|---|
| **INV-RACE-1** | **No Blind Playback** | A media source whose container/codecs are unknown MUST NEVER be attached to the `<video>` element until Media Inspection completes or a valid cached capability record is retrieved. |
| **INV-RACE-2** | **Probe Gate** | `PlaybackSession` transitions to `preparing` phase while probing. The player UI displays a lightweight "Inspecting Media..." indicator rather than an error or frozen black screen. |
| **INV-RACE-3** | **No Copy on Incomplete Probe** | FFmpeg `-c:v copy` MUST NEVER be executed when video codec information is incomplete or unverified. |
| **INV-RACE-4** | **Renderer Capability Synchronization** | Renderer `canPlayType` probe results (`VIDEO_CODEC_PROBES`) must be registered in the main process during application bootstrap before any playback session is initiated. |

---

## 5. Media Inspection Layer (Probe Engine)

### 5.1 Architecture & Range Sampling

The inspection layer (`MediaInspector`) uses `ffprobe` operating over the local `MediaProxy` loopback endpoint. It performs an initial non-destructive header/moov atom probe using HTTP `Range: bytes=0-2097152` (2 MB initial probe buffer), ensuring that 4K remote sources are inspected in under **250ms–600ms** without downloading the full file.

```text
[ Remote Source ] ◄───(Range 0-2MB)───► [ MediaProxy (127.0.0.1) ] ◄────► [ FFprobe JSON ]
```

### 5.2 Detected Media Attributes Schema

```typescript
export interface MediaMetadata {
  /** Container format name(s), e.g. "matroska,webm", "mov,mp4,m4a,3gp,3g2,mj2" */
  formatName: string;
  formatLongName: string;
  mimeType: string;
  durationSeconds: number;
  bitrate: number;
  sizeBytes: number;
  isSeekable: boolean;
  supportsRange: boolean;

  video: VideoStreamMetadata | null;
  audio: AudioStreamMetadata[];
  subtitles: SubtitleStreamMetadata[];
}

export interface VideoStreamMetadata {
  index: number;
  codec: string;              // e.g. "hevc", "h264", "vp9", "av1"
  codecLongName: string;
  profile: string;            // e.g. "Main 10", "High", "Main"
  level: number;              // e.g. 150 (5.0), 153 (5.1)
  bitDepth: number;           // 8, 10, 12
  pixelFormat: string;        // e.g. "yuv420p", "yuv420p10le", "yuv444p"
  width: number;
  height: number;
  aspectRatio: string;
  frameRate: number;
  bitrate?: number;
  colorSpace?: string;        // "bt2020nc", "bt709"
  colorTransfer?: string;     // "smpte2084" (HDR10), "arib-std-b67" (HLG)
  isHdr: boolean;
  isInterlaced: boolean;
}

export interface AudioStreamMetadata {
  index: number;
  codec: string;              // e.g. "aac", "ac3", "eac3", "dts", "truehd", "opus", "mp3"
  codecLongName: string;
  profile?: string;
  channels: number;           // 2, 6 (5.1), 8 (7.1)
  channelLayout?: string;     // "stereo", "5.1(side)", "7.1"
  sampleRate: number;         // 44100, 48000
  bitrate?: number;
  language?: string;          // "eng", "jpn", "spa"
  title?: string;             // "Surround 5.1", "Director Commentary"
  isDefault: boolean;
  isForced: boolean;
}

export interface SubtitleStreamMetadata {
  index: number;
  codec: string;              // e.g. "subrip" (srt), "ass", "ssa", "mov_text", "hdmv_pgs_subtitle"
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
  isBitmap: boolean;          // true for PGS / DVB / VOBSUB
}
```

---

## 6. Source Capability Model

The system formalizes the distinction between transport capabilities and playback capabilities. Every resolved source produces a normalized `SourceCapabilityModel`:

```typescript
export interface SourceCapabilityModel {
  sourceId: string;
  originUrl: string;
  resolvedUrl: string;
  
  // Transport & Delivery
  isDownloadable: boolean;
  supportsRangeRequests: boolean;
  supportsLiveSeeking: boolean;
  isHlsPlaylist: boolean;
  isDashManifest: boolean;
  
  // Inspection & Codec State
  inspectionStatus: 'pending' | 'inspected' | 'failed';
  metadata: MediaMetadata | null;
  
  // Playback Classification
  directPlayable: boolean;
  requiredStrategy: PlaybackStrategyType;
  
  // Stream Transformation Plan
  transformationPlan: TransformationPlan;
}

export type PlaybackStrategyType = 
  | 'DIRECT'              // Native browser playback without modification
  | 'REMUX_CONTAINER'     // Container rewrap (e.g. MKV -> MP4 / WebM), video/audio copied
  | 'AUDIO_TRANSCODE'     // Video copied, audio transcoded to AAC/Opus
  | 'VIDEO_TRANSCODE'     // Video transcoded to H.264/AV1, audio copied
  | 'FULL_TRANSCODE'      // Both video and audio transcoded
  | 'HLS_TRANSMUX';       // Live TS/HLS segment repackaging

export interface TransformationPlan {
  videoAction: 'copy' | 'transcode' | 'downscale' | 'none';
  targetVideoCodec?: 'h264' | 'vp9';
  targetPixelFormat?: 'yuv420p';
  hardwareAccelerator?: 'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'cpu';
  
  audioAction: 'copy' | 'transcode' | 'downmix';
  targetAudioCodec?: 'aac' | 'opus';
  selectedAudioIndex: number;
  
  containerAction: 'passthrough' | 'mp4_fragmented' | 'webm_stream';
  
  subtitleAction: 'embed_passthrough' | 'extract_webvtt' | 'burn_in_fallback' | 'ignore';
}
```

---

## 7. Compatibility Decision Engine

### 7.1 Deterministic Decision Matrix

The Decision Engine evaluates the `MediaMetadata` against measured host capabilities. The decision logic is completely deterministic:

```text
                                [ MediaMetadata ]
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             │ Is Container Playable? (MP4, MOV, WebM, OGG)       │
             └──────────────────────────┬──────────────────────────┘
                                        │
                      ┌─────────────────┴─────────────────┐
                     YES                                 NO
                      │                                   │
       ┌──────────────┴──────────────┐     ┌──────────────┴──────────────┐
       │ Is Video Stream Playable?   │     │ Is Video Stream Playable?   │
       │ (H.264 8-bit, VP9, AV1)     │     │ (H.264 8-bit, VP9, AV1)     │
       └──────────────┬──────────────┘     └──────────────┬──────────────┘
                      │                                   │
               ┌──────┴──────┐                     ┌──────┴──────┐
              YES            NO                   YES            NO
               │              │                    │              │
        ┌──────┴──────┐  ┌────┴────┐        ┌──────┴──────┐  ┌────┴────┐
        │ Is Audio    │  │ Video   │        │ Is Audio    │  │ Full    │
        │ Playable?   │  │ Transcode│        │ Playable?   │  │ Transcode│
        │ (AAC, Opus, │  │ Required│        │ Playable?   │  │ Required│
        │ MP3, FLAC)  │  └─────────┘        └──────┬──────┘  └─────────┘
        └──────┬──────┘                            │
               │                            ┌──────┴──────┐
        ┌──────┴──────┐                    YES            NO
       YES            NO                    │              │
        │              │             ┌──────┴──────┐ ┌─────┴─────┐
  [ DIRECT ]    [ AUDIO XCODE ]      [ REMUX ONLY ]  [ REMUX +   ]
                                     [ (-c copy)  ]  [ AUDIO XCD ]
```

### 7.2 Codec & Container Rule Specifications

| Media Characteristic | Detection Criteria | Chromium Behavior | Engine Strategy |
|---|---|---|---|
| **MP4 / H.264 / AAC** | `container=mp4`, `v=h264 (8-bit)`, `a=aac` | Direct hardware/software decode | `DIRECT` |
| **WebM / VP9 / Opus** | `container=webm`, `v=vp9`, `a=opus` | Direct hardware/software decode | `DIRECT` |
| **MKV / H.264 / AAC** | `container=matroska`, `v=h264`, `a=aac` | Cannot demux MKV container | `REMUX_CONTAINER` (`-c copy`) |
| **MKV / H.264 / AC-3** | `container=matroska`, `v=h264`, `a=ac3` | Container + audio unplayable | `REMUX_CONTAINER` + Audio Transcode (`-c:v copy -c:a aac`) |
| **MP4 / H.264 / E-AC-3** | `container=mp4`, `v=h264`, `a=eac3` | Audio silently dropped | `AUDIO_TRANSCODE` (`-c:v copy -c:a aac`) |
| **MKV / HEVC 8-bit** | `container=matroska`, `v=hevc (8-bit)` | Container + HEVC unplayable | `VIDEO_TRANSCODE` or `FULL_TRANSCODE` |
| **GDFlix 4K HEVC 10-bit** | `v=hevc`, `profile=Main 10`, `pix_fmt=yuv420p10le` | Fails completely | `VIDEO_TRANSCODE` (HEVC 10-bit → H.264 8-bit `yuv420p`) |
| **MKV / DTS-HD MA** | `a=dts`, `profile=DTS-HD MA` | Audio unplayable | Audio Transcode (`-c:a aac -b:a 320k`) |
| **AV1 10-bit in MKV** | `v=av1 (10-bit)`, `container=matroska` | AV1 video playable, MKV unplayable | `REMUX_CONTAINER` (Remux to MP4/WebM `-c copy`) |

---

## 8. Adaptive Playback Strategies & FFmpeg Streaming Pipelines

### 8.1 Strategy A: Direct Playback
Used when container, video codec, bit depth, and selected audio codec are 100% natively supported.
- **Pipeline**: MediaProxy Loopback URL (`http://127.0.0.1:<port>/proxy/<token>`)
- **Overhead**: Zero CPU/GPU transcoding overhead; direct network pipe with header spoofing.

### 8.2 Strategy B: High-Speed Remuxing (`-c copy`)
Used when codecs are compatible, but the container wrapper (e.g. MKV, TS) cannot be demuxed by Chromium.
- **FFmpeg Execution Profile**:
  ```bash
  ffmpeg -loglevel error \
    -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
    -user_agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..." \
    -i "http://127.0.0.1:<proxyPort>/stream/<token>" \
    -map 0:v:0 -map 0:a:<selectedAudioIndex> \
    -c:v copy \
    -c:a copy \
    -movflags frag_keyframe+empty_moov+default_base_moov \
    -f mp4 \
    pipe:1
  ```
- **Performance**: Runs at **25x–40x realtime speed**; CPU utilization < 1%.

### 8.3 Strategy C: Video Transcoding (HEVC / 10-bit Adaptation)
Used when video is encoded in HEVC, 10-bit color, MPEG-2, VC-1, or unsupported profiles.
- **FFmpeg Execution Profile (Hardware Accelerated - NVENC Example)**:
  ```bash
  ffmpeg -loglevel error \
    -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
    -user_agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..." \
    -i "http://127.0.0.1:<proxyPort>/stream/<token>" \
    -map 0:v:0 -map 0:a:<selectedAudioIndex> \
    -c:v h264_nvenc -preset p4 -tune ll -pix_fmt yuv420p \
    -c:a copy \
    -movflags frag_keyframe+empty_moov+default_base_moov \
    -f mp4 \
    pipe:1
  ```
- **FFmpeg Execution Profile (Software Fallback - libx264)**:
  ```bash
  ffmpeg -loglevel error \
    -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
    -i "http://127.0.0.1:<proxyPort>/stream/<token>" \
    -map 0:v:0 -map 0:a:<selectedAudioIndex> \
    -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p \
    -c:a copy \
    -movflags frag_keyframe+empty_moov+default_base_moov \
    -f mp4 \
    pipe:1
  ```

### 8.4 Strategy D: Audio Transcoding & Multi-Track Preservation
Used when video is natively playable (e.g. H.264 or AV1 in MP4), but audio contains AC-3, E-AC-3, DTS, TrueHD.
- **FFmpeg Execution Profile**:
  ```bash
  ffmpeg -loglevel error \
    -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
    -i "http://127.0.0.1:<proxyPort>/stream/<token>" \
    -map 0:v:0 -map 0:a:<selectedAudioIndex> \
    -c:v copy \
    -c:a aac -b:a 256k -ac 2 \
    -movflags frag_keyframe+empty_moov+default_base_moov \
    -f mp4 \
    pipe:1
  ```
- **Performance**: Audio encoding runs at **60x–100x realtime**; latency < 150ms.

### 8.5 Progressive Streaming Transcode (Real-Time HTTP Pipe)

The system MUST NEVER convert the entire file to disk before starting playback. 

Transcoding sessions stream directly through a dedicated loopback HTTP server (`TranscodeServer` on `127.0.0.1:<transcodePort>/session/<sessionId>`):
1. Client requests the transcode stream URL.
2. `TranscodeServer` starts the optimized FFmpeg child process, capturing `stdout` via Node.js stream pipe.
3. Stream headers (`Content-Type: video/mp4`, `Transfer-Encoding: chunked`) are flushed immediately.
4. As soon as the first fragmented MP4 chunk (`ftyp` + initial `moof`/`mdat` box, ~128 KB) is produced, it is piped to the response.
5. Chromium `<video>` begins playback within **300ms–800ms** of user click.

---

## 9. Hardware Acceleration Architecture on Windows

### 9.1 Hardware Acceleration Tiering

Hardware acceleration is critical on Windows to prevent CPU thermal throttling during 4K 60fps / 10-bit HEVC transcoding:

```text
[ Hardware Detection Probe ]
            │
            ├─► 1. NVIDIA NVENC (`h264_nvenc`) ─── (Priority 1)
            ├─► 2. Intel QuickSync (`h264_qsv`) ── (Priority 2)
            ├─► 3. AMD AMF (`h264_amf`) ───────── (Priority 3)
            └─► 4. CPU Fallback (`libx264`) ───── (Priority 4)
```

### 9.2 Encoder Validation & Probe Protocol

The system MUST NOT rely on static string matching from `ffmpeg -encoders`. Hardware encoder availability is validated through an active in-memory synthetic test encode during application startup:
1. Engine attempts a 1-frame test transcode of a synthetic 10-bit surface (`yuv420p10le`) using each candidate encoder.
2. If the GPU driver rejects the profile or fails initialization, the candidate is blacklisted for the session, falling back to the next available tier.
3. If all hardware encoders fail, `libx264` with `-preset veryfast` is selected.

---

## 10. Media Proxy Integration & Provider Special Handling

### 10.1 Loopback Proxy Responsibilities

The `MediaProxy` subsystem (`electron/mediaProxy.ts`) acts as the secure network intermediary between upstream third-party CDNs and the local playback/transcoding stack.

```text
[ Provider URL ] ──► [ MediaProxy (127.0.0.1) ] ──► [ MediaInspector (FFprobe) ]
                            │
                            ├──► [ Transcode Engine (FFmpeg) ]
                            │
                            └──► [ Chromium <video> ]
```

### 10.2 GDFlix / Google Drive / Googleusercontent Handling

GDFlix and Google Drive sources enforce strict anti-scraping and CDN access controls:
- **Header Injection**: Must forward exact headers (`Referer`, `User-Agent`, `Cookie`, `Origin`, `Authorization`).
- **Referer Scheme Alignment**: Fixes `ERR_BLOCKED_BY_CLIENT` when proxying `http://` streams originating from `https://` provider pages.
- **Redirect Tracking**: Follows up to 10 redirect hops (301, 302, 303, 307, 308) while preserving required cookies and authentication tokens.
- **Stream Auto-Resume**: If a Google Drive CDN resets a TCP connection mid-stream (common after 60–90 minutes), `MediaProxy` transparently reconnects using `Range: bytes=<deliveredOffset>-` and continues streaming without dropping the playback session.

---

## 11. Multi-Audio & Subtitle Compatibility Engine

### 11.1 Multi-Audio Stream Selection

1. `MediaInspector` enumerates all audio streams, detecting codec, channel count, layout, language tag, and stream title.
2. Player UI displays the complete list of audio tracks (e.g. `English [5.1 Surround] (AC3)`, `Japanese [Stereo] (AAC)`).
3. When the user switches audio tracks:
   - If the current stream is remuxed/transcoded, the player requests a stream switch with `-map 0:a:<newIndex>`.
   - The transcode session is smoothly restarted at the current `currentTime` timestamp.

### 11.2 Subtitle Handling Architecture

| Subtitle Type | Source Location | Handling Strategy |
|---|---|---|
| **External WebVTT** | HTTP URL (`.vtt`) | Direct `<track src="...">` attachment. |
| **External SubRip (.srt)** | HTTP URL (`.srt`) | Converted in-memory to WebVTT via `subtitleService.ts` before attachment. |
| **Embedded Text (SRT/VTT)** | Inside MP4/MKV container | Extracted via fast FFprobe demuxer into memory WebVTT track. |
| **Embedded Advanced SSA/ASS** | Inside MKV container | Parsed and rendered via Javascript ASS overlay engine (`jassub` / `libass-wasm`). |
| **Embedded Bitmap (PGS/DVB)** | Inside Blu-ray / MKV rip | Displayed with native bitmap overlay or rendered via subtitle canvas. Video transcoding is NOT forced for subtitles unless requested by user. |

---

## 12. Quality, Resolution & Dynamic Fallback Handling

### 12.1 4K Transcoding Safeguards

Transcoding a 4K HEVC source to 4K H.264 in software can overwhelm low-power CPUs. The engine implements automated performance safeguards:

```text
[ 4K Source Incompatible with Direct Playback ]
                     │
                     ▼
          [ GPU Encoder Available? ]
                     │
             ┌───────┴───────┐
            YES              NO
             │               │
             ▼               ▼
      [ Transcode 4K ]  [ Downscale to 1080p ]
      [ via GPU (NVENC)] [ (-vf scale=-2:1080) ]
```

1. **Resolution Preservation**: If a hardware encoder (NVENC, QSV, AMF) is active, the engine retains original 2160p / 4K resolution.
2. **Software Downscale Guard**: If falling back to CPU software encoding (`libx264`) on a machine with fewer than 8 high-performance cores, the engine automatically downscales 4K video to 1080p (`-vf scale=-2:1080`) to ensure real-time >1.0x encoding speed.

---

## 13. Resilient Error Recovery & Source Lifecycle

### 13.1 Playback Failover Ladder

If an unpredicted failure occurs during playback, the system executes an automated multi-step recovery ladder before prompting the user:

```text
[ Stage 1: Strategy Execution ] (Direct / Remux / Transcode)
              │
           (Error)
              ▼
[ Stage 2: In-Session Re-Evaluation ]
  ├── Re-probe source stream
  ├── Escalate strategy: Direct ──► Remux ──► Audio Xcode ──► Full Xcode
  └── Retry at current playback position
              │
           (Error)
              ▼
[ Stage 3: Source Token Refresh ]
  ├── Invoke Provider `loadLinks()` to fetch fresh CDN URL (resolves 403 / expired tokens)
  └── Restart strategy pipeline
              │
           (Error)
              ▼
[ Stage 4: Next-Ranked Mirror Failover ]
  ├── Auto-advance to next source candidate in `PlaybackSession`
  └── Log detailed diagnostic trace
```

---

## 14. Unified Diagnostics, Observability & Telemetry

### 14.1 Playback Telemetry Schema

Every playback initialization generates a structured diagnostic event stored in the application's unified diagnostic store (`cs3/diagnostics.ts`):

```typescript
export interface PlaybackDiagnosticEvent {
  timestamp: string;
  sessionId: string;
  sourceUrl: string;
  provider: string;
  
  // Media characteristics
  container: string;
  videoCodec: string;
  videoProfile: string;
  videoBitDepth: number;
  resolution: string;
  audioCodec: string;
  audioChannels: number;
  
  // Compatibility evaluation
  directPlayable: boolean;
  selectedStrategy: PlaybackStrategyType;
  hardwareAccelerator: string;
  
  // Performance metrics
  probeLatencyMs: number;
  startupLatencyMs: number;
  transcodeFps?: number;
  transcodeSpeedRatio?: number;
  
  // Failure / Error details
  errorStage?: 'probe' | 'proxy' | 'ffmpeg' | 'renderer';
  errorMessage?: string;
  ffmpegExitCode?: number;
}
```

---

## 15. Comprehensive Playback Compatibility Matrix

| Category | Input Specification | Direct Play | Remux Plan | Transcode Plan | Target Output Format |
|---|---|---|---|---|---|
| **Video** | H.264 Baseline/Main/High (8-bit) | ✅ YES | Direct | None | Direct |
| **Video** | H.264 Hi10P (10-bit) | ❌ NO | No | Transcode (`yuv420p`) | H.264 8-bit |
| **Video** | HEVC / H.265 Main (8-bit) | ⚠️ GPU | Remux (if GPU) | Transcode (if no GPU) | H.264 8-bit / Direct |
| **Video** | HEVC / H.265 Main 10 (10-bit) | ❌ NO | No | Transcode (`yuv420p`) | H.264 8-bit |
| **Video** | VP9 Profile 0 (8-bit) / Profile 2 | ✅ YES | Direct (WebM) | None | Direct WebM |
| **Video** | AV1 Main 8-bit / 10-bit | ✅ YES | Remux (if MKV) | None | MP4 / WebM AV1 |
| **Video** | MPEG-2 / MPEG-4 Part 2 / VC-1 | ❌ NO | No | Transcode | H.264 8-bit |
| **Audio** | AAC-LC / HE-AAC | ✅ YES | Direct | None | Direct |
| **Audio** | Opus / Vorbis / MP3 / FLAC | ✅ YES | Direct | None | Direct |
| **Audio** | AC-3 (Dolby Digital) | ❌ NO | No | Audio Transcode | AAC Stereo (256 kbps) |
| **Audio** | E-AC-3 (Dolby Digital Plus / Atmos) | ❌ NO | No | Audio Transcode | AAC Stereo (256 kbps) |
| **Audio** | DTS / DTS-HD / DTS:X | ❌ NO | No | Audio Transcode | AAC Stereo (320 kbps) |
| **Audio** | TrueHD / MLP | ❌ NO | No | Audio Transcode | AAC Stereo (320 kbps) |
| **Container** | MP4 (`.mp4`, `.m4v`) | ✅ YES | Direct | None | Direct MP4 |
| **Container** | WebM (`.webm`) | ✅ YES | Direct | None | Direct WebM |
| **Container** | Matroska (`.mkv`) | ❌ NO | Remux to MP4 | None | Fragmented MP4 |
| **Container** | MPEG-TS (`.ts`) | ❌ NO | Remux to MP4 | None | Fragmented MP4 |
| **Sources** | Direct HTTP / HTTPS MP4 | ✅ YES | Direct | None | Direct |
| **Sources** | Google Drive / GDFlix 4K HEVC 10b | ❌ NO | No | Full Transcode | H.264 MP4 Stream |
| **Sources** | BitTorrent Sequential Stream | ⚠️ Varies | Auto-Remux | Auto-Transcode | Adapt to payload |

---

## 16. IPC Contract & API Surface

The engine exposes a clean, typed IPC contract bridging the Main process and Renderer:

```typescript
// electron/preload.ts -> CloudStreamElectronAPI

export interface CloudStreamElectronAPI {
  // Compatibility & Probing
  inspectMediaSource(url: string, headers?: Record<string, string>): Promise<SourceCapabilityModel>;
  getRendererCapabilities(): Promise<RendererCapabilities>;
  registerRendererCapabilities(caps: RendererCapabilities): Promise<void>;

  // Session & Playback Stream Management
  preparePlaybackStream(request: PlaybackStreamRequest): Promise<PlaybackStreamResponse>;
  closePlaybackStream(sessionId: string): Promise<void>;
  
  // In-Player Stream Controls
  switchAudioTrack(sessionId: string, audioIndex: number, currentPositionSeconds: number): Promise<PlaybackStreamResponse>;
  switchSubtitleTrack(sessionId: string, subtitleIndex: number): Promise<SubtitleTrackResponse>;
  
  // Diagnostics
  getPlaybackDiagnostics(sessionId?: string): Promise<PlaybackDiagnosticEvent[]>;
}
```

---

## 17. Acceptance Criteria & Definition of Done

The Universal Media Compatibility and Adaptive Playback Engine is complete when all of the following criteria are validated:

- [ ] **AC-COMPAT-1**: Every playback source undergoes pre-playback media inspection before attaching to the player element.
- [ ] **AC-COMPAT-2**: Compatibility decisions are derived exclusively from actual media stream metadata (FFprobe), never from URL string heuristics.
- [ ] **AC-COMPAT-3**: No race condition exists: the player UI never attempts direct playback or `-c:v copy` remuxing while media probing is pending.
- [ ] **AC-COMPAT-4**: 100% of natively compatible MP4 (H.264/AAC) and WebM (VP9/Opus) sources bypass transcoding and stream directly with zero CPU/GPU overhead.
- [ ] **AC-COMPAT-5**: 2160p / 4K HEVC Main 10 (`yuv420p10le`) sources from GDFlix, Google Drive, and Googleusercontent play reliably through hardware-accelerated/software transcoding.
- [ ] **AC-COMPAT-6**: MKV containers containing H.264/AAC are remuxed to fragmented MP4 via `-c copy` without re-encoding video or audio.
- [ ] **AC-COMPAT-7**: Multi-channel AC-3, E-AC-3, DTS, and TrueHD audio streams are transcoded to stereo AAC without re-encoding compatible video streams.
- [ ] **AC-COMPAT-8**: Progressive streaming transcoding begins playback in `< 1000ms` without waiting for entire file downloads.
- [ ] **AC-COMPAT-9**: Hardware-accelerated encoding (NVENC, QuickSync, AMF) is automatically used on supported Windows GPUs with reliable fallback to `libx264`.
- [ ] **AC-COMPAT-10**: Player UI distinguishes between `Downloadable` and `DirectlyPlayable` capabilities across all detail and player views.
- [ ] **AC-COMPAT-11**: Transport failures on remote CDNs trigger automatic byte-range stream resumption without crashing the player.
- [ ] **AC-COMPAT-12**: Structured diagnostic telemetry records probe metrics, strategy choices, and encoder performance for every playback attempt.

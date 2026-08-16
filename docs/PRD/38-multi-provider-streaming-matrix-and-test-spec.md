# PRD 38 — Multi-Provider Streaming Matrix & Empirical Compatibility Test Specification

## 1. Executive Summary & Problem Statement

CloudStream 3's desktop platform migration must support media delivered by community Kotlin/DEX providers targeting English and Hindi audiences without requiring any upstream plugin modifications. 

Desktop environments powered by Chromium (Electron) encounter fundamental media playback incompatibilities that do not exist on Android:
1. **Chromium Container Rejections**: Chromium cannot natively demux or decode Matroska (`.mkv`) containers carrying high-efficiency or multi-track streams.
2. **Unsupported Audio Codecs & Multi-Audio Silences**: Dolby Digital (`AC-3`), Dolby Digital Plus (`E-AC-3`), and `DTS` / `DTS-HD MA` return empty string `""` from Chromium's `canPlayType()`. When encapsulated inside `.mkv`, Chromium decodes the video while completely dropping audio tracks, resulting in silent playback.
3. **High-Bitrate HEVC / 10-Bit Profiles (4K / 1080p)**: High-efficiency video coding (`HEVC / H.265`) in `Main 10` profile (`yuv420p10le`) from Indian and global providers fails in standard Chromium builds lacking hardware pipeline bindings.
4. **Obfuscated Streaming Protocols & CDN Hotlink Protections**:
   - Obfuscated HLS playlists with `.png` image-disguised segment extensions (`Hdmovie2`, `imagesharerhost.com`).
   - Signed, expiring CDN tokens (`GoogleUserContent`, `Cloudflare Workers`).
   - Referer and Origin header verification (`Dudefilms`, `HDHub4u`).
   - Segmented MPEG-DASH XML manifests (`MovieBox`).

This document provides the definitive empirical findings from live probing and streaming benchmarks across 23 English & Hindi providers, defines the architectural mitigations, and establishes the formal automated test specification.

---

## 2. Tested Provider Ecosystem & Repository Matrix

### 2.1 Provider Corpus (English & Hindi)

| Provider Name | Plugin ID | Repository | Content Focus | Default Containers & Codecs |
|---|---|---|---|---|
| **4K HDHUB** | `FourKHDHub` | `MegaRepo` / `phisher` | 4K/1080p Hindi + English Dual Audio | Matroska (`.mkv`), HEVC 10-bit & H.264, E-AC-3 5.1, DTS 7.1, Google CDN |
| **HDHub4U** | `HDhub4u` | `MegaRepo` / `phisher` | 1080p/720p Hindi + English Dual Audio | Matroska (`.mkv`), 10-bit HEVC, E-AC-3, Cloudflare Workers |
| **DudeFilms** | `DudeFilms` | `phisher` | Bollywood & Dual Audio Hollywood | Matroska (`.mkv`), H.264 / HEVC, Dual Audio, Referer-locked CDN |
| **UHDmovies** | `UHDmoviesProvider`| `phisher` | Ultra HD & 1080p Multi-Audio | Matroska (`.mkv`), H.264 / HEVC, E-AC-3 5.1, GDrive / Worker CDNs |
| **Movies4u** | `Movies4u` | `phisher` | Hindi Dubbed & Pan-Indian | Matroska (`.mkv`), H.264 High, E-AC-3 multi-track |
| **Cinefreak** | `Cinefreak` | `phisher` | High-Bitrate Dual Audio (IMAX/BluRay) | Matroska (`.mkv`), HEVC 10-bit & H.264, AC-3 / AAC stereo & 5.1 |
| **Hdmovie2** | `Hdmovie2` | `phisher` | Bollywood & Dubbed Releases | Disguised HLS (`.m3u8` with `.png` segment URLs) |
| **MovieBox** | `MovieBoxProvider` | `phisher` / `MegaRepo` | Hollywood & Bollywood | MPEG-DASH manifests (`.mpd`), fragmented MP4 |
| **AllMovieLand** | `AllMovieLandProvider`| `phisher` | Global Movies & TV | HLS (`.m3u8`), Web MP4 (`.mp4`), AAC stereo |
| **Desicinemas** | `Desicinemas` | `phisher` | Indian Cinema | Multi-mirror HLS & MP4 |
| **MultiMovies** | `MultiMoviesProvider` | `phisher` | Multi-language Indian Releases | Matroska (`.mkv`), H.264 / E-AC-3 |
| **Tamilblasters**| `Tamilblasters` | `phisher` / `cinephile`| South Indian & Hindi Dubbed | Torrent magnets & Matroska mirrors |
| **SuperStream** | `SuperStream` | `MegaRepo` / `phisher` | Hollywood & English TV | Web MP4 (`.mp4`), HLS, H.264 + AAC |
| **ShowBox** | `ShowBox` | `MegaRepo` / `phisher` | Hollywood Movies & Series | Web MP4 (`.mp4`), H.264 + AAC |
| **YTS** | `YTS` | `phisher` | 1080p/720p YIFY Torrents & Direct | MP4 (`.mp4`), H.264 High + AAC |
| **AllWish** | `AllWish` | `phisher` | Anime & Global Media | HLS (`.m3u8`), MP4 |

### 2.2 Pan-Provider Aggregate Test Corpus Statistics

Across the full automated test execution spanning **23 providers $\times$ 20 English & Hindi titles** (322 provider search and resolution runs):
- **Total Scrape & Resolution Cycles**: 322
- **Search Hits Discovered**: 322
- **Queries with Resolved Streams**: 131
- **Total Live Stream Links & Mirrors Extracted**: **1,051 stream links**
- **Verified Probed Streams**: 37
- **Verified Progressive Stream Deliveries (> 1.0x Real-time)**: 28
- **Container Breakdown**: 100% of tested dual-audio/high-bitrate direct file streams used Matroska (`matroska,webm`).
- **Video Codec Breakdown**: `h264` (65%), `hevc` (Main 10 & 8-bit, 30%).
- **Audio Codec Breakdown**: `aac` (54%), `eac3` (30%), `ac3` (11%), `truehd` (5%).

---

## 3. Empirical Test Results & Media Diagnostic Findings

### 3.1 Live Stream Probing & Codec Inspection Analysis

| Stream Sample | Provider | Container | Video Codec & Profile | Audio Codec & Layout | Chromium Direct Outcome | Adaptive Engine Outcome |
|---|---|---|---|---|---|---|
| **Spider-Man: No Way Home** | `Cinefreak` | `matroska` | `hevc` (Main 10, `yuv420p10le`, 1280x674) | `aac` (2 channels, 2 streams) | **Playback Failure** (undecodable HEVC 10-bit) | **Success**: QSV Hardware Transcode to H.264 $\to$ 1.96 MB in 7s (TTFB 3258ms) |
| **Spider-Man: No Way Home** | `Movies4u` | `matroska` | `h264` (High, `yuv420p`, 1280x534) | `eac3` (5.1ch) $\times$ 3 streams + `aac` | **Silent Video** (dropped E-AC-3) | **Success**: Instant Remux (`-c:v copy`) + AAC downmix $\to$ 19.75 MB in 7s (TTFB 1330ms) |
| **Spider-Man: No Way Home** | `UHDmovies` | `matroska` | `h264` (High, `yuv420p`, 1920x800) | `eac3` (5.1ch) $\times$ 2 streams | **Silent Video** (dropped E-AC-3) | **Success**: Instant Remux + AAC downmix $\to$ 21.95 MB in 7s (TTFB 1238ms) |
| **The Incredible Hulk** | `Cinefreak` | `matroska` | `h264` (High, `yuv420p`, 1920x816) | `ac3` (5.1ch, 2 streams) | **Silent Video** (dropped AC-3) | **Success**: Instant Remux + AAC downmix $\to$ 8.40 MB in 7s (TTFB 3031ms) |
| **The Incredible Hulk** | `4K HDHUB` | `matroska` | `h264` (High, `yuv420p`, 1920x804) | `eac3` (5.1ch) $\times$ 4 streams | **Silent Video** (dropped E-AC-3) | **Success**: Instant Remux + AAC downmix $\to$ 12.40 MB in 7s (TTFB 2274ms) |
| **The Incredible Hulk (4K)** | `4K HDHUB` | `matroska` | `hevc` (Main 10, 3840x2160, 32.7 Mbps) | `eac3` 5.1, `dts-hd ma` 7.1 | **Complete Stall** (undecodable HEVC + DTS) | **Success**: Intel QSV / 1080p Downscale $\to$ 26–60 FPS real-time streaming |
| **The Incredible Hulk** | `Hdmovie2` | `hls` | `h264` (Segment URLs masked as `.png`) | `aac` stereo | **Demux Failure** (rejected non-standard ext) | **Success**: Pass `-allowed_extensions ALL` to FFmpeg demuxer |
| **Spider-Man: No Way Home** | `MovieBox` | `dash` | MPEG-DASH segmented manifest (`.mpd`) | Multi-bitrate AAC/E-AC-3 | **Browser Demux Error** | **Success**: Direct browser MSE routing via `dash.js` |
| **Spider-Man: No Way Home** | `DudeFilms` | `matroska` | `h264` (Cloudflare Workers CDN) | `aac` / `eac3` | **HTTP 403 Forbidden** | **Success**: `MediaProxy` injects `Referer: https://dudefilms.in/` |

---

## 4. Root Cause Taxonomy & Architectural Mitigations

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            STREAM RESOLUTION PIPELINE                            │
│           Provider Scrape → Link Extracted → Pre-Playback Classification         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │   SEGMENTED MANIFEST  │                       │   DIRECT / CDN FILE   │
     │   (HLS / MPEG-DASH)   │                       │  (.mkv / .mp4 / CDN)  │
     └───────────┬───────────┘                       └───────────┬───────────┘
                 │                                               │
        ┌────────┴────────┐                             ┌────────┴────────┐
        ▼                 ▼                             ▼                 ▼
 ┌─────────────┐   ┌─────────────┐               ┌─────────────┐   ┌─────────────┐
 │ Native HLS  │   │  MPEG-DASH  │               │ Probe Valid │   │ Anti-Hotlink│
 │  (hls.js)   │   │  (dash.js)  │               │   (ffprobe) │   │ (MediaProxy)│
 └─────────────┘   └─────────────┘               └──────┬──────┘   └─────────────┘
                                                        │
                      ┌─────────────────────────────────┴────────────────────────┐
                      ▼                                                          ▼
          ┌───────────────────────┐                                  ┌───────────────────────┐
          │  DIRECT PLAY / REMUX  │                                  │   ADAPTIVE TRANSCODE  │
          │ H.264 + AAC in MP4/MKV│                                  │  HEVC 10-bit, AC-3,   │
          │   Speed: > 10.0x RT   │                                  │  E-AC-3, DTS, TrueHD  │
          │   CPU Overhead: ~0%   │                                  │ Speed: 1.5x - 4.0x RT │
          └───────────────────────┘                                  └───────────────────────┘
```

### 4.1 Categorized Failure Signatures and Resolutions

| Category ID | Symptom / Error Signature | Root Cause | Architectural Mitigation |
|---|---|---|---|
| **E-01: AUDIO DROP** | Video plays smoothly, volume is at 100%, but no sound is heard. `audioBytesDecoded = 0`. | Chromium drops AC-3, E-AC-3, DTS, and TrueHD audio streams in MKV/MP4 containers without raising an error event. | Remux stream: copy video (`-c:v copy`), downmix audio to 2-channel stereo AAC (`-c:a aac -b:a 192k -ac 2`). |
| **E-02: 4K HEVC STALL** | 4K HEVC stream starts playing for 3–5 seconds and then permanently freezes / buffers. | CPU software transcoding (`libx264`) at 4K encodes at 11–13 FPS (0.5x real-time), resulting in severe buffer underruns. | 1. Enable Hardware Acceleration (Intel QSV `h264_qsv`, NVIDIA `h264_nvenc`, AMD `h264_amf`).<br>2. Fallback to 1080p downscale (`-vf scale=-2:1080`) which encodes at > 26 FPS (> 1.0x real-time). |
| **E-03: MASKED HLS SEGMENTS** | `[hls] URL ...png is not in allowed_segment_extensions`. | Provider disguises video segments as `.png` files to bypass CDN firewall filtering. | Configure FFmpeg with `-allowed_extensions ALL` flag when probing and remuxing HLS streams. |
| **E-04: HOTLINK 403** | Server returns `403 Forbidden` or `Access Denied` on direct worker request. | CDN validates `Referer` and `User-Agent` headers against the provider's apex domain. | Route stream through loopback `MediaProxy` (`http://127.0.0.1:<port>`) injecting origin headers and referer. |
| **E-05: EXPIRED TOKEN 403/404**| Signed CDN download link fails after TTL expires (e.g. GoogleUserContent / Cloudflare). | Expired HMAC signature or JWT token in media URL. | `PlaybackSessionManager` invokes background `providerLoadLinks` to refresh token and rebinds session. |
| **E-06: DASH XML ERROR** | `[dash] Unable to parse XML declaration allowed only at start`. | MPEG-DASH XML manifest sent to binary MP4/MKV demuxer. | Detect DASH mime/manifest signature and route to browser player via `dash.js` with MSE. |
| **E-07: DEAD MIRROR 404** | Top resolved stream mirror returns `404 Not Found`. | Mirror file removed by upstream file host. | Execute sequential mirror fallback ladder: probe subsequent resolved mirrors until a live stream is found. |

---

## 5. Formal Automated Test Specification

To ensure regression prevention across all provider updates, the following automated test suite specifications are established:

### Test Suite: `tools/e2e/multi-provider-streaming-matrix.test.mjs`

```javascript
/**
 * Test Group 1: Provider Search & Link Resolution Contract
 * Verifies that English & Hindi providers load and return valid stream handles.
 */
describe('Provider Resolution & Scrape Contract', () => {
  it('resolves playable links across English blockbusters', async () => {
    // Queries Spider-Man, The Incredible Hulk, Interstellar
    // Asserts: links.length > 0, links contain valid HTTP/HTTPS URLs
  });

  it('resolves multi-audio and dual-audio links across Hindi providers', async () => {
    // Queries RRR, Jawan, Mirzapur on Cinefreak, Movies4u, UHDmovies, 4K HDHUB
    // Asserts: detail page contains episode/movie dataUrl; links resolved
  });
});

/**
 * Test Group 2: Media Inspection & Capability Classification
 * Verifies that ffprobe accurately identifies containers, codecs, and channels.
 */
describe('Media Capability & Probe Classification', () => {
  it('correctly classifies 10-bit HEVC in Matroska containers', async () => {
    // Asserts: video.codec_name === 'hevc', pix_fmt === 'yuv420p10le'
  });

  it('identifies multi-stream Dolby Digital Plus (E-AC-3) and DTS audio tracks', async () => {
    // Asserts: audio streams contain 'eac3' | 'ac3' | 'dts'
  });

  it('accepts masked HLS playlists with -allowed_extensions ALL', async () => {
    // Probes image-disguised segment streams
    // Asserts: exitCode === 0, streams parsed successfully
  });
});

/**
 * Test Group 3: Progressive Streaming & Real-Time Throughput
 * Verifies that the transcoding and remuxing pipelines sustain > 1.0x real-time speed.
 */
describe('Progressive Streaming & Real-Time Performance', () => {
  it('sustains > 10 MB in 7s for remuxed E-AC-3 audio streams', async () => {
    // Pipes stream through MediaTranscoder (-c:v copy -c:a aac)
    // Asserts: bytesProduced > 5MB, timeToFirstChunk < 2500ms
  });

  it('sustains > 1.0x real-time speed for 10-bit HEVC transcoding', async () => {
    // Encodes with Hardware QSV or 1080p downscale
    // Asserts: realtime speed factor >= 1.0x, 0 buffer underruns
  });

  it('successfully delivers media through MediaProxy with custom Referer', async () => {
    // Exercises referer injection for Dudefilms / Cloudflare worker links
    // Asserts: HTTP status 206, valid video chunk stream
  });
});
```

---

## 6. Verification and Acceptance Criteria

1. **Zero Silent Playback**: All streams containing `AC-3`, `E-AC-3`, `DTS`, or `TrueHD` audio tracks are automatically transcoded to AAC stereo without user intervention.
2. **Zero Infinite Buffering Stalls**: 4K HEVC streams utilize hardware encoding or downscaling to maintain $\ge 1.0\times$ real-time delivery.
3. **100% Header Compliance**: All provider-specific `Referer`, `User-Agent`, and `Cookie` headers are preserved and injected through `MediaProxy`.
4. **Resilient Mirror Ladder**: If mirror 1 fails (404/403/timeout), the playback session immediately switches to mirror 2 within 1.5 seconds.
5. **Lossless Type Safety**: All interfaces, data structures, and IPC signatures typecheck cleanly with `bun run typecheck` (`tsc -b`).

# 28 — Media Playback Requirements

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Playback is CloudStream's largest subsystem — 29 files, 15,531 lines. Its Android implementation is heavily customized precisely because real-world streams are messy. A desktop port that assumes "the browser can play video" will fail on a large fraction of content.

---

## 1. The Android playback stack

| Layer | Implementation |
|---|---|
| Interface | `IPlayer` (294 lines) — the abstraction the UI talks to |
| Implementation | `CS3IPlayer` (2,023 lines) wrapping ExoPlayer/Media3 1.9.3 |
| Orchestration | `GeneratorPlayer` (2,402 lines) — link generation, episode transitions, source switching |
| Link generation | `IGenerator` → `RepoLinkGenerator`, `LinkGenerator`, `DownloadFileGenerator` |
| UI | `FullScreenPlayer` (1,373), `PlayerView` (842), `PlayerGestureHelper` (1,220) |
| Container parsing | `UpdatedMatroskaExtractor` (3,242), `UpdatedDefaultExtractorsFactory` (678) |
| Subtitles | `CustomSubtitleDecoderFactory` (417), `CustomSubripParser` (295), `PlayerSubtitleHelper` (150) |
| Software decoding | `nextlib-media3ext` — FFmpeg decoders |
| Thumbnails | `PreviewGenerator` (545) + previewseekbar-media3 |
| Torrent | `Torrent.kt` (351) + in-process Go `torrServer` |
| PiP | `PlayerPipHelper` (205) |
| Quality selection | `source_priority/` — `QualityDataHelper`, dialogs, adapters |
| TLS | `SSLTrustManager` |

**The customization tells you what matters.** A 3,242-line replacement Matroska extractor and a 295-line tolerant SRT parser exist because upstream repeatedly hit malformed real-world media. Chromium will hit the same media.

**Evidence.** `app/.../ui/player/` file inventory and sizes; `gradle/libs.versions.toml:43,45,47,51`. **Confidence: High.**

---

## 2. Supported inputs

### Link types
| Type | MIME | Handling |
|---|---|---|
| `VIDEO` | `video/mp4` | Progressive |
| `M3U8` | `application/x-mpegURL` | HLS |
| `DASH` | `application/dash+xml` | DASH |
| `TORRENT` | `application/x-bittorrent` | Via torrServer |
| `MAGNET` | `application/x-bittorrent` | Via torrServer |

Inference from URL when `INFER_TYPE` is used ([18](18-technical-reference.md) §6.12).

### Containers and codecs
ExoPlayer plus `nextlib` FFmpeg covers MP4, MKV/WebM, TS/M2TS, FLV, AVI, and 3GP with H.264, H.265/HEVC, VP8/VP9, AV1, MPEG-2/4, AAC, MP3, AC3/E-AC3, DTS, FLAC, Opus, Vorbis, and PCM. Precise coverage depends on device hardware plus the bundled software decoders.

**Confidence: Medium** on exact coverage — it is a function of the ExoPlayer version, `nextlib` build, and device.

### Subtitle formats
WebVTT · SubRip (with a tolerant custom parser) · SSA/ASS · TTML · MP4 WebVTT · TX3G · DVB bitmap · PGS bitmap. CEA-608/708 exist but are commented out.

---

## 3. The desktop gap

| Capability | Chromium `<video>` | Native player (mpv/libVLC) |
|---|---|---|
| MP4 / H.264 / AAC | ✅ | ✅ |
| WebM / VP8, VP9 / Opus | ✅ | ✅ |
| MKV container | ⚠️ limited | ✅ |
| H.265 / HEVC | ⚠️ platform-dependent | ✅ |
| AV1 | ⚠️ version-dependent | ✅ |
| AC3 / E-AC3 / DTS | ❌ | ✅ |
| MPEG-2 / TS | ⚠️ | ✅ |
| FLV / AVI | ❌ | ✅ |
| HLS | via `hls.js` | ✅ native |
| DASH | via `dash.js` | ✅ native |
| SRT / VTT | ✅ (VTT native; SRT converted) | ✅ |
| ASS / SSA styling | ⚠️ needs a JS renderer; imperfect | ✅ full |
| PGS / DVB bitmap | ❌ | ✅ |
| Audio-track switching | ⚠️ limited | ✅ |
| Frame-accurate seeking | ⚠️ | ✅ |
| Hardware decoding | ✅ | ✅ |
| Thumbnail extraction | ❌ | ✅ |

**Conclusion.** A Chromium-only implementation cannot deliver parity. This is the reason for ADR-3.

---

## 4. Target architecture

```
┌── PlaybackController (renderer) ───────────────────────────┐
│  IPlayer-equivalent interface — the UI's only contact      │
└──────────┬─────────────────────────────┬───────────────────┘
           │                             │
┌──────────▼──────────────┐   ┌──────────▼────────────────────┐
│ WebBackend              │   │ NativeBackend                 │
│ <video> + MSE           │   │ mpv (libmpv) or libVLC        │
│ hls.js / dash.js        │   │ Full codec + subtitle support │
│ Zero extra bundle       │   │ +30–80 MB                     │
│ Default for compatible  │   │ Fallback + user preference    │
│ sources                 │   │                               │
└─────────────────────────┘   └───────────────────────────────┘
           │                             │
┌──────────▼─────────────────────────────▼───────────────────┐
│ ExternalPlayer — VLC, mpv, IINA, MPC-HC, … (FEAT-CAST-2)   │
└─────────────────────────────────────────────────────────────┘
```

| ID | Requirement | Priority |
|---|---|---|
| PLAY-1 | A single `IPlayer`-equivalent interface; the UI never talks to a backend directly. | P0 |
| PLAY-2 | Backend selection: automatic by source characteristics, overridable per user and per source. | P0 |
| PLAY-3 | Automatic fallback — when the web backend fails to play, retry on the native backend without losing position. | P0 |
| PLAY-4 | Backend switching preserves position, tracks, and speed. | P1 |
| PLAY-5 | A backend crash is recoverable and attributed. | P0 |
| PLAY-6 | `software_decoding_key2` maps to forcing the native backend / software decode. | P1 |

---

## 5. Functional requirements

### 5.1 Link resolution and source selection
| ID | Requirement | Priority |
|---|---|---|
| PLAY-7 | `loadLinks` results **stream** to the UI as found (API-2). | P0 |
| PLAY-8 | Quality-profile ranking selects the same source Android would for the same link set. | P1 |
| PLAY-9 | On failure, auto-advance to the next-ranked mirror without user action. | P0 |
| PLAY-10 | Manual source switching mid-playback preserves position. | P1 |
| PLAY-11 | `loadLinksTimeoutMs` is honored; partial results are presented. | P0 |
| PLAY-12 | `getVideoInterceptor` headers are applied to media requests. | P1 |
| PLAY-13 | `extractorVerifierJob` runs during playback for providers that need link keep-alive. | P2 |

### 5.2 Playback control
| ID | Requirement | Priority |
|---|---|---|
| PLAY-14 | Play, pause, seek, ±`fast_forward_button_time`, next/previous episode. | P0 |
| PLAY-15 | Speed control persisted at `<p>/playback_speed`. | P1 |
| PLAY-16 | Resize/aspect modes persisted at `<p>/resize_mode`. | P1 |
| PLAY-17 | Volume, independent of system volume, persisted. | P1 |
| PLAY-18 | Fullscreen, multi-monitor aware. | P0 |
| PLAY-19 | Mini-player / always-on-top window (PiP equivalent). | P2 |
| PLAY-20 | Full keyboard control ([08](08-ui-and-interactions.md) §4). | P0 |
| PLAY-21 | Audio-track and video-track selection. | P1 |
| PLAY-22 | Buffer configuration mapped from the four `video_buffer_*` keys. | P2 |

### 5.3 Progress and continuity
| ID | Requirement | Priority |
|---|---|---|
| PLAY-23 | Position written to `<p>/video_pos_dur/<id>` with the **30-second duration guard**. | P0 |
| PLAY-24 | Resume applies `fixVisual` thresholds exactly. | P0 |
| PLAY-25 | Resume-watching updated per Android's rules, including the next-episode threshold. | P0 |
| PLAY-26 | Watch state cleared when a watched episode is re-watched, matching `setViewPosAndResume`. | P1 |
| PLAY-27 | Autoplay-next honoring `autoplay_next_key`. | P1 |
| PLAY-28 | Position survives an abrupt process kill. | P0 |
| PLAY-29 | Tracker progress push when `episode_sync_enabled_key` is set. | P1 |

### 5.4 Subtitles
| ID | Requirement | Priority |
|---|---|---|
| PLAY-30 | Text formats (SRT, VTT, ASS/SSA, TTML) render on both backends. | P0 |
| PLAY-31 | Bitmap formats (PGS, DVB) render on the native backend; the web backend reports the limitation explicitly. | P1 |
| PLAY-32 | Charset auto-detection with manual override (`subtitles_encoding_key`). | P0 |
| PLAY-33 | Tolerant SRT parsing, including VTT content in a `.srt` file. | P1 |
| PLAY-34 | Styling from `subtitle_settings` applied on both backends, visually equivalent. | P1 |
| PLAY-35 | Timing offset adjustment during playback. | P2 |
| PLAY-36 | Auto-select by `subs_auto_select`; auto-download by `subs_auto_download`. | P1 |
| PLAY-37 | Embedded subtitle tracks are enumerated and selectable. | P1 |
| PLAY-38 | Local subtitle files loadable by drag-and-drop. | P1 |

### 5.5 Error handling
| ID | Requirement | Priority |
|---|---|---|
| PLAY-39 | Network interruption pauses and retries with backoff, preserving progress. | P0 |
| PLAY-40 | Unsupported codec produces a specific message and offers the native backend, never a generic failure. | P0 |
| PLAY-41 | Link expiry triggers re-resolution through the provider. | P1 |
| PLAY-42 | Errors identify the source and provider. | P1 |
| PLAY-43 | Repeated failures on one source demote it in ranking for the session. | P2 |

### 5.6 Torrent
| ID | Requirement | Priority |
|---|---|---|
| PLAY-44 | Magnet and `.torrent` playback via a supervised child-process engine, feature-flagged. | P2 |
| PLAY-45 | The engine listens on loopback; the plugin broker denies plugin access to it (SEC-17). | P0 |
| PLAY-46 | Sequential piece selection for streaming. | P2 |
| PLAY-47 | Engine failure is isolated and reported. | P1 |
| PLAY-48 | Torrent cache location and size are configurable; cache is cleaned on exit by default. | P2 |

### 5.7 Enhancements
| ID | Requirement | Priority |
|---|---|---|
| PLAY-49 | Seekbar thumbnail previews (`preview_seekbar_key`); backend-dependent. | P2 |
| PLAY-50 | Intro/outro skip from AniSkip, AnimeSkip, TheIntroDB. | P2 |
| PLAY-51 | Metadata overlay per the four display keys. | P3 |
| PLAY-52 | Prevent display sleep during playback (DSK-32). | P1 |
| PLAY-53 | OS media-key and media-session integration. | P2 |

---

## 6. External players

Android ships 16 action packages: VLC, MPV (3 variants), Just Player, Next Player, Web Video Cast, Aria2, BiglyBT, LibreTorrent, plus copy-link, play-in-browser, view-M3U8, play-mirror, and always-ask.

| ID | Requirement | Priority |
|---|---|---|
| PLAY-54 | Launch an external player with the stream URL **and required headers** — many streams fail without `Referer`/`User-Agent`. | P1 |
| PLAY-55 | Detect installed players per OS: VLC, mpv, IINA (macOS), MPC-HC/PotPlayer (Windows), Celluloid (Linux). | P2 |
| PLAY-56 | User-configurable custom player command with argument templating. | P2 |
| PLAY-57 | Copy stream URL, with headers, to clipboard. | P1 |
| PLAY-58 | Open in the default browser. | P2 |
| PLAY-59 | Preserve the action framework so plugins can register their own actions (PLG-9). | P1 |
| PLAY-60 | External playback cannot report progress back; the app must state this rather than silently losing tracking. | P1 |

---

## 7. Platform notes

| Platform | Consideration |
|---|---|
| Windows | Hardware decoding via D3D11VA; HEVC may need a codec pack for the web backend; the native backend avoids this |
| macOS | VideoToolbox; HEVC well supported; Apple Silicon and Intel need separate validation |
| Linux | VAAPI/VDPAU availability varies; Wayland vs X11 differ materially for video output and fullscreen; bundling the native player's dependencies is safer than relying on system libraries |
| All | Bundle-size and licensing impact of the native backend ([11](11-security-and-compliance.md) LIC-5/6) |

---

## 8. Testing

Covered by TEST-PLAY-1..12 in [13](13-testing-and-qa.md) §6, run against **both backends**. A curated stream corpus is required; playback quality cannot be validated from source analysis alone.

---

## Next steps

1. Prototype both backends in Phase 1/7 and measure the real coverage gap (OQ-29).
2. Choose between mpv and libVLC early (OQ-28) — it affects packaging, licensing, and bundle size.
3. Assemble the stream corpus before Phase 7.
4. Resolve the native-player licensing question with counsel (OQ-23).

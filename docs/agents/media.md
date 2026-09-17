# Playback and the media engine

Domain notes for CloudStream 3 Desktop, covering §6 — inspection, decision, transcode, mpv, DRM, subtitles.

**Read `AGENTS.md` first.** It carries the repository map, the build and test commands, the
IPC contract, the service table and the rules that cut across every area. This file assumes it.

Section numbers here match `AGENTS.md`'s, so a cross-reference like `§6.10` resolves whichever
file you are in. **If this contradicts the code, the code wins — fix this file in the same commit.**

---

## 6. Playback and the media engine

### 6.1 Chromium cannot decode much of what people actually stream

Measured with `canPlayType`. Audio: AAC/MP3/FLAC/Opus fine; **AC-3, E-AC-3, DTS return `""`** in both MP4 and MKV. Worst failure mode: bare `video/x-matroska` reports `"maybe"` — container opens, video decodes, **audio silently dropped** (measured: 65,397 bytes video / 0 bytes audio, correct duration, no `error` event). Hits **series** hardest (HDTV/WEB-DL carries broadcast AC-3/E-AC-3 where film web-rips carry AAC) — the provider was never the variable. Video: H.264/VP8/VP9/AV1 only; no HEVC without platform decoders, no MPEG-2, VC-1, MPEG-4 Part 2, WMV. Android has none of this (ExoPlayer → hardware decoders).

### 6.2 Inspect, decide, execute — in that order

| File | Role |
|---|---|
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport from the manifest **body**; reads DRM |
| `media/decisionEngine.ts` | Pure `(metadata, transport, rendererCaps, hostEncoder) → TransformationPlan`. No I/O |
| `mediaTranscoder.ts` | Executes a plan as live fragmented-MP4 on loopback |
| `media/playbackEngine.ts` | Assembles them, caches capability records per URL, owns telemetry |

Types in `src/types/media.ts`. The decision is pure so it can be tested against an expensive-to-reproduce matrix (a real 25GB file behind a now-expired link): `decisionEngine.test.mts` (35 cases), `pipeline.test.mts` (13 cases, real ffmpeg, skips itself without it).

**Ordering is the bug fix.** Playback used to attach on mount while a probe ran beside it; Chromium's parser failed within ~150ms, `error` fired with the probe still in flight, and the fallback ran `-c:v copy` on unknown video — re-wrapping undecodable HEVC and failing identically. **`media:prepare` is the only source of a URL; assigning `video.src` from anything else reintroduces this.**

| ID | Rule | Enforced in |
|---|---|---|
| INV-RACE-1 | Nothing attached before inspection completes | `VideoPlayer` — no `?? streamUrl` fallback |
| INV-RACE-2 | The gate is visible ("Inspecting media…") | `VideoPlayer`, `isInspecting` |
| INV-RACE-3 | `-c:v copy` never on unverified codec info | `blindFallbackPlan` re-encodes |
| INV-RACE-4 | Renderer capabilities registered before playback | `App.tsx` mount → `media:setCapabilities` |

**Nothing is decided from the URL.** The old implementation searched filenames for `hevc`/`x265`/`10bit` — wrong in both directions. Transport is classified from the first 64KB of body (`#EXTM3U`/`<MPD`), not the URL or content-type.

### 6.3 Plan details that are load-bearing

- **The software 4K guard is arithmetic, not heuristic.** Measured: 3840×2160 10-bit HEVC, libx264 `veryfast` native res = 11–13 FPS (0.47× realtime — Chromium drains the buffer in ~3s then stalls forever); `scale=-2:1080` = 26–28 FPS. Software-only hosts downscale above 1080p; GPU-encoder or 16-thread hosts keep full res. Threshold is **pixels per second**, not height (8K is 4× 4K's pixels and a height-only guard waved it through), `Math.max(1,…)`-clamped so every ≤4K verdict is unchanged.
- **A track switch re-derives the plan, never re-indexes it.** Pointing a copy-audio plan at a 6-channel AC-3 track makes ffmpeg fail outright (`Cannot write moov atom before AC3 packets`). `planForAudioTrack` is the only correct way.
- **Unplayable default audio is swapped only for a track in the same language** (Movies4u ships 3× E-AC-3 5.1 beside AAC stereo of the same film — never swap languages for cost).
- **The hardware encoder is chosen by test-encoding**, never `ffmpeg -encoders` (that lists what the binary was built with; the bundled build advertises nvenc/qsv/amf everywhere and only QSV opens without an NVIDIA GPU). Each candidate encodes one real frame with the exact args it will be used with, which also catches AMF's missing `-preset`.
- **Decodability is measured in the renderer** (`App.tsx` runs `canPlayType` over `VIDEO_CODEC_PROBES`), overriding the static `UNSUPPORTED_VIDEO` table **in both directions**. Chromium is launched with `PlatformHEVCDecoderSupport`.
- **HDR re-encode needs tone-mapping.** `-pix_fmt yuv420p` converts storage format, not transfer function, so PQ/HLG re-encoded to 8-bit keeps HDR-referred values displayed as SDR — washed out, no error. Measured first-frame SATAVG: SDR reference 112.6 · no tone-map 22.8 · zscale chain **63.0** · `tonemap` without `zscale` **6.3**. **That last number is why there is no degraded fallback** — `tonemap` alone on PQ is measurably worse than nothing. `toneMapFilters()` returns the chain only when `zscale` (zimg) is detected at startup. Trap: ffmpeg takes **one** `-vf`, so tone-map and downscale must share a chain.
- Stereo downmix is deliberate (5.1→5.1 AAC decodes but routes to the wrong outputs on most desktop setups).
- `-user_agent` is HTTP-demuxer-only — fatal on local paths, so applied only to http(s) inputs.
- Seeking restarts ffmpeg at the target time (fragmented MP4 has no index; accuracy bounded by keyframe interval).
- Embedded text subtitles extracted on demand, bounded 3 min, cached (reads the whole file — packets are interleaved). Bitmap tracks (PGS/DVB/VOBSUB) listed but never offered. No ffprobe means the app cannot even *list* a Japanese AC-3 dub.
- **FFmpeg 7.1 silently broke the image-segment fix.** `-allowed_extensions ALL` (for Hdmovie2 serving MPEG-TS from `.png` URLs) stopped working when 7.1 added `-extension_picky`, evaluated **before** the allow-list — with no repo-side change on the day it broke. Only `-extension_picky 0` fixes it, and adding it unconditionally is fatal on 7.0. `detectExtensionPicky` probes `-h demuxer=hls` at startup and after any ffmpeg install; `hlsDemuxerOptions()` includes it only if present.

### 6.4 DRM

HLS AES-128 and SAMPLE-AES are **not** DRM here (hls.js handles them in JS). ClearKey/Widevine/PlayReady/unrecognised set `requiresEmeDecryption` and **bypass FFmpeg entirely** — measured: ffprobe reads a synthesised CENC file and reports **correct codec names**, then decode produces `non-existing PPS`. The probe succeeds with a lie, so encrypted streams were reported as "file is corrupt".

1. **ClearKey + browser-decodable payload** → `EME_NATIVE` via `src/utils/clearKeySession.ts`.
2. **ClearKey + browser-undecodable payload** → the ordinary ladder plus `-decryption_keys`. **Progressive only** — the DASH demuxer's `Option decryption_key not found` is fatal to the whole command line.
3. **Widevine/PlayReady/keyless ClearKey/unrecognised** → named as unplayable (no CDM shipped).

Hazards in `src/utils/clearKey.ts`: hex vs base64url told apart **by length only** (16 bytes = 32 hex or 22 base64url, unambiguous); EME wants base64url and FFmpeg wants hex, so both conversions live in one file and are tested against each other. `DrmType.unknown` is kept distinct from `none` — folding them sends it back to be misdiagnosed.

**Not built: DASH under any DRM** (Chromium can't demux `.mpd` without MSE+JS; FFmpeg refuses the keys). Reported by name, not as corrupt.

### 6.5 DASH is played, not remuxed

Shaka Player (Apache-2.0) takes any DASH manifest the browser can decode (`DASH_NATIVE`); remux is the fallback. Buys the full adaptive ladder (remux flattens it to one rendition) and is the only strategy that can play encrypted DASH.

**The proxy had to learn DASH first, which fixed an existing bug**: manifests name segments relative to their own address, so serving one unmodified from loopback breaks resolution for **both** Shaka and ffmpeg's DASH demuxer — the remux path was already broken for any manifest not spelling segments out in full. `MediaProxy` rewrites MPDs with **directory routes** (`/base/<token>/<rest>`, because `SegmentTemplate` uses player-expanded `$Number$` placeholders, unlike HLS which lists every segment); `<BaseURL>` inserted/replaced; absolute `media`/`initialization`/`sourceURL` rewritten; suffix origin-checked (`resolvePrefixed` refuses cross-origin, else a directory route becomes an arbitrary-URL fetcher); manifest sniffing bounded to 4MB declared length.

### 6.6 The media proxy

A browser cannot send the provider's `Referer` (a forbidden fetch/XHR header), which broke `<video>`, hls.js and ffprobe with two different symptoms (HLS `manifestLoadError`; progressive "could not decode"). `mediaProxy.ts` serves from loopback with headers applied, fixing all three at once.

- **HLS playlists are rewritten, not forwarded** — segments, keys and variant playlists would otherwise hit the host with no headers. Covers bare URI lines and quoted `EXT-X-KEY`/`EXT-X-MAP`/`EXT-X-MEDIA` attributes; relative URIs resolve against the **final** (post-redirect) upstream URL.
- **A loopback URL returned from `wrap` is untouched**, else torrent/transcoder output gets double-wrapped, growing a hop per call.
- **A 4xx source fails over immediately** rather than being handed to ffmpeg, saving a wasted startup and timeout per expired URL.
- **Tokens are 16 random bytes**, not sequential integers. With `Access-Control-Allow-Origin: *` (needed for ffprobe/hls.js/Shaka/mpv/VLC), integer tokens let any page in the user's browser enumerate the session's viewing by walking them. A `Host` header not naming loopback is refused — binding to 127.0.0.1 doesn't prevent DNS rebinding.
- **`Accept-Ranges` is stated, not forwarded**; byte-zero data is never served as a mid-file range.
- **Any un-Ranged body under 4MB was once corrupted** — the manifest-sniffing branch did `.text()` then `res.end(body)`, UTF-8-mangling binary bytes (704KB segment → 1.27MB garbage). It survived because media requests almost always carry Range. Read as bytes; decode only to sniff.
- **Abandoned probe requests kept downloading the whole file.** `reader.releaseLock()` detaches but does not stop — under Electron's `net.fetch` the request lives in Chromium's network service. On Range-ignoring hosts, 3 aborted probes × 3 sources = 9 concurrent full-file downloads competing with the real one. The reader is cancelled and every upstream fetch carries an `AbortSignal` tied to the client socket (guarded on `writableEnded`, since close fires on normal finish too).
- **Segments disguised as images**: HDHub4U's playlists point at TikTok's image CDN — each segment is a real 70-byte PNG header with MPEG-TS glued behind it. No demuxer option helps; detection is PNG magic + a sync-byte run at 188-byte stride, only on routes minted by a playlist rewrite.
- **Route eviction is scheduled, not per-mint** (§6.10).

Test traps: **`MediaProxy.wrap` returns loopback URLs untouched**, so a 127.0.0.1 test origin is never proxied and tests nothing real. Regression tests must be verified to FAIL with the bug restored — a stub that ends its own body passes trivially.

### 6.7 The native engine: mpv

4K HEVC 10-bit has exactly one browser path (re-encode to 8-bit H.264 — a whole CPU core, discards HDR, flattens 5.1, downscales under 16 threads). mpv carries its own FFmpeg and hands bitstreams to D3D11VA/NVDEC/Vulkan/VideoToolbox: the same file plays untouched, full resolution, a couple of percent of one core.

**Routing is a decision, not a mode** — `shouldRouteToNativeEngine` runs *after* the browser-side decision, so removing mpv reverts every verdict exactly. Policy (`native_engine_policy`): `off`; `auto` (default — anything the browser path would re-encode or downmix: above-stereo, or lossless/object-based audio at any channel count); `aggressive`. **The channel rule replaced a codec rule** after a lossless-only rule pushed nearly all TV (modal E-AC-3 5.1 WEB-DL) to software re-encode when the GPU decodes it free.

**A stream never reaches mpv without inspection** — no raw-URL entry point, and `VideoPlayer` refuses to assign a `NATIVE_MPV` URL to the element.

- The URL handed over is the **proxied** one; headers go per-file via `loadfile`'s option map (one process serves a whole series and headers differ per episode).
- `--no-config` (a user's own config would silently change behaviour); `--ytdl=no` (wastes ~8s on failures already diagnosed).
- `video-params/pixelformat` reports the **GPU surface type** once hardware decoding runs — read `hw-pixelformat` for the real format.
- **`mpv.com`, not `.exe`** — the GUI-subsystem binary has no stdout. 7z extraction needs bsdtar (Windows' own `tar`, not `Expand-Archive`). mpv is wired into `before-quit`, else it outlives the app.
- **mpv draws its own window**, so `--osc=yes`/`--osd-level=1`/`--input-vo-keyboard=yes`. But **`--input-default-bindings` stays `no`**: defaults quit on `q`/`Q`/`Ctrl+q`, and mpv exiting while playing reports `ended` → advances to the next episode. Bindings enumerated manually (`NATIVE_KEY_BINDINGS`) to match `VideoPlayer`'s (`SKIP_SECONDS` = 10 in both). `end-file` reason `quit` reports `idle`, not `ended`.
- **`--force-seekable=yes` is removed.** Three host shapes: (a) 206 + `Content-Range` + `Accept-Ranges`; (b) 206 + `Content-Range`, no `Accept-Ranges` (honest but silent); (c) `video-downloads.googleusercontent.com` — **200 and the whole file from byte 0 regardless of the Range asked**. On (c) mpv accepted the seek and satisfied it by reading-and-discarding from 0, so the timeline never moved — and **every Continue-Watching resume hit this, since resume is a seek before the first frame**. Measured: the flag never helps and actively hangs.
- **`--volume-max=100`.** mpv's default is 130 and VLC's scale goes to 512; a >100 value divided by 100 and assigned to `HTMLMediaElement.volume` throws `IndexSizeError` **inside a `useEffect`, unmounting the player**. `clampVolume` is a second line of defence in both `VideoPlayer` and `mpvEngine`.
- Echo suppression needs **two** rules: a 700ms window (`AUDIO_ECHO_MS`) ignoring incoming values while a local change settles, **and** a value record (`engineAudio`) so an engine-originated value is never pushed back to that engine. Cleared on engine change, else the first push to a fresh player is suppressed.
- **Not built: embedding.** mpv is a separate OS window driven over IPC (roadmap Option A); true embedding needs libmpv's render API via a native addon. `MpvOpenRequest.windowHandle` exists, unused.

`mpvEngine.test.mts` (19 cases, real mpv against a synthesised HEVC10/AC-3-5.1 MKV) is deliberately impure — the failures live in the inter-process seam.

### 6.8 The failure ladder

element `error` → re-decide with `force` → route to mpv → skip the source.

- **The forced pass must still ask mpv.** `PlaybackEngine.prepare` once hard-set `FULL_TRANSCODE` on the forced pass, bypassing `shouldRouteToNativeEngine` — so exactly when the native engine was most needed it was guaranteed to re-encode. Traced: `hev1` 1080p probed `dash`/`hevc`, remuxed, failed in the element, re-encoded frame by frame; the same URL to mpv opens `d3d11va` in ~1s. Exclusions: `EME_NATIVE`/`requiresEmeDecryption` (mpv has no CDM). **The returned capability is rewritten** — `VideoPlayer` reads `capability.requiredStrategy`, and handing back the pre-force model loops the element on a source mpv could already play.
- **The ladder was wired to `<video>` only.** hls.js's fatal handler was one `setError()` line and Shaka's `.catch` the same shape, so `Playback error: fragParsingError` was the whole of what a viewer got from an HLS stream whose segments had downloaded intact — mpv idle, ffmpeg untried, next candidate never reached. **This is the reported "it downloads but it will not stream".** `player/playbackRecovery.ts` (pure, 16 tests) decides by *what would change the outcome*: nothing arrived → fetch again within a budget; bytes arrived and could not be read → hand to another engine (re-fetching identical bytes produces an identical refusal); budget spent → genuinely unplayable. `fragParsingError` escalates on sight; `bufferStalledError` gets one `recoverMediaError()` first. 403 retried, 404 not — same rule as `SourceCache`.
- **Three "the error outlived the failure" bugs**, all producing "it says it cannot stream while mpv is playing": `setError(null)` sat *below* the `NATIVE_MPV` early return in the attach effect (clear before the branch); `NativeEngineStage` renders `null` while holding an error and had no way to clear one — it now clears on `state === 'playing'` **for its own `url`**, since a late snapshot describing the previous source must not retire this one's failure; and the `[streamUrl]` reset effect reset every ref except the error. A `playing` listener on the element clears the error — `play` fires when `play()` is *called*, only `playing` means frames are presented.

`SourceCache.recordFailure`: **definitive** (404/410/"file is gone") drops immediately; **counted** (timeout/reset/5xx/403) needs 3 strikes, cleared by `recordSuccess`. **403 is specifically not definitive** — expired signed URLs and hotlink protection both answer 403 and both recover by re-resolving.

Genuinely dead hosts (recognise, don't re-debug): `workers.dev` 500/403, `r2.cloudflarestorage` 403 NotEntitled, pixeldrain 404, `hcdn3.hakunaymatata.com` DNS failure. Measurement trap: probing a manifest with `Range: bytes=1000000-` returns 416 (the file is a few KB) — ask for a satisfiable range or none.

### 6.9 The vendor coverage matrix — `tools/e2e/native-engine-matrix.mjs`

```
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs
  [--plugins 12] [--links 2] [--only Cinefreak,HDhub4u] [--titles hindi-movie,english-series]
```

Answers "given what extensions hand back, can this app put it on screen?" Imports the shipping `MediaInspector`/`decideStrategy` (not a reimplementation), then **actually plays** each candidate via headless mpv (`--vo=null --ao=null`, full demux/decode) for a few seconds, recording playhead progress and dropped frames. **`--untimed` deliberately not passed** — it would hide sustained-realtime failures. Records **both** verdicts (with and without the native engine); a differing row is a stream that used to be re-encoded and now isn't. Hindi-title coverage is deliberate (dual-audio MKV, per-language 5.1 AC-3/E-AC-3, 10-bit HEVC cluster there).

### 6.10 The window stopped answering while a film played

Windows marks a window whose message loop has stalled 5s as "not responding"; in Electron that loop is the **main process's**. Two independent costs were paid there, both only reachable while playing + searching + mpv open.

**1. The proxy swept its whole route table on every mint.** Rewriting one HLS media playlist mints a route **per segment** (~1300 in one synchronous burst), and each mint re-swept everything; past `MAX_ROUTES` each also took the `O(n log n)` sort path. One playlist rewrite:

| routes held | before | after |
|---|---|---|
| 1,000 | 306 ms | 8 ms |
| 5,000 | 800 ms | 2 ms |
| 15,000 | 1,202 ms | 2 ms |
| **20,000 (cap)** | **6,654 ms** | **9 ms** |

The table only grows within a session (every source probed adds to it) while `ROUTE_TTL_MS` is an hour — so once a session crossed the cap it **stayed** broken, which is why it reads as "searching causes it". Fixed by changing *when*, never *which*: the expiry sweep runs at most every `SWEEP_INTERVAL_MS` (30s, against a 1h TTL), and a trim goes down to `ROUTE_LOW_WATER` (90% of cap) — trimming *to* the cap leaves the table one mint over it, so the next mint sorts again.

**2. mpv pushed a snapshot per presented frame.** Observing `time-pos` delivers a `property-change` **per frame**, not once a second. Measured (1080p25, 15s, real mpv): 451 property changes — 375 `time-pos` (25/s), 56 `demuxer-cache-time` — so 30 `emit()`/s and **60 `webContents.send`/s** (main sends `mpv:update` and `external:update` for each); 60fps doubles it. Each push re-rendered a 4,020-line `VideoPlayer` plus `NativeEngineStage`, whose snapshot effect depends on five callbacks that are fresh closures every render.

`media/mpvEmitPolicy.ts` (pure, 14 tests): state change, error, pause, track selection, volume or a different file go **immediately**; only playhead, buffer, frame rate, dropped frames and startup latency may wait `COALESCE_MS` (200ms ≈ `<video>`'s own `timeupdate` rate). Measured after: **60/s → 10/s**.

Two rules: **`COALESCEABLE` is an opt-out, not an opt-in** — a new `MpvSnapshot` field defaults to being delivered, and a test enumerates every field of the type and fails if one is neither named coalesceable nor able to make a change significant. And **the timer re-reads `snapshot()` when it fires** rather than closing over the one that started it. `teardown` clears the timer and drops `lastDelivered`, so a new session's first snapshot is always significant.

Known, not changed: `WebViewHost`'s `MAX_CONCURRENT` of 3 — three hidden Chromium windows running ad-heavy resolve pages with `backgroundThrottling: false` are a real CPU cost during playback, but they are separate processes and were not the stall.

### 6.11 PRD-40.1 Tier 1 is half-built — and it looks finished

`docs/PRD/40.1` is **"Approved — frozen for implementation"** and every box in its §6 Definition of Done is still unchecked. Two of its Tier 1 modules were written, given passing test suites, and **never wired**:

| Module | State | What does not happen |
|---|---|---|
| `media/sourceLease.ts` (287 lines, `bun run test lease`) | `MediaProxy.wrapLease` exists and **has no caller**; `new SourceLease` appears nowhere in production; `mediaProxy.ts` imports it as `import type` only | Signed-URL refresh never runs. `this.leases` is always empty, so the 401/403 lease-refresh branch in `MediaProxy` is **unreachable code**. The DoD's "a 2-hour playback of a source with a 15-minute token completes with zero 403 interruptions" is not true |
| `media/playbackTelemetry.ts` (262 lines, `bun run test telemetry`) | only its `InspectionStrategyType` is imported, as a type, by `mediaInspector` | No session ever emits a telemetry record. `media:getPlaybackDiagnostics` returns `PlaybackEngine`'s **own** ring buffer, which is a different and smaller thing |

**Do not delete these as dead code** — they are approved in-flight work, and §4.1's problem (expired signed URLs) is a real recurring failure here. But do not read their green suites as evidence the feature ships either: that is exactly the trap `moduleReachability.test.mts` now names. Both are allow-listed there with the reason and the condition for removing the entry.

`§4.2` (container-aware inspection) *is* built — `mediaInspector` dispatches on `InspectionStrategyType`.

### 6.12 Probes remembered, verdicts recomputed

`media/inspectionStore.ts` is keyed on the **origin** URL, never the proxied one (a per-session token would always miss on restart). The **measurement** (codecs, bit depth, tracks) is a fact about the file and is cached; the **verdict** depends on this machine's decoders/GPU/mpv/policy and is always recomputed — caching it would be the stale-cache bug's most expensive form (install mpv, everything keeps re-encoding per a week-old record). Query strings are **not** stripped, which would merge distinct signed-URL films' codec lists.

The cache was once keyed on the loopback address (`/stream/1`, a token minted per process), so **the second film was decided from the first film's codecs**. `MediaProxy.getTargetRoute` unwraps to the upstream URL; the store refuses and prunes loopback keys.

### 6.13 Player behaviour

- **The mini player never remounts `<video>`.** Minimising is a CSS geometry change (unmounting stops the stream, loses position, renegotiates the swarm). Chrome hidden with CSS, not conditional rendering. Shortcuts disarmed in mini mode. Drag/resize is owned, not `resize:both` (can't hold aspect ratio); the handle is **top-left**, since a corner-parked window's bottom-right handle would be off-screen.
- **Floating playback is four mechanisms, not a scale**: in-app mini (CSS, always works), native PiP (moves the `<video>` surface; **unavailable for exactly what this app most often plays**, since mpv/VLC render in their own windows), app-window always-on-top, and mpv `ontop`. `isPipSupported` checks readiness *and* that the native engine isn't holding the stream. Audio-only hides the picture via `visibility`, not `display` — layout removal can stop decoding on some builds; it genuinely stops decoding on mpv (`vid=no`) but is a no-op on the element, and says so in its own help text. PiP rejection reasons are surfaced as sentences — a silent no-op button is the worst outcome.
- **Volume/mute/speed/track languages persist by language, never index** — track 2 is a different thing on every release.
- **Controls hide from one place** — a state machine polled on a timer, not `setTimeout` chains. A zero-`movementX/Y` `mousemove` is never activity: Chromium synthesises exactly that when hiding controls changes what's under the cursor, which caused a flashing feedback loop.
- **One failure surface**: `player/PlaybackErrorPanel.tsx` (`.player__overlay` z-index 4, above `.native-stage` 3, below `.player__top` 5 and `.player-panel` 7); two stacking overlays used to render through each other. **The first action offered is Download** — decoding and fetching are different capabilities, and a 10-bit HEVC file can be undecodable here and download fine. Suppressed only when the source is dead (`describeUnreadableSource`).
- Messages flow in two columns (`.player__messages--top`/`--bottom`) with `pointer-events:none` on the stack and `auto` per child.
- `NativeEngineStage` keeps only mpv track selection and fullscreen. It once drew a duplicate transport row under `z-index:3`, beneath `.player__controls` — unclickable, and its flex overflow caused a scrollbar with nothing to scroll to (**a flex item never shrinks below its content unless told to**). `onPausedChange` reports the engine's own `paused` upward, because the element's events never fire for mpv. Buffering is deliberately **not** forwarded — that overlay's copy is torrent-specific and would lie about an HTTP stream.
- **The preparation effect keys on a serialised `activeSourceKey`, not object identity.** `activeSource?.directHeaders`/`.drm` are new objects on every `playback:update`, causing stall→teardown→re-prepare→stall loops. **Add new source fields to the key, not the dependency array.**
- **`MpvEngine.serialize` queues `open`/`stop`/`shutdown`.** `mpv:stop` (cleanup) and `mpv:open` (new mount) once fired in the same tick unordered, so the old kill landed on the newly-started process. `shutdownNow` awaits the child's actual `exit`. **`playback:stop` no longer stops mpv at all** — not every session owns a stream, and the detail page's picker starting a scrape used to kill the mini-player's film. Closing the player closes mpv. Idle mpv (`--idle=yes`) left a blank window after `stop()`; it now quits.

### 6.14 Subtitles

Android always had SubRip + WebVTT + SubStation Alpha through `juniversalchardet`; desktop had neither. `.ass`/`.ssa` went through the SubRip converter (emitting `[Script Info]`/`Dialogue:` as cues), and every download decoded as UTF-8 unconditionally, so Windows-1252/GBK subtitles got correct timing and black-diamond garbage per accent.

`electron/subtitles/convert.ts`: **UTF-8 is checked (fatal-mode `TextDecoder`), not detected** — the statistical detector only sees provably-non-UTF-8 files. **A UTF-8 detection is rejected if the decode produces U+FFFD**: `chardet` false-positives on 4-byte Windows-1252 strings, and non-fatal `TextDecoder` substitutes rather than throwing, so the substitution char *is* the error signal. ASS conversion reads the `Format:` line (order is per-file), bounds the `Dialogue:` split (commas in text), drops `\p1` drawing commands.

**Provider subtitles are a real source** — `loadLinks` returns them and `subtitles:search` merges them **ahead of** OpenSubtitles, critical for extension-sourced content with no IMDb id. Appearance is one record, two renderers (`src/utils/subtitleStyle.ts` → `::cue` vars and mpv properties; `sub-pos` counts down from 100 where the CSS lift counts up).

### 6.15 External players

| Player | Channel | Capability |
|---|---|---|
| mpv | JSON IPC via `MpvEngine` | `full` |
| VLC | built-in HTTP interface | `full` |
| MPC-HC/BE | web UI, off unless user-enabled | `none` |
| PotPlayer, IINA, Celluloid, SMPlayer | none | `none` |

VLC is launched `--extraintf http` on an OS-assigned loopback port behind a per-session password (unauthenticated by default otherwise). **Capability can downgrade at runtime** — a VLC build without its HTTP module plays fine and answers nothing, so it reports `none` after a grace period rather than offering dead controls. `transport` in `VideoPlayer` is the single "who holds this stream" answer (element/native/external); volume/mute/speed apply to all engines so a handoff-and-back doesn't reset.

The URL handed over is **proxied** (headers pre-applied — each player has an incompatible or absent way to set `Referer`). Nothing is downloaded on the user's behalf; if no player is found, official download pages open. Suppressed when the source is dead — a 404 plays no better in VLC.

---

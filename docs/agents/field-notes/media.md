# Playback and the media engine — field notes

Dated post-mortems and measurements moved verbatim out of `AGENTS.md` (nothing rewritten). The distilled rules are in `AGENTS.md` §6 and `docs/agents/media.md`; read this file when you need the *why* — the measurement behind a number or the failure a rule prevents. Section numbers and cross-references (§5.1, §6.9 …) are unchanged.

## Contents

- DRM: classified before, decrypted now (2026-08-21)
- 4K, 8K and HDR (2026-08-21)
- The box now contains the player (2026-08-21)
- DASH is played, not remuxed (2026-08-21)
- Subtitles: ASS and the charset, which Android has always had (2026-08-21)
- The forced retry never asked the engine that could have played it (2026-08-26)
- The timeline drew and never moved (2026-08-26)
- YouTube serves only bounded byte ranges, and that broke everything (2026-09-18)
- The player: three bugs that all looked like "nothing happened"
- Volume had two writers and no rule (2026-08-29)
- External players are driven, where driving them is possible
- Probes are remembered; verdicts are not
- Playback failure is one surface, and it offers a download
- Four messages that positioned themselves independently
- The native stage drew a control bar nobody could click
- The native engine: mpv, for the streams Chromium will never decode
- mpv's window draws its own controls (2026-08-24)
- The second film would not play (2026-08-24)
- FFmpeg 7.1 silently broke the image-segment fix
- 5.2 The vendor coverage matrix — `tools/e2e/native-engine-matrix.mjs`
- When we cannot play it, hand it to something that can
- Provider links need the provider's headers, and a browser cannot send them
- The media proxy's tokens were `1`, `2`, `3` (2026-08-27)

---

### DRM: classified before, decrypted now (2026-08-21)

`EME_NATIVE` and `DrmConfiguration` have existed since PRD-37 and **nothing ever filled them
in from a provider**. DRM was detected only by reading a manifest body, which happens after
the probe — so an encrypted stream was handed to ffprobe first, and that is where the real
damage was:

> Measured on a synthesised CENC file: ffprobe reads it and reports **correct codec names**,
> then decoding produces pages of `non-existing PPS`, `no frame!`, `reference count
> overflow`. The probe does not fail. It succeeds with a lie, and every decision made from
> it is wrong — which is why encrypted provider streams reached users as "this file is
> corrupt" rather than "this is encrypted".

So a provider's declaration now short-circuits inspection entirely (`PlaybackStreamRequest.drm`),
and the verdict distinguishes three cases that used to read identically:

1. **ClearKey with a key, browser-decodable payload** → `EME_NATIVE`, and it now *plays*.
   `src/utils/clearKeySession.ts` attaches `org.w3.clearkey` MediaKeys and answers the licence
   request locally — a ClearKey licence is a JWK Set, and the key already came with the link,
   so there is no server in the loop. Covers progressive CENC and, through hls.js, fMP4 CENC
   in HLS.
2. **ClearKey with a key, payload the browser cannot decode** → the ordinary ladder, with
   `-decryption_keys` on the plan. Decrypting is not enough when the bitstream still has no
   decoder; FFmpeg does both in one pass. **Progressive only** — measured, the DASH demuxer
   answers `Option decryption_key not found`, which is *fatal to the whole command line*
   rather than ignored. Same trap `-extension_picky` set, from the other direction.
3. **Widevine, PlayReady, ClearKey without a key, or an unrecognised system** → `EME_NATIVE`
   and named as such. Widevine needs a CDM this build does not ship (Android gets one from
   the device); the message now says so rather than implying a broken source.

Two encoding hazards live in `src/utils/clearKey.ts`, both of which fail *silently* into a
stream that decrypts to noise:

- **Hex and base64url are told apart by length, never by alphabet.**
  `0123456789abcdef0123456789abcdef` is valid base64url *and* valid hex; read as base64 it
  yields 24 bytes of the wrong key. 16 bytes is 32 hex characters or 22 base64url ones, and
  that is unambiguous.
- **EME wants base64url and FFmpeg wants hex.** Both conversions live in one file so they can
  be tested against each other.

`DrmType` gained `unknown` deliberately: an unrecognised system is exactly as unreadable to
FFmpeg as a recognised one, and folding it into `none` sends it back to the probe to be
misdiagnosed.

**Still not built: DASH under any DRM.** Chromium cannot demux an `.mpd` without a JavaScript
player driving MSE, FFmpeg refuses the keys, and this build ships no dash.js. That is the
remaining gap and it is now *reported by name* instead of failing as a corrupt file.

### 4K, 8K and HDR (2026-08-21)

**The software-encode guard was height-only and stopped being right above 4K.** It asked "is
this taller than 1080?" and "are there fewer than 16 cores?", and 16 cores was measured at
*3840x2160*. 8K is four times those pixels, so the machine that holds 1.0x at 4K holds about
0.25x at 7680x4320 — and the guard waved it through at full resolution, producing exactly the
stall it exists to prevent on the most expensive files in the corpus. The threshold is now
pixels per second rather than a height, with `Math.max(1, …)` clamping it so **every verdict
measured at or below 4K is unchanged**; it only ever tightens. Width is used where reported,
because a 5120x2160 frame is not a 3840x2160 one.

Above 4K, a container remux also routes to mpv under `auto`. The remux stays cheap and leaves
Chromium decoding an 8K frame in software with four times a 4K surface behind it — this is
the tier where "the browser can demux it" and "the machine can play it" come apart.

**HDR that is re-encoded has to be tone-mapped, and was not.** `-pix_fmt yuv420p` converts the
storage format and says nothing about the transfer function, so a PQ or HLG source re-encoded
to 8-bit keeps HDR-referred values and is displayed as if they were SDR: washed out, flat,
desaturated. Nothing errors. The file plays perfectly and looks wrong, which is why it
survived. Measured on a synthesised PQ fixture, average saturation of the first frame:

| | SATAVG | YAVG |
|---|---|---|
| SDR source (reference) | 112.6 | 124.7 |
| Re-encoded, no tone-map (what shipped) | 22.8 | 97.4 |
| Re-encoded with the zscale chain | **63.0** | 84.3 |
| `tonemap` without `zscale` — the "graceful fallback" | 6.3 | 37.7 |

**That last row is why there is no degraded fallback.** Fed non-linear PQ code values, the
`tonemap` filter alone is not a worse tone-map, it is a wrong one — measurably worse than
doing nothing. `toneMapFilters()` returns the chain when `zscale` is present and **nothing at
all** when it is not. `zscale` comes from zimg, an optional dependency, so it is detected at
startup exactly like `-extension_picky`; a filter the binary lacks fails the whole command
line.

Only a re-encode is tone-mapped. A copied stream carries its own metadata and is displayed
correctly by whatever decodes it, and `-c:v copy` could not tone-map anyway.

One trap while you are in `buildArgs`: ffmpeg takes **one** `-vf`. A second silently replaces
the first, so the tone-map and the downscale share a chain rather than each pushing their own.

### The box now contains the player (2026-08-21)

`extraResources` carried exactly one entry — the sidecar — so a freshly
installed app had **no ffprobe, no ffmpeg and no mpv**. All three were fetched on
first use, and `setupMpv` did not even try outside Windows: it printed
`brew install mpv` and returned false.

The consequence was not a missing convenience. `MpvEngine.isAvailable()` was
false, so `shouldRouteToNativeEngine` returned false for **every** stream and the
native engine was never used at all — every 4K HEVC file took the software
transcode path, which is the 0.47x-realtime stall the engine exists to avoid.
**The default install was the worst configuration this codebase can be in, and
the good one was opt-in behind a download the user had to discover.**

`tools/package/build-media-runtime.mjs` stages the binaries per platform into
`cs3_windows/media-runtime/`, `extraResources` copies that to `resources/media/`,
and `electron:build` runs it. It **fails the build** when a required component is
missing rather than producing a package quietly without its player;
`--allow-missing` is the deliberate override.

Two things about resolution order:

- **The bundled copy wins**, where it used to lose. `resolveBinary` started at
  `userData/bin`, which is the same shape as the stale-runtime trap in §3: a copy
  fetched by an older version silently shadows the one this version was built
  and tested against.
- **`yt-dlp` is the exception**, and deliberately so. Its extractors break when a
  site changes, which happens weekly, so a downloaded copy there is *newer*
  rather than staler. It keeps the old order.

On Linux and macOS mpv is `required: false` on purpose rather than by omission —
the distribution's own package is the one wired to that platform's VA-API or
VideoToolbox, and shipping a generic binary over it produces a player that
cannot open the GPU. A distribution package should depend on `mpv`.

**Chromium is now asked for the decoders the platform has.** `main.ts` set
exactly one switch (`autoplay-policy`) and had never asked for
`PlatformHEVCDecoderSupport`, available since Chrome 104 — so HEVC was
re-encoded even on machines whose GPU decodes it for free. Enabling it cannot
make a decision worse: `App.tsx` measures `canPlayType` at startup and overrides
the static table **in both directions**, so a machine without the decoder still
answers `""` and still gets the transcode.

### DASH is played, not remuxed (2026-08-21)

Shaka Player (`shaka-player`, Apache-2.0, an ordinary bundled dependency) now
takes any DASH manifest whose payload the browser can decode — strategy
`DASH_NATIVE`. The remux stays as the fallback for a payload Chromium cannot
decode, because Shaka appends to the same MSE and cannot invent decoders either.

What this buys, beyond not spending an ffmpeg process: the remux **flattens the
adaptive ladder to one fixed rendition**, which is the thing DASH exists for.
And it closes the gap the ClearKey work left open — `DASH_NATIVE` is the only
strategy that can play encrypted DASH, because FFmpeg's DASH demuxer rejects
`-decryption_key` outright.

**The proxy had to learn DASH first, and that fixed an existing bug.** A manifest
names its segments relative to its own address, so serving one unmodified from
loopback makes the player resolve them against `…/stream/<token>` and ask for
paths the proxy has no route for. This was never only a Shaka problem: **ffmpeg's
DASH demuxer resolves relative segments exactly the same way**, so the remux path
was already broken for every manifest that did not spell its segments out in
full. `MediaProxy` now rewrites MPDs, and needed a shape it did not have:

- **Directory routes** (`/base/<token>/<rest>`), because `SegmentTemplate` names
  segments with `$Number$` placeholders the *player* expands. HLS never needed
  this — a playlist lists every segment, so each got an exact route. A DASH
  manifest has no list to rewrite, only a base to redirect.
- A `<BaseURL>` is **inserted** when the manifest has none, replaced when it has
  one, and absolute `media`/`initialization`/`sourceURL` attributes are rewritten
  by directory so their placeholders survive.
- The suffix arrives from the renderer, so `resolvePrefixed` refuses anything
  that leaves the base's origin. Without that check a directory route becomes the
  arbitrary-URL fetcher `wrap` deliberately is.
- Manifest sniffing is **bounded by declared length** (4 MB). Reading a body to
  identify it means buffering it, and a provider serving a 5 GB MKV as
  `application/octet-stream` is routine.

Pinned by `mediaProxy.test.mts` (11 cases). Note the origin there is a *stub*
rather than a real server: `wrap` returns loopback URLs untouched by design, so a
socket-backed origin on 127.0.0.1 tests nothing.

### Subtitles: ASS and the charset, which Android has always had (2026-08-21)

`docs/docs_cs3/05` records what the Android app does — SubRip, WebVTT **and**
SubStation Alpha, every file through `juniversalchardet` first. Desktop did
neither, and both failures are silent:

- **`.ass` / `.ssa` went through the SubRip converter**, which emits
  `[Script Info]` and `Dialogue:` lines as if they were cues. That is most of
  anime and of fansubbed releases.
- **Every download was decoded as UTF-8**, because `Response.text()` does that
  unconditionally. A Windows-1252 or GBK subtitle then loads with correct timings
  and a black diamond where each accent was — which reads as a bad upload.

`electron/subtitles/convert.ts` owns both. Two rules in it are worth keeping:

- **UTF-8 is checked, not detected.** `TextDecoder` in fatal mode either accepts
  the bytes or throws, so the common case is answered exactly and the statistical
  detector only sees files that are provably not UTF-8.
- **A detection of UTF-8 is then rejected, and a decode producing U+FFFD is
  treated as a failed decode.** `chardet` answers "UTF-8" for a four-byte
  Windows-1252 string, and `TextDecoder` outside fatal mode substitutes rather
  than throwing — so the substitution character *is* the error and is checked
  for.

ASS conversion reads the `Format:` line rather than assuming field positions
(ASS declares its order per file), bounds the `Dialogue:` split so text
containing a comma is not truncated, and drops `\p1` drawing commands — those are
vector shapes, and printing their coordinate lists puts a wall of numbers over
the picture.

### The forced retry never asked the engine that could have played it (2026-08-26)

Reported as: none of a title's sources play or download, while the Android app plays the
same list. Measured against the captured source list (`.temp/RRR_sources.md`, 54 sources):
most of them are **healthy** — 206 with `Content-Range` and `video/x-matroska`, or a valid
`.mpd`/`.m3u8` with no DRM — and five of a representative seven play through this app's own
`MediaProxy` into mpv in about a second, including the CloudFront-signed DASH that needs a
`Cookie` and the googleusercontent link that ignores `Range`. So the sources were not the
variable, and neither was the proxy.

**`PlaybackEngine.prepare` hard-set `FULL_TRANSCODE` on the forced pass and never consulted
`shouldRouteToNativeEngine`.** `decideStrategy` routes to mpv properly; this path bypasses
the decision entirely. The consequence is precise and backwards: the forced pass runs
*exactly* when the element has already failed on a source — which is the definition of what
the native engine exists for — and it was the one path guaranteed to answer with a software
re-encode instead.

Traced through a session log on MovieBox's DASH:

```
ffprobe  /stream/17  container=dash videoCodec=hevc audioCodec=aac   1736ms   ok
prepare  /stream/17  engine=ffmpeg  strategy=REMUX_CONTAINER
prepare  /stream/17  engine=ffmpeg  strategy=FULL_TRANSCODE  probeLatencyMs=0
```

An `hev1` 1080p stream probes as `dash`/`hevc`, is remuxed, fails in the element, and comes
back here to be re-encoded frame by frame. The same URL handed to mpv opens with `d3d11va`
in about a second — mpv carries its own FFmpeg and the platform's hardware decoders, so a
bitstream that defeated Chromium is usually ordinary to it.

The forced pass now routes to `NATIVE_MPV` when the engine is available and the policy is
not `off`, and falls back to the re-encode when it is not. Two exclusions: `EME_NATIVE` and
anything `requiresEmeDecryption`, because mpv holds no CDM and routing an encrypted stream
to it converts a playable source into an unplayable one.

**The returned capability is rewritten with it, and that half is load-bearing.**
`VideoPlayer` reads `capability.requiredStrategy` to choose between the `<video>` element
and `mpv:open`. Returning the pre-force model would hand the URL back to the element that
had just failed on it — which fails, forces again, and spins the retry ladder on a source
the native engine was ready to play.

**What is genuinely dead in that list, and worth recognising rather than re-debugging:**
`workers.dev` mirrors answering `500` or `403 Quota exceeded`, `r2.cloudflarestorage`
answering `403 NotEntitled`, pixeldrain `404`, and `hcdn3.hakunaymatata.com` failing to
resolve at all (`ENOTFOUND`/`EAI_AGAIN`) — a DNS answer, not an app failure, and one the
DNS-over-HTTPS setting can change.

**One measurement trap.** Probing a manifest with `Range: bytes=1000000-` returns `416`,
because an `.mpd` is a few kilobytes. Nine sources looked dead that way and every one was
fine; a liveness scan has to ask for a range the file can actually satisfy, or none at all.

### The timeline drew and never moved (2026-08-26)

Reported as: the film downloads perfectly, and streaming the same link shows a timeline
that is frozen — in the in-app player and in mpv as an external player alike. Three
separate defects, found by measuring the sources rather than reading the player, and none
of them is the one the symptom points at.

The sources were captured from the app for two titles (`.temp/hulk_sources.csv`,
`.temp/supergirl-…md`) and every one was characterised against the real host. That is what
made the causes separable — they present identically.

**1. `--force-seekable=yes` on an origin that ignores `Range`.** The flag had been in
`mpvEngine` since the engine's first commit, as a blanket default. Measured across the
corpus, hosts fall into three shapes and only one describes itself correctly:

| Shape | Reply to a `Range` | Seekable |
|---|---|---|
| `sssrr.org`, r2.cloudflarestorage | 206 + `Content-Range` + `Accept-Ranges: bytes` | yes, and says so |
| gdflix `workers.dev` mirrors | 206 + `Content-Range`, **no** `Accept-Ranges` | yes, and does not say so |
| `video-downloads.googleusercontent.com` (GDFlix "Instant Download") | **200 + the whole file from byte zero**, whatever was asked | **no**, and does not say so |

On the third, mpv accepted the seek, could not ask for the offset, and satisfied it by
reading and discarding from byte zero. On a 3.24 GB link that never arrives: the tracks
parse, the window opens with a timeline on it, and the position never moves. **Every resume
from Continue Watching hit it, because a resume is a seek before the first frame** — which
is why it looked like the app could not play that source at all while the downloader,
which only ever reads forward, was fine.

Measured on a synthesised fixture behind a Range-ignoring origin, seeking to 60s:

| Origin | `--force-seekable` | Result |
|---|---|---|
| honours Range | yes | seeks to 60s |
| honours Range | **no** | seeks to 60s — the flag buys nothing |
| ignores Range | **yes** | grinds the whole file, no first frame |
| ignores Range | no | starts at 0 immediately and plays |

So the flag only ever converts a correct "cannot seek" into a hang, and it is gone.
`MediaProxy` now **states `Accept-Ranges` rather than forwarding it**, in both directions,
which is what restores seeking on the middle row without anything having to be forced. It
also **refuses to serve byte-zero data as a mid-file range**: a `200` answering a
`bytes=N-` used to be passed straight through, handing the player the opening of the film
labelled as its middle.

**2. `MAX_ROUTES` was below the cost of one film, and LRU evicted the wrong end.**
Rewriting one HLS media playlist mints a route per segment — ~1200 for a two-hour film, in
a single burst, against a cap of 1000. The routes evicted to make room were the *oldest*:
the master playlist and the video variant playlists it had just handed the player.
Measured on HDHub4U's `hdstream4u.com` master, tokens 4 and 5 — the two video variants —
were gone before the first request for either, and the table held segments 306–1305. mpv
read the master, asked for the variant it named, and got `404 Unknown stream` **from us**.

Two changes, and the second matters more than the cap: routes now carry `createdAt`
separately from `lastAccess`, a route that has never served a request is evicted only after
every route that has, and **among never-served routes the newest go first**. For an
unfetched route, age is not staleness — it is position in the document that minted it, so
the oldest are the variants and the opening segments and the newest are the end of the
film. Dropping the tail is free; the playlist re-mints it if playback ever gets there.

**3. Any body under 4 MB with no `Range` was corrupted.** Pre-existing, and independent of
the above. The manifest-sniffing branch did `await upstream.text()` and then `res.end(body)`
— so a binary body small enough to reach it was decoded as UTF-8 and re-encoded, turning
every byte that is not valid UTF-8 into three. A 704 KB HLS segment left the proxy 1.27 MB
long and no longer a media file. It survived because media requests almost always carry a
`Range`, which skips the branch entirely; only the occasional un-ranged first fetch of a
small segment was hit, and it read as a bad source. The body is read as bytes now and
decoded only to look at.


**4. An abandoned request left the whole file downloading.** Found from a later session
log, after the three above were fixed: `ffprobe timed out after 20000ms` three times on
each googleusercontent source, then `The source could not be reached: The operation was
aborted due to timeout` — while the same file probed in 2.4 s standalone. `pump`'s cleanup
called `reader.releaseLock()`, which detaches the reader and **leaves the body open**.
Under Node's fetch the transfer stops anyway; the main process runs on Electron's
`net.fetch`, where the request lives in Chromium's network service and a detached body does
not reliably stop it. On an origin that ignores `Range` and answers everything with the
whole file, each abandoned probe is therefore a 3.24 GB download still running — three
attempts across three sources is nine of them, against a link the viewer was already
downloading at 4.2 MB/s. That is how a two-second probe becomes a twenty-second timeout,
and why playback that had started buffered until the engine exited. The reader is cancelled
now, and every upstream fetch carries an `AbortSignal` tied to the client socket — the
signal is what reaches a request still blocked in DNS or TLS, before there is a body to
cancel at all. Guarded on `writableEnded`, because `close` also fires on a normal finish.

**Two traps worth not repeating.** `MediaProxy.wrap` returns loopback URLs *untouched* by
design, so a test origin listening on 127.0.0.1 is never proxied and measures nothing —
the test file's header says so, and it is still easy to do. And a regression test for this
class of bug has to be checked by breaking the fix again: the assertions pass trivially
against a stub that ends its own body, so the upstream in `mediaProxy.test.mts` is endless
and the test is verified to FAIL with `releaseLock()` restored.

**Segments disguised as images are unwrapped.** HDHub4U's playlists point at TikTok's image
CDN, which serves only images, so each segment is a **real 70-byte PNG header with the
MPEG-TS glued on behind it** — `Content-Type: image/png` and a valid PNG signature. This is
a step beyond the `.png`-*named* segments `-extension_picky` was added for: there the bytes
were already TS and only the name lied, so opening the extension allow-list was enough.
Here the bytes lie too and no demuxer option helps — FFmpeg reads a PNG, finds no
elementary stream, and stops with nothing in the log naming the cause. Measured on a real
segment: 704,318 bytes in, a 70-byte prefix, then 3,745 consecutive sync bytes at the exact
188-byte stride and a clean `h264 + aac` after the strip. Only routes minted by a playlist
rewrite are examined, and only that signature — PNG magic followed by a sync run at the
packet stride — counts, so a mis-detection would need a file that is simultaneously a valid
PNG and a valid transport stream.

**What is still not ours.** Of the 16 Supergirl sources, after these fixes the four
r2.cloudflarestorage links, HUBCDN and all three HLS variants play. The rest fail at the
host and are worth recognising rather than re-debugging: pixeldrain 404s, the Vidstack IP
404s, and the googleusercontent links expire (they are signed with an 8-hour window, and
answer `HTTP 400` after it). A `RefreshingSource` retry on those is correct behaviour.

### YouTube serves only bounded byte ranges, and that broke everything (2026-09-18)

The measurement that shaped the playback half. None of it was guessable.

**YouTube publishes exactly one muxed format -- id 18, 360p -- and it is mostly
refused.** Across eight trailer ids from Cinemeta, format 18 answered `HTTP 403`
on **five of eight**, and `yt-dlp` itself gets the same 403 when asked to
download them, so it is the URL being rejected rather than how we fetch it. No
extraction client changes it: `tv`, `ios`, `android_vr`, `web_safari`, `mweb` and
`tv_simply` were each measured at **0 of 5**.

**The DASH rungs are fine** -- video 137 (1080p avc1) and audio 140 (m4a)
answered `HTTP 206` on every one. So the stream is a *pair*, and something has to
mux it.

**But a DASH URL refuses anything that is not a bounded window:**

| Request | Reply |
|---|---|
| no `Range` header | **403** |
| `Range: bytes=0-` | **403** |
| `Range: bytes=0-4095` | 206, `Content-Range: bytes 0-4095/61710344` |

That defeats every ordinary consumer here: ffmpeg opens an input with no `Range`
at all, and a media element streaming from a position sends the open-ended form.
Both get a 403 and report the source as forbidden, which reads as a dead link.

`MediaProxy.wrap(url, headers, { boundedRanges: true })` is the answer:
`serveWindowed` asks upstream in windows and stitches them into the single
continuous response the client expects. Four things about it are load-bearing:

- **The first window is 64 KB, and that is not a warm-up.** A window's end has to
  be a byte that exists, and the total is unknown until the first reply.
  Measured: `bytes=0-4194303` of a 2,742,140-byte audio rung answers **403**, not
  a clamped 206 -- so a full-size opening window fails on every file smaller than
  the window, while the 61 MB video rung beside it succeeds. That difference
  looks exactly like "audio is broken".
- **The total comes from the first window's `Content-Range`.** It is the only
  place the full size appears, and without it a media element cannot draw a seek
  bar.
- **The status mirrors what was asked**, not what upstream said: upstream answers
  206 to every window, and echoing that to a client which asked for the whole
  file would leave it waiting for a remainder that never comes.
- **A refused window is halved and retried** down to 64 KB, covering both a
  window too long for the file and a momentary refusal.

**Verified end to end** with the real `MediaProxy` and the real ffmpeg: plain GET
-> `200`, `Content-Length: 48696621`; mid-file range -> `206 bytes
1000000-1004095/48696621`; and the two-input copy produced a fragmented MP4 that
ffprobe reads as `h264 1920x1080` + `aac 2ch`. Both decode natively in Chromium,
so the element plays it with no further work.

**One trap when measuring this yourself:** sustained re-reads of one googlevideo
URL start answering 403 after about a megabyte. Two 512 KB windows succeeded and
every window after them failed, on a URL six hours from expiry that a dozen
earlier probes had hammered. Fresh URLs served 16 MB windows without complaint.
Budget fresh ids per experiment, or the rate limit will read as a design fault.

`MediaTranscoder`'s `Session` gained an optional `audioUrl`, unset by every other
caller: with it absent the argument list is byte-for-byte what it was.

### The player: three bugs that all looked like "nothing happened"

**`onRefresh` was `() => {}` on two of three player mount points.** Only the live
`PlaybackSession` path had a working "Search again"; the path taken after picking a source
from the detail page rendered the button and wired it to nothing — which reads as "the
search found nothing new" rather than as a dead control. It now runs a real cache-bypassing
discovery whose results stream into the open list, and reports when one cannot start.

**Two sources could both show "Playing".** `isActive` compared `infoHash`, which for a
provider stream is *synthetic* — the SHA-1 of its URL. Two extensions scraping the same file
host produce the same id, so every copy lit up. Only the first match is marked now, and the
React key is disambiguated so duplicates do not collapse into one row either.

**Volume, mute, speed and track languages persist**, across media and restarts. Languages,
never indices: audio track 2 is the Hindi dub on one release and the director's commentary
on the next, so restoring an index would confidently select the wrong thing. The load is
applied through the same ref the attach effect reads, or a source that attaches before the
preference arrives spends its first seconds at full volume.

### Volume had two writers and no rule (2026-08-29)

Reported as: the volume slider is flaky, and past a certain point in mpv the player
crashes. Two distinct defects with one shared cause — volume is the only control in this
app that is written from **both** ends, and nothing said which end wins.

**The crash is a range contract nobody was enforcing.** The player holds volume as a
fraction of unity because that is what `HTMLMediaElement.volume` takes. Both other engines
speak percentages and both can exceed unity from their *own* UI: mpv defaults
`volume-max` to 130, and its OSC slider and the `add volume 5` bindings we install both
walk past 100; VLC reports up to **512** on its 0–256 scale. That level arrived on a
snapshot, was divided by 100 into something greater than 1, and was assigned to
`video.volume` — whose setter throws `IndexSizeError` outside [0,1]. Thrown from inside a
`useEffect`, that unmounts the player. "Turn it up past a point and it crashes."

Fixed at the source in both engines rather than only at the element: mpv is launched with
`--volume-max=100` and VLC's reported level is capped, so the two windows agree on what
100% means — an OSC showing 120% beside a bar showing 100% is the next bug. `clampVolume`
in `VideoPlayer` and in `mpvEngine` is the second line, kept because the element's
contract is not something to be defensive about only where we remembered.

**The flakiness is the echo, and it needs two rules, not one.** Every push to an engine
comes back as an observed property change. Neither rule alone is enough:

- **A time window** (`AUDIO_ECHO_MS`, 700 ms): while a locally-made change is settling,
  incoming audio values are ignored. Without it, snapshots describing the volume from
  *before* the drag still in progress arrive and yank the slider backwards under the
  cursor.
- **A value record** (`engineAudio`): a level that came *from* an engine is never sent
  back *to* it. Without it, adopting mpv's level immediately re-derives a push of that
  same level — by then several steps behind where the viewer has dragged mpv's own knob,
  so our echo drags it backwards.

`engineAudio` is cleared whenever the engine changes, or the suppression would skip the
one push that matters — the first to a player that has never been told anything.

### External players are driven, where driving them is possible

The requirement is that transport controls keep working after a handoff. What is actually
possible is not uniform, and `externalPlayerControl.ts` declares it per player rather than
pretending:

| Player | Channel | Capability |
|---|---|---|
| mpv | JSON IPC — routed through `MpvEngine` | `full` |
| VLC | its built-in HTTP interface | `full` |
| MPC-HC/BE | web UI, **off unless the user enabled it**, no launch switch | `none` |
| PotPlayer, IINA, Celluloid, SMPlayer | none | `none` |

VLC is launched with `--extraintf http` on an OS-assigned loopback port behind a
per-session password — that interface is unauthenticated by default, and binding it without
one would hand playback control to anything else on the machine.

**Capability can downgrade at runtime.** A VLC built without its HTTP module launches, plays
perfectly, and answers no request; after a grace period the snapshot reports `none` and the
UI stops offering controls that cannot work. A seek bar that silently does nothing is worse
than one the viewer was told about — that is the whole reason this is declared rather than
assumed.

`transport` in `VideoPlayer` is the single derived answer to "who is holding this stream?" —
element, native engine, or external — and every control reads it. Volume/mute/speed are
applied to *all* engines rather than only the active one, so a handoff to VLC and back does
not restore the volume to 100%.

### Probes are remembered; verdicts are not

`media/inspectionStore.ts` persists what ffprobe found, keyed on the **origin** URL — never
the proxied one, whose port and token are minted per session and would miss on every restart
while looking like they should hit.

The split is the point. A **measurement** (container, codecs, bit depth, track list) is a
fact about the file and never changes. A **verdict** is a function of that measurement *and*
this machine: the renderer's decoders, whether a GPU encoder exists, whether mpv is
installed, which routing policy is set. So only the measurement is stored and
`decideStrategy` runs again every time. Caching the verdict would be the stale-cache bug in
its most expensive form — install mpv, and every previously-played title keeps re-encoding
because a record from last week says so.

Query strings are deliberately **not** stripped to normalise signed URLs: two films behind
one path template would then be served each other's codec lists. A signed URL simply misses
and is re-probed.

Measured: 97 ms saved on a local multi-track MKV, and the probe was 1.6–1.7 s per source
against real provider streams in the vendor matrix — which is where it actually pays.

### Playback failure is one surface, and it offers a download

There were two overlays, and they stacked. `NativeEngineStage` rendered its own
full-bleed `.player__overlay` on an mpv failure **and** reported the same failure
through `onError`, so `VideoPlayer` rendered its error overlay as well — two
translucent black panels, each dimming the other, with two different sentences
about one failure legible through each other. Both also sat under `.native-stage`
(`z-index: 3`) while carrying no `z-index` of their own, so on the engine that
fails most interestingly neither could be read at all.

`player/PlaybackErrorPanel.tsx` is the single owner now; the engine reports and
the player renders. `.player__overlay` is `z-index: 4` — chosen against its
neighbours, not for headroom: above `.native-stage` (3), below `.player__top` (5)
so Back stays reachable, and below `.player-panel` (7) so "Choose another source"
opens the list *over* the error that offered it.

**The first action is Download, deliberately.** Decoding and fetching are
different capabilities: a 10-bit HEVC file with Dolby audio can be undecodable
here and completely ordinary to download, and every report of "it will not play"
from a source that would have downloaded fine was a dead end the app put there
itself. Offered only when the source is alive — `describeUnreadableSource`
reporting `dead` suppresses the download, the external players and everything
else that cannot help a 404.

### Four messages that positioned themselves independently

`.player__external-banner` at `top: 4.5rem`, `.player__audio-notice` at
`top: 4.2rem`, `.player__strategy-note` at `bottom: 5.5rem`, `.player__toasts` at
`bottom: 6.5rem` — four absolutely positioned boxes, none of them opaque. Any two
that were true at once overlapped and rendered *through each other*. They can
genuinely co-occur (a stream being converted, on a machine missing the components
that would convert it, while a download finishes), so suppressing one was never
the answer. They are two flow columns now — `.player__messages--top` and
`--bottom` — and the stack carries the blur. `pointer-events: none` on the stack
with `auto` on each child keeps the gaps click-through; the stack spans the width
of the player and would otherwise swallow clicks on the picture.

### The native stage drew a control bar nobody could click

`NativeEngineStage` had a full transport row along its bottom edge: play, seek,
volume, mute, track menus, fullscreen. Every one of those except the track menus
was a duplicate — `VideoPlayer`'s own bar already routes `togglePlay`, `seekTo`
and volume to mpv. And the duplicate was **unreachable**: `.player__controls` is
`z-index: 5` and pinned to the bottom, the stage is `z-index: 3`, so the row sat
underneath it receiving no clicks at all. Its overflow is also what produced the
reported horizontal scrollbar with nothing to scroll to.

Two flexbox faults were behind that overflow, and both are the same trap:
`.native-stage__surface` had `flex: 1` with the default `min-height: auto`, so it
refused to shrink below its own text and pushed the control row off the bottom of
the player; `.native-stage__seek` had `flex: 1` with `min-width: auto`, so the
range input's intrinsic width forced the row wider than the player. **A flex item
does not shrink below its content unless you say so.**

What is left in the stage is what the player's bar genuinely cannot do — mpv
track selection and fullscreening mpv's own window — sitting in the surface where
nothing covers it. Transport state now flows the other way: `onPausedChange`
reports the engine's own `paused` up, because the play button reads the
`<video>` element's events and those never fire here. It showed "Play" over a
film that was playing, and the first press paused it. Buffering is deliberately
*not* forwarded into `isBuffering` — that flag drives an overlay reading
"Buffering from peers…", which is a torrent's story and a lie about an HTTP
stream.

### The native engine: mpv, for the streams Chromium will never decode

Added 2026-08-19 against `docs/roadmap/support_libmpv.md`. Everything in the codec
section above is still true and still the fallback; what changed is that the transcoding
ladder is no longer the *only* answer, and it stopped being the answer for the case where
it was worst.

The arithmetic that motivates it. A 4K HEVC 10-bit release — routine on GDFlix, Google
Drive links and any decent torrent — has exactly one browser-side path: re-encode to 8-bit
H.264. That costs a whole CPU core, throws away the HDR metadata, flattens 5.1 to stereo,
and on a software-only host under 16 threads it downscales to 1080p because libx264 cannot
hold realtime at 4K. mpv carries its own FFmpeg and hands the bitstream to D3D11VA, NVDEC,
Vulkan or VideoToolbox. **Measured here: `d3d11va`, full resolution, nothing re-encoded.**

| File | Role |
|---|---|
| `media/mpvEngine.ts` | Spawns and supervises mpv; line-delimited JSON-RPC over a named pipe (Windows) or unix socket. Property observation, track lists, seek, tracks, subtitles. |
| `src/types/mpv.ts` | The contract, imported by both sides. `MpvSnapshot` is what the player renders from. |
| `src/components/player/NativeEngineStage.tsx` | The player surface for a routed stream: our controls, mpv's playback. |
| `binaryDownloader.setupMpv` | Fetches a portable build on demand. |

**Routing is a decision, not a mode.** `shouldRouteToNativeEngine` runs *after* the
browser-side decision rather than instead of it, so removing mpv from the machine reverts
every verdict to exactly what it was — there is no second code path to keep correct. Three
policies, stored in the datastore under `native_engine_policy`:

- `off` — the ladder does everything, as before.
- `auto` (default) — mpv takes any stream the browser path would have **re-encoded** or
  **downmixed**: that is anything above stereo, plus lossless and object-based audio
  (TrueHD, DTS-HD MA, DTS:X, FLAC, PCM) at any channel count.
- `aggressive` — mpv takes everything that is not already playing natively, including a
  stereo container remux that loses nothing.

**The channel rule replaced a codec rule, and a user's catalogue is what settled it.** The
first version routed only *lossless* audio, reasoning that AC-3/E-AC-3 5.1 was a recoverable
loss and that routing it would push most television out of the in-app player. The report
back was "this happens on most of the content", with `Audio re-encoded, video copied
untouched: matroska,webm cannot be demuxed by the browser; EAC3 audio has no decoder here`
on title after title. A 1080p WEB-DL carrying E-AC-3 5.1 in Matroska is the **modal**
provider release, so the rule meant to protect the common case was degrading it: nearly
every film and episode played as stereo while the 5.1 sat in a file the GPU decodes for
free. The line is now channels, not codec — genuine stereo still stays in the app, where a
remux costs nothing and loses nothing.

**A stream never reaches mpv without being inspected first.** There is no `mpv:play(url)`
that takes a raw link; `media:prepare` remains the only way to obtain a playable URL, and
it returns `requiredStrategy: 'NATIVE_MPV'` with the proxied loopback address. INV-RACE-1
applies to this engine exactly as it applies to the `<video>` element — a second entry
point that skipped inspection would reintroduce PRD-37's original bug in a new decoder.
`VideoPlayer` also refuses to assign a `NATIVE_MPV` URL to the element: Chromium would take
it, fail, fire `error`, and the failover ladder would skip a source that is playing fine.

Things that will bite:

- **The URL handed over is the proxied one**, same rule as `externalPlayer`. Headers are
  also passed per-file through `loadfile`'s option map rather than as process arguments,
  because one long-lived mpv process serves a whole series and episode 2's `Referer` is not
  episode 1's.
- **`--no-config` is not tidiness.** Someone who uses mpv has configured it for mpv — key
  bindings, an OSC, a profile forcing software decoding, `--save-position-on-quit`. Any of
  those silently changes what this engine does, and the bug is invisible on every machine
  but theirs.
- **`--ytdl=no`.** Link resolution is the extensions' job and it is already done. Left on,
  every failed load spends seconds shelling out to a downloader that cannot help — measured
  at ~8s added to a failure mpv had already diagnosed as HTTP 522.
- **`video-params/pixelformat` lies once hardware decoding is running.** It reports the GPU
  surface type (`d3d11`, `cuda`), and the real format moves to `hw-pixelformat`. Reading
  only the first makes every hardware-decoded file look like it has no bit depth — which is
  the fact that put it on this path.
- **`mpv.com` ships beside `mpv.exe`.** `mpv.exe` is a GUI-subsystem binary whose stdout
  goes nowhere, so without the console front-end `--version` and `--hwdec=help` return
  empty and every diagnostic about the engine is blank.
- **The 7z archive needs bsdtar.** Windows' own `tar.exe` is libarchive and reads 7z;
  PowerShell's `Expand-Archive` does not, so `extractZip`'s fallback cannot rescue this one.
- **mpv is a child process with its own window** and is wired into `before-quit`. Without
  that it outlives the app and keeps playing with nothing left on screen to stop it.

### mpv's window draws its own controls (2026-08-24)

`--osc=no`, `--osd-level=0`, `--input-default-bindings=no` and
`--input-vo-keyboard=no` were all set on the reasoning that our control bar is the
controller and mpv's would be a second one. That reasoning holds for an *embedded*
surface and does not hold for what is actually built: mpv renders into a **separate OS
window**, so the viewer looking at the picture was looking at a window with no controls
in it, while the bar that drives it sat behind in a different window.

So `--osc=yes` and `--osd-level=1` are on — mpv's built-in on-screen controller gives
play/pause, a seek bar, volume and fullscreen — and `--input-vo-keyboard=yes` lets keys
reach the window. Verified that the OSC still loads under `--no-config --load-scripts=no`:
it is an internal script, and `--load-scripts` only governs the user's own script
directory. None of this touches decode or network.

**`--input-default-bindings` stays `no`, and the bindings are enumerated instead**
(`NATIVE_KEY_BINDINGS`, applied with mpv's `keybind` command after the IPC channel is up).
mpv's default set quits on `q`, `Q` and `Ctrl+q` — and an exit while playing is reported
as `ended`, which `NativeEngineStage` turns into `onEnded()`, so a viewer pressing `q` to
stop watching would be handed the next episode. The defaults also bind `s` to a screenshot
written beside the working directory. Every enumerated binding matches what the same key
already does in `VideoPlayer` (`SKIP_SECONDS` is 10 in both), because the two windows are
one player and a key that seeks 10 in one and 60 in the other is worse than a dead key.

Two consequences worth keeping:

- **Nothing new syncs.** `pause`, `volume`, `mute`, `speed` and `fullscreen` are already in
  `OBSERVED`, so whatever the viewer changes in mpv's window arrives back as a
  `property-change` and our own control bar follows it. Adding a control that mpv can
  change without an `OBSERVED` entry behind it would be the first thing here to need a
  second sync path.
- **`end-file` with reason `quit` now reports `idle`.** Closing mpv's window — or any
  binding that quits — used to reach `child.on('exit')` while `state` was still `playing`,
  which is the credits as far as that handler is concerned. The next episode started in a
  new window. Same rule as `shutdownNow`, reached from mpv's side instead of ours.

**What is not built: embedding.** mpv renders in its own window, driven over IPC — the
roadmap's Option A, which it calls the recommended first step. Putting the video surface
inside the Electron window needs libmpv's render API through a native addon (Option B).
`MpvOpenRequest.windowHandle` exists and is passed to `--wid` for when that lands; nothing
sets it today.

### The second film would not play (2026-08-24)

Reported as: the first title plays, and after that nothing does — a different film, a
different source, or the same one again. Four causes, and none of them is the one the
symptom points at.

1. **The persistent probe cache was keyed on the loopback address.** `ContentService` wraps
   a provider link through `MediaProxy` to attach its headers, producing
   `http://127.0.0.1:<port>/stream/1`, and `PlaybackEngine.inspect` handed *that* to
   `InspectionStore` — which persists. The token is minted per process, so `/stream/1` is
   one film this run and a different one the next: the second film was decided from the
   first film's codecs, and an HEVC release was attached as though it were H.264.
   `MediaProxy.getTargetRoute` unwraps a loopback URL back to the upstream one, the
   capability cache and the store are keyed on **that plus the headers**, and the store now
   refuses loopback keys outright and prunes the ones already written.

2. **An idle mpv left its window on screen.** `stop()` sent `['stop']` and left the process
   alive under `--idle=yes`, so a blank standalone window floated over the app for every
   source that was not routed to mpv, and for the player being closed. It quits now.

3. **Which immediately created a race, and it is the ordinary source switch.**
   `NativeEngineStage`'s effect cleanup fires `mpv:stop` and its body fires `mpv:open` in
   the same tick, neither awaiting the other. Interleaved, the quit's `teardown()` — and the
   `kill()` that used to be scheduled on a detached 1.5s timer — landed on the process the
   open had just started. `MpvEngine.serialize` puts `open`, `stop` and `shutdown` on one
   queue, and `shutdownNow` waits for the child's `exit` (~100ms typically) instead of
   arming a timer at a process that may no longer be the one it meant. Pinned by three cases
   in `mpvEngine.test.mts`; the pre-fix engine fails the first of them by timing out waiting
   for the switched-to source to play.

   Two smaller rules fell out of it. An explicit stop clears `state` **before** the quit,
   because `child.on('exit')` reports `ended` when the process dies while playing and
   `NativeEngineStage` turns an `ended` snapshot into `onEnded()` — the next-episode
   advance. And `playback:stop` no longer stops mpv at all: not every session owns a stream,
   and the detail page's source picker starts one through `startSourceDiscovery` purely to
   scrape, so closing the picker killed the film playing in the mini player. Closing the
   player is what must close mpv, and `handleClosePlayer`, `VideoPlayer`'s unmount and
   `NativeEngineStage`'s teardown all do it directly.

4. **The preparation effect depended on object identity, so playback restarted itself.**
   `VideoPlayer`'s `media:prepare` effect listed `activeSource?.directHeaders` and
   `activeSource?.drm` in its dependencies. Those come off a `playback:update` snapshot and
   are therefore **new objects every time one arrives** — and `recordBufferStall` pushes one
   on every buffer underrun. So a stall tore the stream down and re-prepared it, which
   caused the next stall. Identity now comes from a serialised `activeSourceKey`, and the
   effect depends on a `sourceConfig` memo keyed on that. **If you add a source field to
   that effect, add it to the key, not to the dependency array.**

`electron/media/mpvEngine.test.mts` (17 cases, `bun run test:native`) drives a real mpv
process against a synthesised HEVC 10-bit / AC-3 5.1 Matroska fixture. It is not pure and
should not be: every failure worth catching lives in the seam between two processes — the
JSON framing, `request_id` correlation, the property observations that drive the timeline,
`end-file` telling a dead link apart from the credits — and a mock would only ever assert
what we assumed mpv does.

### FFmpeg 7.1 silently broke the image-segment fix

`-allowed_extensions ALL` — the documented answer to `Hdmovie2` serving MPEG-TS from `.png`
URLs — **stopped working, and nothing in this repository changed on the day it did.**
FFmpeg 7.1 added `-extension_picky`, defaulted it to *true*, and evaluates it before the
allow-list. On the bundled build (n8.0) the old flag is inert and every provider serving
extensionless or image-named segments fails with the exact message the fix was written
against.

Measured against a local HLS fixture with `.png` segments served as `image/png`:

| Flags | Result |
|---|---|
| `-allowed_extensions ALL` | refused |
| `-allowed_segment_extensions ALL` | refused |
| `-extension_picky 0` | **probes cleanly** |

The flag cannot simply be added: passing an option a binary does not know is fatal to the
whole command line (`Option extension_picky not found`), and FFmpeg 7.0 is still in the
download mirrors. So `detectExtensionPicky` asks the binary via `-h demuxer=hls` once at
startup and again after any ffmpeg install, and `hlsDemuxerOptions()` includes the flag
only where it exists. Pinned by `pipeline.test.mts`.

Found by `tools/e2e/native-engine-matrix.mjs` on a real provider playlist, on its first
run — which is the argument for that harness existing.

### 5.2 The vendor coverage matrix — `tools/e2e/native-engine-matrix.mjs`

```
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --plugins 12 --links 2
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --only Cinefreak,HDhub4u
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --titles hindi-movie,english-series
```

`provider-e2e.mjs` answers "does the extension corpus still run?". This answers the question
after it: **given what those extensions hand back, can this app put it on screen?** Those are
different failures with different owners — a provider resolving five links to 10-bit HEVC is
working perfectly and is still, without the native engine, five links we could not play.

It imports the shipping `MediaInspector` and `decideStrategy` rather than reimplementing
them, so the strategy in the report is literally the one the app will choose for that URL;
a harness with its own copy of the decision agrees with the product right until it matters.
Every candidate stream is then **played for real by mpv for a few seconds**, headless
(`--vo=null --ao=null`, which still runs the full demux and decode path), and the report
carries how far the playhead got and how many frames dropped. `--untimed` is deliberately
not passed — decoding as fast as the CPU allows would hide the exact failure being looked
for, a stream that cannot sustain realtime.

Each row records **both** verdicts: what the strategy would have been without the engine and
what it is with it. A row where they differ is a stream that used to be re-encoded and now
is not, which is the only honest way to state what the engine bought.

Language coverage is deliberate rather than decorative. Hindi releases are where the hard
cases cluster — dual-audio Matroska with per-language 5.1 AC-3/E-AC-3, 10-bit HEVC encodes,
the multi-track files the audio-selection logic exists for — so a matrix of English titles
alone reports a compatibility story that is true for half the catalogue.

### When we cannot play it, hand it to something that can

`externalPlayer.ts` detects VLC, mpv, MPC-HC/BE and PotPlayer and offers to open
the stream in them. This is not a fallback for our bugs — there is a category of
file Chromium will never decode, and VLC and mpv carry their own ffmpeg and play
essentially anything.

**The URL handed over is the proxied one.** External players each have their own
incompatible way of setting a `Referer` (`--http-referrer`, `--http-header-fields`,
nothing at all), and a provider link without its header is a 403 in any of them.
The loopback URL has the headers applied already, so every player works with no
per-player knowledge.

**Nothing is downloaded on the user's behalf.** Players are detected, never
fetched; when none is found the official download pages open in the browser.
`shell:openExternal` re-checks the scheme because, unlike `setWindowOpenHandler`,
it is reachable from the renderer with an arbitrary string.

The offer is suppressed when the source is dead — a 404 plays no better in VLC,
and sending someone to install a player that cannot help is worse than saying
nothing. That distinction comes from `describeUnreadableSource`: when a probe
returns nothing, the source is asked for its HTTP status with a one-byte range
GET (HEAD is refused by some hosts). A reported failure turned out to be a plain
404 while the message on screen was still guessing at codecs.

### Provider links need the provider's headers, and a browser cannot send them

Extension links routinely only answer when accompanied by the `Referer` the
provider supplied. `ExtractorLink` carries it, and for a long time it reached the
download engine and nothing else: playback handed the raw URL to `<video>`, which
sends neither `Referer` nor a custom `User-Agent`. No renderer-side fix was
possible — `Referer` is a forbidden header for `fetch`/XHR precisely so pages
cannot forge it.

One cause, two unrecognisably different symptoms:

- **HLS** — `manifestLoadError` from hls.js, because the host 403'd the playlist.
- **Progressive** — "could not decode this file", because *ffprobe* could not read
  it either, so the player had no codec to name and fell through to the generic
  message.

`mediaProxy.ts` serves the stream from loopback with the headers applied, and
`ContentService.startStream` wraps every `directUrl` through it. That fixes all
three consumers at once — the media element, hls.js and ffprobe/ffmpeg — because
they are all handed the same loopback URL. A link with no headers is passed
through untouched rather than gaining a pointless hop.

**HLS playlists are rewritten, not forwarded.** A manifest names its segments,
keys and variant playlists by URL, and those requests would otherwise go straight
from the renderer to the host without headers — succeeding on the manifest and
then failing on every segment, which is worse than failing outright. Both forms
are covered: bare URI lines and quoted `URI="…"` attributes (`EXT-X-KEY`,
`EXT-X-MAP`, `EXT-X-MEDIA`). Relative URIs resolve against the *final* upstream
URL so a playlist reached via redirect still resolves correctly.

Bound to loopback only: it forwards arbitrary URLs with caller-supplied headers.

**A loopback URL is returned from `wrap` untouched.** Everything that serves media
locally — the torrent engine, this proxy, the transcoder — hands back
`http://127.0.0.1:…`, which matches the scheme test. Without the guard the
compatibility engine wraps a torrent stream in a second proxy hop that copies every
byte for nothing, and re-wrapping this proxy's own output builds a chain that grows
by one hop per call. There is nothing to gain either way: header injection exists to
satisfy a third-party CDN's hotlink check, and our own servers set what they need.

**A source that answers 4xx is failed over immediately, not converted.** Expired
signed URLs from Cloudflare Workers and Googleusercontent are the routine case, and
opening ffmpeg on one costs its startup plus the wait for the element to give up
before the next mirror gets a turn. `PlaybackEngine.prepare` returns the failure as
soon as `describeUnreadableSource` reports it dead, and the player asks the session
for the next candidate.

### The media proxy's tokens were `1`, `2`, `3` (2026-08-27)

Every response carries `Access-Control-Allow-Origin: *` so that ffprobe, hls.js, Shaka, mpv and
an external VLC can all read from one door — which is correct and load-bearing. Combined with
sequential tokens it meant **any page open in the user's browser could fetch
`http://127.0.0.1:<port>/stream/1` cross-origin, read the body, and walk the integers to
enumerate the session's viewing.** The ephemeral port is a speed bump, not a control. Tokens
are 16 random bytes now (`[0-9a-f]{32}` in all five route regexes), `tokensByKey` keeps them
stable so nothing downstream changed, and a `Host` header that does not name loopback is
refused — binding to 127.0.0.1 says nothing about DNS rebinding. Pinned by two new cases in
`mediaProxy.test.mts`; `fetch` refuses to set `Host`, so that one uses a raw `http.request`.

